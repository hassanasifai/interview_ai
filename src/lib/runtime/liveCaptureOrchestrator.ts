import { listen, emit } from '@tauri-apps/api/event';
import type { TranscriptItem } from '../../store/sessionStore';
import type { STTProvider } from '../providers/sttProvider';
import { logger } from '../logger';

type StartCaptureOptions = {
  includeMicrophone: boolean;
  includeSystemAudio: boolean;
  /** STT provider for the microphone channel (user's voice). */
  micSttProvider: STTProvider;
  /** STT provider for the system audio channel (interviewer's voice). */
  systemSttProvider: STTProvider;
  /** Language code passed to Whisper (e.g. "en", "es"). */
  language?: string;
  onTranscript: (item: TranscriptItem) => void | Promise<void>;
};

type ActiveCapture = {
  stop: () => void;
};

/**
 * Tap a MediaStream with Web Audio API and dispatch the live RMS level on
 * window as `mm:audio-level` so the overlay can animate only when sound is
 * actually being heard. Returns a cleanup function.
 */
function startAudioLevelMonitor(stream: MediaStream, isActive: () => boolean): () => void {
  if (typeof window === 'undefined' || !window.AudioContext) return () => undefined;
  let ctx: AudioContext | null = null;
  let raf = 0;
  try {
    ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    let lastEmitAt = 0;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!isActive()) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      // DOM event for same-window listeners
      window.dispatchEvent(new CustomEvent('mm:audio-level', { detail: { level: rms } }));
      // Tauri event broadcasts to all windows (overlay, companion, etc).
      // Throttle to ~12 emits/sec so we don't flood the IPC bus.
      const now = performance.now();
      if (now - lastEmitAt > 80) {
        lastEmitAt = now;
        emit('mm:audio-level', { level: rms }).catch(() => undefined);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch { /* AudioContext unavailable */ }
  return () => {
    if (raf) cancelAnimationFrame(raf);
    if (ctx) ctx.close().catch(() => undefined);
  };
}

/** Wrap raw 16-bit mono PCM (base64) with a WAV/RIFF header so Groq accepts it. */
function wrapPcmAsWav(pcmBase64: string, sampleRate: number): string {
  const bin = atob(pcmBase64);
  const pcmLen = bin.length;
  const buffer = new ArrayBuffer(44 + pcmLen);
  const view = new DataView(buffer);
  // RIFF header
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, 36 + pcmLen, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
  // fmt chunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true);            // chunk size
  view.setUint16(20, 1, true);             // PCM format
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (2 bytes/sample)
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  // data chunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, pcmLen, true);
  for (let i = 0; i < pcmLen; i++) view.setUint8(44 + i, bin.charCodeAt(i));
  // Encode buffer to base64
  let out = '';
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read audio blob'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string') {
        reject(new Error('Unexpected audio blob conversion result'));
        return;
      }
      const [, base64] = value.split(',');
      resolve(base64 ?? '');
    };
    reader.readAsDataURL(blob);
  });
}

function makeQueue(
  sttProvider: STTProvider,
  speaker: 'user' | 'customer',
  channel: 'microphone' | 'system',
  language: string | undefined,
  onTranscript: (item: TranscriptItem) => void | Promise<void>,
  isActive: () => boolean,
) {
  const queue: Array<{ blob: Blob }> = [];
  let processing = false;

  async function process() {
    if (processing) return;
    processing = true;
    try {
      while (isActive() && queue.length > 0) {
        const next = queue.shift();
        if (!next) continue;
        try {
          const base64Audio = await blobToBase64(next.blob);
          const result = await sttProvider.transcribeChunk({
            mimeType: next.blob.type || 'audio/webm',
            base64Audio,
            channel,
            ...(language !== undefined ? { language } : {}),
          });
          if (!isActive() || !result.text.trim()) continue;
          await onTranscript({
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            speaker,
            text: result.text,
            timestamp: Date.now(),
          });
        } catch (err) {
          // Per-chunk errors are non-fatal; continue draining the queue.
          logger.warn('liveCaptureOrchestrator', 'chunk transcription failed', {
            err: String(err),
            channel,
          });
        }
      }
    } finally {
      processing = false;
    }
  }

  return {
    push: (blob: Blob) => {
      queue.push({ blob });
      process().catch((err) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:stt-error', {
              detail: { reason: String(err), channel },
            }),
          );
        }
      });
    },
  };
}

export async function startLiveCapture(options: StartCaptureOptions): Promise<ActiveCapture> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not supported in this runtime.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture APIs are unavailable in this runtime.');
  }
  if (options.includeSystemAudio && !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('System audio capture APIs are unavailable in this runtime.');
  }

  const recorders: MediaRecorder[] = [];
  const streams: MediaStream[] = [];
  const cleanupFns: Array<() => void> = [];
  let active = true;

  const isActive = () => active;

  // Microphone queue — speaker: 'user'
  const micQueue = makeQueue(
    options.micSttProvider,
    'user',
    'microphone',
    options.language,
    options.onTranscript,
    isActive,
  );

  // System audio queue — speaker: 'customer' (interviewer/other party)
  const systemQueue = makeQueue(
    options.systemSttProvider,
    'customer',
    'system',
    options.language,
    options.onTranscript,
    isActive,
  );

  /**
   * VAD-driven utterance capture. Buffers continuous PCM and only flushes a
   * complete utterance to STT when end-of-speech is detected via a hangover
   * timer. This is how Parakeet, Cluely, and other realtime AI copilots
   * handle STT — it produces clean full-sentence transcripts and stays well
   * under Groq's 20 RPM free-tier limit (since silent moments cost nothing).
   *
   * State machine:
   *   IDLE         → block RMS > THRESHOLD ⇒ SPEAKING (start collecting)
   *   SPEAKING     → block RMS > THRESHOLD ⇒ reset silence timer
   *                  silence > HANGOVER_MS  ⇒ flush + IDLE
   *                  collected > MAX_MS    ⇒ flush + SPEAKING (force cut)
   */
  function wirePcmCapture(stream: MediaStream, queue: ReturnType<typeof makeQueue>): () => void {
    const TARGET_SR = 16_000;
    const VAD_RMS = 0.015;              // speech threshold (RMS of [-1, 1] Float32)
    const PRE_ROLL_MS = 250;            // include a bit before speech starts (avoid clipped word onsets)
    const HANGOVER_MS = 700;            // silence after which we flush the utterance
    const MIN_UTTER_MS = 400;           // ignore tiny noises shorter than this
    const MAX_UTTER_MS = 12_000;        // cap utterances at 12s to bound request size

    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const sourceSr = ctx.sampleRate;
    const decimation = sourceSr / TARGET_SR;

    // Rolling pre-roll ring buffer + active utterance buffer
    const preRollSamples = Math.floor((PRE_ROLL_MS / 1000) * TARGET_SR);
    const maxUtterSamples = Math.floor((MAX_UTTER_MS / 1000) * TARGET_SR);
    const preRoll: Float32Array = new Float32Array(preRollSamples);
    let preRollCursor = 0;
    let preRollFilled = false;

    let utter: Float32Array | null = null;
    let utterCursor = 0;
    let lastSpeechAt = 0;
    let utterStartedAt = 0;
    let speaking = false;

    function flushUtterance() {
      if (!utter || utterCursor === 0) {
        utter = null; utterCursor = 0; speaking = false;
        return;
      }
      const durationMs = (utterCursor / TARGET_SR) * 1000;
      if (durationMs < MIN_UTTER_MS) {
        utter = null; utterCursor = 0; speaking = false;
        return;
      }
      // Convert Float32 → Int16 PCM
      const pcm16 = new Int16Array(utterCursor);
      for (let i = 0; i < utterCursor; i++) {
        const s = Math.max(-1, Math.min(1, utter[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const bytes = new Uint8Array(pcm16.buffer, 0, pcm16.byteLength);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const pcmBase64 = btoa(bin);
      const wavBase64 = wrapPcmAsWav(pcmBase64, TARGET_SR);
      const wavBytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
      const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
      queue.push(wavBlob);
      utter = null; utterCursor = 0; speaking = false;
    }

    proc.onaudioprocess = (event) => {
      if (!active) return;
      const input = event.inputBuffer.getChannelData(0);
      // Compute block RMS on the source (pre-decimation) for fast VAD
      let energy = 0;
      for (let i = 0; i < input.length; i++) energy += input[i] * input[i];
      const rms = Math.sqrt(energy / input.length);
      const now = performance.now();

      // Decimate to 16kHz
      const decimated: number[] = [];
      for (let i = 0; i < input.length; i += decimation) {
        decimated.push(input[Math.floor(i)] || 0);
      }

      if (rms >= VAD_RMS) {
        // Speech detected
        if (!speaking) {
          // Start a new utterance — seed with the pre-roll buffer
          utter = new Float32Array(maxUtterSamples);
          utterCursor = 0;
          if (preRollFilled) {
            // unwrap ring buffer
            const tail = preRoll.subarray(preRollCursor);
            const head = preRoll.subarray(0, preRollCursor);
            utter.set(tail, 0);
            utter.set(head, tail.length);
            utterCursor = preRollSamples;
          } else {
            utter.set(preRoll.subarray(0, preRollCursor), 0);
            utterCursor = preRollCursor;
          }
          speaking = true;
          utterStartedAt = now;
        }
        // Append decimated samples
        if (utter) {
          for (let i = 0; i < decimated.length && utterCursor < utter.length; i++) {
            utter[utterCursor++] = decimated[i];
          }
        }
        lastSpeechAt = now;
        // Force-cut if we exceed max
        if (utter && (now - utterStartedAt) > MAX_UTTER_MS) {
          flushUtterance();
        }
      } else {
        // Silence
        if (speaking && utter) {
          // Still record a bit of trailing silence in case speech resumes
          for (let i = 0; i < decimated.length && utterCursor < utter.length; i++) {
            utter[utterCursor++] = decimated[i];
          }
          if (now - lastSpeechAt > HANGOVER_MS) {
            flushUtterance();
          }
        } else {
          // Maintain pre-roll ring buffer for next utterance
          for (let i = 0; i < decimated.length; i++) {
            preRoll[preRollCursor] = decimated[i];
            preRollCursor = (preRollCursor + 1) % preRollSamples;
            if (preRollCursor === 0) preRollFilled = true;
          }
        }
      }
    };

    source.connect(proc);
    proc.connect(ctx.destination);
    return () => {
      // Final flush so trailing speech isn't lost
      if (speaking) flushUtterance();
      try { proc.disconnect(); } catch { /* ignore */ }
      try { source.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => undefined);
    };
  }

  if (options.includeMicrophone) {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streams.push(micStream);
    cleanupFns.push(wirePcmCapture(micStream, micQueue));
    cleanupFns.push(startAudioLevelMonitor(micStream, () => active));
  }

  // Native WASAPI mic audio from Rust mic_capture.rs
  // Groq Whisper requires a real audio container; raw PCM gives 400. Wrap
  // the incoming PCM bytes in a minimal WAV header before sending.
  const unlistenMic = await listen<{ pcmBase64: string; sampleRate: number; timestampMs: number }>(
    'mic_audio_chunk',
    (event) => {
      if (!active) return;
      const { pcmBase64, sampleRate } = event.payload;
      const wavBase64 = wrapPcmAsWav(pcmBase64, sampleRate || 16_000);
      options.micSttProvider
        .transcribeChunk({
          mimeType: 'audio/wav',
          base64Audio: wavBase64,
          channel: 'microphone',
          ...(options.language !== undefined ? { language: options.language } : {}),
        })
        .then(async (result) => {
          if (!active || !result.text.trim()) return;
          await options.onTranscript({
            id: `mic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            speaker: 'user',
            text: result.text,
            timestamp: Date.now(),
          });
        })
        .catch((err) => {
          // Surface STT errors to the audit log so user sees them
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('mm:stt-error', {
                detail: { reason: String(err), channel: 'microphone' },
              }),
            );
          }
        });
    },
  );
  cleanupFns.push(unlistenMic);

  // System audio capture is opt-in via getDisplayMedia. On Groq's free tier
  // (20 RPM) running both mic + system halves capacity per channel; many
  // shared windows have no audio track at all and produce 400s. We still
  // honor the flag, but skip silently when no audio track exists rather
  // than spamming errors.
  if (options.includeSystemAudio) {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      streams.push(displayStream);
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioOnly = new MediaStream(audioTracks);
        cleanupFns.push(wirePcmCapture(audioOnly, systemQueue));
      } else {
        logger.warn('liveCaptureOrchestrator', 'No audio track in shared source — system capture skipped', {});
      }
    } catch (err) {
      logger.warn('liveCaptureOrchestrator', 'System audio capture cancelled', { err: String(err) });
    }
  }

  return {
    stop: () => {
      active = false;
      recorders.forEach((r) => {
        if (r.state !== 'inactive') r.stop();
      });
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      cleanupFns.forEach((fn) => fn());
    },
  };
}

export async function setupAutoActivation(onActivate: () => void): Promise<() => void> {
  let lastActivationTime = 0;
  let cancelled = false;

  // Cancel-token pattern: even though we await registration here, the inner
  // handler honours `cancelled` so any pending in-flight ticks dispatched
  // between teardown and full unlisten are dropped. The teardown also
  // synchronously trips `cancelled` before invoking unlisten.
  const unlisten = await listen<{ title: string | null; processName: string | null }>(
    'meeting_daemon_tick',
    (event) => {
      if (cancelled) return;
      const { title, processName } = event.payload;
      const titleMatch =
        /zoom|google\s*meet|microsoft\s*teams|webex|hackerrank|leetcode|coderpad|discord|slack|jitsi|whereby|bluejeans|blue\s*jeans/i.test(
          title ?? '',
        );
      const processMatch = /zoom|teams|meet|webex|slack|discord|jitsi|whereby|bluejeans/i.test(
        processName ?? '',
      );
      const isDetected = titleMatch || processMatch;
      const now = Date.now();
      if (isDetected && now - lastActivationTime > 5000) {
        lastActivationTime = now;
        onActivate();
      }
    },
  );

  return () => {
    cancelled = true;
    unlisten();
  };
}
