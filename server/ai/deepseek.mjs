import { randomUUID } from 'node:crypto';
import { prepareModelContext, resolveContextTokens, MAX_CONTEXT_TOKENS, MAX_OUTPUT_TOKENS } from './context-budget.mjs';

const MAX_BODY = 64 * 1024;
const SYSTEM = `You control a character in a 2D platform gun brawl. Win by knocking opponents outside map.bounds; there is no HP damage. x goes right, y goes down; actor x/y is feet center. Physics runs at 60 FPS. Platforms may be one-way (drop through) or solid. Two jumps, limited bombs and weapon ammo. Facing follows moveX; shooting is horizontal in facing direction. Reload takes time. Avoid walking beyond a landing platform without jumping. Move toward enemies and shoot when aligned, recover to platforms when falling, collect active weapon drops when useful. Prioritize survival: keep a safe distance from both map edges, steer toward a reachable platform while falling, and jump before crossing an exposed platform edge. When platformEdgeDistanceLeft or platformEdgeDistanceRight is below about 80, brake or jump inward. Use tactical.nearestEnemy* and tactical.currentPlatformId instead of estimating these values from scratch. recentActions is a short memory of your previous commands; use it to avoid repeating a failed jump or firing while facing away. Never assume unseen future events. Use the provided telemetry only.
Return ONLY a JSON object with all fields, no explanation:
{"moveX":1,"jumpPressed":false,"dropPressed":false,"shootHeld":true,"bombPressed":false,"reloadPressed":false,"holdFrames":30}
moveX must be -1, 0 or 1. The five action flags are booleans. holdFrames is an integer from 1 to 45. Movement and firing are held for holdFrames; jump/drop/bomb/reload trigger ONCE on the first frame. Never jump and drop together. Commands expire and inputs become neutral until the next decision. Requests have network latency: use velocity to anticipate movement. You cannot set coordinates, ammo or lives.`;

class GatewayError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = () => { throw new GatewayError(400, 'INVALID_REQUEST', '游戏状态或操作格式无效'); };
const number = (min = -100000, max = 100000) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
const integer = (min = 0, max = 1000000) => (v) => Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const text = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(v) ? v : fail();
const enumeration = (...values) => (v) => values.includes(v) ? v : fail();
const nullable = (read) => (v) => v === null ? null : read(v);
const list = (read, max) => (v) => Array.isArray(v) && v.length <= max ? v.map(read) : fail();
const shape = (fields) => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return Object.fromEntries(Object.entries(fields).map(([key, read]) => [key, read(v[key])]));
};
const xy = { x: number(), y: number() };
const velocity = { vx: number(), vy: number() };
const actionHistory = shape({
  tick: integer(), moveX: enumeration(-1, 0, 1), jumpPressed: (v) => typeof v === 'boolean' ? v : fail(),
  dropPressed: (v) => typeof v === 'boolean' ? v : fail(), shootHeld: (v) => typeof v === 'boolean' ? v : fail(),
  bombPressed: (v) => typeof v === 'boolean' ? v : fail(), reloadPressed: (v) => typeof v === 'boolean' ? v : fail(),
  holdFrames: integer(1, 45),
});
const optional = (read, fallback) => (v) => v === undefined ? fallback : read(v);
const readObservation = shape({
  version: enumeration(1), episodeId: text, actorId: text, tick: integer(), remaining: number(0, 6000),
  map: shape({
    id: text, width: number(1), height: number(1),
    bounds: shape({ left: number(), right: number(), top: number(), bottom: number() }),
    platforms: list(shape({ id: text, ...xy, width: number(1), height: number(1), kind: enumeration('one-way', 'solid') }), 64),
  }),
  physics: shape({ speed: number(0), gravity: number(0), jump: number(0), airJump: number(0), width: number(1), height: number(1) }),
  self: shape({
    id: text, ...xy, ...velocity, facing: enumeration(-1, 1), groundedOn: nullable(text),
    jumpsRemaining: integer(0, 2), stocks: integer(0, 99), protection: number(0, 100),
    reloadRemaining: number(0, 100), fireCooldown: number(0, 100), bombsRemaining: integer(0, 99), bombCooldown: number(0, 100),
    weapon: shape({ id: text, ammo: nullable(integer()), reserve: integer(), range: number(0), interval: number(0, 100) }),
  }),
  tactical: shape({
    edgeDistanceLeft: number(0), edgeDistanceRight: number(0), nearestEnemyId: nullable(text),
    platformEdgeDistanceLeft: nullable(number(0)), platformEdgeDistanceRight: nullable(number(0)),
    nearestEnemyDx: nullable(number()), nearestEnemyDy: nullable(number()), nearestEnemyDistance: nullable(number(0)),
    currentPlatformId: nullable(text), isFalling: (v) => typeof v === 'boolean' ? v : fail(),
  }),
  recentActions: optional(list(actionHistory, 8), []),
  enemies: list(shape({ id: text, ...xy, ...velocity, facing: enumeration(-1, 1), stocks: integer(0, 99), status: enumeration('alive', 'respawning', 'eliminated'), weaponId: text }), 3),
  projectiles: list(shape({ id: integer(), owner: text, ...xy, ...velocity }), 48),
  bombs: list(shape({ id: integer(), owner: text, ...xy, ...velocity, radius: number(0) }), 16),
  drops: list(shape({ id: integer(), ...xy, weaponId: text, state: enumeration('incoming', 'active') }), 16),
});

export function validateAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (![-1, 0, 1].includes(value.moveX) || !Number.isInteger(value.holdFrames) || value.holdFrames < 1 || value.holdFrames > 45) return null;
  const keys = ['jumpPressed', 'dropPressed', 'shootHeld', 'bombPressed', 'reloadPressed'];
  if (keys.some((key) => typeof value[key] !== 'boolean') || (value.jumpPressed && value.dropPressed)) return null;
  return { moveX: value.moveX, ...Object.fromEntries(keys.map((key) => [key, value[key]])), holdFrames: value.holdFrames };
}

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new GatewayError(415, 'CONTENT_TYPE', '请求需要 JSON');
  if (Number(req.headers['content-length']) > MAX_BODY) throw new GatewayError(413, 'BODY_TOO_LARGE', '游戏状态过大');
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => finish(new GatewayError(408, 'BODY_TIMEOUT', '请求读取超时')), 3000);
    function finish(error, value) {
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort);
      if (error) { req.once('error', () => {}); req.resume(); reject(error); } else resolve(value);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY) finish(new GatewayError(413, 'BODY_TOO_LARGE', '游戏状态过大'));
      else chunks.push(chunk);
    }
    function onEnd() {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new GatewayError(400, 'INVALID_JSON', '请求不是有效 JSON')); }
    }
    function onError() { finish(new GatewayError(400, 'READ_ERROR', '请求读取失败')); }
    function onAbort() { finish(new GatewayError(400, 'CANCELLED', '请求已取消')); }
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAbort);
  });
}

/** Local-only HTTP middleware. API key and upstream address never come from browser input. */
export function createDeepSeekGateway({ apiKey = '', model = 'deepseek-flash', maxRequests = 180, requestIntervalMs = 500, timeoutMs = 5000, contextTokens = MAX_CONTEXT_TOKENS, fetchImpl = globalThis.fetch } = {}) {
  const sessions = new Map();
  const limited = (n, fallback, min, max) => Number.isInteger(Number(n)) ? Math.max(min, Math.min(max, Number(n))) : fallback;
  maxRequests = limited(maxRequests, 180, 1, 360);
  requestIntervalMs = limited(requestIntervalMs, 500, 500, 10000);
  timeoutMs = limited(timeoutMs, 5000, 500, 20000);
  contextTokens = resolveContextTokens(contextTokens);
  model = /^[a-zA-Z0-9_.-]{1,80}$/.test(model) ? model : 'deepseek-flash';
  apiKey = apiKey.trim();
  const configured = Boolean(apiKey);
  let totalRequests = 0;
  const reply = (res, status, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  const dispose = (id) => { sessions.get(id)?.controller?.abort(); sessions.delete(id); };
  const usage = (s) => ({ requests: s.requests, promptTokens: s.promptTokens, completionTokens: s.completionTokens });
  const sweep = () => { for (const [id, s] of sessions) if (Date.now() > s.expires) dispose(id); };

  const middleware = (req, res, next) => {
    let usedSession = null;
    void (async () => {
      const path = (req.url ?? '').split('?')[0];
      if (!['/status', '/session', '/action'].includes(path)) { next(); return; }
      // Works behind Vite's same-origin middleware in both dev and preview.
      const host = req.headers.host ?? '';
      const hostname = host.split(':')[0];
      if (!['localhost', '127.0.0.1'].includes(hostname)) throw new GatewayError(403, 'LOCAL_ONLY', 'AI 服务仅允许本机访问');
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}` && origin !== `https://${host}`) throw new GatewayError(403, 'ORIGIN', '不允许跨站调用 AI 服务');
      sweep();
      if (path === '/status') {
        if (req.method !== 'GET') throw new GatewayError(405, 'METHOD', '请求方法不支持');
        reply(res, 200, { configured, model, maxRequests, requestIntervalMs, timeoutMs, contextTokens }); return;
      }
      if (!configured) throw new GatewayError(503, 'NOT_CONFIGURED', '尚未配置 DeepSeek API Key，请配置 .env.local 后重启服务');
      if (req.method !== 'POST') throw new GatewayError(405, 'METHOD', '请求方法不支持');
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail();
      if (path === '/session' && body.close === true) {
        dispose(text(body.sessionId)); reply(res, 200, { closed: true }); return;
      }
      if (path === '/session') {
        if (sessions.size >= 8) throw new GatewayError(429, 'SESSION_LIMIT', '同时进行的 AI 对局过多');
        const episodeId = text(body.episodeId), actorId = text(body.actorId);
        const sessionId = randomUUID();
        sessions.set(sessionId, { episodeId, actorId, requests: 0, promptTokens: 0, completionTokens: 0, lastStart: 0, sequence: -1, expires: Date.now() + 20 * 60000, controller: null });
        reply(res, 200, { sessionId, model, maxRequests, requestIntervalMs, timeoutMs, contextTokens }); return;
      }

      const sessionId = text(body.sessionId);
      const session = sessions.get(sessionId);
      if (!session) throw new GatewayError(410, 'SESSION_EXPIRED', 'AI 对局连接已失效，请重新开局');
      usedSession = session;
      const observation = readObservation(body.observation);
      const sequence = integer()(body.sequence), epoch = integer()(body.epoch);
      if (observation.episodeId !== session.episodeId || observation.actorId !== session.actorId || observation.self.id !== session.actorId || sequence <= session.sequence) return fail();
      if (session.requests >= maxRequests || totalRequests >= 600) throw new GatewayError(429, 'BUDGET', '本局或本次服务的 AI 请求预算已用完');
      if (session.controller || Date.now() - session.lastStart < requestIntervalMs) throw new GatewayError(429, 'RATE_LIMIT', 'AI 请求过快，稍后继续');
      const prepared = prepareModelContext(SYSTEM, JSON.stringify(observation), contextTokens);
      if (!prepared) throw new GatewayError(413, 'CONTEXT_TOO_LARGE', '当前战场状态超出上下文预算，请提高服务端上下文配置');
      session.requests++; totalRequests++; session.sequence = sequence; session.lastStart = Date.now();
      const controller = new AbortController(); session.controller = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', onClose);
      try {
        const upstream = await fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: prepared.messages, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, stream: false, max_tokens: MAX_OUTPUT_TOKENS }),
        });
        if (!upstream.ok) {
          const errors = { 400: ['PARAMETERS', 'DeepSeek 模型或请求参数无效，请检查服务端配置'], 422: ['PARAMETERS', 'DeepSeek 模型或请求参数无效，请检查服务端配置'], 401: ['AUTH', 'DeepSeek 密钥无效'], 402: ['BALANCE', 'DeepSeek 账户余额不足'], 429: ['UPSTREAM_RATE', 'DeepSeek 请求限流，稍后继续'] };
          const [code, message] = errors[upstream.status] ?? ['UPSTREAM', 'DeepSeek 暂时无法响应'];
          await upstream.body?.cancel();
          throw new GatewayError(upstream.status === 401 || upstream.status === 402 ? upstream.status : 502, code, message);
        }
        // Bound response size independently of the upstream model token setting.
        const reader = upstream.body?.getReader();
        if (!reader) throw new GatewayError(502, 'EMPTY_RESPONSE', 'DeepSeek 返回了空响应');
        let size = 0; const chunks = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY) throw new GatewayError(502, 'RESPONSE_TOO_LARGE', 'DeepSeek 响应过大');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new GatewayError(502, 'MODEL_JSON', 'DeepSeek 响应格式无效'); }
        const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
        session.promptTokens += count(payload.usage?.prompt_tokens);
        session.completionTokens += count(payload.usage?.completion_tokens);
        controller.signal.throwIfAborted();
        const choice = payload.choices?.[0];
        if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw new GatewayError(502, 'INCOMPLETE', 'DeepSeek 未返回完整操作');
        let value;
        try { value = JSON.parse(choice.message.content); } catch { value = null; }
        const action = validateAction(value);
        if (!action) throw new GatewayError(502, 'INVALID_ACTION', 'DeepSeek 返回了无效操作');
        reply(res, 200, { action, sequence, epoch, observationTick: observation.tick, model,
          usage: usage(session), context: prepared.context });
      } catch (error) {
        if (controller.signal.aborted) throw new GatewayError(504, 'TIMEOUT', 'DeepSeek 响应超时或请求已取消');
        if (error instanceof GatewayError) throw error;
        throw new GatewayError(502, 'NETWORK', '无法连接 DeepSeek，请检查网络');
      } finally {
        clearTimeout(timer); res.off('close', onClose); session.controller = null;
      }
    })().catch((error) => {
      const known = error instanceof GatewayError;
      reply(res, known ? error.status : 500, { error: known ? error.code : 'INTERNAL', message: known ? error.message : 'AI 服务处理失败', ...(usedSession ? { usage: usage(usedSession) } : {}) });
    });
  };
  middleware.close = () => { for (const id of sessions.keys()) dispose(id); };
  return middleware;
}
