/**
 * WASM movement predictor.
 *
 * Loads `public/predict.wasm`, built from `server/crates/predict` with the same
 * movement code the server runs, and exposes a tiny handle-based API. When the
 * module is unavailable the caller simply keeps rendering snapshots.
 */

export interface PredictedPose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  grounded: number;
  jumps: number;
  dropRemaining: number;
}

export interface PredictInput {
  moveX: number;
  jump: boolean;
  drop: boolean;
  fire: boolean;
  bomb: boolean;
  reload: boolean;
}

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
  gb_free_solo(handle: number): void;
}

export class Predictor {
  private readonly exports: Exports;
  private readonly posePtr: number;
  private mapIds: string[] | null = null;

  private constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as Exports;
    this.posePtr = this.exports.gb_alloc(8 * 8);
  }

  static async load(url = 'predict.wasm'): Promise<Predictor | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return new Predictor(instance);
    } catch {
      return null;
    }
  }

  mapIndex(id: string): number {
    if (!this.mapIds) {
      const count = this.exports.gb_map_count();
      const ids: string[] = [];
      for (let index = 0; index < count; index++) {
        const length = this.exports.gb_map_name_len(index);
        const pointer = this.exports.gb_alloc(length);
        this.exports.gb_map_name(index, pointer, length);
        ids.push(new TextDecoder().decode(new Uint8Array(this.exports.memory.buffer, pointer, length)));
        this.exports.gb_free(pointer, length);
      }
      this.mapIds = ids;
    }
    return this.mapIds.indexOf(id);
  }

  create(mapIndex: number, x: number, y: number): number | null {
    if (mapIndex < 0) return null;
    const handle = this.exports.gb_new(mapIndex, x, y);
    return handle === 0 ? null : handle;
  }

  step(handle: number, input: PredictInput): void {
    const held = input.fire ? 1 : 0;
    const edges =
      (input.jump ? 1 : 0) | (input.drop ? 2 : 0) | (input.bomb ? 4 : 0) | (input.reload ? 8 : 0);
    this.exports.gb_step(handle, input.moveX, held, edges);
  }

  pose(handle: number): PredictedPose {
    this.exports.gb_pose(handle, this.posePtr);
    const view = new Float64Array(this.exports.memory.buffer, this.posePtr, 8);
    return {
      x: view[0]!,
      y: view[1]!,
      vx: view[2]!,
      vy: view[3]!,
      facing: view[4]!,
      grounded: view[5]!,
      jumps: view[6]!,
      dropRemaining: view[7]!,
    };
  }

  reconcile(handle: number, pose: PredictedPose): void {
    this.exports.gb_set_pose(
      handle,
      pose.x,
      pose.y,
      pose.vx,
      pose.vy,
      pose.facing,
      pose.grounded,
      pose.jumps,
    );
  }

  destroy(handle: number): void {
    this.exports.gb_free_solo(handle);
  }
}
