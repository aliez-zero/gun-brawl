import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCampaignConfig, CAMPAIGN_LEVELS } from '../src/content/campaign';
import { createCustomMatchConfig, createDeepSeekMatchConfig, createMatchConfig } from '../src/content/matches';
import { DeepSeekClient, type DeepSeekSession } from '../src/adapters/ai/DeepSeekClient';
import type { GameObservation } from '../src/game/ai/external/Protocol';
import { NetMatchSource } from '../src/net/NetMatchSource';
import { idleInput } from '../src/game/core/types';
import type { NetClient } from '../src/net/NetClient';
import { Predictor, type PredictedPose } from '../src/net/Predictor';
import { EDGE_BOMB, EDGE_JUMP, EVENT_BOMB, EVENT_BOMB_EMPTY, EVENT_DROP_LANDED, EVENT_EXPLOSION, EVENT_OVERTIME, EVENT_PHASE, EVENT_PICKUP, EVENT_RELOAD, EVENT_RINGOUT, EVENT_SHOT, HELD_FIRE, PHASE_COUNTDOWN, PHASE_PAUSED, PHASE_PLAYING, SLOT_BOT, SLOT_EMPTY, SLOT_HUMAN } from '../src/net/protocol';
import type { RoomView, Snapshot } from '../src/net/protocol';

const room: RoomView = {
  code: 'ABC123',
  host: 1,
  phase: 0,
  map: 'sky-citadel',
  stocks: 3,
  duration: 180,
  dropMode: 0,
  weapons: ['pistol'],
  slots: [
    { kind: SLOT_HUMAN, player: 1, name: 'Me', ready: true, difficulty: 1 },
    { kind: SLOT_BOT, player: 0, name: 'AI', ready: true, difficulty: 1 },
    { kind: SLOT_EMPTY, player: 0, name: '', ready: false, difficulty: 1 },
    { kind: SLOT_EMPTY, player: 0, name: '', ready: false, difficulty: 1 },
  ],
};

function actorSnap(x = 640, y = 300, vx = 0) {
  return {
    id: 0, x: x * 16, y: y * 16, vx, vy: 0, impulseX: 0, impulseY: 0,
    facing: 1, flags: 1, status: 0, stocks: 3, weapon: 0, ammo: 255, reserve: 0,
    fireCd: 0, reloadMs: 0, bombCooldownMs: 0, protection: 0, respawn: 0,
    groundedPlatform: 0, dropPlatform: 255, dropTimer: 0, coyoteTimer: 0, jumpTimer: 0, bombs: 2, knockouts: 0, falls: 0, selfFalls: 0,
  };
}

function snapshot(x = 640, y = 300, vx = 0): Snapshot {
  return {
    tick: 1, playingTick: 1, serverMs: 1000, phase: PHASE_PLAYING, remainingMs: 180_000, acks: [0, 0, 0, 0],
    countdownMs: 0, overtime: false, trainingCompleted: 0, dummyMoving: false, externalEpoch: 0,
    actors: [actorSnap(x, y, vx), { ...actorSnap(700, y), id: 1 }],
    projectiles: [], bombs: [], drops: [], events: [],
  };
}

function fakeClient(): NetClient & { sends: number; frames: { edges: number; seq: number }[] } {
  const client = {
    playerId: 1,
    sends: 0,
    frames: [] as { edges: number; seq: number }[],
    sendInput: (frames: { edges: number; seq: number }[]) => {
      client.sends += 1;
      client.frames.push(...frames);
    },
  };
  return client as unknown as NetClient & { sends: number; frames: { edges: number; seq: number }[] };
}

function fakePredictor(): Predictor & {
  steps: number;
  poseX: number;
  jumps: boolean[];
} {
  let pose: PredictedPose = {
    x: 640, y: 300, vx: 0, vy: 0, impulseX: 0, impulseY: 0,
    facing: 1, grounded: 1, jumps: 2, dropRemaining: 0,
  };
  const fake = {
    steps: 0,
    get poseX() { return pose.x; },
    jumps: [] as boolean[],
    mapIndex: () => 0,
    create: () => 1,
    step: (_handle: number, input: { jump: boolean }) => {
      fake.steps += 1;
      fake.jumps.push(input.jump);
      pose.x += 0.1;
      if (input.jump) {
        pose.y -= 11.5;
        pose.vy = -690;
      }
    },
    pose: () => ({ ...pose }),
    reconcile: (_handle: number, value: Parameters<Predictor['reconcile']>[1]) => {
      pose = { ...value, dropRemaining: 0 };
    },
    destroy: () => {},
  };
  return fake as unknown as Predictor & {
    steps: number;
    poseX: number;
    jumps: boolean[];
  };
}

/** Drives advance() at a fixed frame rate against a controllable clock. */
function runFrames(source: NetMatchSource, hz: number, frames: number): void {
  const step = 1000 / hz;
  for (let index = 0; index < frames; index++) {
    clock += step;
    source.advance(step, idleInput);
  }
}

let clock = 0;

afterEach(() => {
  vi.restoreAllMocks();
  clock = 0;
});

function setUp() {
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const client = fakeClient();
  const predictor = fakePredictor();
  const source = new NetMatchSource(client, room, predictor);
  source.applySnapshot(snapshot());
  return { client, predictor, source };
}

function renderedX(source: NetMatchSource): number {
  const actor = source.state.actors[0]!;
  const { alpha, offset } = source.localPoses.get(0)!;
  return actor.previous.x + (actor.position.x - actor.previous.x) * alpha + offset.x;
}

describe('NetMatchSource fixed-step prediction', () => {
  it('simulates ~60 steps per second at 144 Hz instead of one step per frame', () => {
    const { client, predictor, source } = setUp();
    runFrames(source, 144, 144);
    expect(predictor.steps).toBeGreaterThanOrEqual(55);
    expect(predictor.steps).toBeLessThanOrEqual(65);
    expect(client.sends).toBeGreaterThanOrEqual(55);
    expect(client.sends).toBeLessThanOrEqual(65);
  });

  it('keeps 60 steps per second even when the renderer drops to 37 fps', () => {
    const { predictor, source } = setUp();
    runFrames(source, 37, 37);
    expect(predictor.steps).toBeGreaterThanOrEqual(55);
    expect(predictor.steps).toBeLessThanOrEqual(65);
  });

  it('runs ~60 steps per second at 60 Hz too', () => {
    const { predictor, source } = setUp();
    runFrames(source, 60, 60);
    expect(predictor.steps).toBeGreaterThanOrEqual(58);
    expect(predictor.steps).toBeLessThanOrEqual(62);
  });

  it('adopts server knockback without teleporting the actor', () => {
    const { client, predictor, source } = setUp();
    runFrames(source, 60, 30);
    const before = renderedX(source);
    const next = snapshot(600, 300);
    next.tick = 3;
    next.acks[0] = client.frames.at(-1)!.seq;
    next.actors[0]!.impulseX = 400 * 8;
    source.applySnapshot(next);

    expect(predictor.pose(1).impulseX).toBe(400);
    expect(predictor.pose(1).vx).toBe(0);
    expect(source.state.actors[0]!.position.x).toBe(600);
    expect(renderedX(source)).toBeCloseTo(before, 5);
  });

  it('delivers a jump that lands on a frame which advances no step', () => {
    const { client, predictor, source } = setUp();
    // 100 Hz: 10 ms per frame, so most frames cannot advance the 16.7 ms fixed step.
    clock += 10;
    source.advance(10, () => ({ ...idleInput(), jumpPressed: true }));
    expect(predictor.steps).toBe(0);

    // Keep rendering without any new press; the buffered edge must survive to the next step.
    clock += 10;
    source.advance(10, idleInput);
    clock += 10;
    source.advance(10, idleInput);

    expect(predictor.steps).toBeGreaterThanOrEqual(1);
    expect(predictor.jumps[0]).toBe(true);
    const firstEdgeFrame = client.frames.find((frame) => frame.edges !== 0);
    expect(firstEdgeFrame?.edges).toBe(EDGE_JUMP);
  });

  it('sends exactly one edge per press', () => {
    const { client, source } = setUp();
    clock += 20;
    source.advance(20, () => ({ ...idleInput(), jumpPressed: true }));
    for (let index = 0; index < 10; index++) {
      clock += 20;
      source.advance(20, idleInput);
    }
    const withEdges = client.frames.filter((frame) => frame.edges !== 0);
    expect(withEdges).toHaveLength(1);
    expect(withEdges[0]!.edges).toBe(EDGE_JUMP);
  });

  it('keeps an interpolation pair for the predicted actor', () => {
    const { source } = setUp();
    runFrames(source, 60, 10);
    const actor = source.state.actors[0]!;
    // Collapsed previous/position was why a 60 Hz prediction looked steppy on a 100/144 Hz
    // display: the renderer had nothing to interpolate towards.
    expect(actor.previous.x).not.toBeCloseTo(actor.position.x, 6);
    expect([...source.localPoses.keys()]).toEqual([0]);
    expect(source.localPoses.get(0)!.alpha).toBeGreaterThanOrEqual(0);
    expect(source.localPoses.get(0)!.alpha).toBeLessThan(1);
  });

  it('replays an unacknowledged jump using the room slot rather than the actor index', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const client = fakeClient();
    const predictor = fakePredictor();
    const source = new NetMatchSource(client, {
      ...room, slots: [room.slots[1]!, room.slots[2]!, room.slots[0]!, room.slots[3]!],
    }, predictor);
    source.applySnapshot(snapshot());
    runFrames(source, 100, 1);
    clock += 17;
    source.advance(17, () => ({ ...idleInput(), jumpPressed: true }));
    const jumpSeq = client.frames[0]!.seq;
    expect(predictor.pose(1).vy).toBe(-690);

    const stillGrounded = snapshot();
    stillGrounded.tick = 3;
    stillGrounded.acks[1] = jumpSeq; // an unrelated slot
    source.applySnapshot(stillGrounded);
    expect(predictor.pose(1).vy).toBe(-690);
    expect(source.state.actors[1]!.position.y).toBe(288.5);

    const confirmed = snapshot(640, 288.5);
    confirmed.tick = 5;
    confirmed.acks[2] = jumpSeq;
    confirmed.actors[1]!.vy = -690 * 8;
    source.applySnapshot(confirmed);
    expect(predictor.jumps.filter(Boolean)).toHaveLength(2); // initial and one replay
    expect(source.state.actors[1]!.position.y).toBe(288.5);
  });
});

describe('NetMatchSource remote playback', () => {
  it('keeps remote actors, projectiles and bombs moving across a late snapshot', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const source = new NetMatchSource(fakeClient(), room);
    const step = 1000 / 60;
    const send = (tick: number) => {
      const next = snapshot();
      next.tick = tick;
      next.actors[1] = { ...actorSnap(700 + tick * 5, 300, 300 * 8), id: 1 };
      next.projectiles = [{ id: 3, owner: 1, weapon: 0, x: (720 + tick * 10) * 16, y: 4800, vx: 600 * 8, vy: 0 }];
      next.bombs = [{ id: 5, owner: 1, x: (740 + tick * 5) * 16, y: 4800, fuseMs: 800, vx: 300 * 8, vy: 0 }];
      source.applySnapshot(next);
    };
    const positions = () => [source.state.actors[1]!, source.state.projectiles[0]!, source.state.bombs[0]!]
      .map(({ previous, position }) => previous.x + (position.x - previous.x) * source.alpha);

    clock = 1000;
    send(0);
    source.advance(step, idleInput);
    for (let tick = 1; tick <= 14; tick++) {
      clock += step;
      if (tick <= 12 && tick % 2 === 0) send(tick);
      source.advance(step, idleInput);
    }
    const beforeLateFrame = positions(); // already one snapshot interval since tick 12 arrived
    clock += step;
    source.advance(step, idleInput);
    expect(positions().every((position, index) => position > beforeLateFrame[index]!)).toBe(true);
    expect(source.state.actors[1]!.moveVelocity).toBe(300);

    for (let tick = 0; tick < 12; tick++) {
      clock += step;
      source.advance(step, idleInput);
    }
    const staleFrame = positions();
    clock += step;
    source.advance(step, idleInput);
    expect(positions()).toEqual(staleFrame); // extrapolation is bounded if packets stop
  });
});

function captureClient() {
  const socket = { playerId: 1, connected: true, sendInput: vi.fn(), sendPrivateInput: vi.fn(), privateControl: vi.fn() };
  return { client: socket as unknown as NetClient, socket };
}

function event(kind: number, extra: Partial<Snapshot['events'][number]> = {}) {
  return { kind, actor: 0, x: 160, y: 320, object: 0, weapon: 0, other: 255, radius: 0, ...extra };
}

describe('private authoritative matches', () => {
  it('predicts both keyboard players with the shipped WASM and sends independent inputs to their actor indices', async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const wasm = readFileSync(new URL('../public/predict.wasm', import.meta.url));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Uint8Array.from(wasm)));
    const predictor = await Predictor.load();
    const { client, socket } = captureClient();
    const config = createCustomMatchConfig({ mapId: room.map, duration: 180, stocks: 3, dropMode: 'none',
      slots: [{ kind: 'human', inputSlot: 1 }, { kind: 'bot', difficulty: 'hard' }, { kind: 'human', inputSlot: 2 }] }, 17);
    const source = new NetMatchSource(client, room, predictor, config);
    const wire = snapshot(500, 300);
    wire.actors.push({ ...actorSnap(800, 300), id: 2 });
    source.applySnapshot(wire);
    expect([...source.localPoses.keys()]).toEqual([0, 2]);
    expect(source.state.actors.map((actor) => actor.config)).toEqual(config.actors);
    source.advance(0, (slot) => ({ ...idleInput(), jumpPressed: slot === 1, bombPressed: slot === 2 }));
    clock = 20;
    source.advance(20, (slot) => ({ ...idleInput(), moveX: slot === 1 ? 1 : -1, shootHeld: slot === 2 }));
    expect(socket.sendPrivateInput.mock.calls).toEqual([
      [0, [{ seq: 1, tickHint: 1, moveX: 1, held: 0, edges: EDGE_JUMP }]],
      [2, [{ seq: 1, tickHint: 1, moveX: -1, held: HELD_FIRE, edges: EDGE_BOMB }]],
    ]);
    expect(socket.sendInput).not.toHaveBeenCalled();
    expect(source.state.actors[0]!.position.x).toBeGreaterThan(500);
    expect(source.state.actors[2]!.position.x).toBeLessThan(800);
    expect(source.state.actors[0]!.position.y).toBeLessThan(300);
    source.applySnapshot({ ...wire, tick: 3, acks: [1, 1, 0, 0] });
    expect(source.state.actors[0]!.position.x).toBe(500);
    expect(source.state.actors[2]!.position.x).toBeLessThan(800);
    source.dispose();
    expect(source.localPoses.size).toBe(0);
  });

  it('uses keyboard one for a shared-room guest regardless of their occupied slot', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { client, socket } = captureClient();
    const slots = [room.slots[1]!, room.slots[2]!, room.slots[0]!, room.slots[3]!];
    const source = new NetMatchSource(client, { ...room, slots });
    source.applySnapshot(snapshot());
    const read = vi.fn(() => idleInput());
    source.advance(0, read);
    clock = 18;
    source.advance(18, read);
    expect(read.mock.calls).toEqual([[1], [1]]);
    expect(socket.sendInput).toHaveBeenCalledOnce();
    expect(socket.sendPrivateInput).not.toHaveBeenCalled();
    source.pause();
    expect(socket.privateControl).not.toHaveBeenCalled();
  });

  it('keeps training controls server-owned and restores authoritative timers, tasks and actor data', () => {
    const { client, socket } = captureClient();
    const config = createMatchConfig('training', 50, { trainingCompleted: ['move'] });
    const source = new NetMatchSource(client, { ...room, weapons: ['pistol', 'gatling', 'rocket'] }, null, config);
    const wire = snapshot();
    wire.phase = PHASE_PAUSED;
    wire.countdownMs = 1250;
    wire.dummyMoving = false;
    wire.trainingCompleted = (1 << 0) | (1 << 5);
    Object.assign(wire.actors[1]!, { groundedPlatform: 2, impulseX: 720, impulseY: -400, bombs: 0,
      status: 1, weapon: 1, ammo: 11, reserve: 33, fireCd: 20, reloadMs: 3200, bombCooldownMs: 433, protection: 4, respawn: 8,
      knockouts: 2, falls: 3, selfFalls: 1 });
    source.applySnapshot(wire);
    expect(source.state).toMatchObject({ phase: 'paused', countdownRemaining: 1.25, training: { completedTasks: ['move', 'bomb'], dummyMoving: false } });
    expect(source.state.actors[1]).toMatchObject({ config: { id: 'dummy', appearance: config.actors[1]!.appearance },
      status: 'respawning', groundedOn: config.map.platforms[2]!.id, impulse: { x: 90, y: -50 }, bombsRemaining: 0,
      fireCooldown: 0.2, reloadRemaining: 3.2, bombCooldown: 0.433, respawnRemaining: 0.8, protectionRemaining: 0.4,
      weapon: { definition: { id: 'gatling' }, ammoRemaining: 11, reserveRemaining: 33 }, stats: { knockouts: 2, falls: 3, selfFalls: 1 } });
    source.resume();
    source.pause();
    source.resetTraining();
    source.setDummyMoving(true);
    expect(source.selectTrainingWeapon(6)).toBe(true);
    expect(source.selectTrainingWeapon(9)).toBe(false);
    expect(socket.privateControl.mock.calls.map(([action]) => action)).toEqual([
      { type: 'resume' }, { type: 'pause' }, { type: 'resetTraining' }, { type: 'setDummy', moving: true }, { type: 'selectWeapon', weapon: 'rocket' },
    ]);
    expect(source.state.phase).toBe('paused');
    expect(source.state.training!.dummyMoving).toBe(false);
    source.applySnapshot({ ...wire, tick: 2, phase: PHASE_COUNTDOWN, countdownMs: 3000, dummyMoving: true });
    expect(source.state.countdownRemaining).toBe(3);
    expect(source.state.training!.dummyMoving).toBe(true);
  });

  it('maps authoritative entity and event IDs, and settles the campaign result exactly once', () => {
    const { client } = captureClient();
    const config = createCampaignConfig(CAMPAIGN_LEVELS[4]!, 87, { matchId: 'example-match' });
    const source = new NetMatchSource(client, { ...room, weapons: ['pistol', 'at4'] }, null, config);
    const wire = snapshot();
    wire.overtime = true;
    wire.projectiles = [{ id: 12345, owner: 1, weapon: 1, x: 4000, y: 6400, vx: -800, vy: 0 }];
    wire.bombs = [{ id: 45678, owner: 0, x: 300, y: 600, vx: -800, vy: 200, fuseMs: 375 }];
    wire.drops = [{ id: 78912, weapon: 1, x: 600, y: 900, state: 1, timerMs: 4250, warning: true }];
    wire.events = [event(EVENT_SHOT, { actor: 1, weapon: 1 }), event(EVENT_RELOAD, { actor: 1, weapon: 1 }),
      event(EVENT_BOMB, { object: 45678 }), event(EVENT_BOMB_EMPTY), event(EVENT_DROP_LANDED, { object: 78912, weapon: 1 }),
      event(EVENT_PICKUP, { actor: 1, object: 78912, weapon: 1 }), event(EVENT_RINGOUT, { actor: 1, other: 0 }),
      event(EVENT_EXPLOSION, { actor: 0, other: 0, radius: 170 }), event(EVENT_EXPLOSION, { actor: 1, other: 1, radius: 200 }),
      event(EVENT_OVERTIME), event(EVENT_PHASE, { other: PHASE_COUNTDOWN })];
    source.applySnapshot(wire);
    expect(source.state.projectiles[0]).toMatchObject({ id: 12345, owner: 'bot', weaponId: 'at4' });
    expect(source.state.bombs[0]).toMatchObject({ id: 45678, owner: 'p1', velocity: { x: -100, y: 25 }, fuseRemaining: 0.375 });
    expect(source.state.drops[0]).toMatchObject({ id: 78912, weaponId: 'at4', timer: 4.25, warning: true });
    expect(source.advance(0, idleInput)).toMatchObject([
      { type: 'shot', actorId: 'bot', weaponId: 'at4' }, { type: 'reload-start', actorId: 'bot', weaponId: 'at4' },
      { type: 'bomb', actorId: 'p1', bombId: 45678 }, { type: 'bomb-empty', actorId: 'p1' },
      { type: 'drop-landed', dropId: 78912, weaponId: 'at4' }, { type: 'pickup', actorId: 'bot', weaponId: 'at4', dropId: 78912 },
      { type: 'ringout', actorId: 'bot', creditedTo: 'p1' }, { type: 'explosion', ownerId: 'p1', source: 'bomb', radius: 170 },
      { type: 'explosion', ownerId: 'bot', source: 'rocket', radius: 200 }, { type: 'overtime' }, { type: 'phase', phase: 'countdown' },
    ]);
    source.resetConnection();
    source.applySnapshot(wire);
    expect(source.advance(0, idleInput)).toEqual([]);
    const final = { winner: 0, durationMs: 122500, overtime: true, actors: [
      { id: 0, name: '玩家 1', stocks: 1, knockouts: 3, falls: 2, selfFalls: 0 },
      { id: 1, name: '对手', stocks: 0, knockouts: 2, falls: 3, selfFalls: 0 },
    ] };
    const result = source.finish(final);
    expect(result).toMatchObject({ id: 'example-match', mode: 'campaign', campaignLevelId: 'level-5', winner: 'p1',
      duration: 122.5, overtime: true, actors: [{ id: 'p1', knockouts: 3 }, { id: 'bot', stocks: 0 }] });
    expect(source.state.result).toBe(result);
    expect(source.finish(final)).toBe(result);
    expect(source.advance(0, idleInput)).toEqual([]);
  });

  it('submits DeepSeek input for the server observation tick, rejecting stale epochs, expired observations and repeats', () => {
    const { client, socket } = captureClient();
    const config = createDeepSeekMatchConfig(87, { matchId: 'external-match' });
    const source = new NetMatchSource(client, room, null, config);
    const wire = { ...snapshot(), playingTick: 200, tick: 450, externalEpoch: 7 };
    source.applySnapshot(wire);
    expect(source.tick).toBe(200);
    expect(source.externalEpoch('p1')).toBeUndefined();
    expect(source.externalEpoch('deepseek')).toBe(7);
    const action = { ...idleInput(), moveX: -1, shootHeld: true, jumpPressed: true, holdFrames: 12, intent: 'attack' };
    const context = { sequence: 11, epoch: 7, observationTick: 180 };
    const newest = { ...wire, tick: 452, playingTick: 202, actors: wire.actors.map((actor) => ({ ...actor })) };
    Object.assign(newest.actors[1]!, { x: 900 * 16, groundedPlatform: 2, impulseX: 300 * 8, bombs: 1, bombCooldownMs: 283 });
    newest.bombs = [{ id: 32, owner: 1, x: 200, y: 400, vx: 80, vy: -40, fuseMs: 1083 }];
    source.applySnapshot({ ...wire, tick: 451, playingTick: 201 });
    source.applySnapshot(newest);
    expect(source.state.actors[1]!.position.x).toBe(700);
    expect(source.observationState.actors[1]).toMatchObject({ position: { x: 900 }, impulse: { x: 300 },
      groundedOn: config.map.platforms[2]!.id, bombCooldown: 0.283, bombsRemaining: 1 });
    expect(source.observationState.bombs[0]).toMatchObject({ owner: 'deepseek', velocity: { x: 10, y: -5 } });
    expect(source.tick).toBe(202);
    expect(source.applyExternalInput('deepseek', action, { ...context, epoch: 6 })).toBe(false);
    expect(source.applyExternalInput('deepseek', action, { ...context, observationTick: 20 })).toBe(false);
    expect(source.applyExternalInput('deepseek', action, context)).toBe(true);
    expect(source.applyExternalInput('deepseek', action, context)).toBe(false);
    expect(socket.privateControl).toHaveBeenCalledExactlyOnceWith({ type: 'external', actor: 1, ...context,
      input: { moveX: -1, held: HELD_FIRE, edges: EDGE_JUMP, seq: 11, tickHint: 180 }, intent: 1, hold: 12 });
    source.applySnapshot({ ...wire, tick: 453, phase: PHASE_PAUSED, externalEpoch: 8 });
    expect(source.applyExternalInput('deepseek', action, { ...context, epoch: 8, sequence: 12 })).toBe(false);
  });

  it('pairs model observations and previous action feedback with the authoritative snapshots through a delayed reply', async () => {
    const { client, socket } = captureClient();
    const config = createDeepSeekMatchConfig(51, { matchId: 'observation-match' });
    const source = new NetMatchSource(client, room, null, config);
    function send(tick: number, x: number, y: number, platform: number): void {
      const wire = snapshot();
      Object.assign(wire, { tick, playingTick: tick, externalEpoch: 3 });
      Object.assign(wire.actors[1]!, { x: x * 16, y: y * 16, groundedPlatform: platform });
      source.applySnapshot(wire);
    }
    send(100, 600, 300, 0);
    send(102, 610, 300, 0);
    send(104, 650, 320, 1);
    expect(source.state.actors[1]!.position.x).toBe(610);
    let time = 0;
    const requests: { observation: GameObservation; reply(): void }[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { close?: boolean; observation: GameObservation; epoch: number; sequence: number };
      if (body.close) return new Response('{}');
      return new Promise((resolve) => requests.push({ observation: body.observation, reply: () => resolve(new Response(JSON.stringify({
        action: { ...idleInput(), moveX: 1, holdFrames: 12 }, sequence: body.sequence, epoch: body.epoch, observationTick: body.observation.tick,
      }))) }));
    };
    const session: DeepSeekSession = { sessionId: 'test-session', model: 'test', maxRequests: 10, requestIntervalMs: 1000, timeoutMs: 5000, contextTokens: 4096 };
    const model = new DeepSeekClient(source, 'deepseek', session, () => {}, fetcher, () => time);
    try {
      model.update();
      expect(requests[0]!.observation).toMatchObject({ tick: 104, self: { x: 650, y: 320, groundedOn: config.map.platforms[1]!.id } });
      send(110, 700, 325, 1);
      requests[0]!.reply();
      await vi.waitFor(() => expect(socket.privateControl).toHaveBeenCalledWith(expect.objectContaining({ observationTick: 104, sequence: 1 })));
      send(120, 730, 313, 2);
      time = 1000;
      model.update();
      expect(requests[1]!.observation).toMatchObject({ tick: 120, self: { x: 730, y: 313 }, recentActions: [{ tick: 110,
        outcome: { observedTick: 120, deltaX: 30, deltaY: -12, platformId: config.map.platforms[2]!.id, grounded: true, status: 'alive' },
      }] });
      requests[1]!.reply();
    } finally { model.destroy(); source.dispose(); }
  });
});
