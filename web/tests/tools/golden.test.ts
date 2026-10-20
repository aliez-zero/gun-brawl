import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SKY_CITADEL } from '../../src/content/maps';
import { BASIC_PISTOL } from '../../src/content/weapons';
import { BattleSimulation } from '../../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../../src/game/core/constants';
import type { ActorConfig, ActorInput, MatchConfig, MatchPhase } from '../../src/game/core/types';

// One-shot generator: `GOLDEN=1 pnpm vitest run tests/tools/golden.test.ts`
// The Rust test `server/crates/core/tests/golden.rs` replays the same script.
const enabled = process.env.GOLDEN === '1';
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../../server/crates/core/tests/fixtures/golden.json');

const FRAME_COUNT = 600;
const SCRIPT_SEED = 12_345;

function scriptRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeConfig(): MatchConfig {
  const actors: ActorConfig[] = [1, 2, 3, 4].map((slot, index) => ({
    id: `p${index + 1}`,
    name: `P${index + 1}`,
    color: 0xffffff,
    control: 'human',
    inputSlot: (slot % 2 === 0 ? 2 : 1) as 1 | 2,
  }));
  return {
    mode: 'custom',
    map: SKY_CITADEL,
    actors,
    startingWeapon: BASIC_PISTOL,
    stocks: 3,
    duration: 180,
    countdown: 0,
    seed: 42,
    dropMode: 'all',
  };
}

function phaseCode(phase: MatchPhase): number {
  switch (phase) {
    case 'countdown': return 0;
    case 'playing': return 1;
    case 'paused': return 2;
    case 'finished': return 3;
  }
}

describe.skipIf(!enabled)('golden replay export', () => {
  it('records 600 frames of the TypeScript simulation', () => {
    const simulation = new BattleSimulation(makeConfig());
    const next = scriptRng(SCRIPT_SEED);
    const actorIds = ['p1', 'p2', 'p3', 'p4'];
    const samples = [];

    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      const inputs = new Map<string, ActorInput>();
      for (const id of actorIds) {
        const move = next();
        const jump = next();
        const drop = next();
        const fire = next();
        const bomb = next();
        const reload = next();
        inputs.set(id, {
          moveX: move < 0.34 ? -1 : move < 0.67 ? 0 : 1,
          jumpPressed: jump < 0.08,
          dropPressed: drop < 0.03,
          shootHeld: fire < 0.55,
          bombPressed: bomb < 0.02,
          reloadPressed: reload < 0.02,
        });
      }
      simulation.step(FIXED_STEP, inputs);
      samples.push({
        frame,
        phase: phaseCode(simulation.state.phase),
        projectiles: simulation.state.projectiles.length,
        actors: simulation.state.actors.map((actor) => ({
          x: actor.position.x,
          y: actor.position.y,
          stocks: actor.stocks,
          status: actor.status,
        })),
      });
    }

    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify({ seed: 42, scriptSeed: SCRIPT_SEED, frames: FRAME_COUNT, samples })}\n`, 'utf8');
    expect(samples).toHaveLength(FRAME_COUNT);
  });
});
