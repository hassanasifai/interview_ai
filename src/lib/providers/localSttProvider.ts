import { invoke } from '@tauri-apps/api/core';
import type { STTProvider } from './sttProvider';
import { logger } from '../logger';

export class LocalSttProvider implements STTProvider {
  private apiKey: string;
  private language: string;

  constructor(apiKey: string, language: string = 'en') {
    this.apiKey = apiKey;
    this.language = language;
  }

  async transcribeChunk(payload: {
    mimeType: string;
    base64Audio: string;
    channel: 'microphone' | 'system';
    language?: string;
  }): Promise<{ text: string; confidence: number }> {
    try {
      const result = await invoke<{
        text: string;
        source: string;
        timestampMs: number;
        confidence: number;
      }>('transcribe_audio_chunk', {
        pcmBase64: payload.base64Audio,
        sampleRateHz: 16000,
        source: payload.channel,
        language: payload.language ?? this.language,
        apiKey: this.apiKey,
      });
      return { text: result.text, confidence: result.confidence };
    } catch (err) {
      logger.warn('localSttProvider', 'transcribe_audio_chunk invoke failed', { err: String(err) });
      return { text: '', confidence: 0 };
    }
  }
}
