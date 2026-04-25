import type { AIProvider } from './aiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { LocalDemoProvider } from './localDemoProvider';
import { OpenAiProvider } from './openAiProvider';
import { normalizeGroqModel } from './providerModels';
import { ResilientGroqProvider } from './resilientGroqProvider';
import { logger } from '../logger';

export type ProviderName = 'groq' | 'openai' | 'anthropic';

export function createLiveAnswerProvider(
  providerName: ProviderName,
  apiKey: string,
  model?: string,
): AIProvider {
  const trimmed = apiKey.trim();
  if (!trimmed) return new LocalDemoProvider();

  switch (providerName) {
    case 'openai':
      return new OpenAiProvider(trimmed, model);
    case 'anthropic':
      return new AnthropicProvider(trimmed, model);
    default:
      if (!trimmed.startsWith('gsk_')) return new LocalDemoProvider();
      return new ResilientGroqProvider(trimmed, normalizeGroqModel(model));
  }
}

let _warmedUp = false;

// G28: 30s ceiling on the warmup fetch (the actual TCP open is much faster;
// this just guarantees we never leak a hanging socket).
const WARMUP_TIMEOUT_MS = 30_000;

export async function warmupProvider(providerName: string, apiKey: string): Promise<void> {
  if (_warmedUp || !apiKey) return;
  _warmedUp = true;
  const endpoint =
    providerName === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : providerName === 'anthropic'
        ? 'https://api.anthropic.com/v1/messages'
        : 'https://api.groq.com/openai/v1/chat/completions';

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), WARMUP_TIMEOUT_MS);
  // Fire and forget — just open the TCP connection, don't wait for response.
  // G5: the .catch must do meaningful work; we dispatch a network-timeout
  // event on AbortError and clear the timer in all paths.
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
    signal: ac.signal,
  })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:network-timeout', {
              detail: { url: endpoint, provider: providerName },
            }),
          );
        }
      } else {
        // Warmup failure is non-fatal; log so it surfaces in dev tools but
        // never throws into the call site.
        logger.warn('providerFactory', 'warmup failed', {
          provider: providerName,
          err: String(err),
        });
      }
    })
    .finally(() => {
      clearTimeout(timeoutId);
    });
}

export function getProviderForQuestionType(
  questionType: string,
  configured: { groq: boolean; openai: boolean; anthropic: boolean },
): string {
  // Groq for speed (behavioral, hr, factual)
  if (['behavioral', 'hr', 'factual', 'other'].includes(questionType) && configured.groq)
    return 'groq';
  // Anthropic for quality (system design, coding)
  if (['system-design', 'coding'].includes(questionType) && configured.anthropic)
    return 'anthropic';
  // OpenAI for technical with vision
  if (questionType === 'technical' && configured.openai) return 'openai';
  // Fallback cascade
  if (configured.groq) return 'groq';
  if (configured.openai) return 'openai';
  if (configured.anthropic) return 'anthropic';
  return 'groq';
}
