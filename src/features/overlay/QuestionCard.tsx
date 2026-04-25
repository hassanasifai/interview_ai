import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, Card } from '../../components/ui';
import type { BadgeVariant } from '../../components/ui';

type QuestionType =
  | 'factual'
  | 'pricing'
  | 'technical'
  | 'objection'
  | 'behavioral'
  | 'system-design'
  | 'coding'
  | 'hr'
  | 'other';

type QuestionCardProps = {
  question: string;
  type?: QuestionType;
  oneLiner?: string;
  confidence?: number;
  bullets: string[];
  supportSnippets?: string[];
  suggestedFollowup?: string;
  redFlags?: string[];
  timestamp?: number;
};

const STAR_LABELS: Record<string, string> = {
  'S:': 'Situation',
  'T:': 'Task',
  'A:': 'Action',
  'R:': 'Result',
};

const TYPE_BADGE: Record<QuestionType, { variant: BadgeVariant; label: string }> = {
  behavioral: { variant: 'violet', label: 'Behavioral' },
  'system-design': { variant: 'blue', label: 'System design' },
  factual: { variant: 'gold', label: 'Factual' },
  technical: { variant: 'ok', label: 'Technical' },
  pricing: { variant: 'gold', label: 'Pricing' },
  objection: { variant: 'warn', label: 'Objection' },
  coding: { variant: 'blue', label: 'Coding' },
  hr: { variant: 'neutral', label: 'HR' },
  other: { variant: 'neutral', label: 'Other' },
};

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STAR_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  'S:': 'gold',
  'T:': 'blue',
  'A:': 'violet',
  'R:': 'ok',
};

const STAR_BULLET_CLASSES: Record<string, string> = {
  'S:': 'q-card-bullet--star-S',
  'T:': 'q-card-bullet--star-T',
  'A:': 'q-card-bullet--star-A',
  'R:': 'q-card-bullet--star-R',
};

function StarBullet({ bullet, delay }: { bullet: string; delay: number }) {
  const prefix = bullet.slice(0, 2);
  const label = STAR_LABELS[prefix];
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  if (label) {
    const variant = STAR_BADGE_VARIANTS[prefix] ?? 'gold';
    const bulletClass = STAR_BULLET_CLASSES[prefix] ?? '';
    return (
      <li className={`q-card-bullet ${bulletClass}`} style={style}>
        <Badge variant={variant} size="sm" className="q-card-bullet__star">
          {label}
        </Badge>
        {bullet.slice(3).trim()}
      </li>
    );
  }
  return (
    <li className="q-card-bullet" style={style}>
      {bullet}
    </li>
  );
}

export function QuestionCard({
  question,
  type = 'other',
  oneLiner = '',
  confidence = 0,
  bullets,
  supportSnippets = [],
  suggestedFollowup = '',
  redFlags = [],
  timestamp,
}: QuestionCardProps) {
  const typeMeta = TYPE_BADGE[type];
  const clampedConfidence = useMemo(() => Math.max(0, Math.min(1, confidence)), [confidence]);
  const confidencePct = Math.round(clampedConfidence * 100);
  // Capture mount-time fallback timestamp via lazy useState initializer so render
  // stays pure (initializer runs only once on first render).
  const [fallbackTs] = useState<number>(() => Date.now());
  const clock = timestamp ? formatClock(timestamp) : formatClock(fallbackTs);

  return (
    <Card variant="elevated" padding="md" aria-label="Question suggestion">
      <header className="q-card-header">
        <Badge variant={typeMeta.variant} size="sm">
          {typeMeta.label}
        </Badge>
        <div className="q-card-header__mid" aria-label="Confidence">
          <div
            className="q-confidence"
            role="progressbar"
            aria-valuenow={confidencePct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="q-confidence__fill" style={{ width: `${confidencePct}%` }} />
          </div>
          <span className="q-confidence__value">{confidencePct}%</span>
        </div>
        <span className="q-card-time" aria-hidden>
          {clock}
        </span>
      </header>

      <h2 className="q-card-title">{question}</h2>
      {oneLiner ? <p className="q-card-oneliner">{oneLiner}</p> : null}

      <ul className="q-bullet-list">
        {bullets.map((bullet, i) => (
          <StarBullet key={`${bullet}-${i}`} bullet={bullet} delay={i * 40} />
        ))}
      </ul>

      {supportSnippets.length > 0 ? (
        <section className="q-card-section q-card-section--evidence">
          <h3 className="q-card-section__title">Evidence</h3>
          <ul>
            {supportSnippets.map((s, i) => (
              <li key={`${s}-${i}`}>{s}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {suggestedFollowup ? (
        <section className="q-card-section q-card-section--followup">
          <h3 className="q-card-section__title">Suggested follow-up</h3>
          <p style={{ margin: 0 }}>{suggestedFollowup}</p>
        </section>
      ) : null}

      {redFlags.length > 0 ? (
        <section className="q-card-section q-card-section--redflags">
          <h3 className="q-card-section__title">Red flags</h3>
          <ul>
            {redFlags.map((flag, i) => (
              <li key={`${flag}-${i}`}>{flag}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
