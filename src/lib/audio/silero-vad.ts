import { MicVAD } from '@ricky0123/vad-web';

/**
 * Pluely-style wrapper around @ricky0123/vad-web's MicVAD class.
 *
 * Silero VAD is a small ONNX neural net that runs in the renderer via WASM and
 * emits utterance boundaries directly — no manual RMS gating required. The
 * model operates on 16 kHz mono Float32 audio (the Silero native rate).
 *
 * The library v0.0.30 surface we depend on:
 *   - `MicVAD.new(opts)` returns a `Promise<MicVAD>`
 *   - `vad.start()`, `vad.pause()`, `vad.destroy()` are synchronous
 *   - `onSpeechEnd(audio: Float32Array)` fires once per utterance
 */

export interface SileroVadOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onVadMisfire?: () => void;
  /** Probability above which a frame is considered speech. Default 0.45. */
  positiveSpeechThreshold?: number;
  /** Probability below which a frame is considered silence. Default 0.35. */
  negativeSpeechThreshold?: number;
  /** Milliseconds of silence required before declaring end-of-speech. Default 256. */
  redemptionMs?: number;
  /** Milliseconds of audio prepended to each utterance to avoid clipped onsets. Default 32. */
  preSpeechPadMs?: number;
  /** Minimum milliseconds a speech segment must contain to be emitted. Default 96. */
  minSpeechMs?: number;
}

export interface SileroVadHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  destroy(): Promise<void>;
  isListening: () => boolean;
}

let _instance: SileroVadHandle | null = null;

/**
 * Construct (and start) a Silero VAD instance bound to the default mic.
 * Only one instance is allowed process-wide; constructing a second one
 * destroys the previous one first.
 */
export async function createSileroVad(opts: SileroVadOptions): Promise<SileroVadHandle> {
  if (_instance) {
    await _instance.destroy();
    _instance = null;
  }

  const vad = await MicVAD.new({
    // Static asset paths — these files are copied to /public during postinstall.
    baseAssetPath: '/',
    onnxWASMBasePath: '/',
    model: 'v5',
    positiveSpeechThreshold: opts.positiveSpeechThreshold ?? 0.45,
    negativeSpeechThreshold: opts.negativeSpeechThreshold ?? 0.35,
    redemptionMs: opts.redemptionMs ?? 256,
    preSpeechPadMs: opts.preSpeechPadMs ?? 32,
    minSpeechMs: opts.minSpeechMs ?? 96,
    ...(opts.onSpeechStart ? { onSpeechStart: opts.onSpeechStart } : {}),
    ...(opts.onSpeechEnd ? { onSpeechEnd: opts.onSpeechEnd } : {}),
    ...(opts.onVadMisfire ? { onVADMisfire: opts.onVadMisfire } : {}),
  });

  let listening = false;

  const handle: SileroVadHandle = {
    async start() {
      if (listening) return;
      await vad.start();
      listening = true;
    },
    async stop() {
      if (!listening) return;
      await vad.pause();
      listening = false;
    },
    pause() {
      void vad.pause();
      listening = false;
    },
    async destroy() {
      await vad.destroy();
      listening = false;
      _instance = null;
    },
    isListening: () => listening,
  };

  _instance = handle;
  return handle;
}

export function getActiveSileroVad(): SileroVadHandle | null {
  return _instance;
}

/**
 * Convert Float32 mono audio in [-1, 1] to base64-encoded little-endian PCM16.
 * Used to ship Silero's utterance buffers to STT providers that accept WAV/PCM.
 */
export function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i] ?? 0));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
