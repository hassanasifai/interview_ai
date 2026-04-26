import './overlay.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  Camera,
  ChevronDown,
  ChevronUp,
  Copy,
  HelpCircle,
  Lock,
  Mic,
  MinusSquare,
  Pin,
  PinOff,
  RotateCw,
  Settings,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  Badge,
  IconButton,
  KeyHint,
  ScrollArea,
  Spinner,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '../../components/ui';
import type { StatusDotStatus } from '../../components/ui';
import { cn } from '../../lib/cn';
import { logger } from '../../lib/logger';
import type { AIChatOverlayHandle } from './AIChatOverlay';
import { ChatPanel } from './ChatPanel';
import { QuestionCard } from './QuestionCard';
import { SolutionCard } from './SolutionCard';
import { TranscriptFeed } from './TranscriptFeed';
import { useDraggable } from './useDraggable';
import { evaluateShareGuard } from '../../lib/runtime/shareGuard';
import {
  enforceShareGuardResult,
  readAutoHiddenState,
  SHARE_GUARD_HIDE_EVENT,
  SHARE_GUARD_RESTORE_EVENT,
} from '../../lib/runtime/shareGuardState';
import { solveCodingProblem } from '../../lib/copilot/codingSolver';
import {
  captureScreenRegion,
  listenTauriEvent,
  runOcrOnImage,
  setClickThrough,
} from '../../lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useOverlayStore } from '../../store/overlayStore';
import { useSessionStore } from '../../store/sessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { createLiveAnswerProvider } from '../../lib/providers/providerFactory';

type OverlayTab = 'answer' | 'chat' | 'transcript';

const SHARE_GUARD_REVIEW_EVENT = 'meetingmind:share-guard-review';

// LOW 22 fix: read from the shared hotkey catalog instead of redefining
// here. We keep the local name `HOTKEY_ROWS` for callers below, plus a
// non-catalog "Command palette" Ctrl+K row that's only meaningful in the
// overlay UI (it doesn't fire a global shortcut, so it stays inline).
import { HOTKEY_ROWS as SHARED_HOTKEY_ROWS } from '../../lib/hotkeyCatalog';
const HOTKEY_ROWS: Array<{ label: string; keys: string[] }> = [
  ...SHARED_HOTKEY_ROWS.dashboard.map((row) => ({ label: row.label, keys: row.keys })),
  { label: 'Command palette', keys: ['Ctrl', 'K'] },
];

// Chips shown inline in the command bar (most used shortcuts)
const BAR_CHIPS: Array<{ tip: string; keys: string[] }> = [
  { tip: 'Toggle click-through', keys: ['Ctrl', 'Shift', 'T'] },
  { tip: 'Screenshot + solve', keys: ['Ctrl', 'Shift', 'S'] },
  { tip: 'Generate answer', keys: ['Ctrl', 'Shift', 'Enter'] },
  { tip: 'Next suggestion', keys: ['Ctrl', 'Shift', 'N'] },
  { tip: 'Dismiss', keys: ['Escape'] },
];

function statusDotFor(statusLabel: string): StatusDotStatus {
  const lower = statusLabel.toLowerCase();
  if (lower.includes('error') || lower.includes('fail')) return 'danger';
  if (lower.includes('generating') || lower.includes('solving') || lower.includes('running'))
    return 'info';
  if (
    lower.includes('ready') ||
    lower.includes('solution ready') ||
    lower.includes('suggestion ready')
  )
    return 'ok';
  if (lower.includes('paused') || lower.includes('low')) return 'warn';
  return 'neutral';
}

function isStreaming(statusLabel: string): boolean {
  const lower = statusLabel.toLowerCase();
  return (
    lower.includes('generating') ||
    lower.includes('solving') ||
    lower.includes('running ocr') ||
    lower.includes('capturing')
  );
}

function latencyClass(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 800) return 'overlay-latency--fast';
  if (ms < 2000) return 'overlay-latency--mid';
  return 'overlay-latency--slow';
}

export function OverlayWindow() {
  // ── Existing stores & state (preserved) ──────────────────────────────────
  const [isAutoHidden, setIsAutoHidden] = useState(readAutoHiddenState);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const answerScrollRef = useRef<HTMLDivElement>(null);

  const transcript = useSessionStore((s) => s.rollingWindow);
  const mode = useSessionStore((s) => s.mode);
  const lastLatencyMs = useSessionStore((s) => s.lastAnswerLatencyMs);
  const suggestion = useOverlayStore((s) => s.currentSuggestion);
  const solution = useOverlayStore((s) => s.currentSolution);
  const statusLabel = useOverlayStore((s) => s.statusLabel);
  const isClickThrough = useOverlayStore((s) => s.isClickThrough);
  const { toggleClickThrough, setSolution, setStatus } = useOverlayStore();

  const {
    autoHideOnFullScreenShare,
    hasSecondScreen,
    preferSecondScreen,
    shareMode,
    selectedProvider,
    groqApiKey,
    openAiApiKey,
    anthropicApiKey,
    providerModel,
  } = useSettingsStore();

  const shareGuard = useMemo(
    () =>
      evaluateShareGuard({
        shareMode,
        autoHideOnFullScreenShare,
        preferSecondScreen,
        hasSecondScreen,
      }),
    [autoHideOnFullScreenShare, hasSecondScreen, preferSecondScreen, shareMode],
  );

  // ── New UI state ────────────────────────────────────────────────────────
  const [tab, setTab] = useState<OverlayTab>('answer');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [transcriptUnread, setTranscriptUnread] = useState(0);
  const [audioActive, setAudioActive] = useState(false);

  // Live audio level — turns the listening bars on only when sound is actually heard.
  // Listens via BOTH DOM (same-window) and Tauri (cross-window) since the
  // orchestrator runs in the dashboard window but bars are in the overlay window.
  useEffect(() => {
    let lastActiveAt = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let unlistenTauri: (() => void) | null = null;

    function onLevel(level: number) {
      if (level > 0.02) {
        lastActiveAt = Date.now();
        setAudioActive(true);
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (Date.now() - lastActiveAt >= 250) setAudioActive(false);
        }, 300);
      }
    }

    function onDom(e: Event) {
      onLevel((e as CustomEvent<{ level: number }>).detail.level);
    }

    window.addEventListener('mm:audio-level', onDom);
    listenTauriEvent<{ level: number }>('mm:audio-level', (payload) => {
      onLevel(payload.level);
    })
      .then((u) => {
        unlistenTauri = u;
      })
      .catch(() => undefined);

    return () => {
      window.removeEventListener('mm:audio-level', onDom);
      if (idleTimer) clearTimeout(idleTimer);
      unlistenTauri?.();
    };
  }, []);

  const shellRef = useRef<HTMLDivElement>(null);
  const chatHandleRef = useRef<AIChatOverlayHandle>(null);
  const askCoachFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (askCoachFocusTimerRef.current) {
        clearTimeout(askCoachFocusTimerRef.current);
        askCoachFocusTimerRef.current = null;
      }
    },
    [],
  );

  const { position, onPointerDownHandle } = useDraggable(shellRef);

  // ── Share Guard (preserved) ─────────────────────────────────────────────
  useEffect(() => {
    const state = enforceShareGuardResult(shareGuard);
    const id = window.setTimeout(() => {
      setIsAutoHidden(state.autoHidden);
      if (state.toastMessage) setToastMessage(state.toastMessage);
    }, 0);
    return () => window.clearTimeout(id);
  }, [shareGuard]);

  useEffect(() => {
    function onHide(e: Event) {
      const detail = (e as CustomEvent<{ toastMessage: string | null }>).detail;
      setIsAutoHidden(true);
      setToastMessage(detail.toastMessage);
    }
    function onRestore() {
      setIsAutoHidden(false);
      setToastMessage(null);
    }
    window.addEventListener(SHARE_GUARD_HIDE_EVENT, onHide);
    window.addEventListener(SHARE_GUARD_RESTORE_EVENT, onRestore);
    return () => {
      window.removeEventListener(SHARE_GUARD_HIDE_EVENT, onHide);
      window.removeEventListener(SHARE_GUARD_RESTORE_EVENT, onRestore);
    };
  }, []);

  // ── Click-through sync with OS (preserved) ─────────────────────────────
  useEffect(() => {
    setClickThrough('overlay', isClickThrough).catch((err) => {
      logger.warn('overlay', 'setClickThrough failed', { err: String(err) });
    });
  }, [isClickThrough]);

  // ── Hotkey: screenshot + solve (Ctrl+Shift+S) (preserved) ──────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const activeKey =
      selectedProvider === 'openai'
        ? openAiApiKey
        : selectedProvider === 'anthropic'
          ? anthropicApiKey
          : groqApiKey;

    const runScreenshotSolve = async () => {
      if (isSolving) return;
      setIsSolving(true);
      setStatus('Capturing screen...');
      try {
        const capture = await captureScreenRegion(0, 0, 0, 0);
        if (!capture.imageBase64) {
          setStatus('Screen capture failed');
          return;
        }
        setStatus('Running OCR...');
        const ocr = await runOcrOnImage(capture.imageBase64);
        if (!ocr.text.trim()) {
          setStatus('No text found on screen');
          return;
        }
        setStatus('Solving...');
        const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
        const sol = await solveCodingProblem(ocr.text, provider);
        setSolution(sol);
        setStatus('Solution ready');
      } catch (e) {
        setStatus('Solve failed');
        logger.error('overlay', 'screenshot solve hotkey failed', { err: String(e) });
      } finally {
        setIsSolving(false);
      }
    };
    listenTauriEvent<void>('hotkey_screenshot_solve', () => {
      void runScreenshotSolve();
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_screenshot_solve listener failed', { err: String(err) });
      });

    return () => unlisten?.();
  }, [
    selectedProvider,
    groqApiKey,
    openAiApiKey,
    anthropicApiKey,
    providerModel,
    isSolving,
    setSolution,
    setStatus,
  ]);

  // ── Hotkey: copy answer (Ctrl+Shift+C) (preserved) ─────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_copy_answer', () => {
      const text = suggestion
        ? [suggestion.oneLiner, ...suggestion.answerBullets].join('\n')
        : solution
          ? [solution.approach, ...solution.pseudocode, solution.code].join('\n')
          : '';
      if (text) {
        navigator.clipboard.writeText(text).catch((err) => {
          logger.warn('overlay', 'copy answer hotkey clipboard failed', { err: String(err) });
        });
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_copy_answer listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, [suggestion, solution]);

  // ── Hotkey: scroll answers (Ctrl+Shift+Up/Down) (preserved) ────────────
  useEffect(() => {
    let unlistenUp: (() => void) | undefined;
    let unlistenDown: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_scroll_up', () => {
      answerScrollRef.current?.scrollBy({ top: -120, behavior: 'smooth' });
    })
      .then((fn) => {
        unlistenUp = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_scroll_up listener failed', { err: String(err) });
      });
    listenTauriEvent<void>('hotkey_scroll_down', () => {
      answerScrollRef.current?.scrollBy({ top: 120, behavior: 'smooth' });
    })
      .then((fn) => {
        unlistenDown = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_scroll_down listener failed', { err: String(err) });
      });
    return () => {
      unlistenUp?.();
      unlistenDown?.();
    };
  }, []);

  // ── Hotkey: toggle click-through (Ctrl+Shift+T) (preserved) ────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_toggle_click_through', () => {
      toggleClickThrough();
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_toggle_click_through listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, [toggleClickThrough]);

  // ── Set click-through as default on mount ───────────────────────────────
  useEffect(() => {
    getCurrentWindow()
      .setIgnoreCursorEvents(true)
      .catch((err) => {
        logger.warn('overlay', 'setIgnoreCursorEvents failed', { err: String(err) });
      });
  }, []);

  // ── Hotkey: generate answer (Ctrl+Shift+Enter) ─────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_generate_answer', () => {
      // Pick the most recent transcript entry regardless of speaker so the
      // hotkey works for solo testing AND for real meetings.
      const window = useSessionStore.getState().rollingWindow;
      const lastEntry = [...window]
        .reverse()
        .find((t) => t.speaker === 'customer' || t.speaker === 'user');
      if (lastEntry) {
        useSessionStore
          .getState()
          .ingestTranscript({
            ...lastEntry,
            speaker: 'customer', // re-tag so question detector treats it as a prompt
            id: `${lastEntry.id}-gen-${Date.now()}`,
            timestamp: Date.now(),
          })
          .catch((err) => {
            logger.warn('overlay', 'ingestTranscript (generate hotkey) failed', {
              err: String(err),
            });
          });
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_generate_answer listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, []);

  // ── Hotkey: next suggestion (Ctrl+Shift+N) — no-op if not implemented ──
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_next_suggestion', () => {
      // no-op: multiple response cycling not yet implemented
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_next_suggestion listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, []);

  // ── Hotkey: dismiss overlay (Escape) ───────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_dismiss', () => {
      invoke('toggle_overlay', { label: 'overlay', visible: false }).catch((err) => {
        logger.warn('overlay', 'toggle_overlay (dismiss) failed', { err: String(err) });
      });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_dismiss listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, []);

  // ── Hotkey: switch provider to groq ────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_provider_groq', () => {
      useSettingsStore.getState().patch({ selectedProvider: 'groq' });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_provider_groq listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, []);

  // ── Hotkey: switch provider to openai ──────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_provider_openai', () => {
      useSettingsStore.getState().patch({ selectedProvider: 'openai' });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_provider_openai listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, []);

  // ── Hotkey: switch provider to anthropic ───────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenTauriEvent<void>('hotkey_provider_anthropic', () => {
      useSettingsStore.getState().patch({ selectedProvider: 'anthropic' });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        logger.warn('overlay', 'hotkey_provider_anthropic listener failed', { err: String(err) });
      });
    return () => unlisten?.();
  }, []);

  // ── Transcript unread counter ───────────────────────────────────────────
  const lastSeenCountRef = useRef(0);
  /* eslint-disable react-hooks/set-state-in-effect -- syncs unread badge against an external ref tracking last-seen count; not pure-derivable from props alone */
  useEffect(() => {
    if (tab === 'transcript') {
      lastSeenCountRef.current = transcript.length;
      setTranscriptUnread(0);
    } else {
      setTranscriptUnread(Math.max(0, transcript.length - lastSeenCountRef.current));
    }
  }, [tab, transcript.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Action bar callbacks ────────────────────────────────────────────────
  const handleScreenshotSolve = useCallback(async () => {
    if (isSolving) return;
    setIsSolving(true);
    setStatus('Capturing screen...');
    try {
      const activeKey =
        selectedProvider === 'openai'
          ? openAiApiKey
          : selectedProvider === 'anthropic'
            ? anthropicApiKey
            : groqApiKey;
      const capture = await captureScreenRegion(0, 0, 0, 0);
      if (!capture.imageBase64) {
        setStatus('Screen capture failed');
        return;
      }
      setStatus('Running OCR...');
      const ocr = await runOcrOnImage(capture.imageBase64);
      if (!ocr.text.trim()) {
        setStatus('No text found on screen');
        return;
      }
      setStatus('Solving...');
      const provider = createLiveAnswerProvider(selectedProvider, activeKey, providerModel);
      const sol = await solveCodingProblem(ocr.text, provider);
      setSolution(sol);
      setStatus('Solution ready');
    } catch (e) {
      setStatus('Solve failed');
      logger.error('overlay', 'screenshot solve action failed', { err: String(e) });
    } finally {
      setIsSolving(false);
    }
  }, [
    anthropicApiKey,
    groqApiKey,
    isSolving,
    openAiApiKey,
    providerModel,
    selectedProvider,
    setSolution,
    setStatus,
  ]);

  const handleCopyAnswer = useCallback(async () => {
    const text = suggestion
      ? [suggestion.oneLiner, ...suggestion.answerBullets].join('\n')
      : solution
        ? [solution.approach, ...solution.pseudocode, solution.code].join('\n')
        : '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Answer copied');
    } catch (err) {
      logger.warn('overlay', 'copy answer clipboard failed', { err: String(err) });
      setStatus('Clipboard unavailable');
    }
  }, [suggestion, solution, setStatus]);

  const handleRegenerate = useCallback(() => {
    if (transcript.length === 0) {
      setStatus('No transcript to regenerate from');
      return;
    }
    const lastCustomer = [...transcript].reverse().find((t) => t.speaker === 'customer');
    if (!lastCustomer) {
      setStatus('No customer question detected');
      return;
    }
    setStatus('Regenerating answer...');
    useSessionStore
      .getState()
      .ingestTranscript({
        ...lastCustomer,
        id: `${lastCustomer.id}-re-${Date.now()}`,
        timestamp: Date.now(),
      })
      .catch((err) => {
        logger.warn('overlay', 'ingestTranscript (regenerate) failed', { err: String(err) });
      });
  }, [transcript, setStatus]);

  const handleAskCoach = useCallback(() => {
    setTab('chat');
    if (askCoachFocusTimerRef.current) clearTimeout(askCoachFocusTimerRef.current);
    askCoachFocusTimerRef.current = setTimeout(() => {
      chatHandleRef.current?.focusInput();
    }, 16);
  }, []);

  const handleReviewShareGuard = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SHARE_GUARD_REVIEW_EVENT));
  }, []);

  // ── Auto-hide (cloak) ───────────────────────────────────────────────────
  if (isAutoHidden) {
    return (
      <Tooltip content="Share Guard activated — click to review">
        <button
          type="button"
          className="overlay-cloak-pill"
          aria-label="Share Guard activated — click to review"
          onClick={handleReviewShareGuard}
        >
          <Lock size={18} aria-hidden />
          <StatusDot status="danger" className="overlay-cloak-pill__dot" aria-hidden />
        </button>
      </Tooltip>
    );
  }

  const sessionLabel =
    mode === 'running' ? 'Session running' : mode === 'paused' ? 'Paused' : 'Idle';
  const streaming = isStreaming(statusLabel) || isSolving;
  const dotStatus = statusDotFor(statusLabel);

  return (
    <div
      ref={shellRef}
      role="dialog"
      data-testid="overlay-window"
      className={cn(
        'overlay-shell',
        isClickThrough && 'overlay--click-through',
        isCollapsed && 'overlay--collapsed is-collapsed',
        streaming && 'is-streaming',
        shareGuard.safeDisplayMode && 'safe-display-mode',
      )}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      {/* ── Command bar (titlebar) ─────────────────────────────────────── */}
      <header
        className="overlay-titlebar"
        onMouseDown={onPointerDownHandle}
        data-tauri-drag-region
        aria-label="Drag to move overlay"
      >
        {/* Brand */}
        <div className="overlay-brand">
          <BrainCircuit className="overlay-brand__icon" aria-hidden />
          <span className="overlay-brand__name">MeetingMind</span>
        </div>

        {/* Status strip */}
        <div className="overlay-status-strip" data-no-drag>
          <StatusDot status={dotStatus} label={sessionLabel} />
          <span className="overlay-status-label">{statusLabel}</span>
          {lastLatencyMs !== null ? (
            <Tooltip content="Last answer latency">
              <span className={cn('overlay-latency', latencyClass(lastLatencyMs))}>
                <Zap
                  size={9}
                  aria-hidden
                  style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }}
                />
                {lastLatencyMs}ms
              </span>
            </Tooltip>
          ) : null}
        </div>

        {/* Hotkey chips */}
        <div className="overlay-hotkey-chips" data-no-drag>
          {BAR_CHIPS.map((chip) => (
            <Tooltip key={chip.tip} content={chip.tip}>
              <span className="overlay-hotkey-chip">
                {chip.keys.map((k, i) => (
                  <span key={i}>
                    {k}
                    {i < chip.keys.length - 1 ? '+' : ''}
                  </span>
                ))}
              </span>
            </Tooltip>
          ))}
        </div>

        {/* Icon buttons */}
        <div className="overlay-titlebar__right" data-no-drag>
          <Tooltip
            content={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {isClickThrough ? 'Disable' : 'Enable'} stealth mode
                <KeyHint keys={['Ctrl', 'Shift', 'T']} />
              </span>
            }
          >
            <IconButton
              aria-label={isClickThrough ? 'Disable stealth mode' : 'Enable stealth mode'}
              size="sm"
              onClick={() => toggleClickThrough()}
              className={isClickThrough ? 'overlay-titlebar__pin' : undefined}
            >
              {isClickThrough ? <Pin size={14} aria-hidden /> : <PinOff size={14} aria-hidden />}
            </IconButton>
          </Tooltip>
          <Tooltip content="Settings">
            <IconButton
              aria-label="Open settings"
              size="sm"
              onClick={() => {
                /* settings panel opened via main window */
              }}
            >
              <Settings size={14} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip content={isCollapsed ? 'Expand panel' : 'Collapse panel'}>
            <IconButton
              aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
              size="sm"
              onClick={() => setIsCollapsed((v) => !v)}
            >
              {isCollapsed ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronUp size={14} aria-hidden />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip content="Close overlay">
            <IconButton
              aria-label="Close overlay"
              size="sm"
              onClick={() => useOverlayStore.getState().toggleVisibility()}
            >
              <X size={14} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {/* ── Share-guard toast row ─────────────────────────────────────── */}
      {toastMessage ? (
        <div className="overlay-shareguard" role="status">
          <Shield className="overlay-shareguard__icon" size={14} aria-hidden />
          <span className="overlay-shareguard__text">{toastMessage}</span>
          <IconButton
            aria-label="Dismiss share-guard message"
            size="sm"
            className="overlay-shareguard__dismiss"
            onClick={() => setToastMessage(null)}
          >
            <X size={12} aria-hidden />
          </IconButton>
        </div>
      ) : null}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="overlay-body" ref={answerScrollRef}>
        <Tabs className="overlay-tabs" value={tab} onValueChange={(v) => setTab(v as OverlayTab)}>
          <TabsList aria-label="Overlay sections">
            <TabsTrigger value="answer">
              <span className="overlay-tab-trigger">Answer</span>
            </TabsTrigger>
            <TabsTrigger value="chat">
              <span className="overlay-tab-trigger">Chat</span>
            </TabsTrigger>
            <TabsTrigger value="transcript">
              <span className="overlay-tab-trigger">
                Transcript
                {transcriptUnread > 0 ? (
                  <span className="overlay-tab-count" aria-label={`${transcriptUnread} new`}>
                    {transcriptUnread > 99 ? '99+' : transcriptUnread}
                  </span>
                ) : null}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Answer tab */}
          <TabsContent value="answer">
            {streaming ? (
              <div className="overlay-streaming" aria-live="polite">
                <Spinner size="xs" />
                {statusLabel}
                <span className="streaming-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
            <ScrollArea maxHeight="60vh">
              {solution ? (
                <SolutionCard
                  solution={solution}
                  onDismiss={() => useOverlayStore.getState().clearSolution()}
                />
              ) : suggestion ? (
                <QuestionCard
                  bullets={suggestion.answerBullets}
                  confidence={suggestion.confidence}
                  oneLiner={suggestion.oneLiner}
                  question={suggestion.question.text}
                  type={suggestion.question.type}
                  redFlags={suggestion.redFlags}
                  supportSnippets={suggestion.supportSnippets}
                  suggestedFollowup={suggestion.suggestedFollowup}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-6) var(--space-3)',
                  }}
                >
                  <Mic
                    size={28}
                    aria-hidden
                    color="var(--accent-gold)"
                    className={audioActive ? 'mic-active' : ''}
                  />
                  <div
                    className={cn('audio-bars', audioActive && 'audio-bars--active')}
                    aria-hidden
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600 }}>
                      Listening…
                    </p>
                    <p
                      style={{
                        margin: '6px 0 0',
                        color: 'var(--text-tertiary)',
                        fontSize: 'var(--fs-sm)',
                      }}
                    >
                      Ctrl+Shift+S for screenshot solve, or wait for the next question.
                    </p>
                  </div>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Chat tab — uses new ChatPanel */}
          <TabsContent value="chat" data-pad="none">
            <ChatPanel
              ref={chatHandleRef}
              question={suggestion?.question.text ?? null}
              questionType={suggestion?.question.type ?? null}
            />
          </TabsContent>

          {/* Transcript tab */}
          <TabsContent value="transcript">
            <ScrollArea maxHeight="55vh">
              <TranscriptFeed items={transcript} isLive={mode === 'running'} />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────────── */}
      <div className="overlay-action-bar" role="toolbar" aria-label="Quick actions">
        <div className="overlay-action-bar__group">
          <Tooltip
            content={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Screenshot + solve <KeyHint keys={['Ctrl', 'Shift', 'S']} />
              </span>
            }
          >
            <IconButton
              aria-label="Screenshot and solve"
              size="sm"
              onClick={() => {
                handleScreenshotSolve().catch((err) => {
                  logger.warn('overlay', 'handleScreenshotSolve (click) failed', {
                    err: String(err),
                  });
                });
              }}
              disabled={isSolving}
            >
              {isSolving ? <Spinner size="xs" /> : <Camera size={14} aria-hidden />}
            </IconButton>
          </Tooltip>
          <Tooltip
            content={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Copy answer <KeyHint keys={['Ctrl', 'Shift', 'C']} />
              </span>
            }
          >
            <IconButton
              aria-label="Copy current answer"
              size="sm"
              onClick={() => {
                handleCopyAnswer().catch((err) => {
                  logger.warn('overlay', 'handleCopyAnswer (click) failed', { err: String(err) });
                });
              }}
              disabled={!suggestion && !solution}
            >
              <Copy size={14} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip content="Regenerate">
            <IconButton
              aria-label="Regenerate answer"
              size="sm"
              onClick={handleRegenerate}
              disabled={transcript.length === 0}
            >
              <RotateCw size={14} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip content="Ask the coach">
            <IconButton aria-label="Ask the coach" size="sm" onClick={handleAskCoach}>
              <Sparkles size={14} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>

        <span className="overlay-action-bar__spacer" />

        {isSolving ? (
          <Badge variant="blue" size="sm">
            Solving…
          </Badge>
        ) : null}

        <span className="overlay-hotkey-legend">
          <Tooltip content="Keyboard shortcuts">
            <IconButton aria-label="Show keyboard shortcuts" size="sm">
              <HelpCircle size={14} aria-hidden />
            </IconButton>
          </Tooltip>
          <div
            className="overlay-hotkey-legend__panel"
            role="group"
            aria-label="Keyboard shortcuts"
          >
            {HOTKEY_ROWS.map((row) => (
              <div key={row.label} className="overlay-hotkey-legend__row">
                <span className="overlay-hotkey-legend__label">{row.label}</span>
                <KeyHint keys={row.keys} />
              </div>
            ))}
          </div>
        </span>

        <Tooltip content="Collapse">
          <IconButton aria-label="Collapse" size="sm" onClick={() => setIsCollapsed(true)}>
            <MinusSquare size={14} aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
