import './shareguard.css';
import { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Monitor,
  Eye,
  EyeOff,
  Share2,
  History,
  AlertTriangle,
  Wifi,
  Video,
  MonitorUp,
  Users,
} from 'lucide-react';
import type { ShareGuardResult } from '../../lib/runtime/shareGuard';
import { Badge, Button, EmptyState, ScrollArea, StatusDot } from '../../components/ui';

export type ProtectionHistoryEntry = {
  id: string;
  timestamp: string;
  reason: string;
};

type ShareGuardDashboardProps = {
  riskLevel: ShareGuardResult['riskLevel'];
  monitorCount: number;
  protectionHistory: ProtectionHistoryEntry[];
  autoHidden: boolean;
  safeDisplayMode: boolean;
  onForceShow: () => Promise<void> | void;
  shareMode?: string;
  onSimulateScenario?: (scenario: string) => void;
};

type PlatformPermission = 'allowed' | 'blocked' | 'partial';

type PlatformRow = {
  platform: string;
  icon: string;
  screenShare: PlatformPermission;
  recording: PlatformPermission;
  remoteControl: PlatformPermission;
  participantView: PlatformPermission;
};

const PLATFORM_MATRIX: PlatformRow[] = [
  {
    platform: 'Zoom',
    icon: '🔵',
    screenShare: 'allowed',
    recording: 'partial',
    remoteControl: 'partial',
    participantView: 'allowed',
  },
  {
    platform: 'Teams',
    icon: '🟣',
    screenShare: 'allowed',
    recording: 'partial',
    remoteControl: 'blocked',
    participantView: 'allowed',
  },
  {
    platform: 'Meet',
    icon: '🟢',
    screenShare: 'allowed',
    recording: 'partial',
    remoteControl: 'blocked',
    participantView: 'allowed',
  },
  {
    platform: 'Slack',
    icon: '🟡',
    screenShare: 'allowed',
    recording: 'blocked',
    remoteControl: 'blocked',
    participantView: 'partial',
  },
];

const permVariant = (p: PlatformPermission): 'ok' | 'warn' | 'danger' =>
  p === 'allowed' ? 'ok' : p === 'partial' ? 'warn' : 'danger';

const permLabel = (p: PlatformPermission) =>
  p === 'allowed' ? 'Safe' : p === 'partial' ? 'Partial' : 'Exposed';

const riskLabel: Record<ShareGuardResult['riskLevel'], string> = {
  low: 'PROTECTED',
  medium: 'CAUTION',
  high: 'AT RISK',
};

const riskReason: Record<ShareGuardResult['riskLevel'], string> = {
  low: 'Your assistant is on a private surface — participants cannot see it.',
  medium: 'Some aspects of your setup need attention before you present.',
  high: 'High exposure risk — move the assistant off the shared display now.',
};

function formatShareMode(mode: string | undefined): string {
  if (!mode) return 'Not active';
  return mode
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function ShareGuardDashboard({
  autoHidden,
  monitorCount,
  onForceShow,
  protectionHistory,
  riskLevel,
  safeDisplayMode,
  shareMode,
  onSimulateScenario,
}: ShareGuardDashboardProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleConfirmForceShow() {
    setIsSaving(true);
    try {
      await onForceShow();
      setIsConfirming(false);
    } finally {
      setIsSaving(false);
    }
  }

  function handleSimulate(scenario: string) {
    if (onSimulateScenario) {
      onSimulateScenario(scenario);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('meetingmind:share-guard-simulate', { detail: { scenario } }),
      );
    }
  }

  const bannerStatus =
    riskLevel === 'low' ? 'protected' : riskLevel === 'medium' ? 'caution' : 'at-risk';
  const dotStatus = riskLevel === 'low' ? 'ok' : riskLevel === 'medium' ? 'warn' : 'danger';
  const overlayStatus = autoHidden ? 'Auto-hidden' : safeDisplayMode ? 'Cloaked' : 'Visible';

  return (
    <div className="sg-page">
      {/* ── Status banner ── */}
      <div className="sg-banner" data-status={bannerStatus}>
        <div className="sg-banner__left">
          <span className="sg-banner__eyebrow">
            <ShieldAlert size={12} aria-hidden /> Share Guard
          </span>
          <h2 className="sg-banner__title">
            <StatusDot status={dotStatus} />
            {riskLabel[riskLevel]}
          </h2>
          <p className="sg-banner__reason">{riskReason[riskLevel]}</p>
        </div>

        <div className="sg-banner__right">
          <div className="sg-banner__pill" data-safe={safeDisplayMode}>
            {safeDisplayMode ? (
              <ShieldCheck size={13} aria-hidden />
            ) : (
              <ShieldAlert size={13} aria-hidden />
            )}
            {safeDisplayMode ? 'Safe display mode' : 'Guard active'}
          </div>

          {isConfirming ? (
            <div className="sg-confirm" role="alert">
              <p>
                <AlertTriangle
                  size={13}
                  aria-hidden
                  style={{ verticalAlign: -2, marginRight: 6 }}
                />
                Confirm you accept the current sharing risk before showing the assistant.
              </p>
              <div className="sg-confirm__actions">
                <Button
                  variant="danger"
                  loading={isSaving}
                  onClick={() => void handleConfirmForceShow()}
                >
                  Confirm force show
                </Button>
                <Button
                  variant="secondary"
                  disabled={isSaving}
                  onClick={() => setIsConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant={riskLevel === 'low' ? 'secondary' : 'danger'}
              size="sm"
              onClick={() => setIsConfirming(true)}
            >
              Enforce now
            </Button>
          )}
        </div>
      </div>

      {/* ── Metrics strip ── */}
      <div className="sg-runtime-grid" aria-label="Share Guard metrics">
        <div className="sg-runtime-card">
          <span className="sg-runtime-card__label">
            <Monitor size={11} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
            Monitors
          </span>
          <span className="sg-runtime-card__value">
            {monitorCount}&nbsp;
            <Badge variant={monitorCount > 1 ? 'ok' : 'neutral'} size="sm">
              {monitorCount > 1 ? 'Multi' : 'Single'}
            </Badge>
          </span>
        </div>

        <div className="sg-runtime-card">
          <span className="sg-runtime-card__label">
            {autoHidden ? (
              <EyeOff size={11} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
            ) : (
              <Eye size={11} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
            )}
            Overlay
          </span>
          <span className="sg-runtime-card__value">
            {overlayStatus}&nbsp;
            <Badge variant={autoHidden ? 'warn' : safeDisplayMode ? 'ok' : 'neutral'} size="sm">
              {autoHidden ? 'Hidden' : safeDisplayMode ? 'Cloaked' : 'Live'}
            </Badge>
          </span>
        </div>

        <div className="sg-runtime-card">
          <span className="sg-runtime-card__label">
            <Share2 size={11} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
            Share target
          </span>
          <span className="sg-runtime-card__value">
            {formatShareMode(shareMode)}&nbsp;
            <Badge variant={shareMode === 'entire-screen' ? 'danger' : 'neutral'} size="sm">
              {shareMode === 'entire-screen' ? 'Exposed' : 'Scoped'}
            </Badge>
          </span>
        </div>

        <div className="sg-runtime-card">
          <span className="sg-runtime-card__label">
            <Wifi size={11} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
            Risk level
          </span>
          <span className="sg-runtime-card__value">
            <Badge variant={dotStatus} size="sm">
              {riskLabel[riskLevel]}
            </Badge>
          </span>
        </div>
      </div>

      {/* ── Platform permission matrix ── */}
      <div>
        <div className="sg-section-head">
          <div>
            <h2>
              <MonitorUp size={15} aria-hidden /> Platform matrix
            </h2>
            <p>Exposure profile per conferencing platform and sharing capability.</p>
          </div>
        </div>
        <div className="sg-matrix-wrap">
          <table className="sg-matrix" aria-label="Platform permission matrix">
            <thead>
              <tr>
                <th>Platform</th>
                <th>
                  <Share2 size={12} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
                  Screen share
                </th>
                <th>
                  <Video size={12} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
                  Recording
                </th>
                <th>
                  <MonitorUp size={12} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
                  Remote control
                </th>
                <th>
                  <Users size={12} aria-hidden style={{ marginRight: 4, verticalAlign: -1 }} />
                  Participant view
                </th>
              </tr>
            </thead>
            <tbody>
              {PLATFORM_MATRIX.map((row) => (
                <tr key={row.platform}>
                  <td>
                    <span className="sg-matrix__platform">
                      <span aria-hidden>{row.icon}</span>
                      {row.platform}
                    </span>
                  </td>
                  <td>
                    <Badge variant={permVariant(row.screenShare)}>
                      {permLabel(row.screenShare)}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={permVariant(row.recording)}>{permLabel(row.recording)}</Badge>
                  </td>
                  <td>
                    <Badge variant={permVariant(row.remoteControl)}>
                      {permLabel(row.remoteControl)}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={permVariant(row.participantView)}>
                      {permLabel(row.participantView)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Event timeline ── */}
      <div className="sg-timeline-section">
        <div className="sg-timeline-head">
          <h3>
            <History size={14} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
            Event timeline
          </h3>
          <Badge variant="neutral">{protectionHistory.length}</Badge>
        </div>
        <ScrollArea
          maxHeight={280}
          style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}
        >
          {protectionHistory.length > 0 ? (
            <div className="sg-timeline">
              {protectionHistory
                .slice()
                .reverse()
                .map((entry) => (
                  <div key={entry.id} className="sg-timeline__item">
                    <span className="sg-timeline__dot" aria-hidden />
                    <div className="sg-timeline__body">
                      <span className="sg-timeline__time">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <span className="sg-timeline__reason">{entry.reason}</span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState
              title="No events recorded"
              description="Protection triggers will appear here during active sessions."
            />
          )}
        </ScrollArea>
      </div>

      {/* ── Simulate scenarios ── */}
      <div
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <span
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-tertiary)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Simulate
        </span>
        {(['entire-screen', 'window-only', 'browser-tab', 'second-screen'] as const).map((s) => (
          <Button key={s} size="sm" variant="secondary" onClick={() => handleSimulate(s)}>
            {s
              .split('-')
              .map((w) => w[0].toUpperCase() + w.slice(1))
              .join(' ')}
          </Button>
        ))}
      </div>
    </div>
  );
}
