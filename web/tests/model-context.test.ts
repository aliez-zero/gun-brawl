import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_TOKENS, MAX_OUTPUT_TOKENS, prepareModelContext } from '../../server/ai/context-budget.mjs';

describe('per-request model context', () => {
  it('sends only the rules and current observation independently on every call', () => {
    const first = prepareModelContext('Rules', 'first-observation')!;
    const next = prepareModelContext('Rules', 'latest-observation')!;
    expect(next.messages).toEqual([{ role: 'system', content: 'Rules' }, { role: 'user', content: 'latest-observation' }]);
    expect(JSON.stringify(next)).not.toContain('first-observation');
    expect(first.messages[1]!.content).toBe('first-observation');
  });

  it('enforces the 512K maximum and reserves output space at the request boundary', () => {
    const empty = prepareModelContext('Rules', '', 1000000)!;
    expect(empty.context.limitTokens).toBe(MAX_CONTEXT_TOKENS);
    const available = MAX_CONTEXT_TOKENS - MAX_OUTPUT_TOKENS - empty.context.estimatedInputTokens;
    const atLimit = prepareModelContext('Rules', 'x'.repeat(available))!;
    expect(atLimit.context.estimatedInputTokens + MAX_OUTPUT_TOKENS).toBe(512000);
    expect(prepareModelContext('Rules', 'x'.repeat(available + 1))).toBeNull();
  });

  it('budgets multibyte text conservatively and rejects oversized input without affecting later requests', () => {
    const ascii = prepareModelContext('Rules', 'a'.repeat(500), 10000)!;
    const chinese = prepareModelContext('Rules', '中'.repeat(500), 10000)!;
    expect(chinese.context.estimatedInputTokens).toBeGreaterThan(ascii.context.estimatedInputTokens);
    expect(prepareModelContext('Rules', '中'.repeat(2000), 10000)).toBeNull();
    expect(prepareModelContext('Rules', 'small', 10000)!.messages).toHaveLength(2);
  });
});
