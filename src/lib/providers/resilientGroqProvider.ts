import type { AIProvider } from './aiProvider';
import { GroqProvider } from './groqProvider';

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * G4: manual schema check used to validate the fallback JSON before it is
 * surfaced to the orchestrator. This guards against accidental drift in the
 * fallback shape — if the structure is ever malformed, callers get a hard
 * error instead of a silently-broken answer card.
 */
function isValidFallback(obj: unknown): obj is { answer: string; bullets: string[] } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'answer' in obj &&
    typeof (obj as Record<string, unknown>).answer === 'string' &&
    'bullets' in obj &&
    Array.isArray((obj as Record<string, unknown>).bullets)
  );
}

function buildPrimaryFallback(): string {
  const obj = {
    answer: 'I can share a cautious draft now and verify details after the call.',
    bullets: [
      'Current provider is temporarily unavailable.',
      'Use a clarification-first response to stay accurate.',
      'Confirm pricing, security, and legal specifics after the meeting.',
    ],
    confidence: 0.32,
    sources: ['Provider fallback'],
    supportSnippets: [],
    suggestedFollowup: 'Can I confirm the exact details and send a written answer after this call?',
    redFlags: ['Provider unavailable during live generation.'],
  };
  if (!isValidFallback(obj)) {
    // This branch is unreachable for the literal above; the assertion exists
    // so a future refactor that breaks the shape fails loudly at runtime.
    throw new Error('Resilient Groq fallback failed schema validation');
  }
  return JSON.stringify(obj);
}

function buildEmptyFallback(): string {
  const obj = {
    answer: 'Unable to generate an answer right now.',
    bullets: [] as string[],
    confidence: 0,
    sources: [] as string[],
    supportSnippets: [] as string[],
    suggestedFollowup: '',
    redFlags: ['Unexpected provider execution path.'],
  };
  if (!isValidFallback(obj)) {
    throw new Error('Resilient Groq empty fallback failed schema validation');
  }
  return JSON.stringify(obj);
}

export class ResilientGroqProvider implements AIProvider {
  private readonly groqProvider: GroqProvider;
  private readonly maxRetries: number;

  constructor(apiKey: string, model = 'llama-3.1-8b-instant', maxRetries = 2) {
    this.groqProvider = new GroqProvider(apiKey, model);
    this.maxRetries = maxRetries;
  }

  async complete(payload: { systemPrompt: string; userPrompt: string }): Promise<string> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.groqProvider.complete(payload);
      } catch {
        if (attempt === this.maxRetries) {
          return buildPrimaryFallback();
        }

        await wait(400 * (attempt + 1));
      }
    }

    return buildEmptyFallback();
  }

  /**
   * Streaming variant with retry logic. Falls back to the same fallback JSON
   * string (without streaming) if all retries are exhausted.
   */
  async stream(
    payload: { systemPrompt: string; userPrompt: string },
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.groqProvider.stream(payload, onChunk);
      } catch {
        if (attempt === this.maxRetries) {
          const fallback = buildPrimaryFallback();
          onChunk(fallback);
          return fallback;
        }

        await wait(400 * (attempt + 1));
      }
    }

    const fallback = buildEmptyFallback();
    onChunk(fallback);
    return fallback;
  }
}
