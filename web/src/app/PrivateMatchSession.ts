import { closeDeepSeekSession, type DeepSeekSession } from '../adapters/ai/DeepSeekClient';
import type { MatchConfig, MatchResult, WeaponId } from '../game/core/types';
import { NetClient, type NetLatency } from '../net/NetClient';
import { NetMatchSource } from '../net/NetMatchSource';
import type { Predictor } from '../net/Predictor';
import { PHASE_COUNTDOWN, PHASE_PLAYING, type RoomView } from '../net/protocol';

export function gameServerUrl(): string {
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export interface PrivateMatchOptions {
  deepSeek?: DeepSeekSession;
  trainingWeapon?: WeaponId;
}

interface PrivateMatchCallbacks {
  predictor(): Predictor | null;
  onStart(source: NetMatchSource, session?: DeepSeekSession): void;
  onResult(result: MatchResult): void;
  onLatency(): void;
  onError(message: string): void;
}

/** One socket owns one private room, from the initial handshake until exit. */
export class PrivateMatchSession {
  private readonly client: NetClient;
  private source: NetMatchSource | null = null;
  private pendingAI: DeepSeekSession | undefined;
  private timeout: number | undefined;
  private welcomed = false;
  private closed = false;

  constructor(
    private readonly config: MatchConfig,
    private readonly options: PrivateMatchOptions,
    private readonly callbacks: PrivateMatchCallbacks,
  ) {
    this.pendingAI = options.deepSeek;
    this.client = new NetClient({
      onRoom: (room) => this.enter(room),
      onSnapshot: (snapshot) => this.source?.applySnapshot(snapshot),
      onMatchEnd: (result) => {
        if (this.source && !this.source.state.result) this.callbacks.onResult(this.source.finish(result));
      },
      onLatency: () => this.callbacks.onLatency(),
      onStatus: (status, detail) => {
        if (this.welcomed && (status === 'closed' || status === 'error')) {
          this.fail(detail ?? '游戏服务器连接已断开');
        }
      },
    }, { privateSession: true });
  }

  get latency(): NetLatency | null { return this.client.latency; }

  async start(): Promise<void> {
    this.timeout = window.setTimeout(() => this.fail('等待游戏服务器创建对局超时'), 8000);
    try {
      await this.client.connect(gameServerUrl());
      if (this.closed) return;
      this.welcomed = true;
      this.client.startPrivate(this.config);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '游戏服务器连接失败');
    }
  }

  private enter(room: RoomView): void {
    if (this.closed || this.source || (room.phase !== PHASE_COUNTDOWN && room.phase !== PHASE_PLAYING)) return;
    try {
      this.source = new NetMatchSource(this.client, room, this.callbacks.predictor(), this.config);
      if (this.options.trainingWeapon) this.source.selectTrainingWeapon(this.options.trainingWeapon);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '无法载入服务器对局');
      return;
    }
    window.clearTimeout(this.timeout);
    this.callbacks.onStart(this.source, this.pendingAI);
    // The scene now owns the AI session and closes it when the match ends or is replaced.
    this.pendingAI = undefined;
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.dispose();
    this.callbacks.onError(message);
  }

  dropConnection(): void { this.client.dropConnection(); }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.timeout);
    this.source?.dispose();
    this.source = null;
    this.client.disconnect();
    if (this.pendingAI) void closeDeepSeekSession(this.pendingAI.sessionId).catch(() => {});
    this.pendingAI = undefined;
  }
}
