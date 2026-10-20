import { createObservation, MAX_OBSERVATION_AGE, MAX_RECENT_ACTIONS, parseExternalAction } from '../../game/ai/external/Protocol';
import type { ExternalActionOutcome, RecentExternalAction } from '../../game/ai/external/Protocol';
import type { MatchRunner } from '../../game/core/MatchRunner';

export interface DeepSeekInfo {
  configured: boolean; model: string; maxRequests: number; requestIntervalMs: number; timeoutMs: number; contextTokens: number;
  thinking?: 'enabled' | 'disabled'; reasoningEffort?: 'none' | 'low' | 'high' | 'max';
}
export interface DeepSeekSession extends Omit<DeepSeekInfo, 'configured'> { sessionId: string }
export interface DeepSeekStatus {
  phase: 'waiting' | 'thinking' | 'executing' | 'paused' | 'error' | 'finished';
  message: string; decisions: number; latencyMs: number | null; requests: number; tokens: number;
}
export class DeepSeekError extends Error {
  constructor(message: string, readonly code: string, readonly usage?: unknown) { super(message); }
}

async function readReply(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw new DeepSeekError('AI 服务未启动或响应无效', 'GATEWAY'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeepSeekError('AI 服务响应无效', 'GATEWAY');
  if (!response.ok) throw new DeepSeekError(typeof body.message === 'string' ? body.message.slice(0, 160) : 'AI 服务请求失败', typeof body.error === 'string' ? body.error : 'GATEWAY', body.usage);
  return body;
}

export async function getDeepSeekInfo(signal?: AbortSignal): Promise<DeepSeekInfo> {
  const body = await readReply(await fetch('/api/deepseek/status', { signal, cache: 'no-store' }));
  if (typeof body.configured !== 'boolean') throw new DeepSeekError('AI 服务配置响应无效', 'GATEWAY');
  return { ...infoFields(body), configured: body.configured };
}

function infoFields(body: Record<string, unknown>): Omit<DeepSeekInfo, 'configured'> {
  if (typeof body.model !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(body.model)
    || !Number.isInteger(body.maxRequests) || (body.maxRequests as number) < 1 || (body.maxRequests as number) > 360
    || !Number.isInteger(body.requestIntervalMs) || (body.requestIntervalMs as number) < 500 || (body.requestIntervalMs as number) > 10000
    || !Number.isInteger(body.timeoutMs) || (body.timeoutMs as number) < 500 || (body.timeoutMs as number) > 20000
    || !Number.isInteger(body.contextTokens) || (body.contextTokens as number) < 4096 || (body.contextTokens as number) > 512000) throw new DeepSeekError('AI 服务配置响应无效', 'GATEWAY');
  const thinking = body.thinking === 'enabled' || body.thinking === 'disabled' ? body.thinking : undefined;
  const reasoningEffort = body.reasoningEffort === 'none' || body.reasoningEffort === 'low'
    || body.reasoningEffort === 'high' || body.reasoningEffort === 'max' ? body.reasoningEffort : undefined;
  return { model: body.model, maxRequests: body.maxRequests as number, requestIntervalMs: body.requestIntervalMs as number, timeoutMs: body.timeoutMs as number, contextTokens: body.contextTokens as number, thinking, reasoningEffort };
}

export async function openDeepSeekSession(episodeId: string, actorId: string, signal?: AbortSignal): Promise<DeepSeekSession> {
  const body = await readReply(await fetch('/api/deepseek/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId, actorId }), signal,
  }));
  if (typeof body.sessionId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(body.sessionId)) throw new DeepSeekError('AI 对局连接无效', 'GATEWAY');
  return { ...infoFields(body), sessionId: body.sessionId };
}

export async function closeDeepSeekSession(sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await fetcher('/api/deepseek/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, close: true }), keepalive: true,
  });
}

/** Asynchronous transport around a synchronous runner. Never advances or writes simulation state. */
export class DeepSeekClient {
  private pending: AbortController | null = null;
  private epoch: number | undefined;
  private sequence = 0;
  private nextRequestAt = 0;
  private stopped = false;
  private terminal = false;
  private actionUntilTick = 0;
  private recentActions: RecentExternalAction[] = [];
  private actionAnchor: { x: number; y: number; tick: number } | null = null;
  private readonly status: DeepSeekStatus = { phase: 'waiting', message: '等待开场', decisions: 0, latencyMs: null, requests: 0, tokens: 0 };

  constructor(
    private readonly runner: MatchRunner,
    private readonly actorId: string,
    private readonly session: DeepSeekSession,
    private readonly onStatus: (status: DeepSeekStatus | null) => void,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = () => performance.now(),
  ) { this.publish('waiting', '等待开场'); }

  update(): void {
    if (this.stopped) return;
    const state = this.runner.state;
    const epoch = this.runner.externalEpoch(this.actorId);
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.pending?.abort(); this.pending = null;
      this.nextRequestAt = 0;
      this.recentActions = [];
      this.actionAnchor = null;
    }
    if (state.phase === 'finished') {
      this.publish('finished', '本局结束'); this.stopConnection(); return;
    }
    if (this.terminal) return;
    const actor = state.actors.find((candidate) => candidate.config.id === this.actorId);
    if (state.phase !== 'playing' || actor?.status !== 'alive' || epoch === undefined) {
      this.publish('paused', state.phase === 'paused' ? '已暂停' : actor?.status === 'eliminated' ? '已淘汰' : actor?.status === 'respawning' ? '等待复活' : '等待开场');
      return;
    }
    if (this.status.phase === 'executing' && this.runner.tick >= this.actionUntilTick) this.publish('waiting', '操作结束，等待决策');
    if (this.pending || this.now() < this.nextRequestAt) return;
    void this.request(epoch);
  }

  private async request(epoch: number): Promise<void> {
    const controller = new AbortController(); this.pending = controller;
    const started = this.now();
    this.nextRequestAt = started + this.session.requestIntervalMs;
    this.refreshActionOutcome();
    const observation = createObservation(this.runner.state, this.actorId, this.runner.tick, this.recentActions);
    const sequence = ++this.sequence;
    this.status.requests++;
    this.publish('thinking', '正在决策');
    const timer = setTimeout(() => controller.abort(), this.session.timeoutMs + 1000);
    try {
      const body = await readReply(await this.fetcher('/api/deepseek/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ sessionId: this.session.sessionId, sequence, epoch, observation }),
      }));
      if (this.stopped || controller.signal.aborted || epoch !== this.runner.externalEpoch(this.actorId) || this.pending !== controller) return;
      const action = parseExternalAction(body.action);
      if (!action || body.sequence !== sequence || body.epoch !== epoch || body.observationTick !== observation.tick) throw new DeepSeekError('AI 指令校验失败', 'INVALID_ACTION');
      this.status.latencyMs = Math.round(this.now() - started);
      this.applyUsage(body.usage);
      if (this.runner.applyExternalInput(this.actorId, action, { epoch, sequence, observationTick: observation.tick })) {
        this.status.decisions++;
        this.recentActions = [...this.recentActions, { ...action, tick: observation.tick }].slice(-MAX_RECENT_ACTIONS);
        const actor = this.runner.state.actors.find((candidate) => candidate.config.id === this.actorId);
        this.actionAnchor = actor ? { x: actor.position.x, y: actor.position.y, tick: observation.tick } : null;
        this.actionUntilTick = Math.min(this.runner.tick + action.holdFrames, observation.tick + MAX_OBSERVATION_AGE);
        this.publish('executing', `${action.moveX === 1 ? '向右' : action.moveX === -1 ? '向左' : '停步'}${action.shootHeld ? ' · 开火' : ''}${action.jumpPressed ? ' · 跳跃' : ''}`);
      } else {
        this.publish('waiting', '指令已过期，重新观察');
      }
    } catch (error) {
      if (this.stopped || this.pending !== controller || epoch !== this.runner.externalEpoch(this.actorId)) return;
      const code = error instanceof DeepSeekError ? error.code : 'NETWORK';
      if (error instanceof DeepSeekError) this.applyUsage(error.usage);
      this.terminal = ['AUTH', 'BALANCE', 'BUDGET', 'NOT_CONFIGURED', 'SESSION_EXPIRED', 'PARAMETERS', 'CONTEXT_TOO_LARGE'].includes(code);
      this.nextRequestAt = this.now() + Math.max(2500, this.session.requestIntervalMs);
      this.publish('error', controller.signal.aborted ? '响应超时，等待重试' : error instanceof DeepSeekError ? error.message : '连接失败，等待重试');
    } finally {
      clearTimeout(timer);
      if (this.pending === controller) this.pending = null;
    }
  }

  private refreshActionOutcome(): void {
    const latest = this.recentActions.at(-1);
    const anchor = this.actionAnchor;
    const actor = this.runner.state.actors.find((candidate) => candidate.config.id === this.actorId);
    if (!latest || !anchor || !actor || latest.outcome) return;
    const outcome: ExternalActionOutcome = {
      observedTick: this.runner.tick,
      deltaX: Math.round((actor.position.x - anchor.x) * 100) / 100,
      deltaY: Math.round((actor.position.y - anchor.y) * 100) / 100,
      platformId: actor.groundedOn,
      status: actor.status,
      grounded: actor.groundedOn !== null,
    };
    this.recentActions = [...this.recentActions.slice(0, -1), { ...latest, outcome }];
  }

  private applyUsage(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const usage = value as Record<string, unknown>;
    const count = (n: unknown): number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    this.status.requests = count(usage.requests);
    this.status.tokens = count(usage.promptTokens) + count(usage.completionTokens);
  }

  private publish(phase: DeepSeekStatus['phase'], message: string): void {
    if (this.status.phase === phase && this.status.message === message && phase !== 'executing') return;
    this.status.phase = phase; this.status.message = message;
    this.onStatus({ ...this.status });
  }

  private stopConnection(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pending?.abort(); this.pending = null;
    void closeDeepSeekSession(this.session.sessionId, this.fetcher).catch(() => {});
  }

  destroy(): void { this.stopConnection(); this.onStatus(null); }
}
