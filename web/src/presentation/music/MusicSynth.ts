import { MUSIC_TRACKS } from '../../content/music';
import type { MusicTrackId } from '../../content/music';

type Instrument = 'pluck' | 'keys' | 'pad' | 'bass' | 'bell' | 'kick' | 'snare' | 'hat';
interface Score { root: number; chords: readonly number[]; scale: readonly number[]; melody: readonly number[]; instrument: Instrument }
const SCORES: Record<MusicTrackId, Score> = {
  menu: { root: 50, chords: [0, 5, 7, 0, 9, 5, 7, 0], scale: [0, 2, 4, 7, 9], melody: [0, 2, 3, 2, 1, 0, 4, 3, 2, 1, 0, 2, 3, 4, 2, 0], instrument: 'pluck' },
  citadel: { root: 48, chords: [0, 5, 9, 7, 0, 5, 7, 0], scale: [0, 2, 4, 7, 9], melody: [0, 3, 2, 4, 3, 2, 1, 0, 2, 3, 4, 2, 1, 3, 2, 0], instrument: 'bell' },
  city: { root: 45, chords: [0, 8, 3, 10, 0, 8, 5, 7], scale: [0, 2, 3, 7, 10], melody: [0, 2, 4, 2, 3, 1, 2, 4, 0, 3, 2, 1, 4, 2, 1, 0], instrument: 'keys' },
  space: { root: 42, chords: [0, 8, 3, 10, 0, 8, 5, 7], scale: [0, 2, 3, 7, 10], melody: [0, 3, 2, 4, 1, 3, 0, 2, 4, 3, 1, 2, 0, 4, 2, 1], instrument: 'bell' },
  training: { root: 48, chords: [0, 5, 0, 7, 9, 5, 7, 0], scale: [0, 2, 4, 7, 9], melody: [0, 2, 1, 3, 2, 0, 4, 2, 1, 3, 2, 4, 3, 1, 2, 0], instrument: 'keys' },
};

/** Deterministic fallback scores used when a downloaded track cannot be decoded. */
export function renderMusic(id: MusicTrackId, sampleRate = 22050): Float32Array {
  const score = SCORES[id], beat = 60 / MUSIC_TRACKS.find((track) => track.id === id)!.bpm;
  const pcm = new Float32Array(Math.round(32 * beat * sampleRate));
  const tau = Math.PI * 2;
  const note = (at: number, midi: number, beats: number, instrument: Instrument, level: number): void => {
    const duration = beats * beat, start = Math.round(at * beat * sampleRate);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    let random = (start + midi * 8191 + 12345) >>> 0;
    for (let i = 0; i < Math.ceil(duration * sampleRate); i++) {
      const t = i / sampleRate, age = t / duration, phase = tau * frequency * t;
      const attack = Math.min(1, t / (instrument === 'pad' ? 0.09 : 0.007));
      const release = Math.min(1, (duration - t) / (instrument === 'pad' ? 0.25 : 0.04));
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const noise = random / 2147483648 - 1;
      let value = 0;
      switch (instrument) {
        case 'pluck': value = (Math.sin(phase + 0.45 * Math.sin(phase * 2) * Math.exp(-t * 10)) + 0.25 * Math.sin(phase * 2)) * Math.exp(-age * 4.5); break;
        case 'keys': value = (Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.1 * Math.sin(phase * 3)) * Math.exp(-age * 3.5); break;
        case 'pad': value = (Math.sin(phase) + 0.2 * Math.sin(phase * 2 + 0.4 * Math.sin(t * 3))) * 0.65; break;
        case 'bass': value = (Math.sin(phase) + 0.2 * Math.sin(phase * 2)) * Math.exp(-age * 2.5); break;
        case 'bell': value = (Math.sin(phase) + 0.32 * Math.sin(phase * 3)) * Math.exp(-age * 5); break;
        case 'kick': value = Math.sin(tau * (42 * t + 7.5 * (1 - Math.exp(-t * 22)))) * Math.exp(-t * 19); break;
        case 'snare': value = (noise * 0.7 + Math.sin(tau * 180 * t) * 0.3) * Math.exp(-t * 26); break;
        case 'hat': value = noise * Math.exp(-t * 70); break;
      }
      // Wrap release tails across the loop boundary so repeated buffers join naturally.
      pcm[(start + i) % pcm.length]! += value * attack * release * level;
    }
  };
  for (let bar = 0; bar < 8; bar++) {
    const at = bar * 4, root = score.root + score.chords[bar]!;
    const minor = id === 'city' || id === 'space', third = minor ? 3 : 4;
    for (const interval of [0, third, 7]) note(at, root + 12 + interval, 4.3, 'pad', id === 'space' ? 0.045 : 0.025);
    for (let step = 0; step < 8; step++) {
      const offset = step / 2;
      if (step % 2 === 0 || id === 'city') note(at + offset, root - 12 + (step === 6 ? 7 : 0), 0.65, 'bass', 0.18);
      if (id !== 'space' || step % 2 === 0) note(at + offset, 0, 0.14, 'hat', step % 2 ? 0.045 : 0.025);
      if (step % 2 === 0 || bar % 2 === 1) {
        const degree = score.melody[(bar % 2) * 8 + step]!;
        const pitch = score.root + 24 + score.scale[degree]! + (bar === 6 && step > 3 ? 12 : 0);
        note(at + offset, pitch, id === 'space' ? 1.6 : 0.8, score.instrument, id === 'space' ? 0.09 : 0.12);
        note(at + offset + 0.375, pitch, 0.65, score.instrument, 0.025);
      }
    }
    for (const offset of id === 'city' ? [0, 1, 2, 3] : [0, 2]) note(at + offset, 0, 0.6, 'kick', id === 'space' ? 0.09 : 0.22);
    for (const offset of [1, 3]) note(at + offset, 0, 0.4, 'snare', id === 'space' ? 0.035 : 0.095);
    if (bar === 7 && id !== 'space') for (const offset of [3.25, 3.5, 3.75]) note(at + offset, 0, 0.22, 'snare', 0.045);
  }
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.tanh(pcm[i]! * 1.4) * 0.8;
  return pcm;
}
