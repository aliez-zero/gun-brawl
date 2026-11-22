import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeServer } from '../src/net/protocol';

describe('Rust and browser wire layout', () => {
  it('reads both welcome rates after the token expiration', () => {
    expect(decodeServer(Uint8Array.of(0, 1, 1, 65, 255, 255, 3, 60, 30))).toEqual({
      type: 'welcome', playerId: 1, name: 'A', tokenExpires: 65_535, tickRate: 60, snapshotRate: 30,
    });
  });

  it('reads the same match snapshot the Rust encoder produces', () => {
    const bytes = readFileSync(new URL('../../server/crates/proto/tests/fixtures/v4-snapshot.bin', import.meta.url));
    const message = decodeServer(bytes);
    if (message.type !== 'snapshot') throw new Error('expected snapshot');
    const frame = message.snapshot;
    expect(frame).toMatchObject({
      tick: 12_345, playingTick: 12_000, serverMs: 205_750, trainingCompleted: 33, dummyMoving: true,
      externalEpoch: 8, acks: [42, 41, 40, 0], actors: [{ reloadMs: 3200, bombCooldownMs: 583, bombs: 2, knockouts: 1, impulseY: -320 }],
      projectiles: [{ id: 321, vy: -480 }], bombs: [{ fuseMs: 1200, vy: -4 }],
      drops: [{ timerMs: 4000 }], events: [{ other: 255, y: -348 }],
    });
  });
});
