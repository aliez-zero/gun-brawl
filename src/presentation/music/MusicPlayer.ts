import { DEFAULT_MUSIC, MUSIC_TRACKS, normalizeMusic } from '../../content/music';
import type { MusicSettings, MusicTrackId } from '../../content/music';
import { renderMusic } from './MusicSynth';

export interface MusicStatus {
  track: MusicTrackId;
  state: 'waiting' | 'playing' | 'paused' | 'muted' | 'unavailable';
}
interface Voice { source: AudioBufferSourceNode; gain: GainNode; started: number; offset: number }

/** A looping transport with bounded buffers and short crossfades; audio remains optional. */
export class MusicPlayer {
  onChange?: (status: MusicStatus) => void;
  private context: AudioContext | null = null;
  private readonly buffers = new Map<MusicTrackId, AudioBuffer>();
  private readonly voices = new Set<Voice>();
  private current: Voice | null = null;
  private settings: MusicSettings = { ...DEFAULT_MUSIC };
  private track: MusicTrackId = 'menu';
  private paused = false;
  private offset = 0;
  private unavailable = false;
  private destroyed = false;
  private resuming: Promise<void> | null = null;
  private loading: Promise<AudioBuffer> | null = null;

  get status(): MusicStatus {
    return { track: this.track, state: this.unavailable ? 'unavailable'
      : !this.settings.enabled || this.settings.volume === 0 ? 'muted'
      : this.current && this.context?.state === 'running' ? 'playing'
      : this.paused ? 'paused' : 'waiting' };
  }

  configure(settings: MusicSettings): void {
    if (this.destroyed) return;
    this.settings = normalizeMusic(settings);
    if (!this.settings.enabled || this.settings.volume === 0) this.hold();
    else if (this.current && this.context) {
      this.current.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.current.gain.gain.setTargetAtTime(this.settings.volume, this.context.currentTime, 0.04);
    } else this.play();
    this.emit();
  }

  setTrack(track: MusicTrackId): void {
    if (this.destroyed || this.track === track) return;
    this.track = track; this.offset = 0;
    this.retireCurrent(); this.play(); this.emit();
  }

  setPaused(paused: boolean): void {
    if (this.destroyed || this.paused === paused) return;
    this.paused = paused;
    if (paused) this.hold(); else this.play();
    this.emit();
  }

  async unlock(): Promise<void> {
    if (this.destroyed || !this.settings.enabled || this.settings.volume === 0) return;
    if (this.resuming) return this.resuming;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.context.onstatechange = () => { if (!this.destroyed) { void this.play(); this.emit(); } };
      }
      const context = this.context;
      if (context.state !== 'running') {
        this.resuming = context.resume();
        await this.resuming;
      }
      if (this.destroyed) return;
      this.unavailable = false; await this.play();
    } catch { this.unavailable = true; }
    finally { this.resuming = null; if (!this.destroyed) this.emit(); }
  }

  private async play(): Promise<void> {
    const context = this.context;
    if (this.destroyed || this.current || this.paused || !this.settings.enabled || this.settings.volume === 0 || !context || context.state !== 'running' || this.loading) return;
    const requestedTrack = this.track;
    let source: AudioBufferSourceNode | undefined, gain: GainNode | undefined;
    try {
      const loading = this.loadBuffer(requestedTrack, context);
      this.loading = loading;
      const buffer = await loading;
      if (this.loading === loading) this.loading = null;
      if (this.destroyed || this.current || this.paused || !this.settings.enabled || this.settings.volume === 0 || this.track !== requestedTrack || context.state !== 'running') {
        if (!this.destroyed && this.track !== requestedTrack) void this.play();
        return;
      }
      source = context.createBufferSource(); gain = context.createGain();
      source.buffer = buffer; source.loop = true;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(this.settings.volume, context.currentTime + 0.35);
      source.connect(gain).connect(context.destination);
      const voice = { source, gain, started: context.currentTime, offset: this.offset % buffer.duration };
      source.onended = () => this.release(voice);
      source.start(context.currentTime, voice.offset);
      this.voices.add(voice); this.current = voice;
    } catch {
      this.loading = null;
      source?.disconnect(); gain?.disconnect();
      if (source) source.onended = null;
      this.unavailable = true;
    }
  }

  private async loadBuffer(track: MusicTrackId, context: AudioContext): Promise<AudioBuffer> {
    const cached = this.buffers.get(track);
    if (cached) return cached;
    let buffer: AudioBuffer;
    try {
      const asset = MUSIC_TRACKS.find((candidate) => candidate.id === track)!.asset;
      const response = await fetch(asset);
      if (!response.ok) throw new Error(`music asset ${response.status}`);
      buffer = await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      const pcm = renderMusic(track);
      buffer = context.createBuffer(1, pcm.length, 22050);
      buffer.getChannelData(0).set(pcm);
    }
    if (this.destroyed) return buffer;
    this.buffers.set(track, buffer);
    while (this.buffers.size > 3) this.buffers.delete(this.buffers.keys().next().value!);
    return buffer;
  }

  private retireCurrent(): void {
    if (!this.current || !this.context) return;
    const voice = this.current, now = this.context.currentTime;
    this.current = null;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.06);
    voice.source.stop(now + 0.4);
    // Rapid selection changes retain at most a fading voice and the next one.
    for (const old of this.voices) if (old !== voice) { old.source.stop(); this.release(old); }
  }

  private hold(): void {
    if (this.current && this.context) {
      this.offset = (this.current.offset + this.context.currentTime - this.current.started) % this.current.source.buffer!.duration;
    }
    for (const voice of this.voices) { voice.source.stop(); this.release(voice); }
    this.current = null;
  }

  private release(voice: Voice): void {
    voice.source.disconnect(); voice.gain.disconnect(); voice.source.onended = null;
    this.voices.delete(voice);
  }

  private emit(): void { this.onChange?.(this.status); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.hold(); this.buffers.clear(); this.onChange = undefined;
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => undefined); }
    this.context = null;
  }
}
