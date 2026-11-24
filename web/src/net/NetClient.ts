import { randomId } from '../ids';
import type { MatchConfig } from '../game/core/types';
import { privateSetup } from './matchSetup';
import {
  decodeServer, encodeClient, PROTO_VERSION,
  type ClientMessage, type InputFrame, type MatchResultWire, type PrivateAction,
  type RoomView, type ServerMessage, type Snapshot,
} from './protocol';

export type NetStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface NetLatency {
  readonly rtt: number;
  readonly jitter: number;
}

export interface NetHandlers {
  onRoom(view: RoomView): void;
  onSnapshot(snapshot: Snapshot): void;
  onMatchEnd(result: MatchResultWire): void;
  onStatus(status: NetStatus, detail?: string): void;
  onLatency(rttMs: number, jitterMs: number): void;
}

export class NetClient {
  playerId = 0;
  name = '';
  room: RoomView | null = null;
  status: NetStatus = 'closed';
  lastError: string | null = null;

  private socket: WebSocket | null = null;
  private handshake: { url: string; build: string; promise: Promise<void>; settle(error?: Error): void } | null = null;
  private pingTimer: number | null = null;
  private readonly rtts: number[] = [];
  private sample: NetLatency | null = null;

  constructor(readonly handlers: NetHandlers, private readonly options: { privateSession?: boolean } = {}) {}

  get connected(): boolean {
    return this.status === 'open' && this.socket?.readyState === WebSocket.OPEN;
  }

  get latency(): NetLatency | null { return this.sample; }

  connect(url: string, build = 'web'): Promise<void> {
    if (this.handshake?.url === url && this.handshake.build === build) return this.handshake.promise;
    if (this.socket) this.disconnect();
    this.lastError = null;
    this.playerId = 0;
    this.name = '';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.setStatus('error', '连接失败');
      return Promise.reject(error);
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    let settle!: (error?: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => this.fail('连接超时'), 6000);
      settle = (error) => {
        window.clearTimeout(timeout);
        this.handshake = null;
        if (error) reject(error);
        else resolve();
      };
    });
    this.handshake = { url, build, promise, settle };
    socket.onopen = () => {
      socket.send(encodeClient({ type: 'hello', content: 0, token: this.options.privateSession ? '' : this.token(), build }));
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      let message: ServerMessage;
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new Error('expected binary message');
        message = decodeServer(new Uint8Array(event.data));
      } catch {
        this.fail('服务器消息格式无效，请刷新页面重试');
        return;
      }
      if (message.type === 'kick') { this.fail(message.message); return; }
      if (this.handshake) {
        if (message.type !== 'welcome') { this.fail('服务器握手失败'); return; }
        this.playerId = message.playerId;
        this.name = message.name;
        this.handshake.settle();
        this.setStatus('open');
        if (this.socket === socket) this.startPing();
        return;
      }
      this.dispatch(message);
    };
    socket.onerror = () => {
      if (this.handshake) this.fail('连接失败');
      else socket.close();
    };
    socket.onclose = () => {
      if (this.handshake) this.fail('握手完成前连接已断开');
      else { this.releaseSocket(); this.setStatus('closed'); }
    };
    this.setStatus('connecting');
    return promise;
  }

  private dispatch(message: ServerMessage): void {
    switch (message.type) {
      case 'room':
        this.room = message.room;
        this.handlers.onRoom(message.room);
        break;
      case 'snapshot': this.handlers.onSnapshot(message.snapshot); break;
      case 'matchEnd': this.handlers.onMatchEnd(message.result); break;
      case 'pong': {
        const rtt = performance.now() - message.t;
        if (rtt >= 0 && rtt < 5000) this.recordRtt(rtt);
        break;
      }
    }
  }

  private fail(detail: string): void {
    this.handshake?.settle(new Error(detail));
    this.releaseSocket();
    this.setStatus('error', detail);
  }

  private releaseSocket(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.rtts.length = 0;
    this.sample = null;
    const socket = this.socket;
    this.socket = null;
    this.room = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  }

  disconnect(): void {
    this.handshake?.settle(new Error('连接已取消'));
    this.releaseSocket();
    if (this.status !== 'closed') this.setStatus('closed');
  }

  /** Simulate a network drop for the public reconnect check. */
  dropConnection(): void { this.socket?.close(); }

  createRoom(name: string, map: string, stocks: number, duration: number, dropMode: number): void {
    this.send({ type: 'createRoom', name, map, stocks, duration, dropMode });
  }
  joinRoom(code: string, name: string): void { this.send({ type: 'joinRoom', code: code.trim().toUpperCase(), name }); }
  ready(ready: boolean): void { this.send({ type: 'ready', ready }); }
  pickSlot(slot: number, kind: number, difficulty: number): void { this.send({ type: 'pickSlot', slot, kind, difficulty }); }
  start(): void { this.send({ type: 'start' }); }
  rematch(): void { this.send({ type: 'rematch' }); }
  leave(): void { this.send({ type: 'leave' }); }
  sendInput(frames: InputFrame[]): void { this.send({ type: 'input', frames }); }
  startPrivate(config: MatchConfig): void { this.send({ type: 'startPrivate', setup: privateSetup(config) }); }
  sendPrivateInput(actor: number, frames: InputFrame[]): void { this.send({ type: 'privateInput', actor, frames }); }
  privateControl(action: PrivateAction): void { this.send({ type: 'privateControl', action }); }

  private send(message: ClientMessage): void {
    if (this.connected) this.socket!.send(encodeClient(message));
  }

  private startPing(): void {
    const ping = () => this.send({ type: 'ping', t: Math.floor(performance.now()) });
    ping();
    this.pingTimer = window.setInterval(ping, 1000);
  }

  private recordRtt(rtt: number): void {
    this.rtts.push(rtt);
    if (this.rtts.length > 12) this.rtts.shift();
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const mean = this.rtts.reduce((sum, value) => sum + value, 0) / this.rtts.length;
    const variance = this.rtts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / this.rtts.length;
    this.sample = { rtt: median, jitter: Math.sqrt(variance) };
    this.handlers.onLatency(this.sample.rtt, this.sample.jitter);
  }

  private setStatus(status: NetStatus, detail?: string): void {
    this.status = status;
    if (detail !== undefined) this.lastError = detail;
    this.handlers.onStatus(status, detail);
  }

  private token(): string {
    const key = 'gun-brawl:device';
    try {
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const created = randomId();
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return '';
    }
  }
}

export { PROTO_VERSION };
