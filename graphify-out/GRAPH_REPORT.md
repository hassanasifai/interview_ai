# Graph Report - presentation (2026-04-26)

## Corpus Check

- 178 files · ~122,352 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 996 nodes · 1390 edges · 43 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 288 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 69|Community 69]]

## God Nodes (most connected - your core abstractions)

1. `show()` - 27 edges
2. `canUseTauriInvoke()` - 26 edges
3. `MeetingMind Technical Audit Report` - 21 edges
4. `Remaining Build Prompt (Beat Every Competitor)` - 15 edges
5. `emit()` - 14 edges
6. `appendAuditEvent()` - 14 edges
7. `App Icon (Main)` - 13 edges
8. `logComplianceEvent()` - 11 edges
9. `createLiveAnswerProvider()` - 11 edges
10. `Database` - 11 edges

## Surprising Connections (you probably didn't know these)

- `Groq Whisper-large-v3-turbo` --semantically_similar_to--> `Deepgram Nova-3 Streaming WebSocket` [INFERRED] [semantically similar]
  AUDIT_REPORT.md → REALTIME_ROADMAP.md
- `show()` --calls--> `executeCard()` [INFERRED]
  src\components\ui\useToast.ts → src\features\dashboard\ActionItemsPage.tsx
- `show()` --calls--> `addManualAction()` [INFERRED]
  src\components\ui\useToast.ts → src\features\dashboard\ActionItemsPage.tsx
- `show()` --calls--> `handleCopyCode()` [INFERRED]
  src\components\ui\useToast.ts → src\features\dashboard\CodingAssistPage.tsx
- `refreshSnapshot()` --calls--> `getShareGuardRuntimeSnapshot()` [INFERRED]
  src\features\dashboard\ShareGuardPage.tsx → src\lib\tauri.ts

## Hyperedges (group relationships)

- **Stealth/capture-evasion stack** — concept_wda_excludefromcapture, concept_nswindowsharingnone, concept_ws_ex_transparent, concept_share_guard [EXTRACTED 1.00]
- **Realtime sub-second pipeline** — concept_audioworklet, concept_silero_vad, concept_deepgram_nova3, concept_speculative_generation, concept_parallel_classify_rag [EXTRACTED 1.00]
- **Specialized answer engines** — concept_star_engine, concept_system_design_engine, concept_coding_solver, concept_vision_solver, concept_question_detector [EXTRACTED 1.00]
- **Tauri Packaging Icon Set (Interlocked Cyan/Yellow Circles Logo)** — icon_128x128, icon_128x128_2x, icon_32x32, icon_main, icon_square_107, icon_square_142, icon_square_150, icon_square_284, icon_square_30, icon_square_310, icon_square_44, icon_square_71, icon_square_89, icon_store_logo [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"

Cohesion: 0.03
Nodes (83): Answer Composition Engines (STAR/Coding/SystemDesign), Answer Generation End-to-End Flow, Architecture Overview Diagram, Audio Capture Pipeline (WASAPI + VAD), Audit Logging (Compliance + Operational), Backend Rust Crates and Profile, Screen Capture Evasion (Stealth), Frontend Stack (React/TS/Vite/Tauri) (+75 more)

### Community 1 - "Community 1"

Cohesion: 0.05
Nodes (44): append_audit_event(), call_anthropic_llm(), call_llm(), capture_screen_region(), clear_audit_events(), get_active_window_info(), is_screen_capture_revoked(), list_audit_events() (+36 more)

### Community 2 - "Community 2"

Cohesion: 0.05
Nodes (39): checkForUpdatesOnStartup(), seedDemoKnowledgeBase(), clientValidate(), parseDocx(), parsePdf(), parsePlainText(), parseUrl(), validateUrl() (+31 more)

### Community 3 - "Community 3"

Cohesion: 0.05
Nodes (31): composeAnswer(), scoreAnswer(), getRuntimeConfig(), getRuntimeConfigHealth(), readStoredConfig(), writeRuntimeConfig(), componentDidCatch(), getBestProvider() (+23 more)

### Community 4 - "Community 4"

Cohesion: 0.06
Nodes (38): register_macos_screen_change_observer(), run_ocr_on_image(), transcribe_audio_chunk(), delete_api_key(), retrieve_api_key(), retrieve_api_key_inner(), store_api_key(), apply_sampling() (+30 more)

### Community 5 - "Community 5"

Cohesion: 0.06
Nodes (42): listAuditLog(), readFallbackLog(), defaultSend(), LocalSttProvider, recheck(), startDownload(), startMeetingDetectionDaemon(), armPersistedRefreshes() (+34 more)

### Community 6 - "Community 6"

Cohesion: 0.06
Nodes (20): analyzeJobDescription(), handleAnalyze(), handleGenerateCover(), testConnection(), createLiveAnswerProvider(), normalizeGroqModel(), buildEmptyFallback(), buildPrimaryFallback() (+12 more)

### Community 7 - "Community 7"

Cohesion: 0.06
Nodes (28): addManualAction(), executeCard(), exportActionItems(), moveCard(), onDrop(), seedFromSession(), appendAuditEvent(), canUseTauri() (+20 more)

### Community 8 - "Community 8"

Cohesion: 0.04
Nodes (15): AnthropicProvider, dispatchAnthropicTimeout(), CerebrasProvider, dispatchCerebrasTimeout(), handleCompanionScreenshot(), base64ToBytes(), DeepgramSTTProvider, dispatchGroqTimeout() (+7 more)

### Community 9 - "Community 9"

Cohesion: 0.09
Nodes (15): PcmCaptureProcessor, NoopWorker, constructor(), generateOutputFrame(), hasEnoughDataForFrame(), o, stream(), disposeWorker() (+7 more)

### Community 10 - "Community 10"

Cohesion: 0.13
Nodes (5): BrowserTTSProvider, dispatchNetworkTimeout(), ElevenLabsTTSProvider, OpenAITTSProvider, setTTSProvider()

### Community 11 - "Community 11"

Cohesion: 0.14
Nodes (19): handleUnload(), canUseLocalStorage(), canUseTauri(), clearAuditLog(), createEvent(), flushComplianceEventsNow(), flushPending(), hashKey() (+11 more)

### Community 12 - "Community 12"

Cohesion: 0.18
Nodes (15): applyShareGuardProtection(), detectKnownMeetingApplication(), evaluateShareGuard(), handleForceShow(), refreshProtectionState(), refreshSnapshot(), canUseLocalStorage(), canUseWindowEvents() (+7 more)

### Community 13 - "Community 13"

Cohesion: 0.16
Nodes (11): cacheGet(), cacheSet(), classifyWithLLM(), detectQuestion(), detectQuestionDebounced(), isFollowUpQuestion(), classifyQuestions(), buildMarkersFromTranscript() (+3 more)

### Community 14 - "Community 14"

Cohesion: 0.18
Nodes (15): apply_capture_exclusion_to_label(), ExclusionResult, reapply_capture_exclusion_all(), set_capture_excluded(), set_macos_capture_excluded(), set_windows_capture_excluded(), set_windows_toolwindow(), apply_toolwindow_style() (+7 more)

### Community 15 - "Community 15"

Cohesion: 0.29
Nodes (10): check_local_stt_available(), download_whisper_model(), LocalSttResult, model_dir(), model_path(), now_ms(), num_cpus_or_default(), run_inference() (+2 more)

### Community 16 - "Community 16"

Cohesion: 0.15
Nodes (14): App Icon 128x128, App Icon 128x128@2x, App Icon 32x32, App Icon (Main), Square 107x107 Logo, Square 142x142 Logo, Square 150x150 Logo, Square 284x284 Logo (+6 more)

### Community 17 - "Community 17"

Cohesion: 0.22
Nodes (4): getConnectorAdapters(), GoogleMeetConnectorAdapter, resolveFetcher(), ZoomConnectorAdapter

### Community 18 - "Community 18"

Cohesion: 0.22
Nodes (9): defaultSend(), onKeyDown(), handleSubmit(), nextQuestion(), onKey(), prevQuestion(), resetQuestion(), scoreAnswerFallback() (+1 more)

### Community 19 - "Community 19"

Cohesion: 0.24
Nodes (6): handleStartNewSession(), pauseReplay(), resumeReplay(), runDemoReplay(), stopReplayTimer(), stopSessionFlow()

### Community 20 - "Community 20"

Cohesion: 0.2
Nodes (4): makeQueue(), startAudioLevelMonitor(), startLiveCapture(), createSileroVad()

### Community 21 - "Community 21"

Cohesion: 0.17
Nodes (11): ActiveWindowInfo, AudioPipelineStatus, AuditEvent, KnowledgePassage, LlmChunkPayload, LlmResponse, NativeAudioChunk, OcrResult (+3 more)

### Community 22 - "Community 22"

Cohesion: 0.22
Nodes (2): handleNext(), validateProfile()

### Community 23 - "Community 23"

Cohesion: 0.24
Nodes (5): get_vad_threshold_internal(), is_speech(), is_speech_default(), zcr_alternating_sign(), zero_crossing_rate()

### Community 24 - "Community 24"

Cohesion: 0.2
Nodes (10): SQLite Data Model (sessions/segments/customers), External References (project-raven, meetily, natively), Runtime Flow (capture -> transcript -> RAG -> answer), MeetingMind Design Spec, MeetingMind MVP Implementation Plan, Production Base Checklist, Reliability Standards (lint/test/build per commit), meetily (Rust meeting app reference) (+2 more)

### Community 25 - "Community 25"

Cohesion: 0.29
Nodes (2): onDom(), onLevel()

### Community 26 - "Community 26"

Cohesion: 0.36
Nodes (4): deleteKeychain(), keychainKey(), readKeychain(), writeKeychain()

### Community 27 - "Community 27"

Cohesion: 0.29
Nodes (1): tryOpenTauriWindow()

### Community 29 - "Community 29"

Cohesion: 0.29
Nodes (7): Bluesky Icon Symbol, Discord Icon Symbol, Documentation Icon Symbol, GitHub Icon Symbol, Social/People Icon Symbol, UI Icon Sprite Sheet, X (Twitter) Icon Symbol

### Community 30 - "Community 30"

Cohesion: 0.47
Nodes (3): TabsContent(), TabsTrigger(), useTabsContext()

### Community 31 - "Community 31"

Cohesion: 0.4
Nodes (2): escapeHtml(), highlight()

### Community 32 - "Community 32"

Cohesion: 0.4
Nodes (2): avatarStyleForSpeaker(), hashString()

### Community 33 - "Community 33"

Cohesion: 0.4
Nodes (6): React Library, Vite Build Tool, Vite-styled Favicon (Purple Lightning), Hero Image: Stacked Translucent Cubes, React Library Logo, Vite Logo (Parenthesized Lightning)

### Community 35 - "Community 35"

Cohesion: 0.67
Nodes (2): redactPII(), redactPIIDeep()

### Community 37 - "Community 37"

Cohesion: 1.0
Nodes (2): Skeleton(), toSize()

### Community 39 - "Community 39"

Cohesion: 1.0
Nodes (2): sanitizeHTML(), sanitizePlain()

### Community 40 - "Community 40"

Cohesion: 1.0
Nodes (2): analyzeCodingPrompt(), detectTopics()

### Community 41 - "Community 41"

Cohesion: 1.0
Nodes (2): buildResumeProfileContext(), cleanLine()

### Community 42 - "Community 42"

Cohesion: 0.67
Nodes (1): MissingApiKeyError

### Community 43 - "Community 43"

Cohesion: 0.67
Nodes (1): LocalDemoProvider

### Community 46 - "Community 46"

Cohesion: 1.0
Nodes (2): set_click_through(), set_click_through_impl()

### Community 47 - "Community 47"

Cohesion: 0.67
Nodes (3): MVP Evaluation Plan, Eval Metrics: Latency/Grounding/Hallucination, Pass Criteria: <2.5s median latency, 80% grounded, <5% hallucinations

### Community 69 - "Community 69"

Cohesion: 1.0
Nodes (2): E2E Limitations: Tauri APIs not available in webview, E2E Tests (Playwright)

## Knowledge Gaps

- **81 isolated node(s):** `SampleState`, `NativeAudioChunk`, `SessionSummary`, `TranscriptItem`, `AuditEvent` (+76 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (10 nodes): `canAdvance()`, `handleBack()`, `handleNext()`, `persistApiKey()`, `providerHint()`, `providerPlaceholder()`, `setApiKeyInMemory()`, `updateProfile()`, `validateProfile()`, `OnboardingPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (8 nodes): `isStreaming()`, `latencyClass()`, `onDom()`, `onHide()`, `onLevel()`, `onRestore()`, `statusDotFor()`, `OverlayWindow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (7 nodes): `handler()`, `listenForTrayNavigation()`, `resolveRouteMeta()`, `sessionModeLabel()`, `sessionModeToStatus()`, `tryOpenTauriWindow()`, `DashboardWindow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (6 nodes): `buildAltApproach()`, `buildLineExplanations()`, `escapeHtml()`, `handleCopy()`, `highlight()`, `SolutionCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (6 nodes): `TranscriptFeed.tsx`, `avatarStyleForSpeaker()`, `formatTime()`, `hashString()`, `onScroll()`, `speakerInitial()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (4 nodes): `luhnValid()`, `redactPII()`, `redactPIIDeep()`, `piiRedactor.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (3 nodes): `Skeleton()`, `toSize()`, `Skeleton.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (3 nodes): `sanitizeHTML()`, `sanitizePlain()`, `sanitize.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `analyzeCodingPrompt()`, `detectTopics()`, `codingAssistant.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (3 nodes): `buildResumeProfileContext()`, `cleanLine()`, `resumeProfile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (3 nodes): `MissingApiKeyError`, `.constructor()`, `contracts.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (3 nodes): `LocalDemoProvider`, `.complete()`, `localDemoProvider.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (3 nodes): `set_click_through()`, `set_click_through_impl()`, `click_through.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (2 nodes): `E2E Limitations: Tauri APIs not available in webview`, `E2E Tests (Playwright)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `show()` connect `Community 2` to `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 14`?**
  _High betweenness centrality (0.140) - this node is a cross-community bridge._
- **Why does `startLiveCapture()` connect `Community 20` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `testConnection()` connect `Community 6` to `Community 2`, `Community 5`, `Community 22`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `show()` (e.g. with `executeCard()` and `addManualAction()`) actually correct?**
  _`show()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `emit()` (e.g. with `capture_screen_region()` and `call_llm()`) actually correct?**
  _`emit()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `SampleState`, `NativeAudioChunk`, `SessionSummary` to the rest of the system?**
  _81 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
