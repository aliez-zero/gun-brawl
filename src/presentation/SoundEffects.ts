import type { BattleEvent, WeaponId } from '../game/core/types';

const SHOT_TONES: Partial<Record<WeaponId, [number, number, number, number]>> = {
  pistol: [180, 60, 0.045, 0.1], p1911: [210, 80, 0.04, 0.1], deagle: [120, 45, 0.08, 0.16],
  smg: [190, 70, 0.04, 0.1], ump45: [175, 65, 0.05, 0.1], vector: [230, 90, 0.03, 0.08], uzi: [245, 100, 0.03, 0.07],
  rifle: [160, 55, 0.055, 0.13], m416: [170, 60, 0.05, 0.12], akm: [135, 45, 0.065, 0.17], 'scar-l': [180, 65, 0.05, 0.12],
  shotgun: [95, 35, 0.09, 0.2], s686: [90, 30, 0.1, 0.22], s1897: [75, 28, 0.12, 0.22], s12k: [110, 40, 0.07, 0.18],
  sniper: [70, 30, 0.12, 0.22], kar98k: [80, 32, 0.11, 0.2], m24: [75, 28, 0.12, 0.22], awm: [55, 22, 0.16, 0.28],
  rocket: [60, 25, 0.16, 0.24], rpg7: [55, 22, 0.18, 0.26], at4: [45, 20, 0.2, 0.28],
  gatling: [240, 110, 0.03, 0.09], cannon: [40, 18, 0.22, 0.3],
};

const RELOAD_TONES: Partial<Record<WeaponId, [number, number]>> = {
  pistol: [680, 430], p1911: [640, 400], deagle: [520, 330],
  smg: [560, 320], ump45: [540, 310], vector: [590, 340], uzi: [610, 350],
  rifle: [420, 250], m416: [450, 270], akm: [380, 220], 'scar-l': [440, 260],
  shotgun: [330, 190], s686: [350, 200], s1897: [300, 170], s12k: [360, 210],
  sniper: [470, 280], kar98k: [500, 300], m24: [480, 290], awm: [430, 250],
  rocket: [260, 160], rpg7: [250, 150], at4: [230, 140],
  gatling: [520, 300], cannon: [200, 120],
};

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
    if (event.type === 'shot') {
      const [start, end, duration, level] = SHOT_TONES[event.weaponId ?? 'pistol'] ?? SHOT_TONES.pistol!;
      this.tone(start, end, duration, 'square', level);
    }
    if (event.type === 'reload-start') {
      const [start, end] = RELOAD_TONES[event.weaponId] ?? RELOAD_TONES.pistol!;
      this.tone(start, end, 0.045, 'square', 0.12);
      this.tone(end, end * 0.78, 0.06, 'triangle', 0.1, 0.13);
    }
    if (event.type === 'hit') this.tone(110, 45, 0.07, 'triangle', 0.2);
    if (event.type === 'bomb') this.tone(240, 90, 0.12, 'triangle', 0.16);
    if (event.type === 'explosion') this.tone(90, 35, 0.3, 'sawtooth', 0.25);
    if (event.type === 'drop-landed') this.tone(520, 380, 0.09, 'sine', 0.08);
    if (event.type === 'pickup') this.tone(520, 880, 0.14, 'sine', 0.16);
    if (event.type === 'ringout') this.tone(220, 50, 0.32, 'sawtooth', 0.15);
    if (event.type === 'finished') this.tone(330, 660, 0.35, 'sine', 0.25);
  }

  private tone(start: number, end: number, duration: number, type: OscillatorType, level: number, delay = 0): void {
    const context = this.context!;
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, at);
    oscillator.frequency.exponentialRampToValueAtTime(end, at + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, this.volume * level), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at);
    oscillator.stop(at + duration);
  }

  destroy(): void { void this.context?.close().catch(() => undefined); }
}
