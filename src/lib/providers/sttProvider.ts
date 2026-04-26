import { LocalSttProvider } from './localSttProvider';
import { DeepgramSTTProvider } from './deepgramSttProvider';
import { MissingApiKeyError } from './contracts';

export { LocalSttProvider, DeepgramSTTProvider, MissingApiKeyError };

export interface STTProvider {
  transcribeChunk: (payload: {
    mimeType: string;
    base64Audio: string;
    channel: 'microphone' | 'system';
    language?: string;
  }) => Promise<{ text: string; confidence: number }>;
}

// G28: shared 30s network timeout for cloud STT calls.
const STT_TIMEOUT_MS = 30_000;

/**
 * Mock provider retained for tests / browser-only mode where no real STT
 * stack exists. F31: this is NOT used as a fallback when the Groq key is
 * missing — callers must surface MissingApiKeyError to the UI instead.
 */
export class MockSTTProvider implements STTProvider {
  async transcribeChunk(payload: {
    mimeType: string;
    base64Audio: string;
    channel: 'microphone' | 'system';
    language?: string;
  }): Promise<{ text: string; confidence: number }> {
    return {
      text: `[${payload.channel}] audio chunk received (${payload.mimeType})`,
      confidence: 0.2,
    };
  }
}

export class GroqSTTProvider implements STTProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultLanguage: string | undefined;
  // LOW 17 fix: rate-limit window is per-instance now, not module-global.
  // Two GroqSTTProvider instances (e.g. one for mic, one for system) used
  // to share the cooldown — a 429 on one channel would silently mute the
  // other. Now they back off independently.
  private _rateLimitedUntil = 0;

  constructor(apiKey: string, language?: string, model = 'whisper-large-v3-turbo') {
    this.apiKey = apiKey;
    this.model = model;
    this.defaultLanguage = language;
  }

  async transcribeChunk(payload: {
    mimeType: string;
    base64Audio: string;
    channel: 'microphone' | 'system';
    language?: string;
  }): Promise<{ text: string; confidence: number }> {
    if (!this.apiKey.trim().startsWith('gsk_')) {
      throw new MissingApiKeyError('groq');
    }

    // Honor any active rate-limit window so we don't burn requests for nothing.
    const now = Date.now();
    if (now < this._rateLimitedUntil) {
      return { text: '', confidence: 0 };
    }

    const blob = base64ToBlob(payload.base64Audio, payload.mimeType);
    // Whisper expects a recognized extension; .wav matches our current pipeline.
    const ext = payload.mimeType.includes('wav') ? 'wav' : 'webm';
    const file = new File([blob], `${payload.channel}.${ext}`, { type: payload.mimeType });
    const formData = new FormData();
    formData.set('model', this.model);
    formData.set('file', file);
    const language = payload.language ?? this.defaultLanguage;
    if (language) {
      formData.set('language', language);
    }

    const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        // On 429: parse "try again in Ns" hint and apply a global cool-down.
        if (response.status === 429) {
          const m = errBody.match(/try again in (\d+(?:\.\d+)?)s/i);
          const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) : 5_000;
          this._rateLimitedUntil = Date.now() + waitMs;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('mm:stt-error', {
                detail: { status: 429, channel: payload.channel, retryAfterMs: waitMs },
              }),
            );
          }
          return { text: '', confidence: 0 };
        }
        // 400 with "no audio track" → silently drop (empty utterance).
        if (response.status === 400 && /no audio track/i.test(errBody)) {
          return { text: '', confidence: 0 };
        }
        const hint =
          response.status === 401
            ? ' — Invalid Groq API key. Paste a fresh key from console.groq.com in Settings → API Keys.'
            : response.status === 400
              ? ' — Audio chunk rejected.'
              : '';
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:stt-error', {
              detail: {
                status: response.status,
                channel: payload.channel,
                body: errBody.slice(0, 200),
              },
            }),
          );
        }
        return {
          text: `[${payload.channel}] STT failed (${response.status})${hint}`,
          confidence: 0.1,
        };
      }

      const parsed = (await response.json()) as { text?: string };
      return {
        text: parsed.text?.trim() ?? '',
        confidence: parsed.text ? 0.75 : 0.2,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:network-timeout', {
              detail: { url, provider: 'groq-stt' },
            }),
          );
        }
        return {
          text: `[${payload.channel}] STT request timed out`,
          confidence: 0.1,
        };
      }
      // Re-throw MissingApiKeyError so callers (orchestrator) can branch on it.
      if (err instanceof MissingApiKeyError) throw err;
      return {
        text: `[${payload.channel}] STT network error`,
        confidence: 0.1,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function base64ToBlob(base64: string, mimeType: string) {
  // Sanitize: strip whitespace/newlines and fix padding so atob never throws.
  const clean = base64.replace(/[\s\r\n]+/g, '');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  let byteCharacters: string;
  try {
    byteCharacters = atob(padded);
  } catch {
    return new Blob([new Uint8Array(0)], { type: mimeType });
  }
  const bytes = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    bytes[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Build the active STT provider. F31: when the user requests cloud Groq STT
 * (or 'auto' with no local pipeline path) and the key is missing/invalid,
 * we throw MissingApiKeyError instead of silently falling back to Mock.
 *
 * For mode 'local' or 'auto' we still construct LocalSttProvider eagerly —
 * the underlying Tauri command handles missing-key cases at the Rust layer.
 * The orchestrator (Agent 2A) is responsible for catching MissingApiKeyError
 * and rendering "Add Groq API key in Settings".
 */
export function createSttProvider(
  mode: 'local' | 'groq' | 'auto' | 'deepgram',
  apiKey: string,
  language?: string,
): STTProvider {
  if (mode === 'local' || mode === 'auto') {
    return new LocalSttProvider(apiKey, language);
  }
  if (mode === 'deepgram') {
    if (!apiKey || !apiKey.trim()) {
      throw new MissingApiKeyError('deepgram');
    }
    return new DeepgramSTTProvider(apiKey, language);
  }
  // mode === 'groq' — require a valid key up front.
  if (!apiKey || !apiKey.trim().startsWith('gsk_')) {
    throw new MissingApiKeyError('groq');
  }
  return new GroqSTTProvider(apiKey, language);
}
