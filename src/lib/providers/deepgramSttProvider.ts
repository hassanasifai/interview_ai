import { logger } from '../logger';
import type { STTProvider } from './sttProvider';
import { MissingApiKeyError } from './contracts';

/**
 * Phase BC: Deepgram Nova-3 STT provider (REST batch mode).
 *
 * The existing STTProvider interface is chunk-by-chunk (one base64 audio
 * blob → one transcript), so we use Deepgram's REST endpoint rather than
 * the WebSocket streaming API. A future enhancement can introduce a
 * separate streaming-capable interface that wraps `wss://api.deepgram.com/v1/listen`
 * for true interim-result transport.
 *
 * Error handling mirrors GroqSTTProvider:
 *   - 30s AbortController timeout → mm:network-timeout event
 *   - 401/429/5xx → mm:stt-error event with status code
 *   - missing/empty key → MissingApiKeyError (caller surfaces UI prompt)
 */
export class DeepgramSTTProvider implements STTProvider {
  private readonly apiKey: string;
  private readonly defaultLanguage: string;

  constructor(apiKey: string, language: string = 'en') {
    this.apiKey = apiKey;
    this.defaultLanguage = language;
  }

  async transcribeChunk(payload: {
    mimeType: string;
    base64Audio: string;
    channel: 'microphone' | 'system';
    language?: string;
  }): Promise<{ text: string; confidence: number }> {
    if (!this.apiKey || !this.apiKey.trim()) {
      throw new MissingApiKeyError('deepgram');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    const url = 'https://api.deepgram.com/v1/listen';

    try {
      const audioBytes = base64ToBytes(payload.base64Audio);
      const audioBlob = new Blob([audioBytes.buffer as ArrayBuffer], {
        type: payload.mimeType || 'audio/wav',
      });
      const language = payload.language ?? this.defaultLanguage ?? 'en';
      const qs = new URLSearchParams({
        model: 'nova-3',
        language,
        punctuate: 'true',
        smart_format: 'true',
        interim_results: 'false',
      });
      const fullUrl = `${url}?${qs.toString()}`;

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': payload.mimeType || 'audio/wav',
        },
        body: audioBlob,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:stt-error', {
              detail: {
                provider: 'deepgram',
                status: response.status,
                channel: payload.channel,
                body: errBody.slice(0, 200),
              },
            }),
          );
        }
        const hint =
          response.status === 401
            ? ' — Invalid Deepgram API key. Paste a fresh key from console.deepgram.com in Settings → API Keys.'
            : response.status === 429
              ? ' — Deepgram rate limit hit.'
              : '';
        return {
          text: `[${payload.channel}] STT failed (${response.status})${hint}`,
          confidence: 0.1,
        };
      }

      const json = (await response.json()) as DeepgramResponse;
      const alt = json.results?.channels?.[0]?.alternatives?.[0];
      const transcript = alt?.transcript?.trim() ?? '';
      return {
        text: transcript,
        confidence: typeof alt?.confidence === 'number' ? alt.confidence : transcript ? 0.75 : 0.2,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:network-timeout', {
              detail: { url, provider: 'deepgram-stt' },
            }),
          );
        }
        return {
          text: `[${payload.channel}] STT request timed out`,
          confidence: 0.1,
        };
      }
      if (err instanceof MissingApiKeyError) throw err;
      logger.warn('deepgramStt', 'transcribeChunk failed', { err: String(err) });
      return {
        text: `[${payload.channel}] STT network error`,
        confidence: 0.1,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    }>;
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\s\r\n]+/g, '');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
