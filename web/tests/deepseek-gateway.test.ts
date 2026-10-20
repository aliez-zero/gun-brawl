import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeepSeekGateway } from '../../server/ai/deepseek.mjs';
import type { GatewayOptions } from '../../server/ai/deepseek.mjs';
import { createDeepSeekMatchConfig } from '../src/content/matches';
import { MatchRunner } from '../src/game/core/MatchRunner';
import { createObservation } from '../src/game/ai/external/Protocol';
import { idleInput } from '../src/game/core/types';

const action = { ...idleInput(), moveX: 1, shootHeld: true, holdFrames: 20 };
const modelReply = (content: unknown = action, finish = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason: finish, message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  usage: { prompt_tokens: 120, completion_tokens: 40 },
}));
const instances: { server: Server; gateway: ReturnType<typeof createDeepSeekGateway> }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { server, gateway } of instances.splice(0)) {
    gateway.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function start(options: GatewayOptions = {}) {
  const gateway = createDeepSeekGateway({ apiKey: 'test-key-never-real', fetchImpl: async () => modelReply(), ...options });
  const server = createServer((req, res) => gateway(req, res, () => { res.writeHead(404); res.end(); }));
  instances.push({ server, gateway }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, extra: RequestInit = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });
  const session = await (await post('/session', { episodeId: 'test-episode', actorId: 'deepseek' })).json() as { sessionId: string };
  const runner = new MatchRunner({ ...createDeepSeekMatchConfig(2, { matchId: 'test-episode' }), countdown: 0 });
  runner.advance(1000 / 60, idleInput);
  const request = { sessionId: session.sessionId, sequence: 1, epoch: 2, observation: createObservation(runner.state, 'deepseek', runner.tick) };
  return { base, post, request };
}

describe('local DeepSeek gateway', () => {
  it('does not require a key for status and never returns a key; opening a match requires configuration', async () => {
    const { base, post } = await start({ apiKey: '' });
    const status = await (await fetch(base + '/status')).json() as { configured: boolean; requestIntervalMs: number };
    expect(status.configured).toBe(false);
    expect(status.requestIntervalMs).toBe(500);
    const response = await post('/session', { episodeId: 'another', actorId: 'deepseek' });
    expect(response.status).toBe(503);
  });

  it('calls the official endpoint with thinking JSON mode and strips unknown observation fields', async () => {
    let sent: Record<string, unknown> = {};
    let authorization = '';
    const { post, request } = await start({ fetchImpl: async (url, init) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      sent = JSON.parse(init!.body as string) as typeof sent;
      authorization = (init!.headers as Record<string, string>).Authorization!;
      return modelReply();
    } });
    const response = await post('/action', { ...request, observation: { ...request.observation, privateSecret: 'MUST-NOT-FORWARD' } });
    expect(response.status).toBe(200);
    const body = await response.json() as { action: unknown; sequence: number; usage: { requests: number } };
    expect(body.action).toEqual(action); expect(body.sequence).toBe(1); expect(body.usage.requests).toBe(1);
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.thinking).toEqual({ type: 'enabled' });
    expect(sent.reasoning_effort).toBe('low');
    expect(sent.max_tokens).toBe(4096);
    expect(JSON.stringify(sent)).not.toContain('MUST-NOT-FORWARD');
    const sentObservation = JSON.parse((sent.messages as { role: string; content: string }[])[1]!.content) as typeof request.observation;
    expect(sentObservation.tactical).toEqual(request.observation.tactical);
    expect(sentObservation.recentActions).toEqual(request.observation.recentActions);
    expect(authorization).toBe('Bearer test-key-never-real');
    expect(JSON.stringify(body)).not.toContain('test-key-never-real');
  });

  it('keeps each request independent within one match and across new match sessions', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const sent: { messages: { role: string; content: string }[] }[] = [];
    const { base, post, request } = await start({ contextTokens: 900000, fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(init!.body as string) as typeof sent[number]);
      return modelReply({ ...action, privateExtra: 'do-not-remember' });
    } });
    expect((await (await fetch(base + '/status')).json() as { contextTokens: number }).contextTokens).toBe(512000);
    const first = await post('/action', request);
    expect(first.status).toBe(200);
    expect((await first.json() as { context: { limitTokens: number } }).context.limitTokens).toBe(512000);
    clock.mockReturnValue(1001000);
    const latest = { ...request, sequence: 2, epoch: 5, observation: { ...request.observation, tick: 120 } };
    const second = await post('/action', latest);
    expect(second.status).toBe(200);
    expect((await second.json() as { context: { limitTokens: number } }).context.limitTokens).toBe(512000);
    expect(sent[1]!.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.parse(sent[1]!.messages[1]!.content)).toEqual(latest.observation);
    expect(JSON.stringify(sent[1])).not.toContain('"holdFrames"');
    expect(JSON.stringify(sent)).not.toContain('do-not-remember');
    const fresh = await (await post('/session', { episodeId: 'new-match', actorId: 'deepseek' })).json() as { sessionId: string };
    expect(fresh.sessionId).not.toBe(request.sessionId);
    expect((await post('/action', { ...request, sessionId: fresh.sessionId, observation: { ...request.observation, episodeId: 'new-match' } })).status).toBe(200);
    expect(sent[2]!.messages).toHaveLength(2);
    expect(JSON.stringify(sent[2])).not.toContain('test-episode');
    expect((await post('/session', { sessionId: request.sessionId, close: true })).status).toBe(200);
    expect((await post('/action', { ...latest, sequence: 3 })).status).toBe(410);
  });

  it('does not put invalid model replies into later context', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const sent: { messages: unknown[] }[] = [];
    const { post, request } = await start({ fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(init!.body as string) as typeof sent[number]);
      return sent.length === 1 ? modelReply('INVALID-JSON-CONTENT') : modelReply();
    } });
    expect((await post('/action', request)).status).toBe(502);
    clock.mockReturnValue(1001000);
    expect((await post('/action', { ...request, sequence: 2 })).status).toBe(200);
    expect(sent[1]!.messages).toHaveLength(2);
    clock.mockReturnValue(1002000);
    expect((await post('/action', { ...request, sequence: 3 })).status).toBe(200);
    expect(sent[2]!.messages).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toContain('INVALID-JSON-CONTENT');
  });

  it('applies the context budget separately to each request instead of accumulating match usage', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const { post, request } = await start({ contextTokens: 16000 });
    const estimates: number[] = [];
    for (let sequence = 1; sequence <= 8; sequence++) {
      clock.mockReturnValue(1000000 + sequence * 1000);
      const response = await post('/action', { ...request, sequence });
      expect(response.status).toBe(200);
      const { context } = await response.json() as { context: { estimatedInputTokens: number } };
      expect(context.estimatedInputTokens + 4096).toBeLessThanOrEqual(16000);
      estimates.push(context.estimatedInputTokens);
    }
    expect(new Set(estimates).size).toBe(1);
  });

  it('rejects an observation larger than the context budget before spending requests', async () => {
    const upstream = vi.fn<typeof fetch>(async () => modelReply());
    const { post, request } = await start({ contextTokens: 4096, fetchImpl: upstream });
    const observation = { ...request.observation, projectiles: Array.from({ length: 48 }, (_, id) => ({ id, owner: 'p1', x: 100, y: 100, vx: 0, vy: 0 })) };
    const response = await post('/action', { ...request, observation });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'CONTEXT_TOO_LARGE', usage: { requests: 0 } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects cross-site requests, actor spoofing, oversized bodies and invalid telemetry before calling upstream', async () => {
    const upstream = vi.fn<typeof fetch>(async () => modelReply());
    const { post, request } = await start({ fetchImpl: upstream });
    expect((await post('/action', request, { headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' } })).status).toBe(403);
    expect((await post('/action', { ...request, observation: { ...request.observation, actorId: 'p1' } })).status).toBe(400);
    expect((await post('/action', { ...request, observation: { ...request.observation, tick: -1 } })).status).toBe(400);
    expect((await post('/action', { padding: 'x'.repeat(70000) })).status).toBe(413);
    expect((await post('/action', null)).status).toBe(400);
    expect((await post('/status', request)).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('enforces per-match budget and single-use sequence IDs', async () => {
    const upstream = vi.fn<typeof fetch>(async () => modelReply());
    const { post, request } = await start({ fetchImpl: upstream, maxRequests: 1 });
    expect((await post('/action', request)).status).toBe(200);
    expect((await post('/action', request)).status).toBe(400);
    const response = await post('/action', { ...request, sequence: 2 });
    expect((await response.json() as { error: string }).error).toBe('BUDGET');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects empty, truncated and illegal model output', async () => {
    for (const [content, finish] of [['', 'stop'], ['{}', 'length'], ['{"moveX":99}', 'stop'], [{ ...action, jumpPressed: true, dropPressed: true }, 'stop']] as const) {
      const { post, request } = await start({ fetchImpl: async () => modelReply(content, finish) });
      const response = await post('/action', request);
      expect(response.status).toBe(502);
      expect((await response.json() as { usage: { completionTokens: number } }).usage.completionTokens).toBe(40);
    }
  });

  it('returns useful provider errors without exposing upstream content', async () => {
    for (const [status, code] of [[401, 'AUTH'], [402, 'BALANCE'], [400, 'PARAMETERS'], [429, 'UPSTREAM_RATE'], [503, 'UPSTREAM']] as const) {
      const { post, request } = await start({ fetchImpl: async () => new Response('private upstream diagnostics', { status }) });
      const response = await post('/action', request);
      expect(response.status).toBe(status === 401 || status === 402 ? status : 502);
      const text = await response.text();
      expect(text).toContain(code); expect(text).not.toContain('private upstream');
    }
  });

  it('cancels a slow provider at the deadline', async () => {
    let aborted = false;
    const { post, request } = await start({ timeoutMs: 500, fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    }) });
    const response = await post('/action', request);
    expect(response.status).toBe(504); expect(aborted).toBe(true);
  });

  it('cancels an upstream call when the browser disconnects and closes sessions explicitly', async () => {
    let upstreamSignal: AbortSignal | null = null;
    const { post, request } = await start({ fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      upstreamSignal = init!.signal as AbortSignal;
      upstreamSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) });
    const controller = new AbortController();
    const response = post('/action', request, { signal: controller.signal }).catch(() => null);
    await vi.waitFor(() => expect(upstreamSignal).not.toBeNull());
    controller.abort(); await response;
    await vi.waitFor(() => expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(true));
    expect((await post('/session', { sessionId: request.sessionId, close: true })).status).toBe(200);
    expect((await post('/action', { ...request, sequence: 2 })).status).toBe(410);
  });

  it('does not remember a cancelled request even if an upstream reply arrives after abort', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const sent: { messages: unknown[] }[] = [];
    let upstreamSignal: AbortSignal | undefined;
    const { post, request } = await start({ fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(init!.body as string) as typeof sent[number]);
      if (sent.length > 1) return modelReply();
      upstreamSignal = init!.signal as AbortSignal;
      return await new Promise<Response>((resolve) => {
        upstreamSignal!.addEventListener('abort', () => resolve(modelReply()), { once: true });
      });
    } });
    const controller = new AbortController();
    const response = post('/action', request, { signal: controller.signal }).catch(() => null);
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    controller.abort(); await response;
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
    clock.mockReturnValue(1001000);
    expect((await post('/action', { ...request, sequence: 2, epoch: 5 })).status).toBe(200);
    expect(sent[1]!.messages).toHaveLength(2);
  });
});
