/** Authored values in character units. Change these curves rather than drawing new body frames. */
export type AnimationKey = readonly [time: number, value: number, tangent?: number];
export type AnimationCurve = readonly AnimationKey[];

export function sampleCurve(keys: AnimationCurve, time: number): number {
  if (time <= keys[0]![0]) return keys[0]![1];
  for (let index = 1; index < keys.length; index++) {
    const end = keys[index]!, start = keys[index - 1]!;
    if (time > end[0]) continue;
    const duration = end[0] - start[0], t = (time - start[0]) / duration;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * start[1] + (t3 - 2 * t2 + t) * duration * (start[2] ?? 0)
      + (-2 * t3 + 3 * t2) * end[1] + (t3 - t2) * duration * (end[2] ?? 0);
  }
  return keys.at(-1)![1];
}

export const COWBOY_CLIPS = {
  footTravel: [[0, 10, -35], [0.56, -10, -35], [0.68, -8, 50], [0.82, 5, 70], [0.94, 11], [1, 10, -35]],
  footLift: [[0, 0], [0.56, 0], [0.70, 9], [0.82, 13], [0.94, 3], [1, 0]],
  footRoll: [[0, -0.06], [0.18, 0], [0.48, 0.08], [0.64, -0.32], [0.82, -0.18], [1, -0.06]],
  compression: [[0, 0], [0.22, 0.85], [0.5, -0.5], [0.78, -0.2], [1, 0]],
  torso: [[0, -0.01], [0.24, 0.014], [0.5, -0.01], [0.74, 0.014], [1, -0.01]],
  coat: [[0, -0.025], [0.2, 0.055], [0.5, -0.025], [0.7, 0.055], [1, -0.025]],
  reloadReach: [[0, 0], [0.16, 0.5], [0.3, 1], [0.64, 1], [0.84, 0.7], [1, 0]],
  reloadInsert: [[0, 0], [0.35, 0], [0.62, 1], [1, 1]],
} as const satisfies Record<string, AnimationCurve>;

const cycleTime = (time: number): number => (time % 1 + 1) % 1;

export function cowboyStep(cycle: number): { travel: number; lift: number; roll: number } {
  const t = cycleTime(cycle);
  return { travel: sampleCurve(COWBOY_CLIPS.footTravel, t), lift: sampleCurve(COWBOY_CLIPS.footLift, t), roll: sampleCurve(COWBOY_CLIPS.footRoll, t) };
}

export function cowboyBody(cycle: number): { compression: number; lean: number; coat: number; head: number } {
  return {
    compression: sampleCurve(COWBOY_CLIPS.compression, cycleTime(cycle * 2)),
    lean: sampleCurve(COWBOY_CLIPS.torso, cycleTime(cycle)),
    coat: sampleCurve(COWBOY_CLIPS.coat, cycleTime(cycle - 0.10)),
    head: sampleCurve(COWBOY_CLIPS.torso, cycleTime(cycle - 0.07)) * -0.65,
  };
}
