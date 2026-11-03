/**
 * Counters for diagnosing online feel. Everything here is cheap (integer adds) and only
 * read by the `__gunbrawlDebug.netStats()` hook, so it can stay in the shipped bundle.
 */
export const netStats = {
  /** Rendered frames the scene ran (game loop FPS source). */
  frames: 0,
  /** Fixed steps the local predictor ran. */
  steps: 0,
  /** Input frames pushed onto the wire (should track ~60/s). */
  inputFrames: 0,
  /** Frames where an edge had to wait for the next step (proves the old code dropped it). */
  bufferedEdges: 0,
  /** Full pose reconciliations (visible snaps). */
  reconciles: 0,
  /** Velocity-only adoptions (knockback smoothing). */
  velocityAdoptions: 0,
  /** Snapshots applied. */
  snapshots: 0,
  /** Server ticks advanced, summed from snapshot tick numbers (this room only). */
  serverTicks: 0,
  /** Largest |predicted - authoritative| distance seen, in px. */
  errorMaxPx: 0,
  /** Arrival gap statistics in ms. */
  gapSumMs: 0,
  gapMaxMs: 0,
  /** Last |predicted - authoritative| distance in px, before any correction. */
  lastErrorPx: 0,

  reset(): void {
    this.frames = 0;
    this.steps = 0;
    this.inputFrames = 0;
    this.bufferedEdges = 0;
    this.reconciles = 0;
    this.velocityAdoptions = 0;
    this.snapshots = 0;
    this.serverTicks = 0;
    this.errorMaxPx = 0;
    this.gapSumMs = 0;
    this.gapMaxMs = 0;
    this.lastErrorPx = 0;
  },

  snapshot(): Record<string, number> {
    return {
      frames: this.frames,
      steps: this.steps,
      inputFrames: this.inputFrames,
      bufferedEdges: this.bufferedEdges,
      reconciles: this.reconciles,
      velocityAdoptions: this.velocityAdoptions,
      snapshots: this.snapshots,
      serverTicks: this.serverTicks,
      errorMaxPx: +this.errorMaxPx.toFixed(1),
      gapAvgMs: this.snapshots > 1 ? +(this.gapSumMs / (this.snapshots - 1)).toFixed(1) : 0,
      gapMaxMs: +this.gapMaxMs.toFixed(1),
      lastErrorPx: +this.lastErrorPx.toFixed(1),
    };
  },
};
