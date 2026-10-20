import { describe, expect, it } from 'vitest';
import { createDeepSeekMatchConfig } from '../src/content/matches';
import { createObservation, parseExternalAction, MAX_OBSERVATION_AGE, MAX_RECENT_ACTIONS } from '../src/game/ai/external/Protocol';
import { MatchRunner } from '../src/game/core/MatchRunner';
import { idleInput } from '../src/game/core/types';
import { DeepSeekClient } from '../src/adapters/ai/DeepSeekClient';
import type { DeepSeekSession, DeepSeekStatus } from '../src/adapters/ai/DeepSeekClient';
import type { ExternalAction } from '../src/game/ai/external/Protocol';

export function externalRunner(): MatchRunner {
  const config = createDeepSeekMatchConfig(42, { matchId: 'test-episode' });
  const runner = new MatchRunner({ ...config, countdown: 0, map: {
    id: 'flat', name: '测试台', width: 1200, height: 700,
    spawns: [{ x: 100, y: 500 }, { x: 800, y: 500 }],
    bounds: { left: -100, right: 1300, top: -500, bottom: 700 },
    platforms: [{ id: 'floor', x: 0, y: 500, width: 1200, height: 30, kind: 'one-way' }],
  } });
  runner.advance(1000 / 60, idleInput); runner.advance(1000 / 60, idleInput);
  return runner;
}
const action: ExternalAction = { ...idleInput(), moveX: 1, shootHeld: true, holdFrames: 12 };
const context = (runner: MatchRunner, sequence = 1) => ({ epoch: runner.externalEpoch('deepseek')!, sequence, observationTick: runner.tick });

describe('external direct control', () => {
  it('moves, shoots and throws using real simulation, and consumes jump/bomb only once', () => {
    const runner = externalRunner();
    const actor = runner.state.actors[1]!;
    const x = actor.position.x;
    expect(runner.applyExternalInput('deepseek', { ...action, jumpPressed: true, bombPressed: true }, context(runner))).toBe(true);
    const events = [];
    for (let f = 0; f < 40; f++) events.push(...runner.advance(1000 / 60, idleInput));
    expect(actor.position.x).toBeGreaterThan(x);
    expect(actor.jumpsRemaining).toBe(1);
    expect(actor.bombsRemaining).toBe(1);
    expect(events.filter((e) => e.type === 'bomb')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'shot' && e.actorId === 'deepseek')).toHaveLength(1);
    expect(actor.moveVelocity).toBe(0);
  });

  it('turns an attack intent into approach and fire even when the model omits shootHeld', () => {
    const runner = externalRunner();
    const actor = runner.state.actors[1]!;
    const before = actor.position.x;
    const c = context(runner);
    expect(runner.applyExternalInput('deepseek', {
      ...idleInput(), intent: 'attack', moveX: 0, shootHeld: false, holdFrames: 12,
    }, c)).toBe(true);
    const events = [];
    for (let frame = 0; frame < 4; frame++) events.push(...runner.advance(1000 / 60, idleInput));
    expect(actor.position.x).toBeLessThan(before);
    expect(events.filter((event) => event.type === 'shot' && event.actorId === 'deepseek')).toHaveLength(1);
  });

  it('rejects duplicates, future and stale inputs, invalid values, and cross-actor input', () => {
    const runner = externalRunner(); const c = context(runner);
    expect(runner.applyExternalInput('p1', action, c)).toBe(false);
    expect(runner.applyExternalInput('deepseek', action, { ...c, observationTick: runner.tick + 1 })).toBe(false);
    expect(runner.applyExternalInput('deepseek', { ...action, holdFrames: Infinity }, c)).toBe(false);
    expect(runner.applyExternalInput('deepseek', action, c)).toBe(true);
    expect(runner.applyExternalInput('deepseek', action, c)).toBe(false);
    for (let f = 0; f < MAX_OBSERVATION_AGE; f++) runner.advance(1000 / 60, idleInput);
    expect(runner.applyExternalInput('deepseek', action, { ...c, sequence: 2 })).toBe(false);
    expect(parseExternalAction({ ...action, jumpPressed: true, dropPressed: true })).toBeNull();
    expect(parseExternalAction({ ...action, moveX: '1' })).toBeNull();
    expect(parseExternalAction({ ...action, intent: 'recover' })?.intent).toBe('recover');
    expect(parseExternalAction({ ...action, intent: 'teleport' })).toBeNull();
  });

  it('invalidates commands on pause, countdown and respawn while the latency skill keeps moving', () => {
    const runner = externalRunner(); const c = context(runner);
    runner.applyExternalInput('deepseek', { ...action, holdFrames: 45 }, c);
    runner.pause(); runner.resume();
    expect(runner.applyExternalInput('deepseek', action, c)).toBe(false);
    for (let f = 0; f < 190; f++) runner.advance(1000 / 60, idleInput);
    expect(runner.state.actors[1]!.position.x).not.toBe(800);
    const beforeDeath = context(runner, 2);
    runner.state.actors[1]!.position.y = 1000;
    for (let frame = 0; frame < 4; frame++) runner.advance(1000 / 60, idleInput);
    for (let f = 0; f < 70; f++) runner.advance(1000 / 60, idleInput);
    expect(runner.state.actors[1]!.status).toBe('alive');
    expect(runner.state.actors[1]!.stocks).toBe(2);
    expect(runner.applyExternalInput('deepseek', action, beforeDeath)).toBe(false);
    expect(runner.applyExternalInput('deepseek', action, context(runner, 3))).toBe(true);
  });

  it('copies observations without seed, opponent ammo, future drop timers or mutable references', () => {
    const runner = externalRunner();
    const obs = createObservation(runner.state, 'deepseek', runner.tick);
    const original = runner.state.actors[1]!.position.x;
    obs.self.x = -100;
    obs.map.platforms[0]!.x = 999;
    expect(runner.state.actors[1]!.position.x).toBe(original);
    expect(runner.state.config.map.platforms[0]!.x).toBe(0);
    expect(obs.enemies[0]).not.toHaveProperty('ammo');
    expect(obs).not.toHaveProperty('seed');
    expect(obs).not.toHaveProperty('config');
  });

  it('adds bounded tactical telemetry and keeps only the latest action memory', () => {
    const runner = externalRunner();
    const recentActions = Array.from({ length: MAX_RECENT_ACTIONS + 3 }, (_, tick) => ({ ...action, tick }));
    const obs = createObservation(runner.state, 'deepseek', runner.tick, recentActions);
    expect(obs.tactical.nearestEnemyId).toBe('p1');
    expect(obs.tactical.currentPlatformId).toBe('floor');
    expect(obs.tactical.edgeDistanceLeft).toBeGreaterThan(0);
    expect(obs.tactical.edgeDistanceRight).toBeGreaterThan(0);
    expect(obs.tactical.platformEdgeDistanceLeft).toBeGreaterThan(0);
    expect(obs.tactical.platformEdgeDistanceRight).toBeGreaterThan(0);
    expect(obs.tactical.priority).toBe('attack');
    expect(obs.tactical.routeAction).toBe('hold');
    expect(obs.recentActions).toHaveLength(MAX_RECENT_ACTIONS);
    expect(obs.recentActions[0]!.tick).toBe(3);
    expect(obs.recentActions.at(-1)!.tick).toBe(10);
  });

  it('uses a small emergency input only when an external actor is at an exposed edge', () => {
    const runner = externalRunner();
    const actor = runner.state.actors[1]!;
    actor.position.x = runner.state.config.map.bounds.left + 10;
    actor.moveVelocity = 0;
    actor.impulse.x = 0;
    actor.groundedOn = 'floor';
    const before = actor.position.x;
    runner.advance(1000 / 60, idleInput);
    expect(actor.position.x).toBeGreaterThan(before);
    expect(actor.verticalVelocity).toBeLessThan(0);
  });
});

describe('DeepSeek transport lifecycle', () => {
  const session: DeepSeekSession = { sessionId: 'test-session', model: 'deepseek-flash', maxRequests: 180, requestIntervalMs: 1000, timeoutMs: 5000, contextTokens: 512000 };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('applies a model reply and keeps only one request in flight', async () => {
    const runner = externalRunner(); const statuses: DeepSeekStatus[] = [];
    let resolve!: (r: Response) => void; let calls = 0;
    let sent: { epoch: number; sequence: number; observation: { tick: number } };
    const fetcher: typeof fetch = async (_url, options) => {
      if (JSON.parse(options!.body as string).close) return new Response('{}');
      calls++; sent = JSON.parse(options!.body as string) as typeof sent;
      return await new Promise<Response>((done) => { resolve = done; });
    };
    const client = new DeepSeekClient(runner, 'deepseek', session, (s) => { if (s) statuses.push(s); }, fetcher, () => 0);
    client.update(); client.update(); client.update();
    expect(calls).toBe(1);
    resolve(new Response(JSON.stringify({ action, sequence: sent!.sequence, epoch: sent!.epoch, observationTick: sent!.observation.tick, usage: { requests: 1, promptTokens: 10, completionTokens: 5 } })));
    await flush();
    const before = runner.state.actors[1]!.position.x;
    for (let frame = 0; frame < 4; frame++) runner.advance(1000 / 60, idleInput);
    expect(runner.state.actors[1]!.position.x).toBeGreaterThan(before);
    expect(statuses.at(-1)?.decisions).toBe(1);
    client.destroy();
  });

  it('feeds the next decision a compact outcome for the previous action', async () => {
    const runner = externalRunner(); let time = 0; const bodies: Array<{ observation: ReturnType<typeof createObservation> }> = [];
    const fetcher: typeof fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string) as { close?: boolean; observation: ReturnType<typeof createObservation>; sequence: number; epoch: number };
      if (body.close) return new Response('{}');
      bodies.push(body);
      return new Response(JSON.stringify({ action, sequence: body.sequence, epoch: body.epoch, observationTick: body.observation.tick }));
    };
    const client = new DeepSeekClient(runner, 'deepseek', session, () => {}, fetcher, () => time);
    client.update(); await flush();
    for (let frame = 0; frame < 20; frame++) runner.advance(1000 / 60, idleInput);
    time = 1000; client.update(); await flush();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.observation.recentActions).toHaveLength(1);
    expect(bodies[1]!.observation.recentActions[0]!.outcome?.deltaX).toBeGreaterThan(0);
    client.destroy();
  });

  it('discards a late reply after pause and aborts the pending request', async () => {
    const runner = externalRunner();
    let resolve!: (r: Response) => void; let signal: AbortSignal | null = null;
    let sent: { epoch: number; sequence: number; observation: { tick: number } };
    const fetcher: typeof fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string) as Record<string, unknown>;
      if (body.close) return new Response('{}');
      signal = options!.signal as AbortSignal; sent = body as typeof sent;
      return await new Promise<Response>((done) => { resolve = done; });
    };
    const client = new DeepSeekClient(runner, 'deepseek', session, () => {}, fetcher);
    client.update(); runner.pause(); client.update();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    resolve(new Response(JSON.stringify({ action, sequence: sent!.sequence, epoch: sent!.epoch, observationTick: sent!.observation.tick })));
    await flush(); runner.resume();
    for (let f = 0; f < 190; f++) runner.advance(1000 / 60, idleInput);
    expect(runner.state.actors[1]!.position.x).not.toBe(800);
    client.destroy();
  });

  it.each(['BUDGET', 'CONTEXT_TOO_LARGE'])('stops requesting after a terminal %s error while the latency skill remains active', async (code) => {
    const runner = externalRunner(); let calls = 0; let time = 0;
    const statuses: DeepSeekStatus[] = [];
    const fetcher: typeof fetch = async (_url, options) => {
      if (JSON.parse(options!.body as string).close) return new Response('{}');
      calls++; return new Response(JSON.stringify({ error: code, message: '预算用完' }), { status: code === 'BUDGET' ? 429 : 413 });
    };
    const client = new DeepSeekClient(runner, 'deepseek', session, (s) => { if (s) statuses.push(s); }, fetcher, () => time);
    client.update(); await flush(); time = 30000; client.update();
    expect(calls).toBe(1); expect(statuses.at(-1)?.phase).toBe('error');
    for (let f = 0; f < 60; f++) runner.advance(1000 / 60, idleInput);
    expect(runner.state.actors[1]!.position.x).not.toBe(800);
    client.destroy();
  });
});
