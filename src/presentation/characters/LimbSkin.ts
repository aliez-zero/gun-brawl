import type { Vec2 } from '../../game/core/types';
import { clamp01, offset } from './RigMath';

export interface LimbChain { root: Vec2; joint: Vec2; end: Vec2; upper: number; lower: number }
export type LimbName = 'leg' | 'legBack' | 'arm' | 'armBack';
export type LimbChains = Record<LimbName, LimbChain>;
export interface SkinStrip { chain: LimbName; lower: boolean; left: number; right: number; top: number; bottom: number }

export const SKIN_ROWS = 8;
export const LIMB_SKINS: Readonly<Record<string, SkinStrip>> = {
  thigh: { chain: 'leg', lower: false, left: -4.6, right: 4.6, top: -3.5, bottom: 15.5 },
  thighBack: { chain: 'legBack', lower: false, left: -4.6, right: 4.6, top: -3.5, bottom: 15.5 },
  shin: { chain: 'leg', lower: true, left: -3.6, right: 3.6, top: 0, bottom: 15.2 },
  shinBack: { chain: 'legBack', lower: true, left: -3.6, right: 3.6, top: 0, bottom: 15.2 },
  upper: { chain: 'arm', lower: false, left: -4.5, right: 4.5, top: -3.5, bottom: 16.5 },
  upperBack: { chain: 'armBack', lower: false, left: -4.5, right: 4.5, top: -3.5, bottom: 16.5 },
  fore: { chain: 'arm', lower: true, left: -3.5, right: 3.5, top: 0, bottom: 16 },
  foreBack: { chain: 'armBack', lower: true, left: -3.5, right: 3.5, top: 0, bottom: 16 },
};

/** Two-bone linear blend skinning, with a smooth seven-unit band across the joint. */
export function skinVertex(chain: LimbChain, x: number, y: number): Vec2 {
  const a = Math.atan2(chain.joint.y - chain.root.y, chain.joint.x - chain.root.x) - Math.PI / 2;
  const b = Math.atan2(chain.end.y - chain.joint.y, chain.end.x - chain.joint.x) - Math.PI / 2;
  const t = clamp01((y - chain.upper + 3.5) / 7), weight = t * t * (3 - 2 * t);
  const upper = offset({ x, y }, chain.root, a), lower = offset({ x, y: y - chain.upper }, chain.joint, b);
  return { x: upper.x + (lower.x - upper.x) * weight, y: upper.y + (lower.y - upper.y) * weight };
}

/** Same strip vertices are consumed by Phaser WebGL and the Canvas editor preview. */
export function skinStrip(chain: LimbChain, spec: SkinStrip, vertices: Float32Array = new Float32Array(SKIN_ROWS * 4)): Float32Array {
  for (let row = 0; row < SKIN_ROWS; row++) {
    const y = spec.top + (spec.bottom - spec.top) * row / (SKIN_ROWS - 1);
    for (let side = 0; side < 2; side++) {
      const vertex = skinVertex(chain, side ? spec.right : spec.left, y + (spec.lower ? chain.upper : 0));
      vertices[row * 4 + side * 2] = vertex.x;
      vertices[row * 4 + side * 2 + 1] = vertex.y;
    }
  }
  return vertices;
}
