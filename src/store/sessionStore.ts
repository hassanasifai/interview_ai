import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { composeAnswer } from '../lib/copilot/answerComposer';
import { buildResumeProfileContext } from '../lib/copilot/resumeProfile';
import { extractMeetingMemory } from '../lib/copilot/memoryExtractor';
import { detectQuestionDebounced } from '../lib/copilot/questionDetector';
import { GroqSTTProvider } from '../lib/providers/sttProvider';
import { MissingApiKeyError } from '../lib/providers/contracts';
import { summarizeMeeting } from '../lib/copilot/summarizer';
import {
  createLiveAnswerProvider,
  getProviderForQuestionType,
} from '../lib/providers/providerFactory';
import { createKnowledgeRepository } from '../lib/rag/knowledgeRepository';
import { appendAuditEvent } from '../lib/runtime/auditEvents';
import { ShareGuard, type SharingState } from '../lib/runtime/shareGuard';
import { startLiveCapture } from '../lib/runtime/liveCaptureOrchestrator';
import {
  getNativeAudioPipelineStatus,
  persistSessionSummary,
  startNativeAudioPipeline,
  stopNativeAudioPipeline,
  type AudioPipelineStatus,
} from '../lib/tauri';
import { useOverlayStore } from './overlayStore';
import { useSettingsStore } from './settingsStore';
import { logger } from '../lib/logger';

export type TranscriptSpeaker = 'customer' | 'user' | 'system';

export type TranscriptItem = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: number;
};

export type SessionMode = 'stopped' | 'running' | 'paused';

export type PostCallReport = {
  summary: string;
  actionItems: string[];
  followUpEmail: string;
  crmNotes: string;
  generatedAt: string;
};

let activeLiveCapture: { stop: () => void } | null = null;
const shareGuardRuntime = new ShareGuard();
const CAPTURE_EXCLUDED_LABEL = 'capture-excluded-overlay';

function mapShareModeToSharingState(
  shareMode: ReturnType<typeof useSettingsStore.getState>['shareMode'],
): SharingState {
  if (shareMode === 'entire-screen') {
    return 'entire-screen';
  }

  if (shareMode === 'browser-tab') {
    return 'browser-tab';
  }

  if (shareMode === 'window-only') {
    return 'window';
  }

  return 'none';
}

async function evaluateShareGuardForSurface(surface: SharingState) {
  try {
    const decision = await shareGuardRuntime.evaluate(surface);

    if (decision.action === 'show-excluded') {
      await invoke('toggle_overlay', { label: CAPTURE_EXCLUDED_LABEL, visible: true });
      appendAuditEvent('capture_exclusion_activated', {
        surface,
        reason: decision.reason,
      });
      return decision;
    }

    if (decision.action === 'hide-fallback') {
      await invoke('toggle_overlay', { label: CAPTURE_EXCLUDED_LABEL, visible: false });
      appendAuditEvent('capture_exclusion_activation_failed', {
        surface,
        reason: decision.reason,
      });
      appendAuditEvent('capture_exclusion_fallback_hidden', {
        surface,
        reason: decision.reason,
      });
      return decision;
    }

    return decision;
  } catch (error) {
    await invoke('toggle_overlay', { label: CAPTURE_EXCLUDED_LABEL, visible: false }).catch(
      () => undefined,
    );
    appendAuditEvent('capture_exclusion_activation_failed', {
      surface,
      reason: error instanceof Error ? error.message : 'unknown error',
    });
    appendAuditEvent('capture_exclusion_fallback_hidden', {
      surface,
      reason: 'Exception during ShareGuard evaluation; overlay hidden as fallback.',
    });

    return {
      action: 'hide-fallback' as const,
      reason: 'ShareGuard evaluation failed; fallback hide applied.',
      exclusionActive: false,
    };
  }
}

async function cleanupShareGuard() {
  try {
    await shareGuardRuntime.onSessionEnd();
    appendAuditEvent('capture_exclusion_removed', {
      reason: 'Session ended and capture exclusion was removed.',
    });
  } catch (error) {
    appendAuditEvent('capture_exclusion_activation_failed', {
      reason: error instanceof Error ? error.message : 'Failed to remove capture exclusion',
    });
  }
}

function buildPostCallReport(transcript: TranscriptItem[]) {
  const profile = useSettingsStore.getState().profile;
  const memory = extractMeetingMemory(transcript);
  const summary = summarizeMeeting({
    customerName: 'Demo customer',
    transcript,
    durationMinutes: Math.max(1, Math.ceil(transcript.length / 2)),
    userName: profile.userName || 'Host',
    userRole: profile.userRole || 'Meeting lead',
  });

  const actionItems = summary.actionItems.map((item) => item.text);
  const openQuestions = memory.openQuestions.join(' | ');
  const followUpEmail = [
    'Thanks for the conversation today.',
    `Summary: ${summary.executiveSummary}`,
    `Next steps: ${actionItems.length > 0 ? actionItems.join(' | ') : 'No action items recorded.'}`,
    openQuestions ? `Open questions: ${openQuestions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const crmNotes = [
    `Topics: ${summary.keyDiscussionPoints.join(', ')}`,
    `Customer concerns: ${summary.customerConcerns.join(' | ') || 'None captured'}`,
    `Next steps: ${summary.agreedNextSteps.join(' | ') || 'No explicit asks'}`,
  ].join('\n');

  return {
    summary: summary.executiveSummary,
    actionItems,
    followUpEmail,
    crmNotes,
    generatedAt: new Date().toISOString(),
  };
}

type SessionState = {
  isActive: boolean;
  mode: SessionMode;
  researchMode: boolean;
  providerStatus: 'ready' | 'demo-mode' | 'error';
  liveCaptureStatus: 'idle' | 'starting' | 'running' | 'error';
  nativeAudioStatus: AudioPipelineStatus | null;
  lastError: string | null;
  isGenerating: boolean;
  totalQuestionsDetected: number;
  totalAnswersGenerated: number;
  lastAnswerLatencyMs: number | null;
  averageAnswerLatencyMs: number | null;
  transcript: TranscriptItem[];
  rollingWindow: TranscriptItem[];
  report: PostCallReport | null;
  guardedOverlayVisible: boolean;
  sessionId: string | null;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  startSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  endSession: () => void;
  toggleShortcutWithShareGuard: () => Promise<void>;
  toggleResearchMode: () => void;
  appendTranscript: (item: TranscriptItem) => void;
  ingestTranscript: (item: TranscriptItem) => Promise<void>;
  startLiveCaptureSession: (includeSystemAudio: boolean) => Promise<void>;
  stopLiveCaptureSession: () => Promise<void>;
  refreshNativeAudioStatus: () => Promise<void>;
  clearError: () => void;
  appendConversationTurn: (role: 'user' | 'assistant', content: string) => void;
  clearConversationHistory: () => void;
};

// ── rAF-batched transcript flush (caps store updates at ~60/sec) ─────────────
const _pendingTranscriptItems: TranscriptItem[] = [];
let _rafScheduled = false;

function _flushTranscriptBatch() {
  _rafScheduled = false;
  const items = _pendingTranscriptItems.splice(0);
  if (items.length === 0) return;
  useSessionStore.setState((state) => {
    const transcript = [...state.transcript, ...items];
    const rollingWindow = [...state.rollingWindow, ...items].slice(-3);
    return { transcript, rollingWindow };
  });
  // D1/Gap 11 fix: persist on every rAF flush. The rAF cadence (~60/s)
  // is the correct batching granularity — SQLite handles that comfortably,
  // and a crash now loses at most one frame's worth of items instead of
  // the prior 500ms debounce window.
  scheduleTranscriptPersist(items);
}

function scheduleTranscriptFlush(item: TranscriptItem) {
  _pendingTranscriptItems.push(item);
  if (!_rafScheduled) {
    _rafScheduled = true;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(_flushTranscriptBatch);
    } else {
      // Fallback for environments without rAF (e.g. tests).
      setTimeout(_flushTranscriptBatch, 16);
    }
  }
}

// ── SQLite transcript persistence (per rAF flush, no extra debounce) ─────────
//
// D1/Gap 11: persist every rAF batch immediately. The rAF caller is already
// throttled to ~60/s and items are coalesced per frame — that is the correct
// batching granularity. Removing the prior 500ms debounce shrinks the
// crash-loss window from ~500ms to ~16ms.
//
// In-flight requests are tracked so a renderer crash doesn't leave dangling
// promises; on persist failure we fall back to localStorage as a write-ahead
// log so the next session-resume can replay them.
const _persistFailureBuffer: TranscriptItem[] = [];
const PERSIST_FAILURE_LS_KEY = 'mm.transcript.pending_persist';

function scheduleTranscriptPersist(items: TranscriptItem[]) {
  if (items.length === 0) return;
  const state = useSessionStore.getState();
  if (!state.sessionId) return;
  const sessionId = state.sessionId;
  invoke('upsert_transcript_items_batch', { sessionId, items }).catch((err) => {
    logger.warn('sessionStore', 'transcript persist failed', { err: String(err) });
    // Buffer to localStorage so a successful follow-up can flush both
    // pending and historical items. This is the write-ahead log called
    // out in AUDIT §19/D1.
    _persistFailureBuffer.push(...items);
    try {
      const existing = localStorage.getItem(PERSIST_FAILURE_LS_KEY);
      const prior: TranscriptItem[] = existing ? (JSON.parse(existing) as TranscriptItem[]) : [];
      const merged = [...prior, ...items].slice(-500); // cap at 500 to bound storage
      localStorage.setItem(PERSIST_FAILURE_LS_KEY, JSON.stringify(merged));
    } catch (lsErr) {
      logger.debug('sessionStore', 'localStorage WAL write failed', { err: String(lsErr) });
    }
    try {
      window.dispatchEvent(
        new CustomEvent('mm:persist-error', { detail: { reason: String(err) } }),
      );
    } catch (dispatchErr) {
      logger.debug('sessionStore', 'persist-error dispatch failed', {
        err: String(dispatchErr),
      });
    }
  });
}

/** Replay any items captured in the WAL buffer the last time persist failed. */
export function replayPendingTranscriptPersist(): void {
  let pending: TranscriptItem[] = [];
  try {
    const existing = localStorage.getItem(PERSIST_FAILURE_LS_KEY);
    if (existing) pending = JSON.parse(existing) as TranscriptItem[];
  } catch {
    /* corrupt WAL — drop it */
    try {
      localStorage.removeItem(PERSIST_FAILURE_LS_KEY);
    } catch {
      /* noop */
    }
    return;
  }
  if (pending.length === 0) return;
  const state = useSessionStore.getState();
  if (!state.sessionId) return;
  invoke('upsert_transcript_items_batch', {
    sessionId: state.sessionId,
    items: pending,
  })
    .then(() => {
      try {
        localStorage.removeItem(PERSIST_FAILURE_LS_KEY);
      } catch {
        /* noop */
      }
      _persistFailureBuffer.length = 0;
    })
    .catch(() => {
      /* keep WAL for next attempt */
    });
}

export const useSessionStore = create<SessionState>((set) => ({
  isActive: false,
  mode: 'stopped',
  researchMode: false,
  providerStatus: 'ready',
  liveCaptureStatus: 'idle',
  nativeAudioStatus: null,
  lastError: null,
  isGenerating: false,
  totalQuestionsDetected: 0,
  totalAnswersGenerated: 0,
  lastAnswerLatencyMs: null,
  averageAnswerLatencyMs: null,
  transcript: [],
  rollingWindow: [],
  report: null,
  guardedOverlayVisible: false,
  sessionId: null,
  conversationHistory: [],
  appendConversationTurn: (role, content) =>
    set((state) => {
      const updated = [...state.conversationHistory, { role, content }];
      return {
        conversationHistory: updated.length > 20 ? updated.slice(updated.length - 20) : updated,
      };
    }),
  clearConversationHistory: () => set({ conversationHistory: [] }),
  startSession: () => {
    const consentAccepted = useSettingsStore.getState().consentAccepted;

    if (!consentAccepted) {
      useOverlayStore.getState().setStatus('Consent required before starting');
      set({
        lastError:
          'Accept the consent reminder in onboarding or settings before starting a session.',
      });
      return;
    }

    useOverlayStore.getState().clearSuggestion();
    useOverlayStore.getState().setStatus('Session running');
    appendAuditEvent('session_started', { mode: 'demo' });
    // I7: clear conversationHistory at start to guard against crash-recovery
    //     where endSession was never called and stale turns linger.
    set({
      isActive: true,
      mode: 'running',
      transcript: [],
      rollingWindow: [],
      report: null,
      lastError: null,
      providerStatus: useSettingsStore.getState().groqApiKey.trim().startsWith('gsk_')
        ? 'ready'
        : 'demo-mode',
      isGenerating: false,
      totalQuestionsDetected: 0,
      totalAnswersGenerated: 0,
      lastAnswerLatencyMs: null,
      averageAnswerLatencyMs: null,
      sessionId: crypto.randomUUID(),
      conversationHistory: [],
    });

    const shareSurface = mapShareModeToSharingState(useSettingsStore.getState().shareMode);
    evaluateShareGuardForSurface(shareSurface)
      .then((decision) => {
        if (decision.action === 'show-excluded') {
          set({ guardedOverlayVisible: true });
          useOverlayStore.getState().setStatus('Capture-excluded overlay active');
        }

        if (decision.action === 'hide-fallback') {
          set({ guardedOverlayVisible: false });
          useOverlayStore.getState().setStatus('Overlay hidden by ShareGuard fallback');
        }
      })
      .catch((err) => {
        logger.warn('sessionStore', 'shareGuard evaluation rejected', { err: String(err) });
      });
  },
  pauseSession: () => {
    useOverlayStore.getState().setStatus('Session paused');
    appendAuditEvent('session_paused', {});
    set({ mode: 'paused' });
  },
  resumeSession: () => {
    useOverlayStore.getState().setStatus('Session running');
    appendAuditEvent('session_resumed', {});
    set({ mode: 'running' });
  },
  appendTranscript: (item) => {
    // Delegate to the rAF-batched path so direct callers also benefit.
    scheduleTranscriptFlush(item);
  },
  ingestTranscript: async (item) => {
    const state = useSessionStore.getState();

    if (state.mode !== 'running') {
      return;
    }

    state.appendTranscript(item);
    appendAuditEvent('transcript_ingested', {
      speaker: item.speaker,
      textLength: item.text.length,
    });

    // Question source rule: in a real interview the interviewer arrives over the
    // system-audio (`customer`) channel; in solo / practice mode there's no
    // interviewer feed and the user's own mic is the question source. Fall
    // through to detection on user speech only when no customer line has ever
    // been ingested in this session.
    if (item.speaker !== 'customer') {
      const hasCustomerSpeech = state.transcript.some((t) => t.speaker === 'customer');
      if (hasCustomerSpeech) {
        return;
      }
    }

    // Wait until the rAF batch flushes so the store has the latest transcript,
    // then run the debounced (150 ms) classifier.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 16);
      }
    });

    const currentState = useSessionStore.getState();

    // Gap 15 fix: parallelize question detection and RAG retrieval. Both
    // consume the same transcript window, so we can fire the (semantic)
    // knowledge-base search against the raw transcript tail while the
    // classifier runs. Worst case: detection returns isQuestion=false and
    // we discard the RAG result. The win is that for true questions we
    // pay the max(detection, rag) wall-clock instead of sum.
    const knowledgeRepository = createKnowledgeRepository();
    const lastTranscriptText = currentState.transcript
      .slice(-3)
      .map((t) => t.text)
      .join(' ')
      .slice(0, 600);
    const [detection, parallelRelevant] = await Promise.all([
      detectQuestionDebounced(currentState.transcript),
      lastTranscriptText
        ? knowledgeRepository.searchRelevant(lastTranscriptText, 4).catch(() => [])
        : Promise.resolve([]),
    ]);

    if (!detection.isQuestion) {
      return;
    }

    if (currentState.isGenerating) {
      useOverlayStore.getState().setStatus('Answer already generating');
      return;
    }

    set((prev) => ({
      isGenerating: true,
      totalQuestionsDetected: prev.totalQuestionsDetected + 1,
    }));

    const generationStartedAt = performance.now();

    // If the parallel pre-fetch already saw enough overlap with the detected
    // question text we reuse it (saves a second embedding pass). Otherwise
    // fall back to a focused query against the canonical question text.
    const reuseParallel =
      parallelRelevant.length >= 2 &&
      lastTranscriptText.toLowerCase().includes(detection.questionText.slice(0, 24).toLowerCase());
    const relevant = reuseParallel
      ? parallelRelevant
      : await knowledgeRepository.searchRelevant(detection.questionText, 4);
    const ragChunks = relevant.map((match) => `${match.documentName}: ${match.chunk}`);

    if (ragChunks.length === 0) {
      useOverlayStore.getState().setStatus('Low support in knowledge base');
    } else {
      useOverlayStore.getState().setStatus('Generating grounded suggestion');
    }

    const settings = useSettingsStore.getState();
    const routedProvider = getProviderForQuestionType(detection.questionType ?? 'other', {
      groq: !!settings.groqApiKey,
      openai: !!settings.openAiApiKey,
      anthropic: !!settings.anthropicApiKey,
      cerebras: !!(settings as { cerebrasApiKey?: string }).cerebrasApiKey,
    }) as typeof settings.selectedProvider;
    const resolvedProvider = routedProvider ?? settings.selectedProvider;
    const activeApiKey =
      resolvedProvider === 'openai'
        ? settings.openAiApiKey
        : resolvedProvider === 'anthropic'
          ? settings.anthropicApiKey
          : settings.groqApiKey;
    const provider = createLiveAnswerProvider(
      resolvedProvider,
      activeApiKey,
      settings.providerModel,
    );
    const resumeChunks = settings.enableResumeGrounding
      ? knowledgeRepository
          .listDocumentsByKind('resume')
          .flatMap((document) => knowledgeRepository.getChunks(document.id))
          .slice(0, 12)
      : [];
    const profileContext = buildResumeProfileContext(resumeChunks);

    try {
      const answer = await composeAnswer({
        provider,
        question: detection,
        conversationWindow: currentState.rollingWindow,
        ragChunks,
        profileContext,
        extraInstructions: settings.extraInstructions,
        profile: settings.profile,
      });

      useOverlayStore.getState().setSuggestion({
        question: {
          text: detection.questionText,
          type: detection.questionType,
        },
        oneLiner: answer.answer,
        answerBullets: answer.bullets,
        confidence: answer.confidence,
        supportSnippets: answer.sources,
        suggestedFollowup:
          detection.questionType === 'objection'
            ? 'What outcome matters most for your team this quarter?'
            : 'Would a short follow-up summary help after this call?',
        redFlags:
          answer.confidence < 0.55 ? ['Confidence is low. Use clarification-first wording.'] : [],
      });

      const latencyMs = Math.round(performance.now() - generationStartedAt);

      set((prev) => {
        const previousCount = prev.totalAnswersGenerated;
        const previousAverage = prev.averageAnswerLatencyMs ?? 0;
        const nextAverage =
          previousCount === 0
            ? latencyMs
            : Math.round((previousAverage * previousCount + latencyMs) / (previousCount + 1));

        return {
          providerStatus: settings.groqApiKey.trim().startsWith('gsk_') ? 'ready' : 'demo-mode',
          lastError: null,
          isGenerating: false,
          totalAnswersGenerated: previousCount + 1,
          lastAnswerLatencyMs: latencyMs,
          averageAnswerLatencyMs: nextAverage,
        };
      });
      appendAuditEvent('answer_generated', {
        confidence: Number(answer.confidence.toFixed(2)),
        sources: answer.sources.length,
      });
    } catch (err) {
      logger.warn('sessionStore', 'answer generation failed', { err: String(err) });
      useOverlayStore.getState().setStatus('Answer generation failed');
      appendAuditEvent('answer_generation_failed', {
        provider: 'live-answer',
      });
      set({
        providerStatus: 'error',
        lastError: 'Unable to generate answer card right now.',
        isGenerating: false,
      });
    }
  },
  startLiveCaptureSession: async (includeSystemAudio) => {
    const state = useSessionStore.getState();

    if (!state.isActive) {
      state.startSession();
    }

    if (!useSessionStore.getState().isActive) {
      return;
    }

    const settings = useSettingsStore.getState();
    if (!settings.groqApiKey.trim().startsWith('gsk_')) {
      set({
        liveCaptureStatus: 'error',
        lastError:
          'Groq API key required. Open Settings → Providers and paste a key from console.groq.com.',
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mm:keychain-error', { detail: { provider: 'groq', op: 'missing' } }),
        );
      }
      useOverlayStore.getState().setStatus('Add Groq API key to start live capture');
      throw new MissingApiKeyError('groq');
    }

    set({ liveCaptureStatus: 'starting', lastError: null });

    try {
      const micSttProvider = new GroqSTTProvider(settings.groqApiKey);
      const systemSttProvider = new GroqSTTProvider(settings.groqApiKey);

      await startNativeAudioPipeline(16_000, 1);
      const nativeStatus = await getNativeAudioPipelineStatus();

      activeLiveCapture = await startLiveCapture({
        includeMicrophone: true,
        includeSystemAudio,
        micSttProvider,
        systemSttProvider,
        language: settings.sttLanguage || 'en',
        onTranscript: async (item) => {
          // F28/F52: await ingestTranscript so back-pressure from question
          //          detection / answer generation propagates to the capture
          //          loop and we don't drop ordering guarantees.
          await useSessionStore.getState().ingestTranscript(item);
        },
      });

      set({
        liveCaptureStatus: 'running',
        nativeAudioStatus: nativeStatus,
      });
      useOverlayStore.getState().setStatus('Live capture running');
    } catch (err) {
      logger.warn('sessionStore', 'live capture failed to start', { err: String(err) });
      set({
        liveCaptureStatus: 'error',
        lastError: 'Unable to start live capture in current environment.',
      });
      useOverlayStore.getState().setStatus('Live capture failed to start');
    }
  },
  stopLiveCaptureSession: async () => {
    if (activeLiveCapture) {
      activeLiveCapture.stop();
      activeLiveCapture = null;
    }

    const nativeStatus = await stopNativeAudioPipeline();
    set({
      liveCaptureStatus: 'idle',
      nativeAudioStatus: nativeStatus,
    });
    useOverlayStore.getState().setStatus('Live capture stopped');
  },
  refreshNativeAudioStatus: async () => {
    const status = await getNativeAudioPipelineStatus();
    set({ nativeAudioStatus: status });
  },
  toggleResearchMode: () =>
    set((state) => {
      const next = !state.researchMode;
      useOverlayStore
        .getState()
        .setStatus(next ? 'Research mode enabled (manual use)' : 'Research mode disabled');

      return {
        researchMode: next,
      };
    }),
  endSession: () => {
    const state = useSessionStore.getState();
    const report = buildPostCallReport(state.transcript);
    const now = new Date();
    const sessionId = `session-${now.getTime()}`;

    persistSessionSummary({
      id: sessionId,
      customerName: 'Demo customer',
      title: 'Live support session',
      durationMinutes: Math.max(1, Math.ceil(state.transcript.length / 2)),
      summary: report.summary,
    }).catch(() => {
      set({ lastError: 'Session ended, but persistence failed in current runtime.' });
    });

    useOverlayStore.getState().setStatus('Session ended');
    appendAuditEvent('session_ended', {
      transcriptItems: state.transcript.length,
      actionItems: report.actionItems.length,
    });
    useSessionStore.getState().clearConversationHistory();
    set({
      isActive: false,
      mode: 'stopped',
      report,
      guardedOverlayVisible: false,
      sessionId: null,
    });

    cleanupShareGuard().catch((err) => {
      logger.warn('sessionStore', 'cleanupShareGuard failed', { err: String(err) });
    });
  },
  toggleShortcutWithShareGuard: async () => {
    const state = useSessionStore.getState();

    if (state.guardedOverlayVisible) {
      await invoke('toggle_overlay', { label: CAPTURE_EXCLUDED_LABEL, visible: false }).catch(
        () => undefined,
      );
      set({ guardedOverlayVisible: false });
      return;
    }

    const shareSurface = mapShareModeToSharingState(useSettingsStore.getState().shareMode);
    const decision = await evaluateShareGuardForSurface(shareSurface);

    if (decision.action === 'show-excluded') {
      set({ guardedOverlayVisible: true });
      useOverlayStore.getState().setStatus('Capture-excluded overlay visible');
      return;
    }

    if (decision.action === 'show-normal') {
      await invoke('toggle_overlay', { label: CAPTURE_EXCLUDED_LABEL, visible: true }).catch(
        () => undefined,
      );
      set({ guardedOverlayVisible: true });
      useOverlayStore.getState().setStatus('Overlay visible (normal mode)');
      return;
    }

    await invoke('toggle_overlay', { label: CAPTURE_EXCLUDED_LABEL, visible: false }).catch(
      () => undefined,
    );
    set({ guardedOverlayVisible: false });
    useOverlayStore.getState().setStatus('Overlay hidden by safety fallback');
  },
  clearError: () => set({ lastError: null }),
}));

// ── Selector hooks (I1, I2, I3, I21, I22) ────────────────────────────────────
// Consumers should prefer these over `useSessionStore()` whole-store reads to
// minimise re-renders. Other agents (2E/2F) will swap their components over.
export const useSessionTranscript = () => useSessionStore((s) => s.transcript);
export const useSessionMode = () => useSessionStore((s) => s.mode);
export const useSessionIsActive = () => useSessionStore((s) => s.isActive);
export const useSessionStatus = () => {
  const mode = useSessionStore((s) => s.mode);
  const isActive = useSessionStore((s) => s.isActive);
  const isGenerating = useSessionStore((s) => s.isGenerating);
  return { mode, isActive, isGenerating };
};
export const useSessionLatency = () => {
  const last = useSessionStore((s) => s.lastAnswerLatencyMs);
  const avg = useSessionStore((s) => s.averageAnswerLatencyMs);
  return { last, avg };
};
export const useSessionRollingWindow = () => useSessionStore((s) => s.rollingWindow);
export const useSessionReport = () => useSessionStore((s) => s.report);
export const useNativeAudioStatus = () => useSessionStore((s) => s.nativeAudioStatus);
