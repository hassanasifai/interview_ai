# MeetingMind — Complete Remaining Build Spec

# "Beat Parakeet AI and every competitor in every dimension"

# Give this entire document to an AI to implement.

---

## CONTEXT: WHAT ALREADY EXISTS (DO NOT REBUILD)

MeetingMind is a production Tauri v2 (Rust) + React 19 + TypeScript desktop app
at D:\presentation. The following are already fully implemented and working:

**Solid foundations (A-grade):**

- Screen capture evasion: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) on all
  4 windows, WM_DISPLAYCHANGE/WM_SETTINGCHANGE re-application via message-only Win32
  thread, NSWindowSharingNone + NSWindowDidChangeScreenNotification re-apply (macOS),
  WS_EX_TOOLWINDOW on overlay + companion. DO NOT touch src-tauri/src/commands/capture_exclusion.rs.
- LLM providers: Anthropic Claude (streaming SSE, AbortController, cache_control:ephemeral),
  Groq Llama-3.3-70b (streaming), OpenAI GPT-4o (streaming). All in src/lib/providers/.
- UI: Full dashboard redesign in src/features/dashboard/, overlay in src/features/overlay/,
  companion in src/features/companion/. Design tokens in src/index.css (FROZEN — do not touch).
- Primitives: src/components/ui/ (Button, IconButton, Card, Badge, Tabs, Input, etc.) — FROZEN.
- 6 global hotkeys: Ctrl+Shift+H/S/C/T/Up/Down — all wired end-to-end.
- Session SQLite persistence: rusqlite at app_data_dir. Tauri commands: persist_session_summary,
  load_session_summaries, load_session_detail.
- STAR engine, system design engine, coding solver: real LLM prompts in src/lib/copilot/.
- Knowledge base: pdfjs-dist + mammoth.js parsing, localStorage chunking, keyword search.
- Meeting detection daemon: 2000+jitter ms poll, emits meeting_daemon_tick event.
- Build: tsc -b exits 0, cargo check exits 0 with 0 warnings.

**Known weaknesses vs. Parakeet AI and competitors (what YOU must build):**

---

## GAP 1 — LOCAL STT (NVIDIA PARAKEET TDT / WHISPER.CPP)

**Priority: CRITICAL. Parakeet AI's #1 technical differentiator.**

Parakeet AI uses NVIDIA Parakeet TDT 0.6B locally — 30× real-time on CPU,
no cloud round-trip, works offline. MeetingMind currently uses Groq Whisper only
(cloud, adds ~200-400ms network latency, fails without internet).

### What to build:

1. Rust crate: add `whisper-rs` (whisper.cpp bindings) to Cargo.toml.
   - Model management: download `ggml-base.en.bin` (141MB) or `ggml-small.bin`
     to app_data_dir on first run, show a Tauri progress event `stt_model_download_progress`
     with { downloaded_bytes, total_bytes }.
   - Tauri command: `transcribe_chunk_local(audio_base64: String, language: String) -> String`
     that runs whisper-rs inference on a Vec<f32> audio buffer. Return transcript text.
   - Run inference on a dedicated thread (tokio::task::spawn_blocking) so the async
     runtime is never blocked.
   - Expose: `check_local_stt_available() -> bool` (returns true if model file exists).

2. TypeScript provider: `src/lib/providers/localSttProvider.ts`
   - Implements the same ISTTProvider interface as GroqSTTProvider.
   - Calls invoke('transcribe_chunk_local', ...) instead of Groq API.
   - Falls back to GroqSTTProvider if local model not available.

3. Settings: add `sttMode: 'local' | 'groq' | 'auto'` to useSettingsStore.
   - 'auto' = use local if model present, otherwise Groq.
   - SettingsPage Audio panel already exists — add a SegmentedControl for this.

4. Model download UI: if model not present and user selects 'local' or 'auto',
   show a Dialog with a progress bar reading stt_model_download_progress events.

**Files to create/modify:**

- `src-tauri/Cargo.toml` — add whisper-rs
- `src-tauri/src/commands/stt.rs` (NEW) — transcribe_chunk_local, check_local_stt_available, download_whisper_model
- `src-tauri/src/lib.rs` — register new commands
- `src/lib/providers/localSttProvider.ts` (NEW)
- `src/lib/providers/sttProvider.ts` — update factory to support localSttProvider
- `src/store/settingsStore.ts` — add sttMode field
- `src/features/dashboard/SettingsPage.tsx` — add STT mode SegmentedControl + model download Dialog

---

## GAP 2 — NATIVE MICROPHONE CAPTURE (DUAL AUDIO PIPELINE)

**Priority: CRITICAL. MeetingMind only captures system audio, not mic.**

Parakeet AI and all competitors capture BOTH system audio (interviewer's voice)
AND microphone (user's voice) simultaneously for full transcript with speaker diarization.

### What to build:

1. Rust: `src-tauri/src/audio/mic_capture.rs` (NEW)
   - WASAPI mic capture using IAudioClient with eCapture endpoint (NOT eRender).
   - Same architecture as wasapi_capture.rs: 1500ms chunks, 16kHz mono i16-LE.
   - Emit Tauri event `mic_audio_chunk` with base64-encoded PCM bytes.
   - Expose commands: `start_mic_capture()`, `stop_mic_capture()`.
   - Handle device enumeration: `list_mic_devices() -> Vec<AudioDeviceInfo>`
     where AudioDeviceInfo = { id: String, name: String, is_default: bool }.

2. Rust: update `src-tauri/src/commands/audio_commands.rs` (or equivalent)
   to start/stop both WASAPI loopback AND mic capture simultaneously.

3. TypeScript: `src/lib/runtime/liveCaptureOrchestrator.ts`
   - Already handles system audio. Add a second listener on `mic_audio_chunk`.
   - Route mic chunks to the 'user' STT queue, system audio to 'customer' queue.
   - Each queue gets its own STT provider instance to avoid race conditions.

4. Settings SettingsPage.tsx Audio panel (already exists):
   - `list_mic_devices` populates the mic Select dropdown — wire it to actual
     Tauri invoke instead of a hardcoded list.
   - Add a "Test mic" Button that records 3 seconds and shows waveform peak.

**Files to create/modify:**

- `src-tauri/src/audio/mic_capture.rs` (NEW)
- `src-tauri/src/lib.rs` — register start_mic_capture, stop_mic_capture, list_mic_devices
- `src/lib/runtime/liveCaptureOrchestrator.ts` — add mic_audio_chunk listener
- `src/features/dashboard/SettingsPage.tsx` — wire mic device Select to Tauri

---

## GAP 3 — VOICE ACTIVITY DETECTION (VAD)

**Priority: HIGH. Without VAD, silent audio chunks waste STT quota and add latency.**

Currently there is zero VAD — every audio chunk is sent to STT regardless of content.

### What to build:

1. Rust: `src-tauri/src/audio/vad.rs` (NEW)
   - Energy-based VAD: compute RMS of i16 samples, compare against configurable
     threshold (default: 300 out of 32768).
   - `is_speech(samples: &[i16], threshold: i16) -> bool`
   - Also add zero-crossing rate check as secondary signal.
   - Expose: `get_vad_threshold() -> i16`, `set_vad_threshold(t: i16)`.

2. Wire into wasapi_capture.rs and mic_capture.rs: before emitting audio chunk event,
   run is_speech(). If false, skip the Tauri event emission entirely.
   Add a 200ms hangover (keep sending 2 more chunks after speech ends to catch trailing
   words before cutting off).

3. TypeScript: expose VAD threshold in useSettingsStore as `vadThreshold: number`.
   SettingsPage Audio panel already has a VAD threshold Input — wire it to
   set_vad_threshold Tauri invoke.

**Files to create/modify:**

- `src-tauri/src/audio/vad.rs` (NEW)
- `src-tauri/src/audio/wasapi_capture.rs` — add VAD gate before event emit
- `src-tauri/src/audio/mic_capture.rs` — same VAD gate
- `src-tauri/src/lib.rs` — register get/set_vad_threshold
- `src/store/settingsStore.ts` — vadThreshold field

---

## GAP 4 — LLM-BASED QUESTION CLASSIFIER (REPLACE REGEX)

**Priority: HIGH. Current regex gives false positives/negatives, kills accuracy.**

Currently questionDetector.ts is pure regex. Every competitor uses at least
a lightweight LLM call for classification. This causes wrong answer modes
(behavioral answer for a technical question, etc.).

### What to build:

Replace the regex-only path in `src/lib/copilot/questionDetector.ts`:

1. Add a `classifyWithLLM(text: string): Promise<QuestionClassification>` function.
   - Use the cheapest/fastest available provider (Groq Llama-3.3-70b, non-streaming).
   - System prompt: "You are a classifier. Given a question from a job interview
     transcript, return ONLY a JSON object: { type: 'behavioral'|'system-design'|
     'coding'|'technical'|'hr'|'pricing'|'factual'|'other', confidence: 0-1,
     subtype: string|null }. No explanation."
   - Add 100ms timeout fallback to regex result.
   - Cache results in the existing 32-entry LRU cache.

2. Hybrid flow in detectQuestion():
   - Run regex fast-path first (< 1ms).
   - If regex confidence >= 0.85, return immediately (no LLM needed).
   - If regex confidence 0.5–0.85, fire LLM async; return regex result immediately
     then update with LLM result via callback once it arrives.
   - If regex confidence < 0.5, await LLM (up to 100ms) before returning.

3. Preserve every existing public signature:
   - detectQuestion(text): DetectedQuestion — unchanged
   - detectQuestionDebounced(text): Promise<DetectedQuestion> — unchanged
   - QuestionType union — add 'hr' if not already present

**Files to modify:**

- `src/lib/copilot/questionDetector.ts` — hybrid classifier
- `src/lib/providers/groqProvider.ts` — ensure non-streaming complete() path works

---

## GAP 5 — SEMANTIC KNOWLEDGE BASE (VECTOR SEARCH)

**Priority: HIGH. Keyword search misses synonyms, context. Parakeet uses semantic matching.**

Current knowledge base uses token intersection scoring — misses "distributed systems"
when resume says "microservices", etc.

### What to build:

1. Add `@xenova/transformers` to package.json (Transformers.js — runs in-browser,
   no server needed). Use model `Xenova/all-MiniLM-L6-v2` (22MB, 384-dim embeddings,
   runs in a Web Worker).

2. `src/lib/knowledge/embeddingWorker.ts` (NEW) — Web Worker wrapper:

   ```typescript
   // Worker: loads pipeline once, handles embed requests
   import { pipeline } from '@xenova/transformers';
   let embedder: any;
   self.onmessage = async ({ data: { texts, id } }) => {
     if (!embedder) embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
     const out = await embedder(texts, { pooling: 'mean', normalize: true });
     self.postMessage({ id, vectors: Array.from(out.data) });
   };
   ```

3. `src/lib/knowledge/vectorStore.ts` (NEW):
   - `embedChunks(chunks: KnowledgeChunk[]): Promise<EmbeddedChunk[]>`
     — calls embeddingWorker, stores vectors alongside existing localStorage data.
   - `semanticSearch(query: string, topK: number): Promise<KnowledgeChunk[]>`
     — embed query via worker, cosine-similarity rank against stored vectors,
     return top-K chunks.
   - Cosine similarity: dot product of normalized vectors (they're L2-normalized
     by MiniLM so dot product == cosine).
   - Cache query embeddings (LRU-16) to avoid re-embedding repeated queries.

4. Update `src/lib/knowledge/knowledgeRepository.ts`:
   - `addDocument()` now calls `embedChunks()` after parsing and stores vectors.
   - `searchRelevant()` now calls `semanticSearch()` instead of keyword tokenization.
   - Keep keyword search as a fallback if worker isn't ready yet.

5. Update `src/lib/copilot/answerComposer.ts` (or wherever RAG injection happens):
   - Use semanticSearch instead of old searchRelevant for context retrieval.

**Files to create/modify:**

- `src/lib/knowledge/embeddingWorker.ts` (NEW)
- `src/lib/knowledge/vectorStore.ts` (NEW)
- `src/lib/knowledge/knowledgeRepository.ts` — update addDocument + searchRelevant
- `src/lib/copilot/answerComposer.ts` — use semantic search
- `package.json` — add @xenova/transformers
- `vite.config.ts` — add worker: { format: 'es' } if not present

---

## GAP 6 — AUTO-MEETING DETECTION + OVERLAY AUTO-ACTIVATION

**Priority: HIGH. Currently daemon polls but never auto-starts the overlay.**

Parakeet requires manual start. Beat it by auto-detecting and auto-showing.

### What to build:

1. Enhance `src/lib/runtime/meetingDetector.ts`:
   - Add process-name detection alongside window-title detection.
   - Request process list via new Tauri command `list_running_processes() -> Vec<String>`.
   - Detect: zoom.exe / ZoomOpener.exe, Teams.exe / ms-teams.exe,
     chrome.exe with "Google Meet" title, slack.exe, webexmta.exe,
     HackerRank/LeetCode/CoderPad by active window URL (if accessible).
   - Combine window title AND process name for higher confidence.

2. Rust command `list_running_processes()`:
   - Windows: EnumProcesses() + OpenProcess() + GetModuleBaseName() pattern.
   - macOS: sysctl CTL_KERN / KERN_PROC / KERN_PROC_ALL.
   - Returns Vec<String> of lowercase process names.
   - Add to src-tauri/src/commands/ and register in lib.rs.

3. `src/lib/runtime/liveCaptureOrchestrator.ts`:
   - On meeting_daemon_tick: if confidence >= 0.8 and session not already active,
     automatically call startSession() and show the overlay window
     via `invoke('show_overlay_window')`.
   - Emit a Toast notification: "Meeting detected — copilot activated".
   - Add a 5-second debounce so flicker doesn't trigger/stop repeatedly.
   - Respect a `autoActivate: boolean` setting from useSettingsStore.

4. Settings: add `autoActivate: boolean` Toggle to SettingsPage under "Advanced".

**Files to create/modify:**

- `src-tauri/src/commands/process_list.rs` (NEW)
- `src-tauri/src/lib.rs` — register list_running_processes
- `src/lib/runtime/meetingDetector.ts` — add process-name detection
- `src/lib/runtime/liveCaptureOrchestrator.ts` — auto-activate on detection
- `src/store/settingsStore.ts` — add autoActivate field

---

## GAP 7 — VISION / SCREENSHOT PROBLEM EXTRACTION

**Priority: HIGH. Parakeet AI, Interview Coder, ShadeCoder all read the screen.**

Hotkey Ctrl+Shift+S already captures a screenshot (screenshots crate). But the
image is never sent to an LLM for OCR/understanding. Coding questions on LeetCode,
HackerRank, CoderPad are never read automatically.

### What to build:

1. `src/lib/copilot/visionSolver.ts` (NEW):
   - `extractProblemFromScreenshot(base64Png: string): Promise<ExtractedProblem>`
   - ExtractedProblem = { title: string, description: string, constraints: string[],
     examples: string[], type: 'coding'|'system-design'|'behavioral'|'unknown' }
   - Uses OpenAI vision: gpt-4o with { role:'user', content:[{type:'image_url',
     image_url:{url:`data:image/png;base64,${base64Png}`}},{type:'text',
     text:'Extract the interview question from this screenshot...'}] }
   - Falls back to Anthropic claude-3-5-sonnet if OpenAI not configured.
   - Returns extracted problem structure.

2. Update screenshot hotkey handler (wherever Ctrl+Shift+S is handled in TS):
   - After screenshot is captured and base64 received:
     a. Call extractProblemFromScreenshot(base64).
     b. If type=coding → pipe to codingProblemSolver with extracted description.
     c. If type=system-design → pipe to systemDesignEngine.
     d. If type=behavioral → pipe to STAR engine.
     e. Show extracted title as question echo in overlay ChatPanel.
   - Show a Spinner in the overlay while extraction runs.

3. CodingPage.tsx (already exists): add "Solve from screenshot" Button that
   invokes take_screenshot Tauri command and pipes through visionSolver.

**Files to create/modify:**

- `src/lib/copilot/visionSolver.ts` (NEW)
- Wherever the hotkey_screenshot_solve event is handled in TS (check liveCaptureOrchestrator or overlay event listeners)
- `src/features/dashboard/CodingPage.tsx` — "Solve from screenshot" button

---

## GAP 8 — NEURAL TTS FOR MOCK INTERVIEW AI VOICE

**Priority: MEDIUM. Parakeet has no TTS (weakness). Beat every competitor.**

Current MockInterviewPage uses window.speechSynthesis — robotic browser voice.
Make the AI interviewer sound natural.

### What to build:

1. `src/lib/providers/ttsProvider.ts` (NEW):
   - Interface: `speak(text: string, onChunk?: (audioBlob: Blob) => void): Promise<void>`
   - OpenAI TTS: POST to https://api.openai.com/v1/audio/speech with
     { model:'tts-1', voice:'nova', input:text, response_format:'mp3' }.
     Stream the response as ArrayBuffer, decode via Web Audio API AudioContext,
     play via AudioBufferSourceNode.
   - ElevenLabs fallback: if elevenlabsApiKey in settingsStore, use
     POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream.
   - Browser Speech API fallback if neither key configured.
   - Expose: `stopSpeaking()`, `isSpeaking(): boolean`.

2. Update `src/features/dashboard/MockInterviewPage.tsx`:
   - Replace the 3-line window.speechSynthesis block with ttsProvider.speak().
   - Add a volume/voice Select in the mock interview setup step.
   - Add a mute IconButton in the live step to stop TTS mid-sentence.

3. Settings: add TTS provider SegmentedControl (OpenAI / ElevenLabs / Browser)
   and ElevenLabs API key Input to the Providers panel in SettingsPage.

**Files to create/modify:**

- `src/lib/providers/ttsProvider.ts` (NEW)
- `src/features/dashboard/MockInterviewPage.tsx` — replace speechSynthesis
- `src/features/dashboard/SettingsPage.tsx` — add TTS section
- `src/store/settingsStore.ts` — add ttsProvider, elevenlabsApiKey fields

---

## GAP 9 — REAL INTERVIEW SCORING (NLP, NOT WORD-COUNT)

**Priority: MEDIUM. Current scorer returns 35–95 based on word count alone.**

### What to build:

Replace `scoreAnswer()` in `src/features/dashboard/MockInterviewPage.tsx`:

1. `src/lib/copilot/answerScorer.ts` (NEW):
   - `scoreAnswer(question: string, answer: string, expectedType: QuestionType): Promise<AnswerScore>`
   - AnswerScore = { overall: number, dimensions: ScoringDimension[], feedback: string,
     improvements: string[] }
   - ScoringDimension = { name: string, score: number, comment: string }
   - Dimensions:
     - Behavioral: Situation clarity (0-25), Task specificity (0-25),
       Action detail (0-25), Result measurability (0-25)
     - Technical: Correctness (0-40), Depth (0-30), Communication (0-30)
     - System design: Requirements coverage (0-25), Scalability (0-25),
       Trade-off awareness (0-25), Tech stack justification (0-25)
   - LLM call to fastest provider with structured JSON output.
   - Cache by hash(question + answer).

2. Update MockInterviewPage.tsx review step:
   - Replace word-count scoreAnswer with await answerScorer.scoreAnswer().
   - Show dimension breakdown bars using CSS (already have mock.css).
   - Show AI feedback text and improvement bullets from the score result.

**Files to create/modify:**

- `src/lib/copilot/answerScorer.ts` (NEW)
- `src/features/dashboard/MockInterviewPage.tsx` — use real scorer

---

## GAP 10 — MULTI-MONITOR OVERLAY POSITIONING

**Priority: MEDIUM. Overlay is hardcoded at (100,100) on primary monitor.**

### What to build:

1. Rust: `src-tauri/src/commands/monitor_info.rs` (NEW):
   - Tauri command `get_monitors() -> Vec<MonitorInfo>` where MonitorInfo =
     { id: u32, name: String, x: i32, y: i32, width: u32, height: u32,
     scale_factor: f64, is_primary: bool }.
   - Use tauri::Manager::available_monitors() — already available in Tauri v2.

2. Rust: `set_overlay_monitor(monitor_id: u32)` command:
   - Moves the overlay and companion windows to the specified monitor.
   - Position on that monitor: x = monitor.x + monitor.width - 460 (right side),
     y = monitor.y + 40 (near top). Adjustable via settings.

3. TypeScript: `src/store/overlayStore.ts` — add `targetMonitorId: number | null`.

4. Overlay command bar (OverlayWindow.tsx): add a monitor Select or cycle button
   that calls set_overlay_monitor. Show current monitor name in the drag bar.

5. Settings SettingsPage.tsx Appearance section: "Overlay monitor" Select.

**Files to create/modify:**

- `src-tauri/src/commands/monitor_info.rs` (NEW)
- `src-tauri/src/lib.rs` — register get_monitors, set_overlay_monitor
- `src/store/overlayStore.ts` — targetMonitorId
- `src/features/overlay/OverlayWindow.tsx` — monitor picker in drag bar

---

## GAP 11 — REAL-TIME SESSION SYNC TO SQLITE

**Priority: MEDIUM. Currently only syncs on session end — crash = all data lost.**

### What to build:

1. Rust: add `upsert_transcript_item(session_id, item_json)` Tauri command
   that does INSERT OR REPLACE into transcript_items immediately.

2. TypeScript: in useSessionStore, whenever `appendTranscript()` is called,
   also fire `invoke('upsert_transcript_item', ...)` after the rAF batch flush.
   Use a short debounce (500ms) to batch rapid transcript updates into one write.

3. Rust: add `upsert_session_state(session_id, mode, start_time)` so session
   creation is persisted immediately (not just on end). This means a crash
   still leaves a partial session record that can be recovered.

**Files to modify:**

- `src-tauri/src/db.rs` — add upsert_transcript_item, upsert_session_state
- `src-tauri/src/lib.rs` — register new commands
- `src/store/sessionStore.ts` — call upsert_transcript_item on appendTranscript

---

## GAP 12 — KEYBOARD-ONLY OPERATION (ZERO MOUSE MOVEMENT REQUIRED)

**Priority: HIGH. Parakeet requires clicking "Start Answering" — DETECTABLE.**
**Interview Coder's #1 differentiator is keyboard-only. We must match this.**

### What to build:

1. Audit every interaction in OverlayWindow.tsx, ChatPanel.tsx, SolutionCard.tsx,
   CompanionWindow.tsx: ensure ZERO action requires a mouse click.
   Every button must have a keyboard equivalent shown as a KeyHint.

2. Add these new hotkeys to src-tauri/src/lib.rs:
   - Ctrl+Shift+Enter → trigger_answer_generation (fires hotkey_generate_answer event)
   - Ctrl+Shift+N → next_suggestion (cycles through multiple answer approaches)
   - Ctrl+Shift+C → already exists (copy answer)
   - Ctrl+Shift+1/2/3 → select provider (Groq/OpenAI/Anthropic)
   - Escape → dismiss_overlay (fires hotkey_dismiss event)

3. OverlayWindow.tsx: wire hotkey_generate_answer event listener to manually
   trigger question processing even without auto-detection firing.

4. Make the overlay fully non-interactive by default (click-through mode ON
   by default), switching to interactive only on Ctrl+Shift+T. This matches
   Interview Coder's approach and beats Parakeet's always-interactive overlay.

**Files to modify:**

- `src-tauri/src/lib.rs` — add 5 new hotkeys
- `src/features/overlay/OverlayWindow.tsx` — new event listeners, default click-through
- Ensure KeyHint chips are shown for ALL actions

---

## GAP 13 — SPEAKER DIARIZATION

**Priority: MEDIUM. Without diarization, transcript is a flat stream — can't tell
who asked what.**

### What to build:

1. Use the dual audio pipeline (Gap 2): system audio = interviewer, mic = user.
   Tag all system-audio STT results with speaker: 'interviewer',
   mic STT results with speaker: 'user'.

2. In liveCaptureOrchestrator.ts: merge the two STT streams into a single
   chronological transcript[] array with speaker tags. Sort by timestamp.

3. SessionDetailPage.tsx Transcript tab already has speaker-tagged turns
   (from redesign) — it just needs the data to actually have speaker fields.
   Wire it to read session.transcript[].speaker.

**This is mostly a data-plumbing task once Gap 2 is implemented.**

---

## GAP 14 — FOLLOW-UP QUESTION HANDLING

**Priority: MEDIUM. Parakeet users report it fails on follow-up questions.**

### What to build:

In `src/lib/copilot/answerComposer.ts` (or equivalent):

1. Maintain a `conversationHistory: Message[]` array in useSessionStore.
   Each user question and AI answer pair is appended.
2. When generating the next answer, include the last 4 message pairs as
   context in the LLM prompt so the AI knows what was already said.
3. Question detector: add `isFollowUp` boolean to DetectedQuestion —
   set to true if the detected question contains "follow up", "can you elaborate",
   "tell me more", "what about", "how did you", or references a keyword from
   the previous answer.
4. If isFollowUp=true, prepend "This is a follow-up to your previous answer.
   The user answered: [previous answer]. Now address:" to the prompt.

**Files to modify:**

- `src/store/sessionStore.ts` — add conversationHistory
- `src/lib/copilot/questionDetector.ts` — add isFollowUp detection
- `src/lib/copilot/answerComposer.ts` — include conversation history in prompt

---

## GAP 15 — RESPONSE SPEED: SUB-500MS FIRST TOKEN

**Priority: HIGH. LockedIn AI claims 116ms, StealthCoder claims <2s.**

Optimizations already done (Phase 3A): SSE streaming, AbortController, rAF batching,
Anthropic prompt caching, 150ms debounce on question detector.

**Remaining optimizations:**

1. Preconnect to LLM APIs at app startup (before first question):
   In lib.rs setup or App.tsx useEffect, fire a dummy 1-token completion
   ("ping" → "pong") against the configured provider to warm TCP/TLS connection.
   This eliminates the first-request TCP handshake latency.

2. Provider pre-selection: If Groq is configured, prefer it for first-token
   speed (Groq typically delivers first token in ~80ms vs ~200ms for Anthropic).
   Route behavioral→STAR engine→Groq. Route coding→Anthropic (better quality).
   Route system-design→Anthropic. Make this configurable.

3. Parallelize transcript processing: while the question detector is classifying,
   simultaneously start building the base prompt skeleton (system prompt +
   knowledge chunks). By the time classification returns, the prompt is ready
   to fire immediately.

4. In src/lib/copilot/answerComposer.ts: fire `searchRelevant()` (knowledge base
   retrieval) in parallel with `detectQuestion()`, not sequentially. Use
   Promise.all([detectQuestion(text), searchRelevant(text)]).

**Files to modify:**

- `src/lib/runtime/liveCaptureOrchestrator.ts` — parallel classify + RAG
- `src/lib/copilot/answerComposer.ts` — parallelize Promise.all
- `src/lib/providers/providerFactory.ts` — warmup on startup, provider routing

---

## VERIFICATION REQUIREMENTS (AFTER ALL GAPS IMPLEMENTED)

Run after EVERY agent completes:

1. `cd D:/presentation && npx tsc -b` — must exit 0, zero errors
2. `cd D:/presentation/src-tauri && cargo check` — must exit 0, zero warnings
3. `cd D:/presentation && npm run tauri dev` — app must launch, overlay must appear
   with Ctrl+Shift+H, screenshot must work with Ctrl+Shift+S

---

## IMPLEMENTATION ORDER (RECOMMENDED)

Implement in this order due to dependencies:

Phase A (foundations, no UI deps):

- Gap 2 (native mic capture, Rust)
- Gap 3 (VAD, Rust)
- Gap 6 item 1–2 (process list Tauri command, Rust)
- Gap 10 item 1–2 (monitor info commands, Rust)
- Gap 11 item 1 (upsert_transcript_item, Rust)

Phase B (TypeScript logic, depends on Phase A):

- Gap 1 (local STT provider)
- Gap 4 (LLM question classifier)
- Gap 5 (vector search knowledge base)
- Gap 6 item 3–4 (auto-activation logic)
- Gap 7 (vision solver)
- Gap 13 (diarization, depends on Gap 2)
- Gap 14 (follow-up detection)
- Gap 15 (speed optimizations)

Phase C (UI, depends on Phase B):

- Gap 8 (neural TTS)
- Gap 9 (real scoring)
- Gap 12 (keyboard-only hotkeys + UI)
- Gap 10 item 3–5 (monitor picker UI)

---

## FEATURE COMPARISON: AFTER ALL GAPS CLOSED

| Feature                 | Parakeet AI               | Interview Coder | LockedIn AI | MeetingMind (after gaps)                             |
| ----------------------- | ------------------------- | --------------- | ----------- | ---------------------------------------------------- |
| Local STT               | NVIDIA Parakeet TDT       | Unknown         | No          | whisper-rs (ggml-base)                               |
| Dual audio pipeline     | Yes                       | Yes             | Yes         | Yes (mic + WASAPI)                                   |
| VAD                     | Unknown                   | Yes             | Yes         | Energy + ZCR                                         |
| Question classifier     | Unknown                   | Unknown         | Yes         | Hybrid regex + LLM                                   |
| Screen capture evasion  | WDA_EXCLUDEFROMCAPTURE    | Yes             | Yes         | WDA + WS_EX_TOOLWINDOW + display-change re-apply     |
| Keyboard-only           | No (requires mouse click) | YES             | Partial     | YES — every action has hotkey                        |
| Neural TTS              | No                        | No              | No          | OpenAI TTS / ElevenLabs                              |
| Vision / screenshot OCR | Yes                       | Yes             | Yes         | Yes (GPT-4o vision)                                  |
| Semantic knowledge base | Yes                       | No              | Yes         | Yes (MiniLM embeddings)                              |
| Follow-up handling      | No (reported weakness)    | Unknown         | Yes         | Yes                                                  |
| Interview scoring       | Unknown                   | No              | Yes         | LLM dimensional scoring                              |
| Mock interview          | No                        | No              | Yes         | Yes + neural TTS                                     |
| JD + resume matching    | No                        | No              | Yes         | Yes                                                  |
| Multi-monitor           | Unknown                   | Unknown         | Unknown     | Yes                                                  |
| Auto-activation         | Manual                    | Manual          | Unknown     | Auto on meeting detect                               |
| Speaker diarization     | Unknown                   | No              | Yes         | Yes (via dual pipeline)                              |
| First token latency     | ~500ms+                   | <2s             | 116ms       | <300ms target                                        |
| Session persistence     | Cloud-only                | None            | Cloud       | SQLite real-time                                     |
| Offline capability      | Partial                   | No              | No          | Yes (local STT + local LLM via ollama if configured) |
| Open/BYOK               | No                        | No              | No          | Yes                                                  |

MeetingMind after all gaps closed beats every named competitor on every axis.
