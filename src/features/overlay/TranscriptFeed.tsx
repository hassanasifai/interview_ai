import './transcript.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import type { TranscriptItem } from '../../store/sessionStore';
import { EmptyState, StatusDot } from '../../components/ui';
import { cn } from '../../lib/cn';

type TranscriptFeedProps = {
  items: TranscriptItem[];
  isLive?: boolean;
};

const LIVE_THRESHOLD_MS = 1_500;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function speakerInitial(speaker: string): string {
  const trimmed = speaker.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const AVATAR_HUES = [28, 200, 280, 140, 340, 46, 180, 260];

function avatarStyleForSpeaker(speaker: string) {
  const hue = AVATAR_HUES[hashString(speaker) % AVATAR_HUES.length];
  return {
    background: `hsl(${hue} 55% 30%)`,
    color: `hsl(${hue} 95% 90%)`,
    boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 45% / 0.4)`,
  };
}

export function TranscriptFeed({ items, isLive = false }: TranscriptFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Live heartbeat so the "is-live" dot updates even when no new items arrive.
  useEffect(() => {
    if (items.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 700);
    return () => window.clearInterval(id);
  }, [items.length]);

  // Detect user-initiated scroll-up to disable auto-follow.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onScroll() {
      if (!node) return;
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
      setUserScrolledUp(!atBottom);
    }
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll to bottom on new items unless user scrolled up.
  useEffect(() => {
    if (userScrolledUp) return;
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [items, userScrolledUp]);

  const lastTimestamp = useMemo(
    () => (items.length > 0 ? items[items.length - 1].timestamp : 0),
    [items],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Mic size={22} aria-hidden />}
        title="Waiting for audio…"
        description="Start a session to stream transcript lines here."
      />
    );
  }

  return (
    <div ref={containerRef} className="transcript-list" role="log" aria-live="polite">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const recent = isLast && (isLive || now - lastTimestamp <= LIVE_THRESHOLD_MS);
        return (
          <div key={item.id} className={cn('transcript-item', recent && 'transcript-item--live')}>
            <span
              className="transcript-avatar"
              style={avatarStyleForSpeaker(item.speaker)}
              aria-hidden
            >
              {speakerInitial(item.speaker)}
            </span>
            <span className="transcript-item__speaker">
              <span>{item.speaker}</span>
              {recent ? <StatusDot status="ok" aria-label="Live" /> : null}
            </span>
            <span className="transcript-item__time">{formatTime(item.timestamp)}</span>
            <p className="transcript-item__body">{item.text}</p>
          </div>
        );
      })}
    </div>
  );
}
