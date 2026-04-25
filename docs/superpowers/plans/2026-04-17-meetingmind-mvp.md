# MeetingMind MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compliant local-first desktop meeting copilot in `D:\presentation` with a Tauri shell, visible overlay, dashboard, transcript pipeline abstractions, AI-answer workflow, knowledge-base ingestion, and local session history.

**Architecture:** The app uses Tauri v2 with a Rust backend and a React/Vite frontend. The first implementation establishes a production-ready shell with fake and local data paths, then layers in local persistence, AI provider abstractions, simulated session flow, document ingestion, and dashboard workflows so the application is runnable before native audio capture is finalized.

**Tech Stack:** Tauri v2, Rust, React 18, TypeScript, Vite, Tailwind CSS, Zustand, Vitest, React Testing Library, SQLite, local file storage

---

## File Structure

- `D:\presentation\src-tauri\src\main.rs`
  Tauri bootstrap, window setup, command registration
- `D:\presentation\src-tauri\src\commands.rs`
  Tauri command handlers for settings, sessions, and knowledge base actions
- `D:\presentation\src-tauri\src\db.rs`
  SQLite bootstrap and schema execution
- `D:\presentation\src-tauri\src\models.rs`
  Shared Rust-side DTOs for commands and events
- `D:\presentation\src\main.tsx`
  React entry point
- `D:\presentation\src\App.tsx`
  Window-aware app shell for dashboard vs overlay rendering
- `D:\presentation\src\app\routes.tsx`
  Dashboard routing
- `D:\presentation\src\store\*.ts`
  Zustand stores
- `D:\presentation\src\lib\tauri.ts`
  Typed frontend bridge to Tauri commands and events
- `D:\presentation\src\lib\providers\*.ts`
  AI provider abstraction and development provider
- `D:\presentation\src\lib\rag\*.ts`
  Document chunking, indexing metadata, and retrieval interfaces
- `D:\presentation\src\features\overlay\*.tsx`
  Overlay experience
- `D:\presentation\src\features\dashboard\*.tsx`
  Dashboard experience
- `D:\presentation\src\features\onboarding\*.tsx`
  First-run setup flow
- `D:\presentation\tests\*.test.ts(x)`
  Unit and component tests

## Task 1: Scaffold The Workspace

**Files:**

- Create: `D:\presentation\package.json`
- Create: `D:\presentation\src\main.tsx`
- Create: `D:\presentation\src\App.tsx`
- Create: `D:\presentation\src-tauri\Cargo.toml`
- Create: `D:\presentation\src-tauri\src\main.rs`

- [ ] Step 1: Install the Rust toolchain required by Tauri
- [ ] Step 2: Create the Tauri + React + TypeScript project in `D:\presentation`
- [ ] Step 3: Install core frontend dependencies
- [ ] Step 4: Verify the default app starts in development mode

## Task 2: Create The App Shell With Dashboard And Overlay

**Files:**

- Modify: `D:\presentation\src\App.tsx`
- Create: `D:\presentation\src\app\routes.tsx`
- Create: `D:\presentation\src\features\overlay\OverlayWindow.tsx`
- Create: `D:\presentation\src\features\dashboard\DashboardWindow.tsx`
- Create: `D:\presentation\tests\app-shell.test.tsx`

- [ ] Step 1: Write a failing component test that expects different window layouts for overlay and dashboard modes
- [ ] Step 2: Run the test and confirm it fails for missing shell logic
- [ ] Step 3: Implement the window-aware shell and route composition
- [ ] Step 4: Run the shell test suite and confirm it passes

## Task 3: Add Persistent Settings And Session Stores

**Files:**

- Create: `D:\presentation\src\store\settingsStore.ts`
- Create: `D:\presentation\src\store\sessionStore.ts`
- Create: `D:\presentation\src\store\overlayStore.ts`
- Create: `D:\presentation\tests\stores.test.ts`

- [ ] Step 1: Write failing tests for settings hydration, overlay toggling, and simulated transcript insertion
- [ ] Step 2: Run the tests and confirm expected failures
- [ ] Step 3: Implement Zustand stores with typed actions
- [ ] Step 4: Re-run the store tests and confirm they pass

## Task 4: Establish Rust Commands And Local Persistence

**Files:**

- Create: `D:\presentation\src-tauri\src\commands.rs`
- Create: `D:\presentation\src-tauri\src\db.rs`
- Create: `D:\presentation\src-tauri\src\models.rs`
- Create: `D:\presentation\src\lib\tauri.ts`
- Create: `D:\presentation\tests\tauri-bridge.test.ts`

- [ ] Step 1: Write failing frontend tests for typed command wrappers and repository mapping
- [ ] Step 2: Run the tests and confirm bridge methods are missing
- [ ] Step 3: Implement Rust-side models, DB bootstrap, and initial command set for settings and sessions
- [ ] Step 4: Implement typed frontend bridge functions
- [ ] Step 5: Re-run bridge tests and confirm they pass

## Task 5: Build Onboarding, Settings, And Session History

**Files:**

- Create: `D:\presentation\src\features\onboarding\OnboardingPage.tsx`
- Create: `D:\presentation\src\features\dashboard\SettingsPage.tsx`
- Create: `D:\presentation\src\features\dashboard\SessionHistoryPage.tsx`
- Create: `D:\presentation\src\features\dashboard\SessionDetailPage.tsx`
- Create: `D:\presentation\tests\dashboard-pages.test.tsx`

- [ ] Step 1: Write failing UI tests for onboarding completion, settings save, and session list rendering
- [ ] Step 2: Run the tests and confirm the pages do not exist yet
- [ ] Step 3: Implement the dashboard pages and shared layout
- [ ] Step 4: Re-run dashboard page tests and confirm they pass

## Task 6: Implement Simulated Transcript Pipeline

**Files:**

- Create: `D:\presentation\src\lib\providers\transcriptSimulator.ts`
- Create: `D:\presentation\src\features\overlay\TranscriptFeed.tsx`
- Create: `D:\presentation\tests\transcript-simulator.test.ts`

- [ ] Step 1: Write failing tests for transcript event ordering and rolling-window updates
- [ ] Step 2: Run the tests and confirm the simulator is absent
- [ ] Step 3: Implement transcript simulator plus overlay transcript rendering
- [ ] Step 4: Re-run transcript tests and confirm they pass

## Task 7: Implement AI Provider Abstraction And Question Detection

**Files:**

- Create: `D:\presentation\src\lib\providers\aiProvider.ts`
- Create: `D:\presentation\src\lib\providers\groqProvider.ts`
- Create: `D:\presentation\src\lib\copilot\questionDetector.ts`
- Create: `D:\presentation\src\lib\copilot\answerComposer.ts`
- Create: `D:\presentation\tests\copilot.test.ts`

- [ ] Step 1: Write failing tests for question detection and answer composition against a fake provider
- [ ] Step 2: Run the tests and confirm the copilot layer is missing
- [ ] Step 3: Implement provider interfaces, a development provider, and minimal Groq client plumbing
- [ ] Step 4: Re-run copilot tests and confirm they pass

## Task 8: Surface Suggested Answers In The Overlay

**Files:**

- Create: `D:\presentation\src\features\overlay\QuestionCard.tsx`
- Modify: `D:\presentation\src\features\overlay\OverlayWindow.tsx`
- Create: `D:\presentation\tests\overlay-answer-card.test.tsx`

- [ ] Step 1: Write a failing UI test for rendering a detected question and three answer bullets
- [ ] Step 2: Run the test and confirm it fails
- [ ] Step 3: Implement the answer card and wire it to overlay state
- [ ] Step 4: Re-run overlay tests and confirm they pass

## Task 9: Build Knowledge Base Ingestion And Retrieval Interfaces

**Files:**

- Create: `D:\presentation\src\lib\rag\chunkDocument.ts`
- Create: `D:\presentation\src\lib\rag\knowledgeRepository.ts`
- Create: `D:\presentation\src\features\dashboard\KnowledgeBasePage.tsx`
- Create: `D:\presentation\tests\knowledge-base.test.ts`

- [ ] Step 1: Write failing tests for chunking text documents and storing metadata records
- [ ] Step 2: Run the tests and confirm the RAG utilities are missing
- [ ] Step 3: Implement local chunking, document metadata persistence, and dashboard management UI
- [ ] Step 4: Re-run knowledge-base tests and confirm they pass

## Task 10: Add Customer Memory, Notes, And Summaries

**Files:**

- Create: `D:\presentation\src\lib\copilot\memoryExtractor.ts`
- Create: `D:\presentation\src\lib\copilot\summarizer.ts`
- Create: `D:\presentation\src\features\dashboard\ActionItemsPage.tsx`
- Create: `D:\presentation\tests\meeting-memory.test.ts`

- [ ] Step 1: Write failing tests for extracting action items and producing a structured summary from transcript input
- [ ] Step 2: Run the tests and confirm these utilities are absent
- [ ] Step 3: Implement memory extraction, summary generation interfaces, and action-item dashboard rendering
- [ ] Step 4: Re-run memory tests and confirm they pass

## Task 11: Add Meeting Safety UX And Keyboard Shortcuts

**Files:**

- Create: `D:\presentation\src\features\overlay\ActionBar.tsx`
- Create: `D:\presentation\src\lib\sharingSafety.ts`
- Create: `D:\presentation\tests\sharing-safety.test.ts`

- [ ] Step 1: Write failing tests for safety-state changes and overlay auto-hide decisions
- [ ] Step 2: Run the tests and confirm failures
- [ ] Step 3: Implement visible safety UX, keyboard shortcuts, and optional auto-hide logic
- [ ] Step 4: Re-run the safety tests and confirm they pass

## Task 12: Final Verification

**Files:**

- Modify: `D:\presentation\README.md`

- [ ] Step 1: Run the full frontend test suite
- [ ] Step 2: Run the production frontend build
- [ ] Step 3: Run the Tauri dev or build verification path
- [ ] Step 4: Document setup, supported features, and current limitations in `README.md`
