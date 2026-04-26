# Realtime Roadmap — Beating Parakeet AI / Cluely

This document is a concrete technical plan to take MeetingMind's realtime pipeline from "works with caveats" to "industry-leading sub-1-second end-to-end latency". Based on documented techniques in production voice-AI systems (Pipecat, LiveKit Agents, OpenAI Realtime, Deepgram, AssemblyAI Universal-Streaming).

---

## 1. End-to-End Latency Budget Target

**Current:** ~5-8 seconds from "user finishes speaking" to "first answer token visible"

- VAD hangover: 700 ms
- Audio upload: ~200-500 ms
- Whisper inference: ~300-1000 ms (Groq turbo)
- Question detection: ~150 ms debounce + ~1500 ms LLM classifier
- LLM TTFT: ~500-1500 ms

**Target:** ≤ 1.2 seconds end-to-end

- Streaming partial transcripts: ~300 ms (no upload wait)
- Parallel classify + RAG: ~150 ms (overlapped with STT)
- LLM streaming TTFT: ~300-500 ms (Groq llama-3.1-8b-instant)
- UI render: ~50 ms

---

## 2. STT: Replace HTTP-chunked with Streaming WebSocket

### Why

HTTP POST per utterance forces us to wait for the full utterance before sending. Streaming STT pushes partial transcripts as the user speaks, so the LLM can start composing before they finish.

### Options ranked

| Option                                    | Cost            | Latency                      | Free tier        | Verdict               |
| ----------------------------------------- | --------------- | ---------------------------- | ---------------- | --------------------- |
| **Deepgram Nova-3 streaming WebSocket**   | $0.0043/min     | ~300ms partials              | $200 free credit | Best balance          |
| **AssemblyAI Universal-Streaming**        | $0.15/hour      | ~400ms                       | $50 free         | Good                  |
| **OpenAI Realtime API (gpt-4o-realtime)** | $0.06/min input | ~500ms                       | None             | Vendor lock-in        |
| **Groq Whisper (current)**                | Free 20 RPM     | ~700ms (HTTP)                | Yes              | Keep as fallback      |
| **Local whisper.cpp (ggml-base.en)**      | Free, on-device | ~500ms M-series, ~1500ms x86 | N/A              | Add as offline option |

### Recommendation

1. **Primary**: Deepgram Nova-3 WebSocket (sign up for $200 credit, ~46,000 minutes free)
2. **Fallback**: Groq Whisper HTTP (current)
3. **Offline option**: bundle whisper.cpp with ggml-tiny.en (~75 MB)

### Implementation outline

- `src/lib/providers/deepgramStreamingProvider.ts` — opens WS to `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&interim_results=true&endpointing=300`
- Stream PCM samples directly from AudioWorklet at 16 kHz mono
- On `interim_results=true`, push partial transcript to UI immediately
- On `is_final=true`, commit to transcript store

---

## 3. VAD: Replace RMS with Silero VAD

### Why

Energy-based VAD (current: RMS > 0.015) false-triggers on noise, music, breathing. Silero VAD is a 1.8 MB ONNX model with sub-millisecond inference and ~95% F1 on speech vs noise.

### Library

- **`@ricky0123/vad-web`** (https://github.com/ricky0123/vad-web)
  - Bundles ONNX runtime + Silero
  - Browser-ready AudioWorklet
  - ~1MB model + ~200KB JS
  - Outputs speech_start / speech_end events natively

### Implementation

```typescript
import { MicVAD } from '@ricky0123/vad-web';

const vad = await MicVAD.new({
  positiveSpeechThreshold: 0.7,
  negativeSpeechThreshold: 0.4,
  redemptionFrames: 24, // ~480ms hangover
  preSpeechPadFrames: 8, // 160ms pre-roll
  onSpeechStart: () => sttSocket.send(START_FRAME),
  onSpeechEnd: (audio) => sttSocket.send(audio),
  onVADMisfire: () => undefined,
});
await vad.start();
```

This replaces the entire `wirePcmCapture` function in [liveCaptureOrchestrator.ts](src/lib/runtime/liveCaptureOrchestrator.ts).

---

## 4. AudioWorklet Migration (No More ScriptProcessorNode)

### Why

ScriptProcessorNode is deprecated, runs on main thread, blocks UI. AudioWorklet runs in a separate audio rendering thread, never glitches.

### Pattern

- Create `public/audio-worklet.js`:

```js
class PCMCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch0 = inputs[0]?.[0];
    if (ch0) this.port.postMessage(ch0.slice(), [ch0.buffer]);
    return true;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);
```

- Load in main thread:

```typescript
await ctx.audioWorklet.addModule('/audio-worklet.js');
const node = new AudioWorkletNode(ctx, 'pcm-capture');
node.port.onmessage = (e) => streamPcmChunk(e.data);
```

### Bonus: built-in resampling

Use `AudioContext({ sampleRate: 16000 })` — Chromium auto-resamples from 48k with proper anti-aliasing. **No more linear-interpolation aliasing bug.**

---

## 5. Streaming LLM with Anticipatory Generation

### Why competitors feel instant

LockedIn AI claims 116ms first-token. Trick: they start generating the answer based on **partial transcripts** while the user is still speaking. By the time the user pauses, the answer is ~70% generated.

### Implementation

1. STT provides interim results every 300ms
2. After ~3 stable interim words appear, fire a "speculative" LLM call with the partial question
3. If interim results converge to final, accept the speculative answer
4. If they diverge significantly, cancel and re-fire with the corrected transcript

```typescript
let speculativeAbort: AbortController | null = null;
let lastFiredAt: string = '';

function onInterim(text: string) {
  // Only re-fire if transcript changed significantly
  if (levenshtein(text, lastFiredAt) < 5) return;
  speculativeAbort?.abort();
  speculativeAbort = new AbortController();
  lastFiredAt = text;
  fireLLM(text, speculativeAbort.signal);
}
```

### Best provider for this

**Groq llama-3.1-8b-instant** — 750+ tokens/sec, ~120ms TTFT. Cheap to throw away speculative completions.

---

## 6. Parallel Classify + RAG + Answer

### Current (sequential, slow)

```
detectQuestion(150ms debounce + 1500ms LLM classify) →
  searchRelevant(50ms) →
    composeAnswer(LLM 500ms TTFT + stream)
```

Total: ~2200ms before first token.

### New (parallel)

```
[in parallel as soon as utterance detected]
  P1: detectQuestion(LLM classifier)        → 1500ms
  P2: searchRelevant(RAG vector search)      → 50ms
  P3: composeAnswer(generic prompt)          → 500ms TTFT

When P1 completes:
  - if classification matches generic, accept P3's stream
  - if mismatch (e.g., it's actually behavioral STAR), cancel P3 and re-fire
```

Total: ~500ms before first token (P3 streams immediately).

---

## 7. Pre-warm Everything

### Already in providerFactory.ts (warmupProvider)

- TCP/TLS handshake to Groq (~200ms saved)

### Add

- Pre-load Silero VAD model on app start (~500ms saved on first use)
- Pre-warm AudioContext with silent stream (avoids 200ms cold start)
- Open Deepgram WebSocket on session start, keep alive even when silent

---

## 8. Local Whisper Fallback (Truly Offline)

### Why this beats every competitor

Parakeet AI's claim of "local Parakeet TDT" is ambiguous (cloud-actually). True offline mode = differentiator.

### Implementation in Tauri

- Add Rust crate `whisper-rs` (bindings to whisper.cpp)
- Bundle `ggml-tiny.en.bin` (75 MB) or `ggml-base.en.bin` (142 MB) as Tauri resource
- Tauri command `local_whisper_transcribe(pcm_base64, sample_rate)` that:
  - Loads model lazily (~500ms first time, then cached)
  - Runs inference (~500ms on M-series, ~1500ms on x86 mid-range CPU)
  - Returns text

### Cargo.toml addition

```toml
whisper-rs = "0.11"
```

### Setting

Add `sttMode: 'auto' | 'cloud' | 'local'`. Auto = use cloud if API key valid, fall back to local on rate limit / network error.

---

## 9. UI Streaming + Optimistic Updates

### Show "transcribing..." chip while audio uploads

Current: dead time between user finishing and transcript appearing. Add a chip in the overlay showing live partial transcript.

### Show LLM tokens as they stream

We already have `provider.stream()` — but `sessionStore.ingestTranscript` calls `composeAnswer()` without `onChunk`. Wire it through so tokens appear in the overlay as they arrive (current shows whole answer when done).

---

## 10. Bulletproofing the Pipeline

### Priority bugs from AUDIT_REPORT.md to fix

**Severity HIGH:**

1. `native_audio_chunk` Rust event emitted but never consumed → wire it into orchestrator
2. Transcript items lost on app crash → write each to localStorage as backup before SQLite flush
3. SQLite integrity check failure deletes DB silently → backup file before rename
4. macOS NSWindowDidChangeScreenNotification observer is dead code → register block-based observer

**Severity MEDIUM:** 5. Provider routing doesn't validate routed key is configured → fallback cascade 6. No global token budget tracking → add per-minute counter, throttle 7. Embedding errors silently swallowed → toast on first failure 8. Decryption fallback hides corruption → flag mismatched key

---

## 11. Concrete Next Steps (in priority order)

### Week 1: Foundation

1. **Replace ScriptProcessorNode with AudioWorklet** (eliminates aliasing + main-thread blocking)
2. **Integrate `@ricky0123/vad-web`** (replaces RMS VAD)
3. **Wire `onChunk` streaming end-to-end** so user sees tokens as they arrive

### Week 2: Streaming STT

4. **Add Deepgram streaming provider** (alternative to Groq HTTP)
5. **Show interim transcripts in overlay** (transcribing chip)
6. **Open WebSocket on session start, keep alive**

### Week 3: Latency tricks

7. **Speculative LLM generation** on stable interim transcripts
8. **Parallel classify + RAG + answer** instead of sequential
9. **Switch default LLM to llama-3.1-8b-instant** for sub-200ms TTFT

### Week 4: Robustness

10. **Local whisper.cpp fallback** for offline / rate-limit scenarios
11. **Persist transcript items to localStorage immediately** (crash safety)
12. **Wire `native_audio_chunk` for system audio** (currently dead path)

---

## 12. Reference Implementations to Study

These are real production voice AI systems with documented architectures:

- **Pipecat** (`github.com/pipecat-ai/pipecat`) — Daily.co's voice AI framework. Look at their pipeline composition pattern: VAD → STT → LLM → TTS as connected processors with backpressure.
- **LiveKit Agents** (`github.com/livekit/agents`) — production voice agents. Excellent example of WebSocket STT + streaming LLM.
- **OpenAI Realtime Console** (`github.com/openai/openai-realtime-console`) — official reference for gpt-4o-realtime usage.
- **`@ricky0123/vad-web`** — best browser Silero VAD wrapper.
- **whisper.cpp** (`github.com/ggerganov/whisper.cpp`) — has Rust bindings via `whisper-rs`.
- **Distil-Whisper** (`github.com/huggingface/distil-whisper`) — 6× faster than Whisper-large with similar accuracy. Available as ONNX for browser via transformers.js.

---

## 13. Cost Implications

If you use Deepgram for streaming STT during interviews:

- Average interview: 30 minutes
- 30 min × $0.0043/min = **$0.13 per interview**
- $200 free credit = **~1500 free interviews**

LLM costs (Groq free tier):

- Average interview generates ~30 questions × ~500 tokens = 15K tokens/interview
- Free tier: 30 RPM llama-3.3-70b → easily sufficient
- If users hit limits: switch to llama-3.1-8b-instant (faster, higher RPM)

---

## 14. Architecture After Improvements

```
[User speaks]
      │
      ▼
AudioWorklet (16kHz mono PCM, no main-thread blocking)
      │
      ▼
Silero VAD ONNX (sub-1ms inference, accurate)
      │ ┌───────────────────┐
      ├─┤ speech_start      │
      │ └───────────────────┘
      ▼
WebSocket → Deepgram Nova-3 (interim results every 300ms)
      │
      ▼
Interim transcript displayed live in overlay
      │
      ▼
[On stable 3+ words]
   ├─ P1: Question classifier (Groq llama-8b, 200ms)
   ├─ P2: RAG vector search (50ms)
   └─ P3: Speculative answer LLM stream (Groq, 200ms TTFT)
      │
      ▼
[Tokens stream into overlay live]
      │
      ▼
[On is_final from Deepgram]
   ├─ Commit final transcript to SQLite
   ├─ Validate speculative answer matches final question
   └─ If mismatch: cancel + re-fire
      │
      ▼
[User sees full answer ~1s after they stopped speaking]
```

---

## 15. Honest Caveats

- **Realtime voice AI is hard.** Even the giants (Cluely, Parakeet) have failure modes — accents, crosstalk, music in background. Pursuing 99.9% reliability is a multi-month engineering effort.
- **Latency vs accuracy tradeoff is real.** Streaming STT with interim results sacrifices some accuracy. Whisper batched is more accurate than any streaming provider.
- **Speculative generation wastes tokens.** ~30-40% of speculative LLM calls get cancelled. That's the price of perceived instant response.
- **Local Whisper varies wildly by hardware.** M-series Macs: feels instant. Older x86 laptops: 2-3 second delay.

---

This roadmap is implementable as-is. Start with items 1-3 (week 1) — they unblock everything else and produce visible improvement immediately.
