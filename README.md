# Interview AI

A desktop AI copilot for live meetings and interview practice. Built with **Tauri 2 + React 19 + Rust**.

Real-time speech transcription, automatic question detection, streaming AI answers (STAR / system-design / coding), screenshot-to-solution OCR, knowledge-base RAG, and a floating overlay window.

---

## Features

### Live session
- **Real-time STT** via Groq Whisper-large-v3-turbo (cloud) or local Whisper (Rust).
- **VAD-driven utterance capture** — only sends complete spoken phrases to STT, staying well under free-tier rate limits.
- **Question detector** — hybrid regex + LLM classifier (behavioral, system-design, coding, HR, technical, factual).
- **Streaming answers** — Groq, OpenAI, and Anthropic providers with SSE streaming.
- **Smart provider routing** — behavioral → Groq, coding/system-design → Anthropic, technical → OpenAI.
- **Anthropic prompt caching** — `cache_control: ephemeral` saves ~40% tokens on repeat system prompts.

### Specialized engines
- **STAR engine** — behavioral answers in Situation/Task/Action/Result format.
- **System design engine** — components, data flow, scaling considerations, tradeoffs, tech stack, capacity estimates.
- **Coding solver** — approach, time/space complexity, pseudocode, complete runnable code, key insights. Includes multi-stage JSON repair (handles unescaped newlines, trailing commas, smart quotes).
- **Vision solver** — GPT-4o screenshot OCR for problem extraction (LeetCode/HackerRank/CoderPad).
- **Mock interview** — practice mode with timer and LLM-based answer scoring.

### Knowledge base / RAG
- **PDF / DOCX / TXT / URL ingestion** (pdfjs-dist, mammoth, fetch + HTML strip).
- **Semantic search** via `@xenova/transformers` Web Worker running `all-MiniLM-L6-v2` (384-dim embeddings, cosine similarity).
- **Keyword fallback** when embeddings fail.
- **Resume grounding** — extracted resume signals injected into answer prompts.
- **Job-description matching** — required-skill alignment with answer bullets.

### Privacy / stealth
- **Capture exclusion** — `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+), `NSWindowSharingNone` (macOS). Overlay window is invisible to screen capture and recording.
- **Click-through overlay** — `WS_EX_TRANSPARENT | WS_EX_LAYERED` (Windows), `setIgnoresMouseEvents` (macOS).
- **WS_EX_TOOLWINDOW** — overlay hidden from Alt+Tab and taskbar.
- **WM_DISPLAYCHANGE re-application** — survives monitor hotplug, resolution changes, mirroring.
- **Share Guard** — auto-hides overlay on full-screen share when only one monitor is available.

### Storage / security
- **AES-256-GCM encrypted SQLite** for sessions, transcripts, and audit events.
- **OS keychain** (`keyring` crate) for API keys and OAuth tokens — never localStorage.
- **Dual audit logging** — compliance + operational events with batching, dedup, and 1000-entry localStorage fallback.

### Platform features
- **12 global hotkeys** — `Ctrl+Shift+H/S/C/T/↑/↓/Enter/N/G/O/A` and Escape.
- **Multi-monitor support** — `getMonitors` + `setOverlayMonitor` to pin overlay to a chosen display.
- **Meeting auto-detection** — polls active window for Zoom/Teams/Meet/HackerRank/LeetCode/CoderPad and others.
- **Native audio capture** — WASAPI loopback (system) and microphone (Windows). Browser-side `getUserMedia` + `getDisplayMedia` fallback.
- **Cross-window events** — Tauri `emit`/`listen` so the overlay (separate Tauri window) gets real-time audio level updates from the dashboard's audio pipeline.

---

## Architecture

```
Frontend (React 19 + TypeScript + Vite)
├── Dashboard window     → main app, sessions, settings, knowledge base
├── Overlay window       → floating capture-excluded UI
├── Companion window     → sidebar mode
└── State (Zustand)      → sessionStore, settingsStore, overlayStore, integrationStore

Tauri IPC (events + commands)

Backend (Rust)
├── WASAPI capture       → mic_capture.rs, wasapi_capture.rs, vad.rs
├── SQLite + AES-GCM     → db.rs
├── OS keychain          → commands/keychain.rs
├── Capture exclusion    → commands/capture_exclusion.rs
├── Click-through        → commands/click_through.rs
├── Window manager       → window_manager.rs
├── Meeting daemon       → meeting_daemon.rs
└── 41 Tauri commands    → lib.rs, commands.rs
```

---

## Stack

**Frontend**: React 19, Vite 8, TypeScript 6, Tailwind 4, Zustand, Zod, react-router-dom 7, lucide-react, pdfjs-dist, mammoth, tesseract.js, @xenova/transformers

**Backend**: Tauri 2.10, rusqlite (bundled SQLite), aes-gcm, keyring, reqwest, screenshots, windows-rs, objc2 (macOS), tauri-plugin-log, tauri-plugin-global-shortcut, tauri-plugin-shell

**AI Providers**: Groq (Whisper-large-v3-turbo + Llama 3.3 70B), OpenAI (GPT-4o + TTS-1), Anthropic (Claude with prompt caching), ElevenLabs (neural TTS)

---

## Setup

### Prerequisites

- **Node.js** ≥ 18
- **Rust** ≥ 1.77.2 (stable toolchain)
- **Windows 10 2004+** / **macOS 10.15+** / **Linux** (Linux: WebKit2GTK 4.1, GTK 3, libsoup 3)
- A free **Groq API key** from [console.groq.com](https://console.groq.com)

### Install

```bash
git clone https://github.com/hassanasifai/interview_ai.git
cd interview_ai
npm install
```

### Configure

Copy the example env and add your Groq key:

```bash
cp .env.example .env
# Edit .env and paste your gsk_... key
```

### Run (dev)

```bash
npm run tauri:dev
```

The desktop window opens. Settings → API Keys → paste your Groq key (saved to OS keychain). Click **Start session** and speak.

### Build installer

```bash
npm run tauri:build
```

Produces:
- `src-tauri/target/release/bundle/msi/*.msi` — Windows MSI
- `src-tauri/target/release/bundle/nsis/*-setup.exe` — Windows NSIS
- `src-tauri/target/release/app.exe` — portable
- macOS DMG + Linux deb/AppImage on respective platforms

---

## Configuration

All preferences live in **Settings**:

- **API Keys** — Groq (required), OpenAI (optional, for vision/TTS), Anthropic (optional), ElevenLabs (optional, neural TTS)
- **Profile** — name, role, company, resume upload (PDF/DOCX/TXT)
- **Extra instructions** — system prompt customization (default: Python/AI-ML/backend stack)
- **STT** — language, mode (groq/local/auto), VAD threshold (0–3000 ms)
- **TTS** — provider (browser/openai/elevenlabs)
- **Privacy** — share mode, auto-hide on full-screen share, prefer second screen
- **Monitor** — target display for overlay

Free Groq tier limits:
- 20 RPM on `whisper-large-v3-turbo`
- 30 RPM on `llama-3.3-70b-versatile`

The app's VAD-driven utterance flushing typically stays at 6–12 RPM for STT.

---

## Hotkeys

| Hotkey | Action |
|---|---|
| `Ctrl+Shift+H` | Toggle overlay (with Share Guard check) |
| `Ctrl+Shift+S` | Screenshot + GPT-4o solve |
| `Ctrl+Shift+C` | Copy current answer |
| `Ctrl+Shift+T` | Toggle click-through |
| `Ctrl+Shift+↑` / `↓` | Scroll answer panel |
| `Ctrl+Shift+Enter` | Re-generate answer for last transcript line |
| `Ctrl+Shift+N` | Next suggestion |
| `Ctrl+Shift+G` / `O` / `A` | Switch provider (Groq/OpenAI/Anthropic) |
| `Escape` (overlay focused) | Dismiss overlay |
| `Ctrl+K` | Command palette |

---

## Project layout

```
src/
├── App.tsx, main.tsx
├── app/                    routes, window role detection
├── components/             UI library + error boundary
├── features/
│   ├── companion/          companion sidebar window
│   ├── dashboard/          14 dashboard pages
│   └── overlay/            floating overlay (capture-excluded)
├── lib/
│   ├── copilot/            answer composer, question detector, engines (STAR, system-design, coding, vision)
│   ├── providers/          Groq / OpenAI / Anthropic / TTS / STT
│   ├── rag/                document parser, vector store, embedding worker
│   └── runtime/            audio orchestrator, share guard, meeting daemon, audit
└── store/                  Zustand stores (session, settings, overlay, integrations)

src-tauri/
├── Cargo.toml, tauri.conf.json
├── capabilities/           Tauri v2 permissions
├── src/
│   ├── lib.rs              entry, command registration, hotkeys
│   ├── commands.rs         most Tauri commands
│   ├── db.rs               SQLite + AES-256-GCM
│   ├── audio/              WASAPI capture, VAD
│   └── commands/           capture_exclusion, click_through, keychain, monitor_info, meeting_daemon
└── icons/
```

---

## Scripts

```bash
npm run dev              # vite only (browser mode, limited features)
npm run tauri:dev        # full desktop dev
npm run build            # tsc -b && vite build
npm run tauri:build      # production installer
npm run lint             # eslint
npm run format           # prettier --write
npm test                 # vitest
```

---

## Privacy

- API keys are stored in the OS keychain — Windows Credential Manager, macOS Keychain, GNOME/KDE Secret Service. They never touch localStorage.
- Local SQLite is encrypted at rest with AES-256-GCM (random nonce per field).
- Audio is processed in-memory and sent to Groq/OpenAI per chunk; Groq's API does not store audio after transcription. No audio is written to disk.
- Transcripts are stored locally (encrypted SQLite) — never uploaded.
- The full Content Security Policy in `tauri.conf.json` restricts network calls to `api.groq.com`, `api.openai.com`, `api.anthropic.com`, `api.elevenlabs.io`, `drive.google.com`, `docs.google.com`.

---

## License

MIT

---

## Acknowledgements

Built on Tauri, React, Groq (Whisper + Llama 3.3), OpenAI, Anthropic, ElevenLabs, Hugging Face Xenova/all-MiniLM-L6-v2, pdfjs-dist, mammoth, tesseract.js.
