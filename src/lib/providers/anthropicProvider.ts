import type { AIProvider } from './aiProvider';

// Module-level AbortController so a new call cancels the previous one.
let _activeController: AbortController | null = null;

// G28: 30s network timeout applied to every Anthropic HTTP call.
// Note: this provider streams via fetch directly and does NOT use the
// llm_chunk Tauri event channel — F23 (request_id listen race) does not
// apply here.
const ANTHROPIC_TIMEOUT_MS = 30_000;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function dispatchAnthropicTimeout() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('mm:network-timeout', {
      detail: { url: ANTHROPIC_URL, provider: 'anthropic' },
    }),
  );
}

export class AnthropicProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'claude-opus-4-5') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(payload: { systemPrompt: string; userPrompt: string }): Promise<string> {
    // Cancel any in-flight request before starting a new one.
    if (_activeController) {
      _activeController.abort();
    }
    const controller = new AbortController();
    _activeController = controller;
    const timeoutId = setTimeout(() => {
      controller.abort();
      dispatchAnthropicTimeout();
    }, ANTHROPIC_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          stream: true,
          // cache_control marks the static system prompt + knowledge-base block
          // as ephemeral so Anthropic reuses the KV cache on repeated calls.
          system: [
            {
              type: 'text',
              text: payload.systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: payload.userPrompt }],
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
      throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
    }

    // Parse SSE stream incrementally with a proper chunk buffer so partial
    // lines across network chunks are handled correctly.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data) as {
              type: string;
              delta?: { type: string; text?: string };
            };
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              text += evt.delta.text ?? '';
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

    return text;
  }

  /**
   * Streaming variant: emits each `content_block_delta` text fragment via
   * `onChunk` immediately, then resolves with the full accumulated text.
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
      dispatchAnthropicTimeout();
    }, ANTHROPIC_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          stream: true,
          system: [
            {
              type: 'text',
              text: payload.systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: payload.userPrompt }],
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
      throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

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
              type: string;
              delta?: { type: string; text?: string };
            };
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              const delta = evt.delta.text ?? '';
              if (delta) {
                text += delta;
                onChunk(delta);
              }
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

    return text;
  }
}
