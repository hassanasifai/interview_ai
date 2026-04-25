import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { KeyHint } from '../../components/ui/KeyHint';
import { Tooltip } from '../../components/ui/Tooltip';
import { cn } from '../../lib/cn';
import { detectQuestion } from '../../lib/copilot/questionDetector';
import './sessions.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type TranscriptSpeaker = 'customer' | 'user' | 'system';

type TranscriptItem = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: number;
};

export type TimelineMarkerKind =
  | 'mic-start'
  | 'system-audio-start'
  | 'screenshot'
  | 'question-detected'
  | 'answer-streamed'
  | 'provider-switch'
  | 'share-guard-event';

export interface TimelineMarker {
  id: string;
  kind: TimelineMarkerKind;
  timestamp: number;
  relativeMs: number;
  payload: Record<string, string | number | boolean>;
}

interface Props {
  sessionId?: string;
  items?: TranscriptItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MARKER_COLOR: Record<TimelineMarkerKind, string> = {
  'mic-start': 'var(--accent-green, #7DD3B0)',
  'system-audio-start': 'var(--accent-blue)',
  screenshot: 'var(--accent-violet, #B48CFF)',
  'question-detected': 'var(--accent-gold)',
  'answer-streamed': 'var(--accent-gold-hi)',
  'provider-switch': '#F39A7A',
  'share-guard-event': 'var(--danger)',
};

const MARKER_SHAPE: Record<TimelineMarkerKind, 'diamond' | 'circle' | 'bar'> = {
  'mic-start': 'bar',
  'system-audio-start': 'bar',
  screenshot: 'diamond',
  'question-detected': 'diamond',
  'answer-streamed': 'circle',
  'provider-switch': 'bar',
  'share-guard-event': 'bar',
};

function kindLabel(kind: TimelineMarkerKind): string {
  const map: Record<TimelineMarkerKind, string> = {
    'mic-start': 'Mic start',
    'system-audio-start': 'System audio start',
    screenshot: 'Screenshot',
    'question-detected': 'Question detected',
    'answer-streamed': 'Answer streamed',
    'provider-switch': 'Provider switch',
    'share-guard-event': 'Share guard',
  };
  return map[kind];
}

function formatTs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatAbsTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildMarkersFromTranscript(items: TranscriptItem[]): TimelineMarker[] {
  if (items.length === 0) return [];
  const startMs = items[0].timestamp;
  const markers: TimelineMarker[] = [];

  markers.push({
    id: 'mic-start-0',
    kind: 'mic-start',
    timestamp: items[0].timestamp,
    relativeMs: 0,
    payload: { label: 'Session started' },
  });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const window = items.slice(Math.max(0, i - 2), i + 1);
    const det = detectQuestion(window);

    if (item.speaker === 'customer' && det.isQuestion) {
      markers.push({
        id: `q-${item.id}`,
        kind: 'question-detected',
        timestamp: item.timestamp,
        relativeMs: item.timestamp - startMs,
        payload: {
          text: det.questionText.slice(0, 80),
          type: det.questionType,
          confidence: Math.round(det.confidence * 100),
        },
      });
    }

    if (item.speaker === 'user' && i > 0) {
      const prevCustomer = items.slice(0, i).findLast((x) => x.speaker === 'customer');
      if (prevCustomer) {
        const prevDet = detectQuestion(
          items.slice(
            Math.max(0, items.indexOf(prevCustomer) - 2),
            items.indexOf(prevCustomer) + 1,
          ),
        );
        if (prevDet.isQuestion) {
          markers.push({
            id: `ans-${item.id}`,
            kind: 'answer-streamed',
            timestamp: item.timestamp,
            relativeMs: item.timestamp - startMs,
            payload: { preview: item.text.slice(0, 80) },
          });
        }
      }
    }
  }

  return markers.sort((a, b) => a.relativeMs - b.relativeMs);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionTimeline({ sessionId, items = [] }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  const [activeKinds, setActiveKinds] = useState<Set<TimelineMarkerKind>>(
    new Set(Object.keys(MARKER_COLOR) as TimelineMarkerKind[]),
  );

  const allMarkers = useMemo(() => buildMarkersFromTranscript(items), [items]);
  const markers = useMemo(
    () => allMarkers.filter((m) => activeKinds.has(m.kind)),
    [allMarkers, activeKinds],
  );

  const totalMs = useMemo(() => {
    if (items.length < 2) return 1;
    return items[items.length - 1].timestamp - items[0].timestamp;
  }, [items]);

  useEffect(() => {
    function onTimelineSelect(e: Event) {
      const detail = (e as CustomEvent<{ markerId: string }>).detail;
      setSelectedId(detail.markerId);
    }
    window.addEventListener('session_timeline_select', onTimelineSelect);
    return () => window.removeEventListener('session_timeline_select', onTimelineSelect);
  }, []);

  function toggleKind(kind: TimelineMarkerKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        if (next.size === 1) return prev; // keep at least one active
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  function selectMarker(marker: TimelineMarker) {
    setSelectedId(marker.id);
    const event = new CustomEvent('session_timeline_select', {
      detail: { markerId: marker.id, marker, sessionId },
      bubbles: true,
    });
    window.dispatchEvent(event);
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setScrubPct(pct);
    const targetMs = pct * totalMs;
    let closest: TimelineMarker | null = null;
    let closestDist = Infinity;
    for (const m of markers) {
      const dist = Math.abs(m.relativeMs - targetMs);
      if (dist < closestDist) {
        closestDist = dist;
        closest = m;
      }
    }
    if (closest) selectMarker(closest);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (markers.length === 0) return;
    const idx = markers.findIndex((m) => m.id === selectedId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = markers[Math.min(idx + 1, markers.length - 1)];
      if (next) selectMarker(next);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = markers[Math.max(idx - 1, 0)];
      if (prev) selectMarker(prev);
    } else if (e.key === 'Home') {
      e.preventDefault();
      selectMarker(markers[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      selectMarker(markers[markers.length - 1]);
    }
  }

  if (items.length === 0) {
    return (
      <p className="hint-copy">No transcript data — run a session to populate the timeline.</p>
    );
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="stl-root">
      {/* ── Kind filter chips ── */}
      <div className="stl-filters" role="group" aria-label="Filter timeline events">
        {(Object.keys(MARKER_COLOR) as TimelineMarkerKind[]).map((kind) => {
          const isActive = activeKinds.has(kind);
          const count = allMarkers.filter((m) => m.kind === kind).length;
          if (count === 0) return null;
          return (
            <button
              key={kind}
              type="button"
              className={cn('stl-filter-chip', isActive && 'stl-filter-chip--active')}
              aria-pressed={isActive}
              onClick={() => toggleKind(kind)}
            >
              <span
                className="stl-filter-chip__dot"
                style={{ background: MARKER_COLOR[kind] }}
                aria-hidden
              />
              {kindLabel(kind)}
              <span>({count})</span>
            </button>
          );
        })}
        <span
          className="stl-count-badge"
          style={{ position: 'static', border: 'none', background: 'none' }}
        >
          <KeyHint keys={['←', '→']} /> navigate
        </span>
      </div>

      {/* ── Scrub bar ── */}
      <div
        ref={trackRef}
        className="stl-track"
        role="slider"
        aria-label="Session timeline scrub"
        aria-valuemin={0}
        aria-valuemax={totalMs}
        aria-valuenow={selectedMarker?.relativeMs ?? 0}
        tabIndex={0}
        onClick={handleTrackClick}
        onMouseMove={(e) => {
          const track = trackRef.current;
          if (!track) return;
          const rect = track.getBoundingClientRect();
          setScrubPct(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
        }}
        onMouseLeave={() => setScrubPct(null)}
        onKeyDown={handleKeyDown}
      >
        {/* baseline */}
        <div className="stl-track__rail" />

        {/* playhead ghost when hovering track */}
        {scrubPct !== null && (
          <>
            <div
              className="stl-track__playhead"
              style={{ left: `${scrubPct * 100}%` }}
              aria-hidden
            />
            <div className="stl-scrub-label" style={{ left: `${scrubPct * 100}%` }} aria-hidden>
              {formatTs(scrubPct * totalMs)}
            </div>
          </>
        )}

        {/* event count */}
        <div className="stl-count-badge" aria-hidden>
          {markers.length} event{markers.length !== 1 ? 's' : ''}
        </div>

        {/* markers */}
        {markers.map((marker) => {
          const pct = totalMs > 0 ? (marker.relativeMs / totalMs) * 100 : 0;
          const shape = MARKER_SHAPE[marker.kind];
          const color = MARKER_COLOR[marker.kind];
          const isSelected = marker.id === selectedId;
          const isHovered = marker.id === hoveredId;

          const tooltipContent = (
            <div className="stl-tooltip-inner">
              <strong>{kindLabel(marker.kind)}</strong>
              <span className="stl-tooltip-ts">
                {formatTs(marker.relativeMs)} &middot; {formatAbsTs(marker.timestamp)}
              </span>
              {Object.entries(marker.payload).map(([k, v]) => (
                <span key={k} className="stl-tooltip-payload">
                  <em>{k}:</em> {String(v)}
                </span>
              ))}
            </div>
          );

          return (
            <Tooltip key={marker.id} content={tooltipContent} side="top">
              <button
                type="button"
                className={cn(
                  'stl-marker',
                  `stl-marker--${shape}`,
                  isSelected && 'stl-marker--selected',
                  isHovered && 'stl-marker--hovered',
                )}
                style={
                  {
                    left: `${pct}%`,
                    '--marker-color': color,
                  } as React.CSSProperties
                }
                aria-label={`${kindLabel(marker.kind)} at ${formatTs(marker.relativeMs)}`}
                aria-pressed={isSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  selectMarker(marker);
                }}
                onMouseEnter={() => setHoveredId(marker.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            </Tooltip>
          );
        })}

        {/* tick labels */}
        <div className="stl-ticks" aria-hidden>
          {[0, 25, 50, 75, 100].map((pct) => (
            <span key={pct} style={{ left: `${pct}%` }}>
              {formatTs((pct / 100) * totalMs)}
            </span>
          ))}
        </div>
      </div>

      {/* ── Selected marker detail ── */}
      {selectedMarker ? (
        <div className="stl-detail" role="region" aria-label="Selected event detail">
          <Badge
            variant={
              selectedMarker.kind === 'question-detected'
                ? 'gold'
                : selectedMarker.kind === 'answer-streamed'
                  ? 'ok'
                  : selectedMarker.kind === 'share-guard-event'
                    ? 'danger'
                    : 'neutral'
            }
            size="sm"
          >
            {kindLabel(selectedMarker.kind)}
          </Badge>
          <span className="stl-detail__ts">
            {formatTs(selectedMarker.relativeMs)} &middot; {formatAbsTs(selectedMarker.timestamp)}
          </span>
          {Object.entries(selectedMarker.payload).map(([k, v]) => (
            <span key={k} className="stl-detail__kv">
              <em>{k}</em>: {String(v)}
            </span>
          ))}
        </div>
      ) : (
        <p className="hint-copy" style={{ marginTop: 'var(--space-2)' }}>
          Click a marker or use ←→ keys to inspect events.
        </p>
      )}

      {/* ── Legend ── */}
      <div className="stl-legend" aria-label="Timeline legend">
        {(Object.keys(MARKER_COLOR) as TimelineMarkerKind[]).map((kind) => (
          <span key={kind} className="stl-legend__item">
            <span
              className="stl-legend__swatch"
              style={{ background: MARKER_COLOR[kind] }}
              aria-hidden
            />
            {kindLabel(kind)}
          </span>
        ))}
      </div>
    </div>
  );
}
