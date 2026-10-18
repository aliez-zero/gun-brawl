import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MUSIC, MUSIC_TRACKS, normalizeMusic, sceneMusic } from '../src/content/music';
import type { MusicTrackId } from '../src/content/music';
import { MusicPlayer } from '../src/presentation/music/MusicPlayer';
import { renderMusic } from '../src/presentation/music/MusicSynth';

describe('background music content and synthesis', () => {
  it('repairs music preferences field by field', () => {
    expect(normalizeMusic({ enabled: false, volume: 1.4, track: 'city' })).toEqual({ enabled: false, volume: 1, track: 'city' });
    expect(normalizeMusic({ enabled: 'yes', volume: Number.NaN, track: 'missing' })).toEqual(DEFAULT_MUSIC);
    expect(normalizeMusic(null)).toEqual(DEFAULT_MUSIC);
  });

  it('selects menu and map themes in automatic mode', () => {
    expect(sceneMusic('auto', false, 'neon-city')).toBe('menu');
    expect(sceneMusic('auto', true, 'sky-citadel')).toBe('citadel');
    expect(sceneMusic('auto', true, 'neon-city')).toBe('city');
    expect(sceneMusic('auto', true, 'alien-starship')).toBe('space');
    expect(sceneMusic('auto', true, 'training-arena')).toBe('training');
    expect(sceneMusic('space', false, 'sky-citadel')).toBe('space');
  });

  it('renders deterministic, audible and bounded looping PCM for every track', () => {
    const rendered = new Map<MusicTrackId, Float32Array>();
    for (const track of MUSIC_TRACKS) {
      const pcm = renderMusic(track.id, 8000);
      rendered.set(track.id, pcm);
      const expected = Math.round(32 * 60 / track.bpm * 8000);
      expect(pcm.length).toBe(expected);
      expect(pcm.every(Number.isFinite)).toBe(true);
      const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
      const peak = pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
      expect(rms).toBeGreaterThan(0.005);
      expect(peak).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(pcm).toEqual(renderMusic(track.id, 8000));
      // Wrapped release tails keep the loop join from becoming a hard digital edge.
      const seam = Math.abs(pcm[0]! - pcm.at(-1)!);
      expect(seam).toBeLessThan(0.35);
    }
    expect(rendered.get('menu')).not.toEqual(rendered.get('city'));
  });
});

interface FakeVoice {
  buffer: { duration: number } | null;
  loop: boolean;
  starts: number[];
  stops: number[];
  onended: (() => void) | null;
  connect: (node: unknown) => FakeVoice;
  disconnect: () => void;
  start: (when?: number, offset?: number) => void;
  stop: (when?: number) => void;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  readonly voices: FakeVoice[] = [];
  closed = false;
  constructor() { FakeAudioContext.instances.push(this); }
  resume(): Promise<void> { this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
  }
  createGain(): GainNode {
    const gain = { gain: {
      value: 1,
      setValueAtTime: () => gain.gain,
      linearRampToValueAtTime: () => gain.gain,
      setTargetAtTime: () => gain.gain,
      cancelScheduledValues: () => gain.gain,
    }, connect: () => gain, disconnect: () => undefined };
    return gain as unknown as GainNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    const voice: FakeVoice = {
      buffer: null, loop: false, starts: [], stops: [], onended: null,
      connect: () => voice,
      disconnect: () => undefined,
      start: (_when = 0, offset = 0) => { voice.starts.push(offset); },
      stop: (when = this.currentTime) => { voice.stops.push(when); },
    };
    this.voices.push(voice);
    return voice as unknown as AudioBufferSourceNode;
  }
}

const originalAudioContext = globalThis.AudioContext;
afterEach(() => {
  if (originalAudioContext) globalThis.AudioContext = originalAudioContext;
  else delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  FakeAudioContext.instances = [];
});

describe('music player transport', () => {
  const flushAudio = async (): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); };

  it('unlocks lazily, creates one loop, pauses at its offset and resumes there', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const player = new MusicPlayer();
    player.configure({ enabled: true, volume: 0.4, track: 'menu' });
    expect(player.status.state).toBe('waiting');
    await player.unlock();
    const context = FakeAudioContext.instances[0]!;
    expect(player.status.state).toBe('playing');
    expect(context.voices).toHaveLength(1);
    context.currentTime = 2.5;
    player.setPaused(true);
    expect(player.status.state).toBe('paused');
    expect(context.voices[0]!.stops).toHaveLength(1);
    player.setPaused(false);
    await flushAudio();
    expect(player.status.state).toBe('playing');
    expect(context.voices).toHaveLength(2);
    expect(context.voices[1]!.starts[0]).toBeCloseTo(2.5, 5);
    player.destroy();
    expect(context.closed).toBe(true);
  });

  it('crossfades selection changes while bounding active voices', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const player = new MusicPlayer();
    await player.unlock();
    const context = FakeAudioContext.instances[0]!;
    player.setTrack('city');
    await flushAudio();
    player.setTrack('space');
    await flushAudio();
    expect(context.voices).toHaveLength(3);
    expect(context.voices.filter((voice) => voice.stops.length > 0)).toHaveLength(2);
    player.configure({ enabled: false, volume: 0.4, track: 'space' });
    expect(player.status.state).toBe('muted');
    player.destroy();
  });
});
