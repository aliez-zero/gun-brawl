import type { IncomingMessage, ServerResponse } from 'node:http';
export interface GatewayOptions {
  apiKey?: string; model?: string; maxRequests?: number | string; requestIntervalMs?: number | string;
  timeoutMs?: number | string; contextTokens?: number | string; thinking?: string; reasoningEffort?: string; fetchImpl?: typeof fetch;
}
export function createDeepSeekGateway(options?: GatewayOptions): {
  (req: IncomingMessage, res: ServerResponse, next: () => void): void;
  close(): void;
};
export function validateAction(value: unknown): import('../../src/game/ai/external/Protocol').ExternalAction | null;
