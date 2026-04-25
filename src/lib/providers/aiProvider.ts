export interface AIProvider {
  complete: (payload: { systemPrompt: string; userPrompt: string }) => Promise<string>;

  /**
   * Optional streaming variant. Emits each token chunk via `onChunk` as it
   * arrives, then resolves with the full accumulated text. Providers that
   * implement this enable real-time token-by-token UI updates.
   */
  stream?: (
    payload: { systemPrompt: string; userPrompt: string },
    onChunk: (chunk: string) => void,
  ) => Promise<string>;
}
