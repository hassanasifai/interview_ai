import { invoke } from '@tauri-apps/api/core';
import type { STTProvider } from './sttProvider';
import { logger } from '../logger';

/**
 * Gap 1 (Parakeet AI parity): Local STT provider that runs Whisper inference
 * via the on-device whisper.cpp binding (`whisper-rs`). Falls back to the
 * cloud Groq Whisper path when the local model isn't installed or the Rust
 * build was compiled without the `local-whisper` feature.
 */
export class LocalSttProvider implements STTProvider {
  private apiKey: string;
  private language: string;
  private localAvailable: boolean | null = null;

  constructor(apiKey: string, language: string = 'en') {
    this.apiKey = apiKey;
    this.language = language;
  }

  /**
   * Probe the Rust side for local-whisper availability. Cached after the
   * first call to avoid IPC noise on the audio-chunk hot path.
   */
  private async probeLocal(): Promise<boolean> {
    if (this.localAvailable !== null) return this.localAvailable;
    try {
      const ok = await invoke<boolean>('check_local_stt_available', {
        model: 'base.en',
      });
      this.localAvailable = !!ok;
    } catch {
      this.localAvailable = false;
    }
    return this.localAvailable;
  }

  async transcribeChunk(payload: {
    mimeType: string;
    base64Audio: string;
    channel: 'microphone' | 'system';
    language?: string;
  }): Promise<{ text: string; confidence: number }> {
    // Strip the WAV header off if present — the local whisper command takes
    // raw PCM. For uploads coming through the WAV-wrapped path we slice off
    // the standard 44-byte RIFF header.
    let pcmBase64 = payload.base64Audio;
    if (payload.mimeType.includes('wav')) {
      try {
        const bin = atob(payload.base64Audio);
        if (bin.length > 44 && bin.startsWith('RIFF')) {
          const stripped = bin.slice(44);
          pcmBase64 = btoa(stripped);
        }
      } catch {
        // If atob fails the upstream encoder messed up — let the cloud path try.
      }
    }

    const useLocal = await this.probeLocal();
    if (useLocal) {
      try {
        const result = await invoke<{ text: string; confidence: number }>(
          'transcribe_chunk_local',
          {
            pcmBase64,
            sampleRateHz: 16000,
            source: payload.channel,
            language: payload.language ?? this.language,
            model: 'base.en',
          },
        );
        return { text: result.text, confidence: result.confidence };
      } catch (err) {
        logger.warn('localSttProvider', 'transcribe_chunk_local failed; falling back to cloud', {
          err: String(err),
        });
        // Mark unavailable so subsequent chunks skip the failed local path
        // until the user fixes the install (network, model file, etc.).
        this.localAvailable = false;
      }
    }

    // Cloud fallback: same Tauri command the prior implementation called.
    try {
      const result = await invoke<{
        text: string;
        source: string;
        timestampMs: number;
        confidence: number;
      }>('transcribe_audio_chunk', {
        pcmBase64,
        sampleRateHz: 16000,
        source: payload.channel,
        language: payload.language ?? this.language,
        apiKey: this.apiKey,
      });
      return { text: result.text, confidence: result.confidence };
    } catch (err) {
      logger.warn('localSttProvider', 'transcribe_audio_chunk invoke failed', {
        err: String(err),
      });
      return { text: '', confidence: 0 };
    }
  }
}
