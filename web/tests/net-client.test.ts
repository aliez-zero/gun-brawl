import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_LEVELS, createCampaignConfig } from '../src/content/campaign';
import { createDeepSeekMatchConfig, createMatchConfig } from '../src/content/matches';
import { NetClient } from '../src/net/NetClient';
import { privateSetup } from '../src/net/matchSetup';
import { Reader, Writer } from '../src/net/postcard';
import { PROTO_VERSION } from '../src/net/protocol';

class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static last: Socket;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBufferLike }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn<(bytes: Uint8Array) => void>();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor() { Socket.last = this; }
  open(): void { this.readyState = Socket.OPEN; this.onopen?.(); }
  receive(bytes: Uint8Array): void { this.onmessage?.({ data: bytes.buffer }); }
}

function handlers() {
  return { onRoom: vi.fn(), onSnapshot: vi.fn(), onMatchEnd: vi.fn(), onStatus: vi.fn(), onLatency: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout,
    localStorage: { getItem: () => 'public-device-token' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('WebSocket handshake', () => {
  it.each([false, true])('waits for Welcome and sends the right identity for privateSession=%s', async (privateSession) => {
    const hooks = handlers();
    const client = new NetClient(hooks, { privateSession });
    const connected = client.connect('ws://game/ws');
    expect(client.connect('ws://game/ws')).toBe(connected);
    const socket = Socket.last;
    socket.open();
    expect(client.connected).toBe(false);
    const hello = new Reader(socket.send.mock.calls[0]![0]);
    expect([hello.varint(), hello.varint(), hello.varint(), hello.str(), hello.str()]).toEqual([
      0, PROTO_VERSION, 0, privateSession ? '' : 'public-device-token', 'web',
    ]);
    const done = vi.fn();
    void connected.then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    socket.receive(Uint8Array.of(0, 8, 1, 65, 0, 60, 30));
    await connected;
    expect(client.connected).toBe(true);
    expect(client.playerId).toBe(8);
    vi.advanceTimersByTime(1000);
    expect(new Reader(socket.send.mock.calls.at(-1)![0]).varint()).toBe(8);
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    expect(socket.onmessage).toBeNull();
  });

  it.each(['timeout', 'close', 'error', 'kick', 'cancel'])('releases a pending %s handshake and can connect again', async (reason) => {
    const client = new NetClient(handlers());
    const pending = client.connect('ws://game/ws');
    const rejected = expect(pending).rejects.toThrow();
    const first = Socket.last;
    if (reason !== 'timeout') first.open();
    switch (reason) {
      case 'timeout': vi.advanceTimersByTime(6100); break;
      case 'close': first.close(); break;
      case 'error': first.onerror?.(); break;
      case 'cancel': client.disconnect(); break;
      case 'kick': {
        const reply = new Writer();
        reply.varint(5); reply.varint(426); reply.str('版本不一致');
        first.receive(reply.finish());
        break;
      }
    }
    await rejected;
    expect(client.connected).toBe(false);
    expect(first.onopen).toBeNull();
    expect(first.onclose).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const retry = client.connect('ws://game/ws');
    Socket.last.open();
    Socket.last.receive(Uint8Array.of(0, 9, 1, 66, 0, 60, 30));
    await retry;
    expect(client.playerId).toBe(9);
    client.disconnect();
  });
});

it('sends keyboard assignments, training bits, campaign rules and DeepSeek control kinds', () => {
  expect(privateSetup(createMatchConfig('local-duel', 12)).actors.map((actor) => actor.kind)).toEqual([1, 2]);
  const training = privateSetup(createMatchConfig('training', 12, { trainingCompleted: ['bomb', 'drop'] }));
  expect(training.trainingCompleted).toBe(36);
  expect(training.actors[1]!.kind).toBe(4);
  const campaign = privateSetup(createCampaignConfig(CAMPAIGN_LEVELS[4]!, -1));
  expect(campaign).toMatchObject({ mode: 'campaign', map: 'sky-citadel', campaignLevel: 'level-5', stocks: 2,
    dropMode: 1, duration: 90, seed: 0xffffffff, actors: [{ kind: 1 }, { kind: 3, difficulty: 2 }] });
  expect(privateSetup(createDeepSeekMatchConfig(1, { matchId: 'deepseek-test' })).actors[1]!.kind).toBe(5);
});
