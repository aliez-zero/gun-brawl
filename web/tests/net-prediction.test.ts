import { afterEach, describe, expect, it, vi } from 'vitest';
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

function actorSnap(x = 640, y = 300) {
  return {
    id: 0, x: x * 16, y: y * 16, vx: 0, vy: 0,
    facing: 1, flags: 1, status: 0, stocks: 3, weapon: 0, ammo: 255, reserve: 0,
    fireCd: 0, reload: 0, protection: 0, respawn: 0,
  };
}

function snapshot(x = 640, y = 300): Snapshot {
  return {
    tick: 1, serverMs: 1000, phase: PHASE_PLAYING, remainingMs: 180_000, acks: [0, 0, 0, 0],
    actors: [actorSnap(x, y), actorSnap(700, y)],
    projectiles: [], bombs: [], drops: [], events: [],
  };
}

function fakeClient(): NetClient & { sends: number } {
  const client = { playerId: 1, sends: 0, sendInput: () => { client.sends += 1; } };
  return client as unknown as NetClient & { sends: number };
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

  it('does not yank the predicted actor back when a snapshot arrives', () => {
    const { predictor, source } = setUp();
    runFrames(source, 60, 30);
    const predicted = { ...source.state.actors[0]!.position };
    expect(predicted.x).toBeCloseTo(predictor.poseX, 5);

    // The server still believes the player is far behind; the renderer keeps the prediction.
    source.applySnapshot(snapshot(400, 300));
    expect(source.state.actors[0]!.position.x).toBeCloseTo(predicted.x, 5);

    // Remote actors still follow the authoritative snapshot.
    expect(source.state.actors[1]!.position.x).toBeCloseTo(700, 5);
  });
});
