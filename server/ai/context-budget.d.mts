export const MAX_CONTEXT_TOKENS: 512000;
export const MAX_OUTPUT_TOKENS: 256;
export interface ContextBudget {
  limitTokens: number;
  estimatedInputTokens: number;
}
export function resolveContextTokens(value?: number | string): number;
export function prepareModelContext(system: string, content: string, contextTokens?: number | string): {
  messages: { role: string; content: string }[];
  context: ContextBudget;
} | null;
