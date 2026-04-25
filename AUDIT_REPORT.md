# MeetingMind — Complete Technical Audit & Architecture Reference

**Generated:** 2026-04-25
**Project:** `D:\presentation` (meetingmind-app v1.0.0)
**Identifier:** `com.meetingmind.desktop`
**Stack:** Tauri 2.10.3 + React 19 + Rust + TypeScript

This document is intended to be handed to another AI for comparison with competing tools (Parakeet AI, Cluely, Interview Coder, LockedIn AI, ShadeCoder). It catalogs every approach, library, algorithm, command, and known bug.

---

## 1. PRODUCT POSITIONING

MeetingMind is a desktop AI copilot for live interviews/meetings. Direct competitors:

| Competitor | Their differentiator | MeetingMind equivalent |
|---|---|---|
| Parakeet AI | NVIDIA Parakeet TDT local STT | Groq Whisper-large-v3-turbo (cloud) |
| Cluely | Never joins meeting, invisible | WDA_EXCLUDEFROMCAPTURE + NSWindowSharingNone |
| Interview Coder | 20+ stealth features, click-through | WS_EX_TRANSPARENT + WS_EX_TOOLWINDOW |
| LockedIn AI | 116 ms response, 42 languages | Groq streaming + 99 languages |
| ShadeCoder | Sub-2-second screenshot solve | OpenAI Vision (GPT-4o) screenshot OCR |

---

## 2. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                         │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ Main Window │   │   Overlay    │   │ Companion Window │  │
│  │ (Dashboard) │   │  (Floating,  │   │  (Sidebar mode)  │  │
│  │             │   │  capture-    │   │                  │  │
│  │             │   │  excluded)   │   │                  │  │
│  └──────┬──────┘   └──────┬───────┘   └────────┬─────────┘  │
│         │                 │                     │            │
│         └─────────────────┼─────────────────────┘            │
│                           │                                  │
│                  Tauri IPC (events + commands)               │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────┐    │
│  │              Rust Backend (src-tauri/)               │    │
│  │                                                       │    │
│  │  • WASAPI loopback + mic capture                     │    │
│  │  • Whisper STT (cloud + local)                       │    │
│  │  • SQLite (encrypted AES-256-GCM)                    │    │
│  │  • OS keychain (keyring crate)                       │    │
│  │  • Capture exclusion (Win/macOS)                     │    │
│  │  • Click-through (WS_EX_TRANSPARENT)                 │    │
│  │  • Global shortcuts (12 hotkeys)                     │    │
│  │  • Screen capture (screenshots crate)                │    │
│  └─────────────────────┬────────────────────────────────┘    │
└────────────────────────┼─────────────────────────────────────┘
                         │
            HTTPS (CSP-restricted)
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
   Groq API        OpenAI API      Anthropic API
   (LLM + STT)     (LLM + Vision   (LLM with prompt
                    + TTS)          caching)
```

---

## 3. FRONTEND (TypeScript / React)

### 3.1 Framework & Tooling

| Tool | Version | Purpose |
|---|---|---|
| React | 19.2.4 | UI framework |
| react-dom | 19.2.4 | DOM rendering |
| react-router-dom | 7.14.1 | Hash-routing for SPA |
| Vite | 8.0.4 | Build + dev server (port 1420 strict, polling watcher) |
| TypeScript | 6.0.2 (~pinned) | Strict mode: exactOptionalPropertyTypes, noImplicitOverride, noUnusedLocals/Parameters, erasableSyntaxOnly |
| Tailwind CSS | 4.2.2 (via @tailwindcss/vite) | Styling — no config file, defaults only |
| zustand | 5.0.12 | State management |
| zod | 4.3.6 | Runtime schema validation |
| clsx | 2.1.1 | Conditional class merging |
| lucide-react | 1.8.0 | Icons |

### 3.2 Document Processing

| Tool | Version | Purpose |
|---|---|---|
| pdfjs-dist | 4.10.38 | PDF text extraction (Web Worker) |
| mammoth | 1.12.0 | DOCX → plain text |
| tesseract.js | 7.0.0 | Browser OCR (WASM) |

### 3.3 ML / Embeddings

| Tool | Version | Purpose |
|---|---|---|
| @xenova/transformers | 2.17.2 | Browser-side transformers via Web Worker |
| Model: `Xenova/all-MiniLM-L6-v2` | — | 384-dim sentence embeddings |

### 3.4 Tauri Bindings

| Tool | Version | Purpose |
|---|---|---|
| @tauri-apps/api | 2.10.1 | IPC, window, event APIs |
| @tauri-apps/cli | 2.10.1 | Build CLI |

### 3.5 Code Splitting (Vite chunks)

- `vendor-react` — react, react-dom, react-router-dom
- `vendor-tauri` — @tauri-apps/*
- `vendor-pdf` — pdfjs-dist (~2.2 MB)
- `vendor-transformers` — @xenova/transformers (~788 KB)
- `vendor-mammoth` — mammoth (DOCX)
- `embeddingWorker` — separate Web Worker chunk
- `pdf.worker` — separate PDF Web Worker

### 3.6 Lint / Format / Test

- **ESLint 9.39.4** with rules: `@typescript-eslint/no-floating-promises: error`, `@typescript-eslint/no-misused-promises: error`, `no-console: error` (warn/error allowed)
- **Prettier 3.2.5** — printWidth 100, semi true, singleQuote true, trailingComma all
- **Vitest 4.1.4** with jsdom — mocks all Tauri APIs (invoke, listen, emit, WebviewWindow)
- **Playwright** — E2E suite (smoke, hotkeys, onboarding, settings, share-guard)
- **Husky 9** + **lint-staged 15** — pre-commit (prettier+eslint), pre-push (vitest + cargo check)

---

## 4. BACKEND (Rust / Tauri)

### 4.1 Crates (655 transitive deps; key direct ones)

| Crate | Version | Purpose |
|---|---|---|
| tauri | 2.10.3 | Runtime (with `tray-icon` feature) |
| tauri-build | 2.5.6 | Build script |
| tauri-plugin-log | 2.x | Structured JSON logging, 5MB rotation, KeepSome(10) |
| tauri-plugin-global-shortcut | 2.x | OS-level hotkeys |
| tauri-plugin-shell | 2.x | `shell::allow-open` for URLs |
| rusqlite | 0.32 | Bundled SQLite |
| aes-gcm | 0.10 | AES-256-GCM for at-rest encryption |
| keyring | 3.x | OS credential vault (apple-native, windows-native, sync-secret-service) |
| reqwest | 0.13 | HTTP (json, stream, multipart) |
| screenshots | 0.8 | Native screen capture |
| serde / serde_json | 1.0 | Serialization |
| futures-util | 0.3 | Async utilities |
| uuid | 1 | UUID v4 |
| base64 | 0.22 | Base64 codec |
| rand | 0.8 | RNG (jitter, polling intervals) |
| log | 0.4 | Logging facade |

### 4.2 Platform-Specific

**Windows**: `windows 0.61` with features `Win32_Foundation, Win32_UI_WindowsAndMessaging, Win32_System_Threading, Win32_Media_Audio, Win32_System_Com, Win32_Media_KernelStreaming`
**macOS**: `objc2 0.5, objc2-app-kit 0.3, objc2-foundation 0.3`

### 4.3 Release Profile

```toml
[profile.release]
lto = "fat"           # full link-time optimization
codegen-units = 1     # single unit for max optimization
opt-level = 3
strip = "symbols"     # strip debug symbols
```

### 4.4 Build Outputs

- **MSI installer** — `MeetingMind_1.0.0_x64_en-US.msi` (8.7 MB) via WiX
- **NSIS installer** — `MeetingMind_1.0.0_x64-setup.exe` (6.9 MB)
- **Portable .exe** — `app.exe` (18.4 MB)
- **macOS** — DMG + universal-apple-darwin `.app`
- **Linux** — `.deb` + AppImage

---

## 5. AUDIO CAPTURE PIPELINE

### 5.1 Native (Rust)

**WASAPI Loopback** — `src-tauri/src/audio/wasapi_capture.rs`
- `IMMDeviceEnumerator` → `GetDefaultAudioEndpoint(eRender, eConsole)`
- `AUDCLNT_STREAMFLAGS_LOOPBACK` to capture system audio
- Format negotiation: tries 16kHz mono first, falls back to device's `GetMixFormat()` and resamples
- 16-bit PCM little-endian, mono
- Linear-interpolation resampling to 16kHz (no anti-aliasing — known weakness)
- VAD with hangover (2-chunk silence tolerance)
- Emits Tauri event `native_audio_chunk` with `{ source, sample_rate_hz, channels, pcm_base64, timestamp_ms }`

**WASAPI Mic** — `src-tauri/src/audio/mic_capture.rs`
- Same pattern but `eCapture, eCommunications` endpoint
- Init flag `0` (not loopback)
- Emits `mic_audio_chunk` event

**VAD** — `src-tauri/src/audio/vad.rs`
- Energy-based: `RMS = sqrt(Σ(sample²) / N)`
- Optional zero-crossing rate (exported, unused)
- Global atomic threshold (`Relaxed` ordering)

### 5.2 Browser-Side (TypeScript)

**Live Capture Orchestrator** — `src/lib/runtime/liveCaptureOrchestrator.ts`

Recently rewritten from MediaRecorder (which produced header-less or duplicated chunks rejected by Whisper) to **VAD-driven utterance capture**:

```
Web Audio API:
  MediaStream → MediaStreamSource → ScriptProcessor(4096, 1, 1) → Destination

VAD State Machine:
  IDLE       → block RMS > 0.015 ⇒ SPEAKING (collect samples)
  SPEAKING   → block RMS > 0.015 ⇒ reset hangover timer
               silence > 700ms   ⇒ flush utterance to STT, IDLE
               duration > 12s    ⇒ force-flush, stay SPEAKING
  IDLE       → maintain 250ms pre-roll ring buffer
```

Constants:
- `VAD_RMS = 0.015` (Float32 [-1,1] scale)
- `PRE_ROLL_MS = 250` (capture word onsets)
- `HANGOVER_MS = 700` (end-of-utterance silence)
- `MIN_UTTER_MS = 400` (filter coughs/clicks)
- `MAX_UTTER_MS = 12000` (cap chunk size)
- `TARGET_SR = 16000`

Decimation: source 48kHz → 16kHz via nearest-sample (no FIR filter — known weakness).
PCM-to-WAV: 44-byte RIFF/fmt /data header prepended to Int16 LE samples.

**Audio level monitoring** — separate AnalyserNode (FFT 512), throttled to ~12 Hz via 80ms gate. Emits both DOM event (same window) and Tauri event (cross-window — needed because overlay is a separate Tauri window with isolated JS context).

### 5.3 Critical Audio Issues

| # | Issue | Severity |
|---|---|---|
| A1 | ScriptProcessorNode is deprecated; should migrate to AudioWorklet | Medium |
| A2 | No anti-aliasing filter on 48→16 kHz decimation | Medium |
| A3 | Resampler is linear interpolation only (Rust side) | Low |
| A4 | `active` flag in orchestrator has race conditions across callbacks | Low |
| A5 | VAD threshold is global atomic, not per-instance | Low |
| A6 | `native_audio_chunk` is emitted by Rust but never consumed by orchestrator (only `mic_audio_chunk` is) | High |

---

## 6. STT PROVIDERS

### 6.1 GroqSTTProvider — `src/lib/providers/sttProvider.ts`

- **Endpoint**: `POST https://api.groq.com/openai/v1/audio/transcriptions`
- **Model**: `whisper-large-v3-turbo`
- **Format**: multipart/form-data with `model`, `file` (Blob), optional `language`
- **Timeout**: 30s via AbortController
- **Rate-limit gate**: module-level `_rateLimitedUntil` shared across all instances. On 429, parses `try again in Ns` header and sets cool-down window. All subsequent calls short-circuit until window expires.
- **Error handling**:
  - 401 → "Invalid Groq API key" hint
  - 400 + "no audio track" → silently return empty
  - 429 → cool-down + emit `mm:stt-error` event
  - Other → emit `mm:stt-error`
- **Base64 sanitization**: strips whitespace, fixes padding, try/catch around atob

### 6.2 LocalSttProvider — `src/lib/providers/localSttProvider.ts`

Wrapper around Tauri command `transcribe_audio_chunk`. Forwards to Rust which calls Groq Whisper or local Whisper if implemented (currently routes to cloud).

### 6.3 Free-Tier Constraints (from Groq docs)

- **20 RPM** for `whisper-large-v3-turbo`
- 25 MB max file size
- Supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm

---

## 7. LLM PROVIDERS

### 7.1 Provider Implementations

All implement `AIProvider` interface (`src/lib/providers/aiProvider.ts`):
```typescript
interface AIProvider {
  complete(payload): Promise<string>
  stream?(payload, onChunk): Promise<string>
}
```

**AnthropicProvider** (`anthropicProvider.ts`)
- Endpoint: `https://api.anthropic.com/v1/messages`
- Header: `anthropic-version: 2023-06-01`
- **Prompt caching**: `cache_control: { type: 'ephemeral' }` on system prompt
- SSE streaming via ReadableStream + line buffering
- Max tokens: 1024 hardcoded
- Module-level `_activeController` cancels prior in-flight requests

**OpenAiProvider** (`openAiProvider.ts`)
- Endpoint: `https://api.openai.com/v1/chat/completions`
- SSE streaming
- Default model: `gpt-4o`
- Note: response_format json_object incompatible with streaming; system prompt instructs JSON

**GroqProvider** (`groqProvider.ts`)
- Endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Default: `llama-3.3-70b-versatile`
- Models supported: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
- SSE streaming, abort controller, 30s timeout

**ResilientGroqProvider** (`resilientGroqProvider.ts`)
- Wraps GroqProvider with retry (max 2) + exponential backoff `400 * (attempt+1) ms`
- Conservative fallback JSON if exhausted
- Schema validation via `isValidFallback`
- **BUG**: Streaming fallback emits entire JSON in one `onChunk` call (breaks streaming UX)

**LocalDemoProvider** (`localDemoProvider.ts`)
- No-network demo when API key missing
- Detects coding mode from prompt content
- Returns hardcoded demo JSON pointing user to console.groq.com

### 7.2 Provider Routing — `src/lib/providers/providerFactory.ts`

```typescript
getProviderForQuestionType(questionType, configured) {
  behavioral|hr|factual|other     → groq        (speed)
  system-design|coding            → anthropic   (quality)
  technical                       → openai      (vision)
  fallback cascade                → groq → openai → anthropic
}
```

`warmupProvider(name, key)` — fire-and-forget request to pre-warm TCP/TLS connection. Hardcoded model `llama-3.3-70b-versatile` regardless of selected (bug).

### 7.3 LLM Issues

| # | Issue | Severity |
|---|---|---|
| L1 | Routing doesn't validate routed provider's key is configured | Medium |
| L2 | Hardcoded model in warmup | Low |
| L3 | ResilientGroqProvider streams fallback as single chunk | Low |
| L4 | No global token budget tracking | Medium |
| L5 | Empty completion throws as error in GroqProvider | Low |

---

## 8. ANSWER COMPOSITION ENGINES

### 8.1 Question Detection — `src/lib/copilot/questionDetector.ts`

**Hybrid: Regex short-circuit + LLM classifier**

Regex patterns (recently expanded):
- 25 interrogative starts: `can you, what, how, why, tell me, explain, walk me, describe, design, give me, show me, help me, write a, implement, solve, optimize, ...`
- Contains `?` OR sentence ≥4 words containing `who|what|when|where|why|how|which`
- Confidence 0.93 if regex match

Signal lists for classification:
- `behavioral`, `system-design`, `coding`, `hr`, `pricing`, `technical`, `objection`, `factual`

LLM fallback: if regex confidence <0.85, async Groq call (`llama-3.3-70b-versatile`, 1.5s timeout). Returns JSON with `{ questionType, confidence, isFollowUp }`.

LRU cache (32 entries, FIFO eviction). 150ms debouncing batches multiple ingestTranscript calls.

Speaker source: prefers `customer` (interviewer audio via system capture), falls back to `user` (mic) for solo testing.

### 8.2 Answer Composer — `src/lib/copilot/answerComposer.ts`

Routes to specialized engine by question type:

| Type | Engine | Output shape |
|---|---|---|
| `behavioral` | `composeStar` | `{ situation, task, action, result, oneLiner }` |
| `system-design` | `composeSystemDesign` | `{ requirements[], highLevelComponents[], dataFlow, scalingConsiderations[], tradeoffs[], techStack[], estimations }` |
| `coding` | `solveCodingProblem` | `{ approach, timeComplexity, spaceComplexity, pseudocode[], code, language, keyInsights[] }` |
| (other) | Generic LLM with profile + RAG context | `{ answer, bullets[], confidence, sources[] }` |

System prompt includes:
- User profile (name, role, company)
- `extraInstructions` (default: Python/AI/ML stack description)
- `profileContext` (extracted resume signals)
- Conversation history (last 4 turns when `isFollowUp`)
- RAG chunks (top-5 from knowledge base)

### 8.3 Coding Solver — `src/lib/copilot/codingSolver.ts`

**JSON repair pipeline** (this is unique vs competitors):
1. `extractJson(raw)` — strip markdown fences (```json...```), find first `{...}` block
2. `JSON.parse` first attempt
3. If fail → `repairJson(candidate)`:
   - Walk char-by-char tracking string state
   - Escape raw `\n`, `\r`, `\t` inside JSON strings
   - Strip trailing commas before `]`/`}`
   - Replace smart quotes (`""`'`) with ASCII
4. If still fail → check if raw text >20 chars → use as code directly
5. Final fallback: parse error card with raw response visible

This makes the solver resilient to typical LLM JSON malformations.

### 8.4 Vision Solver — `src/lib/copilot/visionSolver.ts`

- GPT-4o vision via `messages: [{ role: user, content: [{ type: image_url, ...}, { type: text, ... }] }]`
- Detail: `low` (faster, cheaper)
- 10s timeout
- Regex JSON extraction `\{[\s\S]*\}` (no repair logic — bug)

### 8.5 Other Engines

- **answerScorer.ts** — 5s Groq scoring with 25-point dimensions per question type
- **memoryExtractor.ts** — regex action items / open questions (brittle, hardcoded "i will", "please")
- **summarizer.ts** — template-based meeting summary
- **resumeProfile.ts** — keyword-pattern matching from resume chunks
- **resumeBuilder.ts** — XYZ-formula bullet generation
- **jdMatcher.ts** — JD parsing + skill alignment

---

## 9. KNOWLEDGE BASE / RAG

### 9.1 Document Ingestion — `src/lib/rag/documentParser.ts`

| Format | Library | Method |
|---|---|---|
| PDF | pdfjs-dist | Page-by-page `getTextContent()`, joined with `\n\n` |
| DOCX | mammoth | `extractRawText()` (loses formatting) |
| TXT | native | `file.text()` |
| URL | fetch | HTML strip via regex (naive) |

URL allowlist: drive.google.com, docs.google.com, zoom.us, teams.microsoft.com, github.com, etc. Rust-side `validate_remote_url` exists but **not registered in invoke_handler** (TODO).

### 9.2 Chunking — `src/lib/rag/chunkDocument.ts`

- 80-word chunks, 12-word overlap (stride = 68)
- No semantic boundary awareness — can split mid-sentence

### 9.3 Embeddings — `src/lib/rag/embeddingWorker.ts`

- Web Worker (`@xenova/transformers`)
- Model: `Xenova/all-MiniLM-L6-v2` (384 dims)
- Mean pooling + L2 normalize
- Lazy init, 5min idle timeout, worker terminates if unused

### 9.4 Vector Store — `src/lib/rag/vectorStore.ts`

- localStorage key `meetingmind-kb-vectors`, key format `{docId}::{chunkIndex}`
- In-memory `_vectorCache` mirror to skip parse on every search
- Cosine similarity (vectors L2-normalized so dot product suffices)
- LRU query cache (16 queries)

### 9.5 Search — `src/lib/rag/knowledgeRepository.ts`

```typescript
async searchRelevant(query, maxResults=5):
  try → semanticSearch(query, embedQuery)
  catch → keywordSearch(query)  // tokenize + intersect, very basic
```

### 9.6 RAG Issues

| # | Issue | Severity |
|---|---|---|
| K1 | Embedding errors silently swallowed (fire-and-forget) | Medium |
| K2 | Keyword fallback is naive token intersection (no BM25) | Low |
| K3 | No document deduplication | Low |
| K4 | No streaming for large PDFs (OOM risk) | Medium |

---

## 10. STORAGE LAYER

### 10.1 SQLite — `src-tauri/src/db.rs`

**Schema:**
```sql
session_summaries(id TEXT PK, customer_name, title, duration_minutes, summary)
transcript_items(session_id TEXT, id TEXT, speaker, text, timestamp INTEGER, PK(session_id, id))
audit_events(id TEXT PK, event_type, timestamp, details_json)
```

**Encryption:** AES-256-GCM with random 12-byte nonce per field. Key (32 bytes) stored in OS keychain via `keyring` crate. Format: `base64(nonce || ciphertext)`.

**Connection tuning:**
- WAL journal mode
- `PRAGMA synchronous = NORMAL`
- `busy_timeout = 500ms`
- `with_busy_retry()` — 5 retries, exponential backoff (50→800ms)

**Integrity check:** `PRAGMA integrity_check` on init. If not "ok", rename DB aside (timestamp suffix) and create fresh — **silent data loss** (HIGH severity bug).

**Decryption fallback:** Returns ciphertext verbatim on decrypt failure (assumes plaintext migration). **Hides corruption** (MEDIUM severity bug).

**Special errors:** SQLITE_FULL → `DISK_FULL` sentinel for UI handling.

### 10.2 OS Keychain — keyring 3.x

Stored entries (service `meetingmind`):
- `groq` / `openai` / `anthropic` / `elevenlabs` — API keys
- `db_encryption_key` — DB master key
- `integration.zoom.access_token` / `.refresh_token` / `.expires_at`
- `integration.google.access_token` / `.refresh_token` / `.expires_at`

**G12 invariant**: API keys NEVER fall back to localStorage on keychain failure. Surfaced as `mm:keychain-error` event.

### 10.3 localStorage Keys

| Key | Purpose |
|---|---|
| `meetingmind-settings` | User profile, preferences (no secrets) |
| `meetingmind-runtime-config` | App config (timeouts, retention) |
| `meetingmind-knowledge-base` | KB document list + chunks |
| `meetingmind-kb-vectors` | Embedding vectors |
| `meetingmind-share-guard-auto-hidden` | Bool: currently auto-hidden |
| `meetingmind-share-guard-protection-history` | Last 100 ShareGuard triggers |
| `meetingmind-compliance-audit-log` | Last 1000 compliance events (fallback) |
| `meetingmind-audit-events` | Last 500 operational events (fallback) |

### 10.4 Zustand Stores

| Store | Persistence | Key state |
|---|---|---|
| sessionStore | SQLite (debounced 500ms batch) | transcript, rollingWindow (last 3), conversationHistory (last 20), report, latency metrics |
| settingsStore | localStorage + keychain | profile, API keys (in-memory only), provider config, STT/TTS, ShareGuard |
| overlayStore | ephemeral | currentSuggestion, currentSolution, statusLabel, isClickThrough |
| integrationStore | keychain | OAuth tokens with refresh scheduling (5min before expiry) |

---

## 11. SCREEN-CAPTURE EVASION (Stealth)

### 11.1 Windows — `src-tauri/src/commands/capture_exclusion.rs`

- `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` — Win10 2004+
- Fallback `WDA_MONITOR` for older builds
- `WS_EX_TOOLWINDOW` — removes from Alt+Tab and taskbar
- Re-applies on `WM_DISPLAYCHANGE` and `WM_SETTINGCHANGE` via message-only window

### 11.2 macOS

- `setSharingType: NSWindowSharingNone (0)` — excluded from `CGWindowListCopyWindowInfo`
- Collection behaviors: `NSWindowCollectionBehaviorStationary | IgnoresCycle | Transient`
- `setIgnoresCycle: YES`
- Window level: `kCGFloatingWindowLevel`
- `NSWindowDidChangeScreenNotification` observer (currently dead code per agent audit — registered but not actually attached)

### 11.3 Click-Through — `src-tauri/src/commands/click_through.rs`

- Windows: `WS_EX_TRANSPARENT | WS_EX_LAYERED` via SetWindowLongPtrW
- macOS: `setIgnoresMouseEvents: YES`
- Linux: not implemented

### 11.4 Capabilities (Tauri permissions)

`capabilities/default.json` (main window):
- core:default, shell:allow-open, global-shortcut:default
- core:window:allow-create/show/hide/set-always-on-top (capture-excluded-overlay)

`capabilities/overlay.json` (overlay/companion/capture-excluded-overlay):
- core:event:allow-listen, allow-emit
- core:window:allow-set-always-on-top, allow-set-ignore-cursor-events, allow-show, allow-hide

### 11.5 Stealth Issues

| # | Issue | Severity |
|---|---|---|
| S1 | macOS NSWindowDidChangeScreenNotification observer is dead code | High |
| S2 | TODO: detect DXGI_ERROR_ACCESS_DENIED on capture revocation | Medium |
| S3 | `apply_toolwindow_style` errors silently ignored | Low |
| S4 | "overlay" window in tauri.conf.json has `transparent: false` (inconsistent) | Low |

---

## 12. WINDOW MANAGEMENT

`tauri.conf.json` defines 4 windows:

| Label | Size | Visible | Decorations | Transparent | alwaysOnTop | Notes |
|---|---|---|---|---|---|---|
| main | 800×600 | yes | yes | no | no | Dashboard |
| companion | 520×760 | no | yes | no | no | Sidebar |
| overlay | 420×760 | no | no | no | yes | Legacy |
| capture-excluded-overlay | 400×700 | no | no | yes | yes | Primary overlay (skipTaskbar, focus:false) |

Window role detection: `src/app/windowRole.ts` parses `?window=<role>` query param.

---

## 13. HOTKEYS — `src-tauri/src/lib.rs`

12 global shortcuts via `tauri-plugin-global-shortcut`:

| Hotkey | Event | Handler |
|---|---|---|
| Ctrl+Shift+H | `share_guard_toggle_shortcut` | Toggle overlay (with ShareGuard check) |
| Ctrl+Shift+S | `hotkey_screenshot_solve` | Capture screen + GPT-4o vision solve |
| Ctrl+Shift+C | `hotkey_copy_answer` | Clipboard write current answer |
| Ctrl+Shift+T | `hotkey_toggle_click_through` | Toggle WS_EX_TRANSPARENT |
| Ctrl+Shift+↑ | `hotkey_scroll_up` | Scroll answer panel |
| Ctrl+Shift+↓ | `hotkey_scroll_down` | Scroll answer panel |
| Ctrl+Shift+Enter | `hotkey_generate_answer` | Re-generate answer for last transcript line |
| Ctrl+Shift+N | `hotkey_next_suggestion` | (no-op currently) |
| Ctrl+Shift+G | `hotkey_provider_groq` | Switch to Groq |
| Ctrl+Shift+O | `hotkey_provider_openai` | Switch to OpenAI |
| Ctrl+Shift+A | `hotkey_provider_anthropic` | Switch to Anthropic |
| Escape (overlay-focused only) | `hotkey_dismiss` | Hide overlay |

Escape uses `register_overlay_only_shortcut` with focus check to avoid hijacking globally.

---

## 14. TAURI COMMANDS (41 total)

### Persistence
`upsert_session_summary`, `list_session_summaries`, `upsert_transcript_item`, `upsert_transcript_items_batch`, `list_transcript_items`, `append_audit_event`, `list_audit_events`, `clear_audit_events`

### Audio
`start_native_audio_pipeline`, `stop_native_audio_pipeline`, `get_native_audio_pipeline_status`, `transcribe_audio_chunk`, `start_mic_capture`, `stop_mic_capture`, `list_mic_devices`

### Screen / OCR
`capture_screen_region`, `run_ocr_on_image` (delegates to browser tesseract.js), `get_active_window_info`

### Knowledge / LLM
`search_knowledge_base`, `call_llm` (multi-provider streaming proxy)

### Stealth / Window
`set_capture_excluded`, `get_capture_exclusion_support`, `reapply_capture_exclusion_all`, `set_click_through`, `create_overlay`, `toggle_overlay`, `destroy_overlay`

### Keychain
`store_api_key`, `retrieve_api_key`, `delete_api_key`

### Meeting Detection
`start_meeting_daemon`, `stop_meeting_daemon`

### VAD
`get_vad_threshold`, `set_vad_threshold`

### Monitor
`get_monitors`, `set_overlay_monitor`

### Audit (batch variants)
`audit_append_batch`, `persist_audit_event`

---

## 15. SHARE GUARD (Privacy Detection)

`src/lib/runtime/shareGuard.ts` + `shareGuardState.ts`

Sharing states tracked:
- `entire-screen` → trigger capture exclusion + audit `capture_exclusion_activated`
- `window` / `browser-tab` → no exclusion (low risk)
- `none` → show normally
- `second-screen` / `mobile-companion` → handled separately

Decision factors:
- Is `autoHideOnFullScreenShare` enabled?
- Does user have a second screen?
- Is meeting app (Zoom/Teams/Meet) detected as foreground?
- Is window in fullscreen?

Outputs `ShareGuardResult` with `{ overlayShouldHide, riskLevel, protectionReason }`.

Audit logging via `mm:share-guard-hide` / `mm:share-guard-restore` window events. Last 100 protection triggers in localStorage.

---

## 16. MEETING AUTO-DETECTION

`src/lib/runtime/meetingDetector.ts` + Rust daemon

- Polls active window every 2s + 50-250ms jitter
- Window title regex: `zoom|google\s*meet|microsoft\s*teams|webex|hackerrank|leetcode|coderpad|discord|slack|jitsi|whereby|bluejeans`
- Process name regex: `zoom.exe|teams.exe|chrome.exe|...`
- Confidence:
  - 0.95: title + process match
  - 0.90: title only
  - 0.70: process only
  - 0.20: no match

**Issue M1**: chrome.exe alone gives 70% — false positives during normal browsing.

---

## 17. AUDIT LOGGING

Two parallel systems:

**Compliance Audit** (`src/lib/auditLogger.ts`)
- Events: `assistant_startup/shutdown`, `automatic_hide_trigger`, `force_show_action`, `sensitive_knowledge_base_query`
- Includes UUID `request_id`, optional `session_id`
- Batched (50 events / 1s flush) → Tauri `audit_append_batch`
- Dedup: max 5 of same (type, msg) per 60s
- localStorage fallback: 1000 entries

**Operational Audit** (`src/lib/runtime/auditEvents.ts`)
- Events: `session_started/paused/resumed/ended`, `transcript_ingested`, `answer_generated`, `answer_generation_failed`, `export_generated`, `capture_exclusion_*`
- Same batching pattern
- localStorage fallback: 500 entries

---

## 18. ANSWER GENERATION FLOW (end-to-end)

```
1. WASAPI/getUserMedia captures audio
   ↓
2. VAD-driven utterance buffering (700ms hangover)
   ↓
3. Flush as 16kHz mono WAV → Groq Whisper
   ↓
4. Transcript appended to sessionStore.transcript (rAF-batched)
   ↓
5. detectQuestionDebounced (150ms debounce)
   ↓
6. Regex fast-path OR LLM classifier (1.5s)
   ↓
7. If isQuestion → look up RAG chunks (top-5 semantic)
   ↓
8. getProviderForQuestionType → choose Groq/OpenAI/Anthropic
   ↓
9. composeAnswer routes to STAR / SystemDesign / Coding / Generic engine
   ↓
10. provider.stream(...) emits tokens → onChunk → overlay UI
   ↓
11. Final JSON parsed (with repairJson for coding)
   ↓
12. setSuggestion / setSolution → overlayStore
   ↓
13. UI re-renders QuestionCard / SolutionCard
   ↓
14. Conversation history appended (capped at 20 turns)
   ↓
15. Latency metric updated, audit event emitted
```

---

## 19. KNOWN BUGS BY SEVERITY

### HIGH

1. **A6**: `native_audio_chunk` emitted but never consumed (system audio loopback dead path)
2. **D1**: Transcript batch loses pending items on app crash (no replay log)
3. **D5**: SQLite integrity check failure deletes DB silently
4. **S1**: macOS screen change observer is dead code (no actual subscription)
5. **F2**: `.env` Groq key in repo is invalid (returns 401)

### MEDIUM

6. **A1**: ScriptProcessorNode deprecated → migrate to AudioWorklet
7. **A2**: 48→16 kHz decimation has no anti-aliasing filter
8. **L1**: Provider routing doesn't validate routed key is configured
9. **L4**: No global token budget tracking
10. **K1**: Embedding errors silently swallowed
11. **K4**: No streaming for large PDFs (OOM)
12. **D3**: Decryption failure falls through as plaintext (hides corruption)
13. **D8**: OAuth token refresh handlers are no-ops (TODO unfulfilled)
14. **M1**: chrome.exe match alone triggers 70% meeting confidence
15. **S2**: TODO: DXGI_ERROR_ACCESS_DENIED detection missing

### LOW

16. Question detector follow-up heuristic too broad (<12 words = follow-up)
17. STT rate-limit window is module-global (not per-instance)
18. Hardcoded model in providerFactory.warmup
19. ResilientGroqProvider streams fallback as single chunk
20. JSON parse without repair in starEngine, systemDesignEngine, jdMatcher, visionSolver, answerScorer (only codingSolver has repair)
21. Hotkey blocked by another app → silent (no UI feedback)
22. CompanionWindow + SettingsPage hardcode hotkey list (TODO: shared catalog)
23. Resume signal regex misses Go, Kotlin, C++, Rust
24. Memory extractor "i will" / "please" patterns brittle
25. Overlay shimmer border z-fighting on scroll
26. `validate_remote_url` Rust command not registered in invoke_handler

---

## 20. FEATURE COMPARISON TABLE

| Feature | MeetingMind | Parakeet AI | Cluely | Interview Coder |
|---|---|---|---|---|
| Local STT | ❌ Cloud-only (Groq) | ✅ NVIDIA Parakeet TDT | ❌ Cloud | ❌ Cloud |
| Cloud STT | Groq Whisper-large-v3-turbo | Groq Whisper | OpenAI Whisper | OpenAI Whisper |
| Mic capture | ✅ Web Audio + WASAPI | ✅ | ✅ | ✅ |
| System audio capture | ✅ getDisplayMedia + WASAPI loopback (loopback unused) | ✅ | ❌ | ❌ |
| VAD-driven utterances | ✅ (RMS + hangover) | ✅ | ✅ | unknown |
| Question detection | Regex + LLM hybrid | LLM | LLM | none |
| LLM providers | Groq + OpenAI + Anthropic | OpenAI + Anthropic | OpenAI | OpenAI |
| Prompt caching | ✅ Anthropic ephemeral | ❌ | ❌ | ❌ |
| Streaming SSE | ✅ All 3 providers | ✅ | ✅ | ✅ |
| STAR engine | ✅ | basic | ❌ | ❌ |
| System design engine | ✅ structured JSON | basic | ❌ | ❌ |
| Coding solver | ✅ with JSON repair | basic | ❌ | ✅ |
| Vision solver (screenshot) | ✅ GPT-4o low detail | ✅ | ✅ | ✅ |
| Knowledge base RAG | ✅ MiniLM-L6-v2 + cosine | basic keyword | ✅ | ❌ |
| Resume grounding | ✅ | ✅ | ✅ | ❌ |
| Job description matching | ✅ | ✅ | partial | ❌ |
| Mock interview | ✅ with LLM scoring | ❌ | ❌ | ❌ |
| Capture exclusion | ✅ WDA_EXCLUDEFROMCAPTURE | ✅ | ✅ | ✅ |
| Click-through overlay | ✅ WS_EX_TRANSPARENT | ❌ (manual click) | ✅ | ✅ |
| Multi-monitor | ✅ getMonitors / setOverlayMonitor | ❌ | ❌ | partial |
| WM_DISPLAYCHANGE re-apply | ✅ message-only window | ❌ | ❌ | ❌ |
| Encrypted local storage | ✅ AES-256-GCM SQLite | ❌ unknown | ❌ unknown | ❌ unknown |
| OS keychain integration | ✅ keyring crate | ❌ unknown | ❌ unknown | ❌ unknown |
| 12 global hotkeys | ✅ | ❌ click-required | partial | ✅ |
| ShareGuard auto-hide | ✅ | ❌ | ✅ | ✅ |
| Audit logging (compliance) | ✅ dual-system | ❌ | ❌ | ❌ |
| Real-time audio level animation | ✅ AnalyserNode + cross-window event | ❌ | ❌ | ❌ |
| Open-source | ❌ | ❌ | ❌ | ❌ |

---

## 21. RUNTIME CONSTANTS REFERENCE

| Constant | Value | Location |
|---|---|---|
| Vite dev port | 1420 (strict) | vite.config.ts |
| AudioContext target SR | 16000 Hz | liveCaptureOrchestrator.ts |
| VAD RMS threshold | 0.015 | liveCaptureOrchestrator.ts |
| Pre-roll buffer | 250 ms | liveCaptureOrchestrator.ts |
| Hangover (silence) | 700 ms | liveCaptureOrchestrator.ts |
| Min utterance | 400 ms | liveCaptureOrchestrator.ts |
| Max utterance | 12000 ms | liveCaptureOrchestrator.ts |
| Whisper RPM (free tier) | 20 | Groq docs |
| LLM stream timeout | 30 s | provider files |
| Question detect debounce | 150 ms | questionDetector.ts |
| LLM classifier timeout | 1.5 s | questionDetector.ts |
| Question cache size | 32 (FIFO) | questionDetector.ts |
| Embedding model | all-MiniLM-L6-v2 (384d) | embeddingWorker.ts |
| Embedding worker idle | 5 min | vectorStore.ts |
| Vector LRU cache | 16 queries | vectorStore.ts |
| Chunk size | 80 words | chunkDocument.ts |
| Chunk overlap | 12 words | chunkDocument.ts |
| Audit batch | 50 events / 1 s | auditEvents.ts |
| Audit dedup | max 5 same/60s | auditEvents.ts |
| SQLite busy timeout | 500 ms | db.rs |
| SQLite busy retries | 5 (50→800ms) | db.rs |
| Token refresh lead time | 5 min before expiry | integrationStore.ts |
| Conversation history cap | 20 turns | sessionStore.ts |
| Rolling transcript window | 3 items | sessionStore.ts |
| Transcript persist debounce | 500 ms | sessionStore.ts |
| Compliance log fallback | 1000 entries | auditLogger.ts |
| Operational log fallback | 500 entries | auditEvents.ts |
| Meeting daemon poll | 2000 + jitter(50-250) ms | meetingDaemon.rs |

---

## 22. CSP (Content Security Policy)

From `tauri.conf.json`:
```
default-src 'self'
script-src 'self'
style-src 'self' 'unsafe-inline'
connect-src 'self'
  https://api.groq.com
  https://api.openai.com
  https://api.anthropic.com
  https://api.elevenlabs.io
  https://drive.google.com
  https://docs.google.com
  ipc: http://ipc.localhost
  asset: http://asset.localhost
img-src 'self' data: blob: asset: http://asset.localhost
media-src 'self' blob: data:
worker-src 'self' blob:
font-src 'self' data:
```

---

## 23. CI/CD

**GitHub Actions** (`.github/workflows/`):
- `ci.yml`: matrix [ubuntu, windows, macos] → cargo check + clippy + tests; node20 → tsc + eslint + prettier (continue-on-error) + vitest
- `release.yml`: on `v*.*.*` tag → tauri-action builds and creates draft release

**Husky hooks**:
- `pre-commit` → lint-staged (prettier + eslint --fix)
- `pre-push` → vitest + cargo check

---

## 24. RECOMMENDATIONS FOR PARITY/SUPERIORITY VS COMPETITORS

To exceed Parakeet AI / Cluely:

1. **Local STT** (highest leverage) — bundle whisper.cpp + ggml-base.en model (~150 MB). Zero rate limits, true offline. Currently a documented gap.
2. **AudioWorklet migration** — replace deprecated ScriptProcessor for stable long-term capture
3. **Anti-aliasing FIR filter** — proper resampling improves transcription accuracy
4. **Universal JSON repair** — extend codingSolver's repair to all engines (eliminates parse errors)
5. **Token budget governor** — prevent 413 errors on Anthropic
6. **Provider key validation in routing** — fail fast vs silent demo fallback
7. **Wire native_audio_chunk** — currently emitted but unused (free system audio path)
8. **Real OAuth refresh** — current no-op breaks Zoom/Google integrations after expiry
9. **Multi-monitor: prefer non-shared display** — auto-pick monitor without active screen-share
10. **Adaptive VAD threshold** — calibrate from ambient RMS during first 3 seconds
11. **Per-question-type timeout** — system design legitimately needs more than generic 20s
12. **Streaming LLM into UI** — currently `composeAnswer` doesn't pass `onChunk` from sessionStore.ingestTranscript

---

## 25. FILE INVENTORY

### Frontend (src/)
```
src/
├── App.tsx                           — Root + role detection
├── main.tsx                          — Entry + ErrorBoundary
├── app/
│   ├── routes.tsx                    — React Router config
│   └── windowRole.ts                 — ?window=<role> parser
├── components/
│   ├── AppErrorBoundary.tsx
│   ├── useAsyncErrorBoundary.ts
│   └── ui/                           — Button, Card, Tabs, Toast, Tooltip, ...
├── features/
│   ├── companion/CompanionWindow.tsx
│   ├── dashboard/                    — 14 pages (Sessions, Coding, Knowledge, Settings, ...)
│   └── overlay/                      — OverlayWindow, AIChatOverlay, ChatPanel, QuestionCard, SolutionCard, TranscriptFeed, useDraggable, overlay.css
├── lib/
│   ├── auditLogger.ts
│   ├── cn.ts
│   ├── logger.ts
│   ├── tauri.ts                      — Tauri IPC wrappers
│   ├── coding/codingAssistant.ts
│   ├── copilot/                      — answerComposer, questionDetector, starEngine, systemDesignEngine, codingSolver, visionSolver, answerScorer, memoryExtractor, summarizer, resumeProfile, resumeBuilder, jdMatcher
│   ├── interview/questionBank.ts
│   ├── providers/                    — aiProvider, anthropicProvider, openAiProvider, groqProvider, resilientGroqProvider, localDemoProvider, providerFactory, providerModels, ttsProvider, sttProvider, localSttProvider, contracts, languageCodes
│   ├── rag/                          — knowledgeRepository, documentParser, chunkDocument, vectorStore, embeddingWorker
│   └── runtime/                      — appConfig, auditEvents, liveCaptureOrchestrator, meetingDaemon, meetingDetector, screenCapture, shareGuard, shareGuardState
└── store/                            — sessionStore, settingsStore, overlayStore, integrationStore
```

### Backend (src-tauri/)
```
src-tauri/
├── Cargo.toml
├── build.rs
├── tauri.conf.json
├── capabilities/
│   ├── default.json
│   └── overlay.json
├── icons/
└── src/
    ├── lib.rs                        — App entry, command registration, hotkey setup
    ├── commands.rs                   — Most Tauri commands
    ├── db.rs                         — SQLite + AES-256-GCM
    ├── window_manager.rs             — Window lifecycle
    ├── meeting_daemon.rs             — 2s polling daemon
    ├── audio/
    │   ├── wasapi_capture.rs
    │   ├── mic_capture.rs
    │   └── vad.rs
    └── commands/
        ├── capture_exclusion.rs
        ├── click_through.rs
        ├── keychain.rs
        ├── meeting_daemon.rs
        ├── monitor_info.rs
        └── ...
```

### Tests
```
tests/
├── provider-factory.test.ts
├── answer-composer-runtime.test.ts
└── ...

e2e/
├── smoke.spec.ts
├── hotkeys.spec.ts
├── onboarding.spec.ts
├── settings.spec.ts
└── share-guard.spec.ts
```

---

## END OF REPORT

Hand this document to any AI to:
- Compare feature parity with Parakeet AI / Cluely / Interview Coder / LockedIn AI
- Identify gaps requiring implementation
- Audit security/privacy posture
- Estimate competitive positioning

Generated from comprehensive multi-agent codebase audit covering audio pipeline, LLM composition, capture evasion, data layer, and build/packaging — every file path, line range, algorithm, and bug surfaced.
