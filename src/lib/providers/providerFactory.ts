import type { AIProvider } from './aiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { CerebrasProvider, CEREBRAS_DEFAULT_MODEL } from './cerebrasProvider';
import { LocalDemoProvider } from './localDemoProvider';
import { OpenAiProvider } from './openAiProvider';
import { normalizeGroqModel } from './providerModels';
import { ResilientGroqProvider } from './resilientGroqProvider';
import { logger } from '../logger';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * Phase BB widens the provider union to include 'cerebras'. The narrow
 * ProviderName from lib/tauri.ts (groq | openai | anthropic) remains the
 * canonical type for keychain operations; this extended union is what the
 * factory and router accept.
 */
export type ProviderName = 'groq' | 'openai' | 'anthropic' | 'cerebras';

export function createLiveAnswerProvider(
  providerName: ProviderName,
  apiKey: string,
  model?: string,
): AIProvider {
  const trimmed = apiKey.trim();

  switch (providerName) {
    case 'openai':
      if (!trimmed) return new LocalDemoProvider();
      return new OpenAiProvider(trimmed, model);
    case 'anthropic':
      if (!trimmed) return new LocalDemoProvider();
      return new AnthropicProvider(trimmed, model);
    case 'cerebras': {
      // Defensive read: Phase BA owns settingsStore.cerebrasApiKey. If the
      // caller didn't pass a key (older call sites), fall back to the store.
      const fallback =
        (useSettingsStore.getState() as { cerebrasApiKey?: string }).cerebrasApiKey ?? '';
      const key = trimmed || fallback.trim();
      if (!key) return new LocalDemoProvider();
      return new CerebrasProvider(key, model || CEREBRAS_DEFAULT_MODEL);
    }
    default:
      if (!trimmed) return new LocalDemoProvider();
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
        : providerName === 'cerebras'
          ? 'https://api.cerebras.ai/v1/chat/completions'
          : 'https://api.groq.com/openai/v1/chat/completions';

  // LOW 18 fix: pick the cheapest model that exists on each provider so we
  // never warm up against a model the user can't access. The TCP/TLS open
  // is what we care about — the actual completion is a 1-token throwaway.
  const warmupModel =
    providerName === 'cerebras'
      ? CEREBRAS_DEFAULT_MODEL
      : providerName === 'openai'
        ? 'gpt-4o-mini'
        : providerName === 'anthropic'
          ? 'claude-3-5-haiku-latest'
          : 'llama-3.3-70b-versatile';

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), WARMUP_TIMEOUT_MS);

  // Anthropic uses a different auth header (`x-api-key`) and accepts the same
  // body shape; openai/groq/cerebras share the chat-completions shape.
  const headers: Record<string, string> =
    providerName === 'anthropic'
      ? {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  // Fire and forget — just open the TCP connection, don't wait for response.
  // G5: the .catch must do meaningful work; we dispatch a network-timeout
  // event on AbortError and clear the timer in all paths.
  fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: warmupModel,
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
  configured: { groq: boolean; openai: boolean; anthropic: boolean; cerebras?: boolean },
): string {
  // L1 fix: every branch must honor the `configured` flags. The previous
  // implementation fell through to `return 'groq'` even when no Groq key
  // was set, causing silent demo-mode without surfacing a configuration
  // error. Now we return the first *actually configured* provider in the
  // cascade. If none are configured, we still return 'groq' as a sentinel —
  // the caller is expected to translate that into a "configure a provider"
  // prompt rather than firing a request.
  const cer = !!configured.cerebras;
  const grq = !!configured.groq;
  const oai = !!configured.openai;
  const ant = !!configured.anthropic;

  // Speed tier (behavioral/hr/factual/other): cerebras > groq > openai > anthropic.
  if (['behavioral', 'hr', 'factual', 'other'].includes(questionType)) {
    if (cer) return 'cerebras';
    if (grq) return 'groq';
    if (oai) return 'openai';
    if (ant) return 'anthropic';
  }
  // Quality tier (system-design / coding): anthropic > openai > groq > cerebras.
  if (['system-design', 'coding'].includes(questionType)) {
    if (ant) return 'anthropic';
    if (oai) return 'openai';
    if (grq) return 'groq';
    if (cer) return 'cerebras';
  }
  // Vision tier (technical): openai > anthropic > groq > cerebras.
  if (questionType === 'technical') {
    if (oai) return 'openai';
    if (ant) return 'anthropic';
    if (grq) return 'groq';
    if (cer) return 'cerebras';
  }
  // Generic fallback cascade.
  if (cer) return 'cerebras';
  if (grq) return 'groq';
  if (oai) return 'openai';
  if (ant) return 'anthropic';
  // Sentinel — caller should treat unconfigured cascade as a config error.
  return 'groq';
}

/**
 * L1 helper: returns true iff at least one provider is configured. Callers
 * can use this to short-circuit and prompt the user to add a key instead
 * of firing a request that will fail with 401.
 */
export function hasAnyProviderConfigured(configured: {
  groq: boolean;
  openai: boolean;
  anthropic: boolean;
  cerebras?: boolean;
}): boolean {
  return !!(configured.groq || configured.openai || configured.anthropic || configured.cerebras);
}
