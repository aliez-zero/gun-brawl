/**
 * WebSocket client: handshake, ping, room commands and message dispatch.
 */
import {
  decodeServer,
  encodeClient,
  PROTO_VERSION,
  type ClientMessage,
  type InputFrame,
  type MatchResultWire,
  type RoomView,
  type Snapshot,
} from './protocol';

export type NetStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface NetHandlers {
  onRoom(view: RoomView): void;
  onSnapshot(snapshot: Snapshot): void;
  onMatchEnd(result: MatchResultWire): void;
  onStatus(status: NetStatus, detail?: string): void;
  onLatency(rttMs: number, jitterMs: number): void;
}

export class NetClient {
  readonly handlers: NetHandlers;
  playerId = 0;
  name = '';
  room: RoomView | null = null;
  status: NetStatus = 'closed';
  lastError: string | null = null;

  private socket: WebSocket | null = null;
  private pingTimer: number | null = null;
  private pingSentAt = 0;
  private readonly rtts: number[] = [];

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  async connect(url: string, build = 'web'): Promise<void> {
    this.disconnect();
    this.setStatus('connecting');
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('连接超时')), 6000);
      socket.onopen = () => {
        window.clearTimeout(timer);
        this.send({ type: 'hello', content: 0, token: this.token(), build });
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timer);
        this.setStatus('error', '连接失败');
        reject(new Error('连接失败'));
      };
    });

    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      let message;
      try {
        message = decodeServer(new Uint8Array(event.data));
      } catch (error) {
        const hex = Array.from(new Uint8Array(event.data).slice(0, 64), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
        console.error(`net: decode failed ${String(error)} bytes=${hex}`);
        return;
      }
      switch (message.type) {
        case 'welcome':
          this.playerId = message.playerId;
          this.name = message.name;
          this.setStatus('open');
          this.startPing();
          break;
        case 'room':
          this.room = message.room;
          this.handlers.onRoom(message.room);
          break;
        case 'snapshot':
          this.handlers.onSnapshot(message.snapshot);
          break;
        case 'matchEnd':
          this.handlers.onMatchEnd(message.result);
          break;
        case 'pong': {
          const rtt = performance.now() - this.pingSentAt;
          if (rtt > 0 && rtt < 5000) this.recordRtt(rtt);
          break;
        }
        case 'kick':
          this.lastError = message.message;
          this.setStatus('error', message.message);
          socket.close();
          break;
        case 'unknown':
          break;
      }
    };
    socket.onclose = () => {
      this.stopPing();
      if (this.status !== 'error') this.setStatus('closed');
    };
  }

  disconnect(): void {
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    this.room = null;
    this.setStatus('closed');
  }

  /** Simulate a network drop (browser smoke test); the client reconnects. */
  dropConnection(): void {
    this.socket?.close();
  }

  createRoom(name: string, map: string, stocks: number, duration: number, dropMode: number): void {
    this.send({ type: 'createRoom', name, map, stocks, duration, dropMode });
  }

  joinRoom(code: string, name: string): void {
    this.send({ type: 'joinRoom', code: code.trim().toUpperCase(), name });
  }

  ready(ready: boolean): void {
    this.send({ type: 'ready', ready });
  }

  pickSlot(slot: number, kind: number, difficulty: number): void {
    this.send({ type: 'pickSlot', slot, kind, difficulty });
  }

  start(): void {
    this.send({ type: 'start' });
  }

  rematch(): void {
    this.send({ type: 'rematch' });
  }

  leave(): void {
    this.send({ type: 'leave' });
  }

  sendInput(frames: InputFrame[]): void {
    this.send({ type: 'input', frames });
  }

  private send(message: ClientMessage): void {
    if (!this.connected) return;
    this.socket!.send(encodeClient(message));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (!this.connected) return;
      this.pingSentAt = performance.now();
      this.send({ type: 'ping', t: Math.round(this.pingSentAt) });
    }, 1000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private recordRtt(rtt: number): void {
    this.rtts.push(rtt);
    if (this.rtts.length > 12) this.rtts.shift();
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const mean = this.rtts.reduce((sum, value) => sum + value, 0) / Math.max(1, this.rtts.length);
    const variance = this.rtts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, this.rtts.length);
    this.handlers.onLatency(median, Math.sqrt(variance));
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
      const created = crypto.randomUUID();
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return '';
    }
  }
}

export { PROTO_VERSION };
