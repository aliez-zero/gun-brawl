import { describe, expect, it, vi } from 'vitest';
import { NetMatchSource } from '../src/net/NetMatchSource';
import { idleInput } from '../src/game/core/types';
import type { NetClient } from '../src/net/NetClient';
import type { Predictor } from '../src/net/Predictor';
import { PHASE_PLAYING, SLOT_BOT, SLOT_EMPTY, SLOT_HUMAN } from '../src/net/protocol';
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

function actorSnap(overrides: Partial<{ x: number; y: number }> = {}) {
  return {
    id: 0, x: overrides.x ?? 640 * 16, y: overrides.y ?? 300 * 16, vx: 0, vy: 0,
    facing: 1, flags: 1, status: 0, stocks: 3, weapon: 0, ammo: 255, reserve: 0,
    fireCd: 0, reload: 0, protection: 0, respawn: 0,
  };
}

function snapshot(x = 640, y = 300): Snapshot {
  return {
    tick: 1, serverMs: 1000, phase: PHASE_PLAYING, remainingMs: 180_000, acks: [0, 0, 0, 0],
    actors: [actorSnap({ x: x * 16, y: y * 16 }), actorSnap({ x: 700 * 16, y: y * 16 })],
    projectiles: [], bombs: [], drops: [], events: [],
  };
}

function fakeClient(): NetClient {
  return { playerId: 1, sendInput: vi.fn() } as unknown as NetClient;
}

function fakePredictor(): Predictor & { steps: number; poseX: number } {
  const fake = {
    steps: 0,
    poseX: 640,
    mapIndex: () => 0,
    create: () => 1,
    step: () => { fake.steps += 1; fake.poseX += 0.1; },
    pose: () => ({ x: fake.poseX, y: 300, vx: 0, vy: 0, facing: 1, grounded: 1, jumps: 2, dropRemaining: 0 }),
    reconcile: () => {},
    destroy: () => {},
  };
  return fake as unknown as Predictor & { steps: number; poseX: number };
}

const idle = () => idleInput();

describe('NetMatchSource fixed-step prediction', () => {
  it('simulates ~60 steps per second at 144 Hz instead of one step per frame', () => {
    const client = fakeClient();
    const predictor = fakePredictor();
    const source = new NetMatchSource(client, room, predictor);
    source.applySnapshot(snapshot());

    // One second of a 144 Hz display: 144 frames of 6.94 ms each.
    for (let frame = 0; frame < 144; frame++) source.advance(1000 / 144, idle);

    expect(predictor.steps).toBeGreaterThanOrEqual(55);
    expect(predictor.steps).toBeLessThanOrEqual(65);
    // Inputs go out once per simulated step, not once per rendered frame.
    expect((client.sendInput as unknown as { mock: { calls: unknown[] } }).mock.calls.length)
      .toBeGreaterThanOrEqual(55);
  });

  it('runs ~60 steps per second at 60 Hz too', () => {
    const client = fakeClient();
    const predictor = fakePredictor();
    const source = new NetMatchSource(client, room, predictor);
    source.applySnapshot(snapshot());

    for (let frame = 0; frame < 60; frame++) source.advance(1000 / 60, idle);
    expect(predictor.steps).toBeGreaterThanOrEqual(58);
    expect(predictor.steps).toBeLessThanOrEqual(62);
  });

  it('does not yank the predicted actor back when a snapshot arrives', () => {
    const client = fakeClient();
    const predictor = fakePredictor();
    const source = new NetMatchSource(client, room, predictor);
    source.applySnapshot(snapshot());

    for (let frame = 0; frame < 30; frame++) source.advance(1000 / 60, idle);
    const predicted = { ...source.state.actors[0]!.position };
    expect(predicted.x).toBeCloseTo(predictor.poseX, 5);

    // The server believes the player is far behind; the renderer must keep the prediction.
    source.applySnapshot(snapshot(400, 300));
    expect(source.state.actors[0]!.position.x).toBeCloseTo(predicted.x, 5);

    // Remote actors still follow the authoritative snapshot.
    expect(source.state.actors[1]!.position.x).toBeCloseTo(700, 5);
  });
});
