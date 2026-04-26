import type { AIProvider } from './aiProvider';

// Module-level AbortController; new call cancels the previous one.
// Mirrors Groq's pattern so back-to-back invocations cleanly terminate
// any in-flight Cerebras request.
let _activeController: AbortController | null = null;

// Phase BB: 30s network timeout applied to every Cerebras HTTP call.
const CEREBRAS_TIMEOUT_MS = 30_000;
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';

/**
 * Default Cerebras model. April 2026 pricing snapshot has llama3.1-8b at
 * 2,154 tok/s and $0.10/M tokens blended — the speed-tier choice for
 * behavioral / hr / factual questions.
 */
export const CEREBRAS_DEFAULT_MODEL = 'llama3.1-8b';

function dispatchCerebrasTimeout() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('mm:network-timeout', {
      detail: { url: CEREBRAS_URL, provider: 'cerebras' },
    }),
  );
}

/**
 * Cerebras Inference API provider. The wire format is OpenAI-compatible
 * (chat/completions, SSE deltas), so this implementation closely mirrors
 * GroqProvider — only the URL and default model differ.
 */
export class CerebrasProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = CEREBRAS_DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model || CEREBRAS_DEFAULT_MODEL;
  }

  async complete(payload: { systemPrompt: string; userPrompt: string }): Promise<string> {
    if (_activeController) {
      _activeController.abort();
    }
    const controller = new AbortController();
    _activeController = controller;
    const timeoutId = setTimeout(() => {
      controller.abort();
      dispatchCerebrasTimeout();
    }, CEREBRAS_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(CEREBRAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [
            { role: 'system', content: payload.systemPrompt },
            { role: 'user', content: payload.userPrompt },
          ],
        }),
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (_activeController === controller) _activeController = null;
      throw err;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      if (_activeController === controller) _activeController = null;
      throw new Error(`Cerebras request failed with status ${response.status}`);
    }

    // Incremental SSE parse with a proper line buffer so partial lines that
    // span chunk boundaries are not truncated.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            content += evt.choices?.[0]?.delta?.content ?? '';
          } catch {
            // skip malformed SSE line
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (_activeController === controller) _activeController = null;
    }

    if (!content) {
      throw new Error('Cerebras response did not include message content');
    }

    return content;
  }

  /**
   * Streaming variant: emits each SSE delta via `onChunk` immediately,
   * then resolves with the full accumulated text.
   */
  async stream(
    payload: { systemPrompt: string; userPrompt: string },
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    if (_activeController) {
      _activeController.abort();
    }
    const controller = new AbortController();
    _activeController = controller;
    const timeoutId = setTimeout(() => {
      controller.abort();
      dispatchCerebrasTimeout();
    }, CEREBRAS_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(CEREBRAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [
            { role: 'system', content: payload.systemPrompt },
            { role: 'user', content: payload.userPrompt },
          ],
        }),
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (_activeController === controller) _activeController = null;
      throw err;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      if (_activeController === controller) _activeController = null;
      throw new Error(`Cerebras request failed with status ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = evt.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              content += delta;
              onChunk(delta);
            }
          } catch {
            // skip malformed SSE line
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (_activeController === controller) _activeController = null;
    }

    if (!content) {
      throw new Error('Cerebras response did not include message content');
    }

    return content;
  }
}

export default CerebrasProvider;
