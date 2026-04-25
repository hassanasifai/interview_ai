import type { AIProvider } from './aiProvider';

// Module-level AbortController; new call cancels the previous one.
let _activeController: AbortController | null = null;

// G28: 30s network timeout applied to every Groq HTTP call.
const GROQ_TIMEOUT_MS = 30_000;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function dispatchGroqTimeout() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('mm:network-timeout', {
      detail: { url: GROQ_URL, provider: 'groq' },
    }),
  );
}

export class GroqProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(payload: { systemPrompt: string; userPrompt: string }): Promise<string> {
    if (_activeController) {
      _activeController.abort();
    }
    const controller = new AbortController();
    _activeController = controller;
    const timeoutId = setTimeout(() => {
      controller.abort();
      dispatchGroqTimeout();
    }, GROQ_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          // response_format json_object is incompatible with streaming on Groq;
          // we accumulate the full delta text and JSON.parse at the end.
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
      throw new Error(`Groq request failed with status ${response.status}`);
    }

    // Incremental SSE parse with a proper line buffer.
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
      throw new Error('Groq response did not include message content');
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
      dispatchGroqTimeout();
    }, GROQ_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(GROQ_URL, {
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
      throw new Error(`Groq request failed with status ${response.status}`);
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
      throw new Error('Groq response did not include message content');
    }

    return content;
  }
}
