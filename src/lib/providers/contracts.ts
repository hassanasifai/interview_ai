/**
 * Typed error thrown when an API key required by a provider is missing or
 * empty. Callers should catch this and surface a UI prompt that guides the
 * user to Settings rather than silently falling back to a mock provider.
 *
 * NOTE: This file is compiled under `erasableSyntaxOnly`, which forbids
 * TypeScript parameter properties (e.g. `constructor(public readonly x)`).
 * The `provider` field is therefore declared explicitly and assigned by
 * hand inside the constructor body.
 */
export class MissingApiKeyError extends Error {
  public readonly provider: string;

  constructor(provider: string) {
    super(`API key missing for ${provider}`);
    this.name = 'MissingApiKeyError';
    this.provider = provider;
  }
}

export interface SpeechProvider {
  transcribeChunk(payload: {
    channel: 'microphone' | 'system';
    pcmBase64: string;
    timestampMs: number;
  }): Promise<{
    text: string;
    confidence: number;
    startMs: number;
    endMs: number;
  }>;
}

export interface LiveAnswerProvider {
  createAnswerCard(payload: {
    question: string;
    conversationContext: string;
    groundedContext: string[];
  }): Promise<{
    oneLiner: string;
    bullets: string[];
    confidence: number;
    sources: string[];
  }>;
}

export interface ExtractionProvider {
  extractPostCallArtifacts(payload: { transcript: string }): Promise<{
    summary: string;
    actionItems: string[];
    followUpDraft: string;
    crmNotes: string;
  }>;
}

export interface OptionalRealtimeProvider {
  startRealtimeSession(payload: { sessionId: string }): Promise<{
    sessionHandle: string;
  }>;

  stopRealtimeSession(payload: { sessionHandle: string }): Promise<void>;
}
