export const MAX_CONTEXT_TOKENS = 512000;
// Thinking mode returns a short JSON command plus a hidden reasoning trace.
// Reserve enough completion budget for both; the visible action is still tiny.
export const MAX_OUTPUT_TOKENS = 4096;

// Conservative budget, not a provider tokenizer: one token per UTF-8 byte,
// plus headroom for chat framing. Actual billed tokens come from upstream usage.
const messageBudget = (message) => Buffer.byteLength(message.content, 'utf8') + 32;
const REQUEST_HEADROOM = 1024;

export function resolveContextTokens(value = MAX_CONTEXT_TOKENS) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 4096
    ? Math.min(parsed, MAX_CONTEXT_TOKENS) : MAX_CONTEXT_TOKENS;
}

/** Each request has its own budget and carries only rules and the current state. */
export function prepareModelContext(system, content, contextTokens = MAX_CONTEXT_TOKENS) {
  const limitTokens = resolveContextTokens(contextTokens);
  const messages = [{ role: 'system', content: system }, { role: 'user', content }];
  const estimatedInputTokens = REQUEST_HEADROOM + messages.reduce((sum, message) => sum + messageBudget(message), 0);
  if (estimatedInputTokens + MAX_OUTPUT_TOKENS > limitTokens) return null;
  return { messages, context: { limitTokens, estimatedInputTokens } };
}
