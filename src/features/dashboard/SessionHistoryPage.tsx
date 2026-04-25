import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Circle, Download, FileSearch, Pause, Play, Plus, Search, Square } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { KeyHint } from '../../components/ui/KeyHint';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import { StatusDot } from '../../components/ui/StatusDot';
import { Tag } from '../../components/ui/Tag';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/useToast';
import { cn } from '../../lib/cn';
import { logger } from '../../lib/logger';
import { mockCustomerCall } from '../../fixtures/mockCallTranscript';
import { createTranscriptSimulator } from '../../lib/providers/transcriptSimulator';
import { readPersistedSessions, type SessionSummary } from '../../lib/tauri';
import { useOverlayStore } from '../../store/overlayStore';
import { useSessionStore } from '../../store/sessionStore';
import './sessions.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionSource = 'live' | 'demo' | 'imported';
type DateRange = 'today' | 'week' | 'month' | 'all';
type StatusFilter = 'all' | 'completed' | 'active' | 'aborted';

interface SessionListItem {
  id: string;
  customer: string;
  title: string;
  duration: string;
  durationMinutes: number;
  summary: string;
  questionCount: number;
  source: SessionSource;
  platform: string;
  provider: string;
  topics: string[];
  status: 'completed' | 'active' | 'aborted';
  timestamp: number;
  isPrivate: boolean;
}

// ── Seeded data ───────────────────────────────────────────────────────────────

const seededSessions: SessionListItem[] = [
  {
    id: 'acme-renewal',
    customer: 'Acme Corp',
    title: 'Renewal planning call',
    duration: '28 min',
    durationMinutes: 28,
    summary: 'Reviewed pricing concerns, renewal timing, and migration blockers.',
    questionCount: 12,
    source: 'demo',
    platform: 'Zoom',
    provider: 'OpenAI',
    topics: ['Pricing', 'Migration', 'Renewal'],
    status: 'completed',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 2,
    isPrivate: false,
  },
  {
    id: 'northwind-demo',
    customer: 'Northwind',
    title: 'Technical demo follow-up',
    duration: '41 min',
    durationMinutes: 41,
    summary: 'Covered API fit, SSO rollout sequence, and sandbox next steps.',
    questionCount: 18,
    source: 'demo',
    platform: 'Google Meet',
    provider: 'Groq',
    topics: ['API', 'SSO', 'Sandbox', 'Integrations'],
    status: 'completed',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 5,
    isPrivate: false,
  },
  {
    id: 'meta-sysdesign',
    customer: 'Meta',
    title: 'System design: distributed cache',
    duration: '55 min',
    durationMinutes: 55,
    summary:
      'Deep dive into consistent hashing, eviction policies, and write-through vs write-back.',
    questionCount: 7,
    source: 'demo',
    platform: 'Teams',
    provider: 'Claude',
    topics: ['System Design', 'Technical'],
    status: 'completed',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 9,
    isPrivate: true,
  },
];

// ── Utility ───────────────────────────────────────────────────────────────────

function inferTopics(summary: string, title: string): string[] {
  const src = `${title} ${summary}`.toLowerCase();
  const topicMap: Array<[string, string]> = [
    ['pricing', 'Pricing'],
    ['cost', 'Pricing'],
    ['api', 'API'],
    ['sso', 'SSO'],
    ['migration', 'Migration'],
    ['renewal', 'Renewal'],
    ['sandbox', 'Sandbox'],
    ['integration', 'Integrations'],
    ['security', 'Security'],
    ['technical', 'Technical'],
    ['demo', 'Demo'],
    ['support', 'Support'],
    ['onboarding', 'Onboarding'],
    ['system design', 'System Design'],
    ['coding', 'Coding'],
    ['behavioral', 'Behavioral'],
  ];
  const found = new Set<string>();
  for (const [needle, label] of topicMap) {
    if (src.includes(needle)) found.add(label);
  }
  return Array.from(found).slice(0, 4);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

const PAGE_SIZE = 50;

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionHistoryPage() {
  const [savedSessions, setSavedSessions] = useState<SessionSummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState(1);
  const timerRef = useRef<number | null>(null);
  // Stable "now" captured once on mount via lazy useState initializer; used inside
  // useMemo to keep filters idempotent (react-hooks/purity disallows Date.now()
  // during render — but lazy initializers run only on first render).
  const [mountedAt] = useState<number>(() => Date.now());
  const simulator = useMemo(() => createTranscriptSimulator(mockCustomerCall), []);
  const toast = useToast();

  // ── Store selectors (I21/I22) ──────────────────────────────────────────────
  // Read individual fields so unrelated state changes don't re-render the list.
  const isActive = useSessionStore((s) => s.isActive);
  const mode = useSessionStore((s) => s.mode);
  const researchMode = useSessionStore((s) => s.researchMode);
  const providerStatus = useSessionStore((s) => s.providerStatus);
  const liveCaptureStatus = useSessionStore((s) => s.liveCaptureStatus);
  const nativeAudioStatus = useSessionStore((s) => s.nativeAudioStatus);
  const lastError = useSessionStore((s) => s.lastError);
  const isGenerating = useSessionStore((s) => s.isGenerating);
  const totalQuestionsDetected = useSessionStore((s) => s.totalQuestionsDetected);
  const totalAnswersGenerated = useSessionStore((s) => s.totalAnswersGenerated);
  const averageAnswerLatencyMs = useSessionStore((s) => s.averageAnswerLatencyMs);

  // Actions are stable references — read individually too.
  const startSession = useSessionStore((s) => s.startSession);
  const pauseSession = useSessionStore((s) => s.pauseSession);
  const resumeSession = useSessionStore((s) => s.resumeSession);
  const endSession = useSessionStore((s) => s.endSession);
  const toggleResearchMode = useSessionStore((s) => s.toggleResearchMode);
  const ingestTranscript = useSessionStore((s) => s.ingestTranscript);
  const startLiveCaptureSession = useSessionStore((s) => s.startLiveCaptureSession);
  const stopLiveCaptureSession = useSessionStore((s) => s.stopLiveCaptureSession);
  const refreshNativeAudioStatus = useSessionStore((s) => s.refreshNativeAudioStatus);
  const clearError = useSessionStore((s) => s.clearError);
  const overlayStatus = useOverlayStore((state) => state.statusLabel);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<SessionSource>('demo');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  // ── Keyboard nav state ────────────────────────────────────────────────────
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  // ── Online state ──────────────────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    readPersistedSessions()
      .then((s) => setSavedSessions(s))
      .catch(() => setSavedSessions([]));
  }, [isActive, mode]);

  // Debounce search 200ms
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 200);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting timer state when capture stops; no external system to sync with
      setLiveStartedAt(null);
      setLiveElapsedMs(0);
      return;
    }
    if (liveStartedAt === null) setLiveStartedAt(Date.now());
  }, [isActive, liveStartedAt]);

  useEffect(() => {
    if (!isActive || mode !== 'running' || liveStartedAt === null) return;
    const id = window.setInterval(() => setLiveElapsedMs(Date.now() - liveStartedAt), 500);
    return () => window.clearInterval(id);
  }, [isActive, mode, liveStartedAt]);

  // ── Demo replay helpers ───────────────────────────────────────────────────

  function stopReplayTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function runDemoReplay() {
    stopReplayTimer();
    startSession();
    if (!useSessionStore.getState().isActive) return;
    setCursor(0);
    const queue: typeof mockCustomerCall = [];
    simulator.flush((item) => queue.push(item));
    timerRef.current = window.setInterval(() => {
      setCursor((value) => {
        const next = queue[value];
        if (!next) {
          stopReplayTimer();
          return value;
        }
        void ingestTranscript(next);
        return value + 1;
      });
    }, 1100);
  }

  function pauseReplay() {
    pauseSession();
    stopReplayTimer();
  }

  function resumeReplay() {
    resumeSession();
    const remaining = mockCustomerCall.slice(cursor);
    if (remaining.length === 0) return;
    stopReplayTimer();
    timerRef.current = window.setInterval(() => {
      setCursor((value) => {
        const next = mockCustomerCall[value];
        if (!next) {
          stopReplayTimer();
          return value;
        }
        void ingestTranscript(next);
        return value + 1;
      });
    }, 1100);
  }

  function stopSessionFlow() {
    stopReplayTimer();
    endSession();
    setCursor(0);
  }

  function handleStartNewSession() {
    if (sourceFilter === 'live') {
      startLiveCaptureSession(true).catch((err) => {
        logger.warn('session-history', 'startLiveCaptureSession failed', { err: String(err) });
      });
      return;
    }
    runDemoReplay();
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const allSessions: SessionListItem[] = useMemo(() => {
    // Compute fallback timestamp outside .map() to avoid repeated impure calls
    // and to keep useMemo idempotent for stable session ordering.
    const fallbackTs = mountedAt;
    const persisted: SessionListItem[] = savedSessions.map((s) => {
      const topics = inferTopics(s.summary, s.title);
      const ts = s.id.startsWith('session-')
        ? Number(s.id.replace('session-', '')) || fallbackTs
        : fallbackTs;
      return {
        id: s.id,
        customer: s.customerName,
        title: s.title,
        duration: `${s.durationMinutes} min`,
        durationMinutes: s.durationMinutes,
        summary: s.summary,
        questionCount: Math.max(1, Math.round(s.durationMinutes / 3)),
        source: 'live' as SessionSource,
        platform: 'System',
        provider: 'Auto',
        topics,
        status: 'completed' as const,
        timestamp: ts,
        isPrivate: false,
      };
    });
    return [...persisted, ...seededSessions];
  }, [savedSessions, mountedAt]);

  const platforms = useMemo(() => {
    const set = new Set(allSessions.map((s) => s.platform));
    return ['all', ...Array.from(set)];
  }, [allSessions]);

  const filteredSessions = useMemo(() => {
    const now = mountedAt;
    const day = 86_400_000;

    return allSessions.filter((s) => {
      if (s.source !== sourceFilter) return false;
      if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;

      if (dateRange === 'today' && now - s.timestamp > day) return false;
      if (dateRange === 'week' && now - s.timestamp > day * 7) return false;
      if (dateRange === 'month' && now - s.timestamp > day * 30) return false;

      if (debouncedQuery.length > 0) {
        const haystack = [s.title, s.summary, s.customer, s.platform, s.provider, ...s.topics]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(debouncedQuery)) return false;
      }

      return true;
    });
  }, [
    allSessions,
    sourceFilter,
    platformFilter,
    statusFilter,
    dateRange,
    debouncedQuery,
    mountedAt,
  ]);

  const pagedSessions = useMemo(
    () => filteredSessions.slice(0, page * PAGE_SIZE),
    [filteredSessions, page],
  );

  const hasMore = pagedSessions.length < filteredSessions.length;

  // ── Keyboard nav ──────────────────────────────────────────────────────────

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (pagedSessions.length === 0) return;
      const len = pagedSessions.length;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(focusedIndex + 1, len - 1);
        setFocusedIndex(next);
        cardRefs.current.get(pagedSessions[next].id)?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(focusedIndex - 1, 0);
        setFocusedIndex(prev);
        cardRefs.current.get(pagedSessions[prev].id)?.focus();
      }
    },
    [focusedIndex, pagedSessions],
  );

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLAnchorElement>, session: SessionListItem, index: number) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setDeleteTarget(session);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(index + 1, pagedSessions.length - 1);
        setFocusedIndex(next);
        cardRefs.current.get(pagedSessions[next].id)?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(index - 1, 0);
        setFocusedIndex(prev);
        cardRefs.current.get(pagedSessions[prev].id)?.focus();
      }
    },
    [pagedSessions],
  );

  const handleCardCtrlClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, session: SessionListItem) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        window.open(`/sessions/${session.id}`, '_blank');
      }
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const rangeOptions: Array<{ value: DateRange; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'all', label: 'All' },
  ];

  const platformOptions = platforms.map((p) => ({
    value: p,
    label: p === 'all' ? 'All platforms' : p,
  }));

  return (
    <section className="sessions-root">
      {/* ── Live banner ── */}
      {isActive ? (
        <div className="session-live-banner" role="region" aria-label="Active session">
          <div className="session-live-banner__row">
            <div className="session-live-banner__title">
              <StatusDot status={mode === 'running' ? 'ok' : 'warn'} />
              <span>{mode === 'running' ? 'Live session in progress' : 'Session paused'}</span>
            </div>
            <div className="session-live-banner__timer" aria-label="Elapsed time">
              {formatElapsed(liveElapsedMs)}
            </div>
            <div className="session-live-banner__stats">
              <span>Questions: {totalQuestionsDetected}</span>
              <span>Answers: {totalAnswersGenerated}</span>
              <span>
                Avg latency:{' '}
                {averageAnswerLatencyMs === null ? 'n/a' : `${averageAnswerLatencyMs}ms`}
              </span>
              <span>Capture: {liveCaptureStatus}</span>
            </div>
            <div className="session-live-banner__actions">
              {mode === 'running' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Pause size={14} />}
                  onClick={pauseReplay}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Play size={14} />}
                  onClick={resumeReplay}
                >
                  Resume
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Square size={14} />}
                onClick={() => {
                  stopLiveCaptureSession().catch((err) => {
                    logger.warn('session-history', 'stopLiveCaptureSession failed', {
                      err: String(err),
                    });
                  });
                  stopSessionFlow();
                }}
              >
                Stop
              </Button>
            </div>
          </div>
          <div className="sessions-demo-panel" style={{ marginTop: 'var(--space-3)' }}>
            <span className="sessions-subtle">
              Demo replay: {cursor}/{mockCustomerCall.length}
            </span>
            <div
              className="sessions-demo-panel__progress"
              role="progressbar"
              aria-valuenow={cursor}
              aria-valuemin={0}
              aria-valuemax={mockCustomerCall.length}
              aria-label="Demo replay progress"
            >
              <span
                style={{
                  width: `${mockCustomerCall.length === 0 ? 0 : (cursor / mockCustomerCall.length) * 100}%`,
                }}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={toggleResearchMode}>
              Research: {researchMode ? 'on' : 'off'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void refreshNativeAudioStatus()}>
              Refresh audio
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Toolbar ── */}
      <Card className="sessions-toolbar" padding="md">
        <div className="sessions-toolbar__row">
          <SegmentedControl<SessionSource>
            aria-label="Session source filter"
            value={sourceFilter}
            onChange={(v) => {
              setSourceFilter(v);
              setPage(1);
            }}
            options={[
              { value: 'live', label: 'Live' },
              { value: 'demo', label: 'Demo' },
              { value: 'imported', label: 'Imported' },
            ]}
          />
          <div className="sessions-toolbar__search">
            <Input
              placeholder="Search sessions…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              leadingIcon={<Search size={14} aria-hidden />}
              aria-label="Search sessions"
            />
          </div>
          <SegmentedControl<DateRange>
            aria-label="Date range"
            value={dateRange}
            onChange={(v) => {
              setDateRange(v);
              setPage(1);
            }}
            options={rangeOptions}
          />
          <Select
            aria-label="Platform filter"
            value={platformFilter}
            onChange={(e) => {
              setPlatformFilter(e.target.value);
              setPage(1);
            }}
            options={platformOptions}
          />
          <div className="sessions-toolbar__spacer" />
          <Button
            variant="primary"
            leadingIcon={<Plus size={14} aria-hidden />}
            onClick={handleStartNewSession}
            disabled={isActive && mode === 'running'}
          >
            New session
          </Button>
        </div>

        {/* Status tabs */}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Tabs
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as StatusFilter);
              setPage(1);
            }}
          >
            <TabsList aria-label="Session status filter">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="aborted">Aborted</TabsTrigger>
            </TabsList>
            {/* TabsContent panels are empty — filter is driven by state */}
            <TabsContent value="all">{null}</TabsContent>
            <TabsContent value="completed">{null}</TabsContent>
            <TabsContent value="active">{null}</TabsContent>
            <TabsContent value="aborted">{null}</TabsContent>
          </Tabs>
        </div>

        {/* Status row */}
        <div className="sessions-status-row">
          <span>
            Provider: <strong>{providerStatus}</strong>
          </span>
          <span>
            Runtime: <strong>{isGenerating ? 'generating' : 'idle'}</strong>
          </span>
          <span>
            Network: <strong>{isOnline ? 'online' : 'offline'}</strong>
          </span>
          <span>
            Native audio: <strong>{nativeAudioStatus?.isActive ? 'active' : 'inactive'}</strong>
          </span>
          <span>
            Overlay: <strong>{overlayStatus}</strong>
          </span>
        </div>

        {lastError ? (
          <div role="alert" className="sessions-error-bar">
            <span>{lastError}</span>
            <Button variant="ghost" size="sm" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </Card>

      {/* ── List ── */}
      {filteredSessions.length === 0 ? (
        <Card padding="lg" className="sessions-empty">
          <EmptyState
            icon={<FileSearch size={32} aria-hidden />}
            title="No sessions match"
            description={
              debouncedQuery.length > 0
                ? 'No matches for your filter. Broaden the search or date range.'
                : 'Start your first session to begin building a transcript history.'
            }
            action={
              <Button
                variant="primary"
                leadingIcon={<Plus size={14} aria-hidden />}
                onClick={handleStartNewSession}
              >
                Start your first session
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="sessions-list-header">
            <span className="sessions-eyebrow">
              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
            </span>
            <span className="sessions-keyhints">
              <KeyHint keys={['↑', '↓']} />
              <span>navigate</span>
              <KeyHint keys={['Enter']} />
              <span>open</span>
              <KeyHint keys={['Del']} />
              <span>delete</span>
              <KeyHint keys={['Ctrl', 'click']} />
              <span>open in new tab</span>
            </span>
          </div>

          <div
            ref={listRef}
            className="sessions-list"
            role="list"
            aria-label="Session history"
            onKeyDown={handleListKeyDown}
          >
            {pagedSessions.map((session, index) => (
              <Link
                key={session.id}
                to={`/sessions/${session.id}`}
                ref={(el) => {
                  if (el) cardRefs.current.set(session.id, el);
                  else cardRefs.current.delete(session.id);
                }}
                className={cn(
                  'session-row',
                  focusedIndex === index && 'session-row--keyboard-focus',
                )}
                role="listitem"
                aria-label={`Open session: ${session.title}`}
                onFocus={() => setFocusedIndex(index)}
                onKeyDown={(e) => handleCardKeyDown(e, session, index)}
                onClick={(e) => handleCardCtrlClick(e, session)}
              >
                <div className="session-row__head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="sessions-eyebrow">{session.customer}</p>
                    <p className="session-row__title">{session.title}</p>
                  </div>
                  <div className="session-row__badges">
                    <Badge
                      variant={
                        session.status === 'active'
                          ? 'gold'
                          : session.status === 'aborted'
                            ? 'danger'
                            : 'ok'
                      }
                      size="sm"
                    >
                      {session.platform}
                    </Badge>
                    <StatusDot
                      status={session.isPrivate ? 'warn' : 'neutral'}
                      label={session.isPrivate ? 'Private' : 'Shared'}
                    />
                  </div>
                </div>

                <div className="session-row__meta">
                  <span>{formatDate(session.timestamp)}</span>
                  <span aria-hidden>·</span>
                  <span>{session.duration}</span>
                  <span aria-hidden>·</span>
                  <span>{session.questionCount} questions</span>
                  <span aria-hidden>·</span>
                  <Tag>{session.provider}</Tag>
                </div>

                <p className="session-row__summary">{session.summary}</p>

                {session.topics.length > 0 ? (
                  <div className="session-row__topics">
                    {session.topics.map((topic) => (
                      <Tag key={topic}>{topic}</Tag>
                    ))}
                  </div>
                ) : null}

                <div
                  className="session-row__actions"
                  onClick={(e) => e.preventDefault()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <IconButton
                    aria-label="Export session"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toast.show({ title: 'Open session to export', variant: 'info' });
                    }}
                  >
                    <Download size={14} aria-hidden />
                  </IconButton>
                  <IconButton
                    aria-label="Delete session"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget(session);
                    }}
                  >
                    <FileSearch size={14} aria-hidden />
                  </IconButton>
                </div>
              </Link>
            ))}
          </div>

          {hasMore ? (
            <div
              style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-2)' }}
            >
              <Button variant="secondary" onClick={() => setPage((p) => p + 1)}>
                Load more ({filteredSessions.length - pagedSessions.length} remaining)
              </Button>
            </div>
          ) : null}
        </>
      )}

      {/* ── Delete dialog ── */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this session?"
        description="This permanently removes the session transcript, summary, and exports."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteTarget(null);
                toast.show({
                  title: 'Delete not available',
                  description: 'Session deletion requires a backend action — coming soon.',
                  variant: 'warn',
                });
              }}
            >
              Delete session
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          You will lose access to <strong>{deleteTarget?.title}</strong>. This action cannot be
          undone.
        </p>
      </Dialog>

      {/* Keeps lucide Circle import alive for tauri tree shaking compat */}
      <Circle aria-hidden style={{ display: 'none' }} />
    </section>
  );
}
