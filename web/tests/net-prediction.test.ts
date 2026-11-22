import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetMatchSource } from '../src/net/NetMatchSource';
import { idleInput } from '../src/game/core/types';
import type { NetClient } from '../src/net/NetClient';
import type { PredictedPose, Predictor } from '../src/net/Predictor';
import { PHASE_PLAYING, SLOT_BOT, SLOT_EMPTY, SLOT_HUMAN, EDGE_JUMP } from '../src/net/protocol';
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
    fireCd: 0, reload: 0, protection: 0, respawn: 0,
    groundedPlatform: 0, dropPlatform: 255, dropTimer: 0, coyoteTimer: 0, jumpTimer: 0,
  };
}

function snapshot(x = 640, y = 300, vx = 0): Snapshot {
  return {
    tick: 1, serverMs: 1000, phase: PHASE_PLAYING, remainingMs: 180_000, acks: [0, 0, 0, 0],
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
  const actor = source.state.actors[source.localActor!]!;
  const alpha = source.localAlpha!;
  return actor.previous.x + (actor.position.x - actor.previous.x) * alpha + source.localOffset!.x;
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
    expect(source.localActor).toBe(0);
    expect(source.localAlpha).toBeGreaterThanOrEqual(0);
    expect(source.localAlpha).toBeLessThan(1);
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
      next.bombs = [{ id: 5, owner: 1, x: (740 + tick * 5) * 16, y: 4800 }];
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
