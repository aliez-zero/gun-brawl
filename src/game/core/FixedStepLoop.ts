import { FIXED_STEP } from './constants';

export class FixedStepLoop {
  private accumulator = 0;

  advance(elapsedMilliseconds: number, update: (dt: number) => void): void {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) return;
    this.accumulator += Math.min(elapsedMilliseconds / 1000, FIXED_STEP * 5);
    let steps = 0;
    while (this.accumulator + 1e-9 >= FIXED_STEP && steps < 5) {
      update(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    this.accumulator = Math.max(0, this.accumulator);
  }

  reset(): void { this.accumulator = 0; }
  get alpha(): number { return Math.min(1, this.accumulator / FIXED_STEP); }
}
