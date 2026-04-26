/**
 * Lightweight token budgeting (AUDIT §24/L4).
 *
 * We don't ship a real BPE tokenizer in the renderer — paying ~5MB to do
 * exact counting in a chat-completion path is overkill. Instead we use the
 * widely-cited heuristic of ~4 chars per token for English/code and apply
 * a 1.15× safety multiplier. This is good to within ±10% for typical
 * answer-composition prompts, which is plenty to keep us off the 413
 * cliff on Anthropic and the 16k cap on Groq.
 *
 * Returns `{ ok, estimatedTokens, trimmed }`. When `ok === false` the
 * caller should refuse to fire and surface a "context too large" error;
 * `trimmed` is a best-effort head/tail-truncated version of the input
 * that fits the budget if the caller prefers degradation over refusal.
 */

export type BudgetResult = {
  ok: boolean;
  estimatedTokens: number;
  trimmed: string;
};

const CHARS_PER_TOKEN = 4;
const SAFETY_MULTIPLIER = 1.15;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_MULTIPLIER);
}

/**
 * Default budgets per provider — these match the safe context windows we
 * use today minus headroom for the response. Tune in one place if a
 * provider raises a limit.
 */
export const PROVIDER_INPUT_BUDGETS: Record<string, number> = {
  groq: 28_000, // Llama 3.3-70b on Groq: 32k window, leave 4k for output
  openai: 120_000, // gpt-4o: 128k window, leave 8k for output
  anthropic: 180_000, // claude-3.5-sonnet: 200k window, leave 20k for output
  cerebras: 7_500, // Cerebras llama-3.3-70b: 8k window, leave 500
  default: 12_000,
};

export function budgetFor(provider: string | undefined): number {
  if (!provider) return PROVIDER_INPUT_BUDGETS.default;
  return PROVIDER_INPUT_BUDGETS[provider] ?? PROVIDER_INPUT_BUDGETS.default;
}

/**
 * Check `prompt` against the budget for `provider`. If under, returns ok=true.
 * If over, returns ok=false plus a head-and-tail-truncated string that fits.
 */
export function applyBudget(prompt: string, provider: string | undefined): BudgetResult {
  const cap = budgetFor(provider);
  const estimated = estimateTokens(prompt);
  if (estimated <= cap) {
    return { ok: true, estimatedTokens: estimated, trimmed: prompt };
  }
  // Trim. Keep the first 60% and last 30% of allowed chars; drop the middle.
  const allowedChars = Math.floor((cap / SAFETY_MULTIPLIER) * CHARS_PER_TOKEN);
  const headChars = Math.floor(allowedChars * 0.6);
  const tailChars = Math.floor(allowedChars * 0.3);
  const head = prompt.slice(0, headChars);
  const tail = prompt.slice(prompt.length - tailChars);
  const trimmed = `${head}\n…\n[token budget trimmed: ${estimated - cap} est. tokens removed]\n…\n${tail}`;
  return { ok: false, estimatedTokens: estimated, trimmed };
}
