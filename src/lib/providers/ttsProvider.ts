import { MissingApiKeyError } from './contracts';
import { logger } from '../logger';

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TTSProvider {
  speak(text: string): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
  /**
   * Optional hook for releasing long-lived resources (e.g. AudioContext)
   * when the provider is being swapped out. Implementations that don't hold
   * any persistent resources can omit this.
   */
  dispose?(): Promise<void>;
}

// G28: shared 30s network timeout for TTS HTTP calls.
const TTS_TIMEOUT_MS = 30_000;

function dispatchNetworkTimeout(url: string, provider: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('mm:network-timeout', { detail: { url, provider } }));
}

// ── Browser Speech API (no-key fallback) ─────────────────────────────────────

export class BrowserTTSProvider implements TTSProvider {
  private _speaking = false;
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.onend = () => {
        this._speaking = false;
        resolve();
      };
      u.onerror = () => {
        this._speaking = false;
        resolve();
      };
      this._speaking = true;
      window.speechSynthesis.speak(u);
    });
  }
  stop() {
    window.speechSynthesis?.cancel();
    this._speaking = false;
  }
  isSpeaking() {
    return this._speaking;
  }
  async dispose() {
    this.stop();
  }
}

// ── OpenAI TTS ─────────────────────────────────────────────────────────────────

export class OpenAITTSProvider implements TTSProvider {
  private apiKey: string;
  private voice: TTSVoice;
  // I5/I6: singleton AudioContext per provider instance — never recreated
  // per speak() call. The OS only allows a small number of concurrent
  // contexts; recreating leaks audio worker threads and eventually fails.
  private _ac: AudioContext | null = null;
  private _source: AudioBufferSourceNode | null = null;
  private _speaking = false;

  constructor(apiKey: string, voice: TTSVoice = 'nova') {
    this.apiKey = apiKey;
    this.voice = voice;
  }

  private getAc(): AudioContext {
    if (!this._ac || this._ac.state === 'closed') {
      this._ac = new AudioContext();
    }
    return this._ac;
  }

  async speak(text: string): Promise<void> {
    this.stop(); // cleanup previous source
    const ac = this.getAc();
    const url = 'https://api.openai.com/v1/audio/speech';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: 'tts-1',
          voice: this.voice,
          input: text.slice(0, 4096),
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenAI TTS ${res.status}`);
      const buffer = await res.arrayBuffer();
      const decoded = await ac.decodeAudioData(buffer);
      const source = ac.createBufferSource();
      source.buffer = decoded;
      source.connect(ac.destination);
      this._source = source;
      this._speaking = true;
      await new Promise<void>((resolve) => {
        source.onended = () => {
          this._speaking = false;
          resolve();
        };
        source.start(0);
      });
    } catch (err) {
      this._speaking = false;
      if (err instanceof DOMException && err.name === 'AbortError') {
        dispatchNetworkTimeout(url, 'openai-tts');
      }
      // Silent fallback — don't throw to caller; the audio simply doesn't play.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  stop() {
    try {
      this._source?.stop();
    } catch (err) {
      logger.debug('ttsProvider', 'openai source.stop() noop', { err: String(err) });
    }
    this._source = null;
    this._speaking = false;
    // Intentionally do NOT close the AudioContext — it is reused across calls.
  }

  isSpeaking() {
    return this._speaking;
  }

  async dispose() {
    this.stop();
    try {
      await this._ac?.close();
    } catch (err) {
      logger.debug('ttsProvider', 'openai AudioContext.close() failed', { err: String(err) });
    }
    this._ac = null;
  }
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────

export class ElevenLabsTTSProvider implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private _ac: AudioContext | null = null;
  private _source: AudioBufferSourceNode | null = null;
  private _speaking = false;

  constructor(apiKey: string, voiceId = 'EXAVITQu4vr4xnSDxMaL') {
    // default: Sarah
    this.apiKey = apiKey;
    this.voiceId = voiceId;
  }

  private getAc(): AudioContext {
    if (!this._ac || this._ac.state === 'closed') {
      this._ac = new AudioContext();
    }
    return this._ac;
  }

  async speak(text: string): Promise<void> {
    this.stop();
    const ac = this.getAc();
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': this.apiKey },
        body: JSON.stringify({
          text: text.slice(0, 2500),
          model_id: 'eleven_turbo_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
      const buffer = await res.arrayBuffer();
      const decoded = await ac.decodeAudioData(buffer);
      const source = ac.createBufferSource();
      source.buffer = decoded;
      source.connect(ac.destination);
      this._source = source;
      this._speaking = true;
      await new Promise<void>((resolve) => {
        source.onended = () => {
          this._speaking = false;
          resolve();
        };
        source.start(0);
      });
    } catch (err) {
      this._speaking = false;
      if (err instanceof DOMException && err.name === 'AbortError') {
        dispatchNetworkTimeout(url, 'elevenlabs-tts');
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  stop() {
    try {
      this._source?.stop();
    } catch (err) {
      logger.debug('ttsProvider', 'elevenlabs source.stop() noop', { err: String(err) });
    }
    this._source = null;
    this._speaking = false;
    // Reuse AudioContext across calls — see OpenAITTSProvider.stop().
  }

  isSpeaking() {
    return this._speaking;
  }

  async dispose() {
    this.stop();
    try {
      await this._ac?.close();
    } catch (err) {
      logger.debug('ttsProvider', 'elevenlabs AudioContext.close() failed', { err: String(err) });
    }
    this._ac = null;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Construct a TTS provider for the requested mode. Validates that the
 * required API key is present BEFORE instantiation, throwing
 * MissingApiKeyError so callers can surface a "Add key in Settings" prompt.
 * Browser speech synthesis is always available as a no-key fallback.
 */
export function createTTSProvider(
  mode: 'openai' | 'elevenlabs' | 'browser',
  openAiKey?: string,
  elevenlabsKey?: string,
): TTSProvider {
  if (mode === 'openai') {
    if (!openAiKey || !openAiKey.trim()) {
      throw new MissingApiKeyError('openai');
    }
    return new OpenAITTSProvider(openAiKey);
  }
  if (mode === 'elevenlabs') {
    if (!elevenlabsKey || !elevenlabsKey.trim()) {
      throw new MissingApiKeyError('elevenlabs');
    }
    return new ElevenLabsTTSProvider(elevenlabsKey);
  }
  return new BrowserTTSProvider();
}

// Re-export the typed error for convenience.
export { MissingApiKeyError };

// Singleton for the current session
let _currentTTS: TTSProvider = new BrowserTTSProvider();
export function getTTSProvider(): TTSProvider {
  return _currentTTS;
}

/**
 * Replace the active TTS provider. The previous provider's `dispose()` is
 * invoked so its AudioContext (and any pending audio source) is released
 * promptly rather than waiting for GC. Errors from dispose are swallowed
 * with a meaningful no-op since we have no UI surface for them.
 */
export function setTTSProvider(p: TTSProvider) {
  const previous = _currentTTS;
  _currentTTS = p;
  if (previous && previous !== p) {
    try {
      previous.stop();
    } catch (err) {
      logger.debug('ttsProvider', 'previous.stop() noop on swap', { err: String(err) });
    }
    if (typeof previous.dispose === 'function') {
      previous.dispose().catch((err: unknown) => {
        // Meaningful catch: log so leaks are diagnosable, never silently swallow.
        logger.warn('ttsProvider', 'dispose() failed for previous provider', { err: String(err) });
      });
    }
  }
}
