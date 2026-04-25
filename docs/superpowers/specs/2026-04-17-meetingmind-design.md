# MeetingMind Design

## Summary

MeetingMind is a desktop meeting copilot built in `D:\presentation` as a Tauri v2 application with a Rust backend and a React/Vite frontend. It provides live transcription, question detection, answer suggestions, knowledge-base retrieval, meeting summaries, action items, and customer memory across sessions for video meetings and phone-style calls.

The product target is feature parity with the legitimate public-facing features advertised by Parakeet AI as of April 17, 2026, while explicitly excluding stealth, evasion, proctoring bypass, screen-share invisibility, taskbar or dock hiding, process disguise, or any behavior intended to conceal the tool from meeting participants or platform controls.

## Goals

- Build a local-first cross-platform desktop app in `D:\presentation`
- Support a visible helper overlay plus a full dashboard window
- Capture meeting context from microphone and, where supported, system audio
- Produce live transcript updates and AI-generated response suggestions
- Support uploaded documents, extra instructions, and user profile conditioning
- Persist sessions, transcripts, summaries, action items, and customer history locally
- Provide coding-question assistance in a normal visible mode
- Provide a second-screen / companion-friendly architecture for private use without bypassing platform controls

## Non-Goals

- Invisible overlays or hidden windows
- Undetectability against screen sharing, recording tools, or proctoring software
- Process renaming or operating-system disguise
- Background recording without the user’s explicit knowledge and OS permissions
- Multi-tenant hosted backend for the MVP

## External References And Reuse Strategy

### `Laxcorp-Research/project-raven`

Use as the primary architectural reference for:

- dual-stream meeting-copilot flow
- audio capture patterns
- provider abstraction for AI backends
- local session persistence
- document-backed retrieval patterns

Reason: the repository publicly documents meeting-copilot architecture, real-time transcription, local storage, and RAG under an MIT license, making it the cleanest reuse baseline for compatible concepts.

### `Zackriya-Solutions/meetily`

Use as the main reference for:

- Rust-heavy meeting app structure
- local transcription workflows
- provider selection patterns
- summarization and post-meeting flows

Reason: it is an open-source, privacy-first meeting assistant that focuses on cross-platform local processing and flexible providers, which aligns with the compliant product direction.

### `Natively-AI-assistant/natively-cluely-ai-assistant`

Use only as a conceptual reference for:

- broad product-module ideas
- local-first assistant workflows
- session and RAG composition ideas

Do not copy stealth-oriented code or AGPL-governed implementation into the shipped MVP baseline.

## Product Surfaces

### 1. Overlay Window

A visible, always-on-top helper panel that shows:

- live transcript snippets
- detected question cards
- suggested answer bullets
- optional coaching metrics
- quick actions such as pin, dismiss, and save note

The overlay is intentionally visible to the user and must behave like a normal app window. It may auto-hide or minimize when the user shares the full screen, based on user-configured safety rules.

### 2. Dashboard Window

A full application window for:

- onboarding
- settings
- knowledge-base management
- session history
- session detail review
- transcript browsing
- action-item tracking
- exports

### 3. Companion Modes

To keep the copilot private without bypassing platform controls, the app will support:

- second-screen placement
- detachable dashboard
- local network mobile companion mode in a later slice

## System Architecture

### Desktop Shell

- Framework: Tauri v2
- Backend: Rust
- Frontend: React 18 + TypeScript + Vite + Tailwind
- State: Zustand
- IPC: Tauri commands and events

### Audio Layer

The backend owns meeting-session lifecycle and audio ingestion.

MVP implementation path:

- microphone capture through normal OS/device permissions
- system-audio capture through native platform support where available
- file or simulated-input fallback for development and tests
- transcript event abstraction that does not depend on a single provider

The design keeps capture and transcription decoupled:

- `audio` module emits PCM frames and session events
- `transcription` module consumes frames and emits transcript segments
- `session` module composes transcript, memory, and UI updates

### Transcription Layer

Provider abstraction:

- default remote path: Groq transcription API
- optional local path later: faster-whisper / Whisper.cpp / local models

Core outputs:

- transcript segments
- speaker role
- timestamps
- rolling window snapshots

### AI Layer

The AI orchestration layer has four services:

1. `QuestionDetector`
2. `AnswerComposer`
3. `MemoryExtractor`
4. `PostMeetingSummarizer`

All services sit behind a common provider interface so that Groq, Gemini, or other OpenAI-compatible endpoints can be swapped with configuration.

### Knowledge Layer

Local persistence:

- SQLite for structured app data
- local vector index for semantic retrieval

Document ingestion supports:

- PDF
- TXT
- Markdown
- DOCX

Sources for answer generation:

- uploaded documents
- user scripts
- extra session instructions
- customer memory from past sessions

### Frontend Layer

The frontend is composed into focused modules:

- `overlay`
- `dashboard`
- `onboarding`
- `knowledge-base`
- `session-history`
- `settings`
- `shared UI`

## Data Model

### SQLite Tables

- `settings`
- `profiles`
- `sessions`
- `session_segments`
- `session_summaries`
- `action_items`
- `customers`
- `documents`
- `document_chunks`
- `scripts`

### Vector Retrieval Units

Each retrievable chunk stores:

- source id
- source type
- text
- embedding vector reference
- metadata tags such as customer, product, pricing, or objection

## Runtime Flow

1. User launches the app
2. User completes onboarding and configures provider keys
3. User starts a session manually or via meeting detection prompt
4. Backend begins capture and transcription stream(s)
5. Transcript segments stream to the frontend and SQLite
6. Rolling transcript window updates in memory
7. Question detector evaluates recent customer-side transcript
8. If a question is detected, answer composer retrieves context and returns bullets plus sources
9. Overlay updates immediately
10. Memory extractor runs on interval and updates action items, customer memory, and session notes
11. User ends session
12. Post-meeting summarizer writes summary and next steps
13. Dashboard opens session detail automatically

## Feature Set

### Parity Targets

- works with standard call platforms by listening through permitted audio capture
- real-time transcript
- answer generation during calls
- document upload and reference
- extra context / instructions for the session
- coding-question assistance mode
- AI notes after the call
- keyboard shortcuts
- headphones-friendly workflow
- meeting auto-detect prompt
- visible desktop app plus later companion mode

### MeetingMind-Specific Additions

- customer memory across sessions
- objection playbook document type
- action-item tracker across all sessions
- configurable safety behavior when full-screen sharing is detected
- optional real-time coaching analytics

## Delivery Slices

### Slice 1: Foundation Shell

- scaffold Tauri v2 + React app
- create dashboard and overlay windows
- implement routing, layout, Zustand stores, and settings persistence
- create provider abstraction and fake transcript feed for development
- create local schema and repositories

### Slice 2: Session And Transcript Pipeline

- implement session lifecycle
- stream transcript events into UI
- persist transcript segments
- build live transcript feed and timeline views

### Slice 3: AI Copilot

- implement question detector
- implement answer composer without RAG first
- render answer cards in overlay

### Slice 4: Knowledge Base And Memory

- implement document upload, chunking, embeddings, and retrieval
- wire customer memory retrieval
- add objection playbook support

### Slice 5: Post-Meeting Workflows

- implement summaries
- action item extraction
- exports
- searchable history

### Slice 6: Advanced Parity

- coding assist mode
- meeting auto-detect prompts
- coaching metrics
- companion mode

## Error Handling

- audio capture failures surface actionable device or permission errors
- AI provider failures show fallback status and preserve transcript flow
- ingestion failures isolate per-file and never corrupt existing index state
- retrieval failures degrade gracefully to conversation-only answering
- all long-running jobs report progress and cancellation states

## Testing Strategy

- unit tests for stores, repositories, prompt builders, and detector logic
- integration tests for session persistence and AI-service orchestration
- component tests for overlay cards, transcript feed, and dashboard flows
- end-to-end smoke tests for onboarding, session start, transcript simulation, document upload, and session review

## Compliance And Safety

- explicit user-controlled session start and stop
- visible UI surfaces only
- no bypass of sharing, recording, or proctoring systems
- local-first defaults with clear provider disclosures

## Open Risks

- system-audio capture varies by OS and may require staged implementation
- low-latency transcription quality depends on provider and hardware
- document embeddings and vector retrieval need careful runtime sizing
- Tauri desktop build requires Rust toolchain setup in this workspace
