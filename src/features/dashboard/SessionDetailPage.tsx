import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Check,
  Copy,
  Download,
  FileText,
  ListTodo,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Divider } from '../../components/ui/Divider';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tag } from '../../components/ui/Tag';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/useToast';
import { logger } from '../../lib/logger';
import { appendAuditEvent, listAuditEvents, type AuditEvent } from '../../lib/runtime/auditEvents';
import { detectQuestion } from '../../lib/copilot/questionDetector';
import {
  readPersistedSessions,
  readPersistedTranscriptItems,
  type SessionSummary,
} from '../../lib/tauri';
import {
  useSessionLatency,
  useSessionReport,
  useSessionTranscript,
  type TranscriptItem,
} from '../../store/sessionStore';
import { SessionTimeline } from './SessionTimeline';
import './sessions.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface DetectedQuestionEntry {
  itemId: string;
  text: string;
  type: string;
  timestamp: number;
  relativeMs: number;
  answerText: string;
}

function classifyQuestions(items: TranscriptItem[]): {
  star: number;
  technical: number;
  other: number;
  total: number;
  topCategories: string[];
} {
  let star = 0;
  let technical = 0;
  let other = 0;
  const catCounts = new Map<string, number>();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.speaker !== 'customer') continue;
    const window = items.slice(Math.max(0, i - 2), i + 1);
    const det = detectQuestion(window);
    if (!det.isQuestion) continue;
    catCounts.set(det.questionType, (catCounts.get(det.questionType) ?? 0) + 1);
    if (det.questionType === 'behavioral') {
      star += 1;
    } else if (det.questionType === 'technical' || det.questionType === 'system-design') {
      technical += 1;
    } else {
      other += 1;
    }
  }

  const topCategories = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat]) => cat);

  return { star, technical, other, total: star + technical + other, topCategories };
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function speakerDisplay(speaker: TranscriptItem['speaker']): string {
  if (speaker === 'customer') return 'Interviewer';
  if (speaker === 'user') return 'You';
  return 'System';
}

function transcriptToMarkdown(items: TranscriptItem[]): string {
  return items
    .map((item) => {
      const d = new Date(item.timestamp).toLocaleTimeString();
      return `**${speakerDisplay(item.speaker)}** [${d}]: ${item.text}`;
    })
    .join('\n\n');
}

const BADGE_VARIANT_MAP: Record<string, 'gold' | 'blue' | 'violet' | 'neutral'> = {
  behavioral: 'gold',
  technical: 'blue',
  'system-design': 'blue',
  factual: 'violet',
  coding: 'violet',
};

function qBadgeVariant(type: string): 'gold' | 'blue' | 'violet' | 'neutral' {
  return BADGE_VARIANT_MAP[type] ?? 'neutral';
}

function auditLevelVariant(type: AuditEvent['type']): 'danger' | 'warn' | 'ok' | 'neutral' {
  if (type === 'answer_generation_failed' || type === 'capture_exclusion_activation_failed')
    return 'danger';
  if (type === 'export_generated' || type === 'session_ended' || type === 'answer_generated')
    return 'ok';
  if (type === 'session_paused' || type === 'capture_exclusion_fallback_hidden') return 'warn';
  return 'neutral';
}

// ── Hand-rolled fixed-height windowing (I23) ────────────────────────────────
// Renders only the slice currently within the viewport plus a small overscan.
// Activated above 200 items; for shorter lists we render normally.

function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  height = 600,
  ariaLabel,
}: {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, idx: number) => React.ReactNode;
  height?: number;
  ariaLabel?: string;
}) {
  const [scrollTop, setScrollTop] = React.useState(0);
  const visibleStart = Math.max(0, Math.floor(scrollTop / itemHeight) - 5);
  const visibleEnd = Math.min(items.length, Math.ceil((scrollTop + height) / itemHeight) + 5);
  const offsetY = visibleStart * itemHeight;
  const totalHeight = items.length * itemHeight;
  return (
    <div
      style={{ height, overflowY: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      aria-label={ariaLabel}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${offsetY}px)`,
            position: 'absolute',
            left: 0,
            right: 0,
          }}
        >
          {items
            .slice(visibleStart, visibleEnd)
            .map((item, i) => renderItem(item, visibleStart + i))}
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionDetailPage() {
  const { sessionId } = useParams();
  // Selector hooks (I21/I22) — narrow reads to minimise re-renders.
  const transcript = useSessionTranscript();
  const report = useSessionReport();
  const { avg: avgLatency } = useSessionLatency();

  const [storedSession, setStoredSession] = useState<SessionSummary | null>(null);
  const [storedTranscript, setStoredTranscript] = useState<TranscriptItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayPosition, setReplayPosition] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const replayTimerRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggering loading state for async data fetch is the canonical use of useEffect
    setIsLoading(true);
    Promise.all([
      readPersistedSessions()
        .then((sessions) => sessions.find((s) => s.id === sessionId) ?? null)
        .catch(() => null),
      readPersistedTranscriptItems(sessionId)
        .then((items) => items as TranscriptItem[])
        .catch(() => [] as TranscriptItem[]),
    ])
      .then(([sess, items]) => {
        setStoredSession(sess);
        setStoredTranscript(items);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
    setAuditEvents(listAuditEvents().slice(-200));
  }, [sessionId]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditingTitle]);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current !== null) window.clearInterval(replayTimerRef.current);
    };
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────

  const displayTranscript: TranscriptItem[] = transcript.length > 0 ? transcript : storedTranscript;

  const sessionTimeline = useMemo(() => {
    if (displayTranscript.length === 0) return { startMs: 0, endMs: 0, totalMs: 0 };
    const startMs = displayTranscript[0].timestamp;
    const endMs = displayTranscript[displayTranscript.length - 1].timestamp;
    return { startMs, endMs, totalMs: Math.max(1, endMs - startMs) };
  }, [displayTranscript]);

  const detectedQuestionEntries: DetectedQuestionEntry[] = useMemo(() => {
    const entries: DetectedQuestionEntry[] = [];
    for (let i = 0; i < displayTranscript.length; i += 1) {
      const item = displayTranscript[i];
      if (item.speaker !== 'customer') continue;
      const window = displayTranscript.slice(Math.max(0, i - 2), i + 1);
      const det = detectQuestion(window);
      if (!det.isQuestion) continue;
      const nextUser = displayTranscript.slice(i + 1).find((x) => x.speaker === 'user');
      entries.push({
        itemId: item.id,
        text: det.questionText,
        type: det.questionType,
        timestamp: item.timestamp,
        relativeMs: item.timestamp - sessionTimeline.startMs,
        answerText: nextUser?.text ?? 'No answer captured yet.',
      });
    }
    return entries;
  }, [displayTranscript, sessionTimeline.startMs]);

  const classification = useMemo(() => classifyQuestions(displayTranscript), [displayTranscript]);

  const durationMinutes = useMemo(() => {
    if (storedSession) return storedSession.durationMinutes;
    if (displayTranscript.length === 0) return 0;
    return Math.max(1, Math.ceil(sessionTimeline.totalMs / 60_000));
  }, [storedSession, displayTranscript.length, sessionTimeline.totalMs]);

  const questionCount = detectedQuestionEntries.length;

  const sessionTitle =
    titleDraft ||
    (storedSession?.title ??
      detectedQuestionEntries[0]?.text?.slice(0, 60) ??
      `Session ${sessionId ?? ''}`);

  const sessionDate = storedSession
    ? new Date().toLocaleDateString()
    : displayTranscript.length > 0
      ? new Date(displayTranscript[0].timestamp).toLocaleDateString()
      : new Date().toLocaleDateString();

  const startedAt =
    displayTranscript.length > 0
      ? new Date(displayTranscript[0].timestamp).toLocaleTimeString()
      : '—';
  const endedAt =
    displayTranscript.length > 0
      ? new Date(displayTranscript[displayTranscript.length - 1].timestamp).toLocaleTimeString()
      : '—';

  // ── Replay ────────────────────────────────────────────────────────────────
  // I11/I14: every setInterval-create site clears any pre-existing timer first
  // so a double-click on Replay cannot leak two intervals onto the heap.

  function startReplay() {
    if (replayTimerRef.current !== null) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    setReplayPlaying(true);
    replayTimerRef.current = window.setInterval(() => {
      setReplayPosition((prev) => {
        const next = prev + 500;
        if (next >= sessionTimeline.totalMs) {
          if (replayTimerRef.current !== null) {
            window.clearInterval(replayTimerRef.current);
            replayTimerRef.current = null;
          }
          setReplayPlaying(false);
          return sessionTimeline.totalMs;
        }
        return next;
      });
    }, 500);
  }

  function pauseReplay() {
    if (replayTimerRef.current !== null) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    setReplayPlaying(false);
  }

  function restartReplay() {
    if (replayTimerRef.current !== null) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    setReplayPosition(0);
    setReplayPlaying(false);
  }

  function jumpTo(relativeMs: number) {
    setReplayPosition(Math.min(relativeMs, sessionTimeline.totalMs));
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function handleExportJson() {
    if (!report) {
      toast.show({
        title: 'No report yet',
        description: 'End a live session to generate a report.',
        variant: 'warn',
      });
      return;
    }
    downloadFile(
      `meetingmind-${sessionId ?? 'session'}-report.json`,
      JSON.stringify(report, null, 2),
      'application/json',
    );
    appendAuditEvent('export_generated', { format: 'json', source: 'session-detail' });
    toast.show({ title: 'Exported JSON', variant: 'success' });
  }

  function handleExportMarkdown() {
    if (!report) {
      toast.show({
        title: 'No report yet',
        description: 'End a live session to generate a report.',
        variant: 'warn',
      });
      return;
    }
    const md = [
      '# MeetingMind Session Report',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      '## Summary',
      report.summary,
      '',
      '## Action Items',
      ...report.actionItems.map((item) => `- ${item}`),
      '',
      '## Follow-Up Draft',
      report.followUpEmail,
      '',
      '## CRM Notes',
      report.crmNotes,
      '',
      '## Transcript',
      transcriptToMarkdown(displayTranscript),
    ].join('\n');
    downloadFile(`meetingmind-${sessionId ?? 'session'}-report.md`, md, 'text/markdown');
    appendAuditEvent('export_generated', { format: 'markdown', source: 'session-detail' });
    toast.show({ title: 'Exported Markdown', variant: 'success' });
  }

  function handleDeleteConfirmed() {
    setDeleteOpen(false);
    toast.show({
      title: 'Delete not available',
      description: 'Session deletion requires a backend action — coming soon.',
      variant: 'warn',
    });
  }

  async function copyToClipboard(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch (err) {
      logger.warn('session-detail', 'clipboard copy failed', { err: String(err) });
      toast.show({ title: 'Copy failed', variant: 'warn' });
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const starPct =
    classification.total === 0 ? 0 : (classification.star / classification.total) * 100;
  const techPct =
    classification.total === 0 ? 0 : (classification.technical / classification.total) * 100;
  const otherPct =
    classification.total === 0 ? 0 : (classification.other / classification.total) * 100;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="sessions-root">
      {/* ── Header ── */}
      <div className="session-detail-hero">
        <div className="session-detail-hero__titles">
          <p className="sessions-eyebrow">Session detail</p>

          {isEditingTitle ? (
            <Input
              ref={titleInputRef}
              value={titleDraft || sessionTitle}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') setIsEditingTitle(false);
              }}
              aria-label="Edit session title"
              className="session-detail-hero__title-input"
            />
          ) : (
            <h1
              className="session-detail-hero__title"
              onClick={() => {
                setTitleDraft(sessionTitle);
                setIsEditingTitle(true);
              }}
              title="Click to rename"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setTitleDraft(sessionTitle);
                  setIsEditingTitle(true);
                }
              }}
            >
              {sessionTitle}
            </h1>
          )}

          <div className="session-detail-hero__info">
            <Badge variant="neutral" size="sm">
              {storedSession ? 'persisted' : 'live'}
            </Badge>
            <span>{sessionDate}</span>
            <Divider orientation="vertical" />
            <span>Started {startedAt}</span>
            <Divider orientation="vertical" />
            <span>Ended {endedAt}</span>
            <Divider orientation="vertical" />
            <span>{durationMinutes} min</span>
            <Divider orientation="vertical" />
            <span>{questionCount} questions</span>
            {avgLatency !== null ? (
              <>
                <Divider orientation="vertical" />
                <span>Avg latency {avgLatency}ms</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="session-detail-hero__actions">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={replayPlaying ? <Pause size={14} /> : <Play size={14} />}
            onClick={replayPlaying ? pauseReplay : startReplay}
          >
            {replayPlaying ? 'Pause' : 'Replay'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RotateCcw size={14} />}
            onClick={restartReplay}
          >
            Reset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Download size={14} />}
            onClick={handleExportJson}
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<FileText size={14} />}
            onClick={handleExportMarkdown}
          >
            Export MD
          </Button>
          <Button
            variant="danger"
            size="sm"
            leadingIcon={<Trash2 size={14} />}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* ── 3-col grid ── */}
      <div className="session-detail-grid">
        {/* LEFT: stats sidebar */}
        <Card padding="md" className="session-detail-grid__left">
          <div className="session-sidebar-stats">
            <div>
              <p className="sessions-eyebrow">Session stats</p>
            </div>
            <div className="session-sidebar-stats__metric">
              <strong>{isLoading ? <Skeleton width={40} height={24} /> : questionCount}</strong>
              <span>Questions detected</span>
            </div>
            <div className="session-sidebar-stats__metric">
              <strong>{avgLatency === null ? 'n/a' : `${avgLatency}ms`}</strong>
              <span>Avg response latency</span>
            </div>
            <div className="session-sidebar-stats__metric">
              <strong>{displayTranscript.length}</strong>
              <span>Transcript turns</span>
            </div>

            <div>
              <p className="sessions-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Question mix
              </p>
              <div
                className="stat-bar"
                role="img"
                aria-label={`STAR ${Math.round(starPct)}% technical ${Math.round(techPct)}% other ${Math.round(otherPct)}%`}
              >
                <span
                  className="stat-bar__seg stat-bar__seg--star"
                  style={{ width: `${starPct}%` }}
                />
                <span
                  className="stat-bar__seg stat-bar__seg--technical"
                  style={{ width: `${techPct}%` }}
                />
                <span
                  className="stat-bar__seg stat-bar__seg--other"
                  style={{ width: `${otherPct}%` }}
                />
              </div>
              <div className="stat-bar-legend" style={{ marginTop: 'var(--space-2)' }}>
                <span>
                  <span
                    className="stat-bar-legend__dot"
                    style={{ background: 'var(--accent-gold)' }}
                  />
                  STAR {classification.star}
                </span>
                <span>
                  <span
                    className="stat-bar-legend__dot"
                    style={{ background: 'var(--accent-blue)' }}
                  />
                  Technical {classification.technical}
                </span>
                <span>
                  <span
                    className="stat-bar-legend__dot"
                    style={{ background: 'var(--surface-overlay)' }}
                  />
                  Other {classification.other}
                </span>
              </div>
            </div>

            {classification.topCategories.length > 0 ? (
              <div>
                <p className="sessions-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                  Top categories
                </p>
                <div className="session-sidebar-stats__topics">
                  {classification.topCategories.map((cat) => (
                    <Tag key={cat}>{cat}</Tag>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Replay progress */}
            <div>
              <p className="sessions-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Replay position
              </p>
              <div className="replay-progress">
                <div
                  className="replay-progress__bar"
                  role="progressbar"
                  aria-valuenow={replayPosition}
                  aria-valuemin={0}
                  aria-valuemax={sessionTimeline.totalMs}
                  aria-label="Replay progress"
                >
                  <div
                    className="replay-progress__fill"
                    style={{
                      width: `${sessionTimeline.totalMs === 0 ? 0 : (replayPosition / sessionTimeline.totalMs) * 100}%`,
                    }}
                  />
                </div>
                <div className="replay-progress__labels">
                  <span>{formatClock(replayPosition)}</span>
                  <span>{formatClock(sessionTimeline.totalMs)}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* CENTER: tabs */}
        <Card padding="md" className="session-detail-grid__center">
          <Tabs defaultValue="transcript">
            <TabsList aria-label="Session views">
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="answers">Answers</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>

            {/* ── Transcript tab ── */}
            <TabsContent value="transcript">
              {isLoading ? (
                <ScrollArea maxHeight={560}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} height={60} />
                    ))}
                  </div>
                </ScrollArea>
              ) : displayTranscript.length === 0 ? (
                <p className="hint-copy">Run a session to generate transcript data.</p>
              ) : displayTranscript.length > 200 ? (
                /* I23: large transcripts virtualize at fixed height to keep DOM bounded. */
                <VirtualList
                  items={displayTranscript}
                  itemHeight={104}
                  height={560}
                  ariaLabel="Session transcript"
                  renderItem={(item) => {
                    const questionEntry = detectedQuestionEntries.find((q) => q.itemId === item.id);
                    const isQuestion = Boolean(questionEntry);
                    return (
                      <div
                        key={item.id}
                        id={`turn-${item.id}`}
                        className={`transcript-turn transcript-turn--${item.speaker}`}
                        style={{ minHeight: 104, boxSizing: 'border-box' }}
                      >
                        <div className="transcript-turn__header">
                          <strong className="transcript-turn__speaker">
                            {speakerDisplay(item.speaker)}
                          </strong>
                          <span className="transcript-turn__ts">
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </span>
                          {isQuestion && questionEntry ? (
                            <Badge variant={qBadgeVariant(questionEntry.type)} size="sm">
                              {questionEntry.type}
                            </Badge>
                          ) : null}
                          {isQuestion ? (
                            <a
                              href={`#answer-${item.id}`}
                              className="transcript-jump-link"
                              aria-label="Jump to answer"
                            >
                              Jump to answer ↓
                            </a>
                          ) : null}
                        </div>
                        <p className="transcript-turn__text">{item.text}</p>
                      </div>
                    );
                  }}
                />
              ) : (
                <ScrollArea maxHeight={560}>
                  <div
                    className="transcript-list"
                    role="log"
                    aria-label="Session transcript"
                    aria-live="polite"
                  >
                    {displayTranscript.map((item) => {
                      const isQuestion = detectedQuestionEntries.some((q) => q.itemId === item.id);
                      const qEntry = detectedQuestionEntries.find((q) => q.itemId === item.id);
                      return (
                        <div
                          key={item.id}
                          id={`turn-${item.id}`}
                          className={`transcript-turn transcript-turn--${item.speaker}`}
                        >
                          <div className="transcript-turn__header">
                            <strong className="transcript-turn__speaker">
                              {speakerDisplay(item.speaker)}
                            </strong>
                            <span className="transcript-turn__ts">
                              {new Date(item.timestamp).toLocaleTimeString()}
                            </span>
                            {isQuestion && qEntry ? (
                              <Badge variant={qBadgeVariant(qEntry.type)} size="sm">
                                {qEntry.type}
                              </Badge>
                            ) : null}
                            {isQuestion ? (
                              <a
                                href={`#answer-${item.id}`}
                                className="transcript-jump-link"
                                aria-label="Jump to answer"
                              >
                                Jump to answer ↓
                              </a>
                            ) : null}
                          </div>
                          <p className="transcript-turn__text">{item.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            {/* ── Answers tab ── */}
            <TabsContent value="answers">
              {isLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height={80} />
                  ))}
                </div>
              ) : detectedQuestionEntries.length === 0 ? (
                <p className="hint-copy">No questions detected in this session.</p>
              ) : (
                <div className="answers-list">
                  {detectedQuestionEntries.map((entry, idx) => (
                    <div key={entry.itemId} id={`answer-${entry.itemId}`} className="answer-card">
                      <div className="answer-card__head">
                        <span className="answer-card__num">Q{idx + 1}</span>
                        <Badge variant={qBadgeVariant(entry.type)} size="sm">
                          {entry.type}
                        </Badge>
                        <span className="answer-card__ts">{formatClock(entry.relativeMs)}</span>
                        <button
                          type="button"
                          className="answer-card__jump"
                          onClick={() => jumpTo(entry.relativeMs)}
                        >
                          Jump to position
                        </button>
                        <IconButton
                          aria-label="Copy answer"
                          variant="ghost"
                          size="sm"
                          onClick={() => void copyToClipboard(entry.answerText, entry.itemId)}
                        >
                          {copiedId === entry.itemId ? (
                            <Check size={14} aria-hidden />
                          ) : (
                            <Copy size={14} aria-hidden />
                          )}
                        </IconButton>
                      </div>
                      <p className="answer-card__question">{entry.text}</p>
                      <p className="answer-card__answer">{entry.answerText}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Timeline tab ── */}
            <TabsContent value="timeline">
              <SessionTimeline
                {...(sessionId !== undefined ? { sessionId } : {})}
                items={displayTranscript}
              />
            </TabsContent>

            {/* ── Artifacts tab ── */}
            <TabsContent value="artifacts">
              {report ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div>
                    <p className="sessions-eyebrow">Executive summary</p>
                    <p style={{ marginTop: 'var(--space-2)', lineHeight: 1.6 }}>{report.summary}</p>
                  </div>
                  {report.actionItems.length > 0 ? (
                    <div>
                      <p className="sessions-eyebrow">Action items</p>
                      <ul
                        className="bullet-list"
                        style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}
                      >
                        {report.actionItems.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      <div style={{ marginTop: 'var(--space-3)' }}>
                        <Link
                          to="/actions"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            color: 'var(--accent-gold-hi)',
                            fontSize: 'var(--fs-sm)',
                            textDecoration: 'none',
                          }}
                        >
                          <ListTodo size={14} aria-hidden /> Open action items
                        </Link>
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <p className="sessions-eyebrow">Follow-up draft</p>
                    <pre
                      className="text-block"
                      style={{
                        marginTop: 'var(--space-2)',
                        padding: 'var(--space-3)',
                        background: 'var(--surface-2)',
                        borderRadius: 'var(--radius-md)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {report.followUpEmail}
                    </pre>
                  </div>
                  <div>
                    <p className="sessions-eyebrow">CRM notes</p>
                    <pre
                      className="text-block"
                      style={{
                        marginTop: 'var(--space-2)',
                        padding: 'var(--space-3)',
                        background: 'var(--surface-2)',
                        borderRadius: 'var(--radius-md)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {report.crmNotes}
                    </pre>
                  </div>
                </div>
              ) : storedSession ? (
                <p style={{ margin: 0, lineHeight: 1.6 }}>{storedSession.summary}</p>
              ) : (
                <p className="hint-copy">No artifacts. End a session to generate a report.</p>
              )}
            </TabsContent>

            {/* ── Audit tab ── */}
            <TabsContent value="audit">
              {auditEvents.length === 0 ? (
                <p className="hint-copy">No audit events recorded for this session.</p>
              ) : (
                <ScrollArea maxHeight={520}>
                  <table className="audit-table" aria-label="Audit log">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Level</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEvents.map((evt) => (
                        <tr key={evt.id}>
                          <td className="audit-table__ts">
                            {new Date(evt.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="audit-table__type">{evt.type}</td>
                          <td>
                            <Badge variant={auditLevelVariant(evt.type)} size="sm">
                              {auditLevelVariant(evt.type)}
                            </Badge>
                          </td>
                          <td className="audit-table__details">
                            {Object.entries(evt.details)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        {/* RIGHT: jump list */}
        <Card padding="md" className="session-detail-grid__right">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <p className="sessions-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Jump to question
              </p>
              {detectedQuestionEntries.length === 0 ? (
                <p className="hint-copy" style={{ fontSize: 'var(--fs-xs)' }}>
                  No questions detected yet.
                </p>
              ) : (
                <div className="replay-jump-list">
                  {detectedQuestionEntries.map((entry) => (
                    <button
                      key={entry.itemId}
                      type="button"
                      className="replay-jump-list__item"
                      onClick={() => jumpTo(entry.relativeMs)}
                      aria-label={`Jump to ${formatClock(entry.relativeMs)}: ${entry.text}`}
                    >
                      <span className="replay-jump-list__time">
                        {formatClock(entry.relativeMs)}
                      </span>
                      <span className="replay-jump-list__text">{entry.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ── Delete dialog ── */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this session?"
        description="This permanently removes the session transcript, summary, and exports."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteConfirmed}>
              Delete session
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          You will lose access to <strong>{sessionTitle}</strong>. This action cannot be undone.
        </p>
      </Dialog>
    </section>
  );
}
