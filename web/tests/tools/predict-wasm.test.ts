import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// End-to-end check of the committed wasm ABI; rebuild with `pnpm build:wasm`.
const here = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(resolve(here, '../../public/predict.wasm'));

interface Exports {
  memory: WebAssembly.Memory;
  gb_map_count(): number;
  gb_map_name_len(index: number): number;
  gb_map_name(index: number, out: number, len: number): number;
  gb_alloc(len: number): number;
  gb_free(ptr: number, len: number): void;
  gb_new(mapIndex: number, x: number, y: number): number;
  gb_step(handle: number, moveX: number, held: number, edges: number): void;
  gb_pose(handle: number, out: number): void;
  gb_set_pose(handle: number, x: number, y: number, vx: number, vy: number, facing: number, grounded: number, jumps: number): void;
  gb_set_impulse(handle: number, x: number, y: number): void;
  gb_set_movement_state(handle: number, ground: number, drop: number, dropTimer: number, coyoteTimer: number, jumpTimer: number): void;
  gb_free_solo(handle: number): void;
}

describe('prediction wasm', () => {
  it('predicts local movement and accepts reconciliation', async () => {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const exports = instance.exports as unknown as Exports;

    const count = exports.gb_map_count();
    expect(count).toBeGreaterThanOrEqual(4);
    let skyCitadel = -1;
    for (let index = 0; index < count; index++) {
      const length = exports.gb_map_name_len(index);
      const pointer = exports.gb_alloc(length);
      exports.gb_map_name(index, pointer, length);
      const name = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, length));
      exports.gb_free(pointer, length);
      if (name === 'sky-citadel') skyCitadel = index;
    }
    expect(skyCitadel).toBeGreaterThanOrEqual(0);

    const handle = exports.gb_new(skyCitadel, 230, 555);
    expect(handle).toBeGreaterThan(0);
    const posePointer = exports.gb_alloc(10 * Float64Array.BYTES_PER_ELEMENT);
    const pose = (): number[] => {
      exports.gb_pose(handle, posePointer);
      return Array.from(new Float64Array(exports.memory.buffer, posePointer, 10));
    };

    const startX = pose()[0]!;
    for (let frame = 0; frame < 30; frame++) exports.gb_step(handle, 1, 0, 0);
    expect(pose()[0]!).toBeGreaterThan(startX + 20);

    exports.gb_set_pose(handle, 640, 500, 0, 0, -1, 1, 1);
    expect(pose()[0]).toBe(640);
    expect(pose()[4]).toBe(-1);

    exports.gb_set_movement_state(handle, 255, 0, 3, 0, 0);
    exports.gb_set_impulse(handle, 360, -80);
    expect(pose().slice(7)).toEqual([0.2 - 1 / 60 - 1 / 60, 360, -80]);
    exports.gb_step(handle, 0, 0, 0);
    expect(pose()[0]).toBeGreaterThan(640);
    expect(pose()[2]).toBe(0);

    exports.gb_free(posePointer, 10 * Float64Array.BYTES_PER_ELEMENT);
    exports.gb_free_solo(handle);
  });
});
