import type { BattleEvent } from '../game/core/types';

export class SoundEffects {
  private context: AudioContext | null = null;
  volume = 0.35;

  unlock(): void {
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => undefined);
    } catch { /* Audio is optional; the match remains playable. */ }
  }

  play(event: BattleEvent): void {
    if (!this.context || this.context.state !== 'running' || this.volume <= 0) return;
    if (event.type === 'shot') this.tone(180, 60, 0.045, 'square', 0.1);
    if (event.type === 'hit') this.tone(110, 45, 0.07, 'triangle', 0.2);
    if (event.type === 'ringout') this.tone(220, 50, 0.32, 'sawtooth', 0.15);
    if (event.type === 'finished') this.tone(330, 660, 0.35, 'sine', 0.25);
  }

  private tone(start: number, end: number, duration: number, type: OscillatorType, level: number): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(end, context.currentTime + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, this.volume * level), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  destroy(): void { void this.context?.close().catch(() => undefined); }
}
