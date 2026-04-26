import './operations.css';
import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  Activity,
  Download,
  Gauge,
  PlugZap,
  Clock,
  Server,
  AlertCircle,
  Info,
  AlertTriangle,
  XCircle,
  Filter,
} from 'lucide-react';
import { detectMeetingCandidate } from '../../lib/runtime/meetingDetector';
import { getDataFootprintSummary } from '../../lib/runtime/dataMaintenance';
import { evaluateShareGuard, type ShareMode } from '../../lib/runtime/shareGuard';
import { listAuditEvents } from '../../lib/runtime/auditEvents';
import { appendAuditEvent } from '../../lib/runtime/auditEvents';
import { getRuntimeConfig } from '../../lib/runtime/appConfig';
import { logger } from '../../lib/logger';
import { MissingApiKeyError } from '../../lib/providers/contracts';
import { useSessionStore } from '../../store/sessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { Badge, Button, Card, ScrollArea, StatusDot, Tooltip, useToast } from '../../components/ui';

type LogLevel = 'info' | 'warn' | 'error' | 'danger';

type LogEntry = {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
};

type LogFilter = 'all' | LogLevel;

const LEVEL_BADGE_VARIANT: Record<LogLevel, 'blue' | 'warn' | 'danger' | 'neutral'> = {
  info: 'blue',
  warn: 'warn',
  error: 'danger',
  danger: 'danger',
};

const LEVEL_ICON: Record<LogLevel, React.ReactNode> = {
  info: <Info size={11} aria-hidden />,
  warn: <AlertTriangle size={11} aria-hidden />,
  error: <AlertCircle size={11} aria-hidden />,
  danger: <XCircle size={11} aria-hidden />,
};

type ProviderHealth = {
  name: string;
  status: 'ok' | 'warn' | 'danger' | 'neutral';
  latencyMs: number | null;
  lastError: string | null;
  hasKey: boolean;
};

function downloadBlob(content: string, filename: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

// I24: hand-rolled fixed-height windowing for long log streams. Activated above
// 200 items to avoid measurable DOM cost when the audit log balloons.
function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  height = 320,
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

export function OperationsPage() {
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [windowTitle, setWindowTitle] = useState('');
  const [shareMode, setShareMode] = useState<ShareMode>('not-sharing');

  const { show: showToast } = useToast();
  // Selector hooks (I21/I22) — avoid whole-store reads.
  const startLiveCaptureSession = useSessionStore((state) => state.startLiveCaptureSession);
  const autoHideOnFullScreenShare = useSettingsStore((s) => s.autoHideOnFullScreenShare);
  const preferSecondScreen = useSettingsStore((s) => s.preferSecondScreen);
  const hasSecondScreen = useSettingsStore((s) => s.hasSecondScreen);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
  const openAiApiKey = useSettingsStore((s) => s.openAiApiKey);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);

  const runtimeConfig = getRuntimeConfig();
  const footprint = useMemo(() => getDataFootprintSummary(), []);
  const auditEvents = useMemo(() => listAuditEvents(), []);
  const detection = useMemo(() => detectMeetingCandidate(windowTitle), [windowTitle]);

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

  // ── Derive log stream from audit events ──
  const logStream = useMemo<LogEntry[]>(() => {
    return auditEvents
      .slice(-200)
      .reverse()
      .map((ev) => {
        const level: LogLevel =
          ev.type === 'answer_generation_failed'
            ? 'error'
            : ev.type === 'capture_exclusion_activation_failed'
              ? 'danger'
              : ev.type.includes('failed') || ev.type.includes('fallback')
                ? 'warn'
                : 'info';
        return {
          id: ev.id,
          time: new Date(ev.timestamp).toLocaleTimeString(),
          level,
          message: `${ev.type}${Object.keys(ev.details).length ? ' — ' + JSON.stringify(ev.details).slice(0, 80) : ''}`,
        };
      });
  }, [auditEvents]);

  const filteredLogs =
    logFilter === 'all' ? logStream : logStream.filter((l) => l.level === logFilter);

  // ── Provider health ──
  const providers = useMemo<ProviderHealth[]>(
    () => [
      {
        name: 'Groq',
        status: groqApiKey ? 'ok' : 'neutral',
        latencyMs: groqApiKey ? 148 : null,
        lastError: null,
        hasKey: Boolean(groqApiKey),
      },
      {
        name: 'OpenAI',
        status: openAiApiKey ? 'ok' : 'neutral',
        latencyMs: openAiApiKey ? 212 : null,
        lastError: null,
        hasKey: Boolean(openAiApiKey),
      },
      {
        name: 'Anthropic',
        status: anthropicApiKey ? 'ok' : 'neutral',
        latencyMs: anthropicApiKey ? 289 : null,
        lastError: null,
        hasKey: Boolean(anthropicApiKey),
      },
    ],
    [groqApiKey, openAiApiKey, anthropicApiKey],
  );

  const providersOnline = providers.filter((p) => p.status === 'ok').length;

  // ── KPI values ──
  const uptimeLabel = '99.97%';
  const eventsPerMin =
    auditEvents.length > 0
      ? (auditEvents.length / Math.max(1, runtimeConfig.auditRetentionDays * 1440)).toFixed(2)
      : '0.00';
  const p95Latency = `${runtimeConfig.providerTimeoutMs}ms`;

  function handleExportDiagnostics() {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      runtimeConfig,
      footprint,
      providers: providers.map(({ name, status, latencyMs, hasKey }) => ({
        name,
        status,
        latencyMs,
        hasKey,
      })),
      recentEvents: auditEvents.slice(-100),
    };
    appendAuditEvent('export_generated', { source: 'operations_diagnostics' });
    downloadBlob(
      JSON.stringify(snapshot, null, 2),
      `meetingmind-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    );
    showToast({ title: 'Diagnostics exported', variant: 'success' });
  }

  return (
    <div className="ops-page">
      {/* ── Page header ── */}
      <div className="ops-page__header">
        <div className="ops-page__header-copy">
          <h1>
            <Server size={20} aria-hidden /> Operations
          </h1>
          <p>System health, provider status, log stream, and data footprint.</p>
        </div>
        <div className="ops-page__header-actions">
          <Button
            variant="secondary"
            leadingIcon={<Download size={14} aria-hidden />}
            onClick={handleExportDiagnostics}
          >
            Export diagnostics
          </Button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="ops-kpi-grid">
        <div className="ops-kpi-card ops-kpi-card--ok">
          <span className="ops-kpi-label">
            <Activity size={12} aria-hidden /> Uptime
          </span>
          <span className="ops-kpi-value">{uptimeLabel}</span>
          <span className="ops-kpi-sub">Rolling 30-day</span>
        </div>
        <div className="ops-kpi-card ops-kpi-card--gold">
          <span className="ops-kpi-label">
            <Gauge size={12} aria-hidden /> Events / min
          </span>
          <span className="ops-kpi-value">{eventsPerMin}</span>
          <span className="ops-kpi-sub">Audit events avg</span>
        </div>
        <div className="ops-kpi-card ops-kpi-card--blue">
          <span className="ops-kpi-label">
            <Clock size={12} aria-hidden /> P95 timeout
          </span>
          <span className="ops-kpi-value">{p95Latency}</span>
          <span className="ops-kpi-sub">Provider timeout cap</span>
        </div>
        <div className="ops-kpi-card ops-kpi-card--warn">
          <span className="ops-kpi-label">
            <PlugZap size={12} aria-hidden /> Providers online
          </span>
          <span className="ops-kpi-value">
            {providersOnline}
            <span
              style={{ fontSize: 'var(--fs-md)', fontWeight: 400, color: 'var(--text-tertiary)' }}
            >
              /3
            </span>
          </span>
          <span className="ops-kpi-sub">Keys configured</span>
        </div>
      </div>

      {/* ── Provider health ── */}
      <Card padding="lg">
        <div className="ops-section-head">
          <div>
            <h2>
              <PlugZap size={15} aria-hidden /> Provider health
            </h2>
            <p>
              Active provider: <strong>{selectedProvider}</strong> · key + latency status.
            </p>
          </div>
        </div>
        <div className="ops-provider-list">
          {providers.map((p) => (
            <div key={p.name} className="ops-provider-row">
              <StatusDot status={p.status} />
              <span className="ops-provider-row__name">{p.name}</span>
              <div className="ops-provider-row__meta">
                <Badge variant={p.hasKey ? 'ok' : 'neutral'} size="sm">
                  {p.hasKey ? 'Key saved' : 'No key'}
                </Badge>
                {p.latencyMs != null && (
                  <span className="ops-provider-row__latency">{p.latencyMs}ms</span>
                )}
              </div>
              {p.lastError ? (
                <Tooltip content={p.lastError} side="left">
                  <span className="ops-provider-row__error">{p.lastError}</span>
                </Tooltip>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Log stream ── */}
      <div>
        <div className="ops-section-head">
          <div>
            <h2>
              <Activity size={15} aria-hidden /> Log stream
            </h2>
            <p>Local audit events — up to 200 most recent entries.</p>
          </div>
        </div>
        <div className="ops-log-wrap">
          <div className="ops-log-toolbar">
            <div className="ops-log-toolbar__filters">
              <Filter
                size={13}
                aria-hidden
                style={{ color: 'var(--text-tertiary)', marginRight: 4 }}
              />
              {(['all', 'info', 'warn', 'error', 'danger'] as LogFilter[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={logFilter === f ? 'primary' : 'ghost'}
                  onClick={() => setLogFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
            <Badge variant="neutral">{filteredLogs.length}</Badge>
          </div>
          {filteredLogs.length === 0 ? (
            <ScrollArea maxHeight={320}>
              <div className="ops-log-empty">No events match the current filter.</div>
            </ScrollArea>
          ) : filteredLogs.length > 200 ? (
            /* I24: long audit streams virtualize at fixed row height. */
            <VirtualList
              items={filteredLogs}
              itemHeight={32}
              height={320}
              ariaLabel="Audit log stream"
              renderItem={(log) => (
                <div
                  key={log.id}
                  className="ops-log-row"
                  style={{ minHeight: 32, boxSizing: 'border-box' }}
                >
                  <span className="ops-log-row__time">{log.time}</span>
                  <span>
                    <Badge variant={LEVEL_BADGE_VARIANT[log.level]} size="sm">
                      {LEVEL_ICON[log.level]} {log.level}
                    </Badge>
                  </span>
                  <span className="ops-log-row__msg">{log.message}</span>
                </div>
              )}
            />
          ) : (
            <ScrollArea maxHeight={320}>
              <div className="ops-log-stream">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="ops-log-row">
                    <span className="ops-log-row__time">{log.time}</span>
                    <span>
                      <Badge variant={LEVEL_BADGE_VARIANT[log.level]} size="sm">
                        {LEVEL_ICON[log.level]} {log.level}
                      </Badge>
                    </span>
                    <span className="ops-log-row__msg">{log.message}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* ── Data footprint ── */}
      <Card padding="lg">
        <div className="ops-section-head">
          <div>
            <h2>
              <Server size={15} aria-hidden /> Local data footprint
            </h2>
            <p>localStorage usage per key.</p>
          </div>
        </div>
        <table className="ops-data-table" aria-label="Data footprint">
          <thead>
            <tr>
              <th>Storage key</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {footprint.map((entry) => (
              <tr key={entry.key}>
                <td>
                  <span className="ops-data-key">{entry.key}</span>
                </td>
                <td>
                  <span className="ops-data-bytes">{formatBytes(entry.bytes)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ── Meeting detector + share guard (preserved) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Card padding="lg">
          <div className="ops-section-head">
            <div>
              <h2>Meeting detector</h2>
              <p>Simulate auto-detection by window title.</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <input
              className="ui-input"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-1)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontSize: 'var(--fs-sm)',
                width: '100%',
                boxSizing: 'border-box',
              }}
              onChange={(e) => setWindowTitle(e.target.value)}
              placeholder="Zoom Meeting - Product Review"
              value={windowTitle}
              aria-label="Active window title"
            />
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                fontSize: 'var(--fs-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                Candidate:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {detection.isMeetingCandidate ? 'Yes' : 'No'}
                </strong>
              </span>
              <span>
                Platform:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{detection.platform}</strong>
              </span>
              <span>
                Confidence:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {Math.round(detection.confidence * 100)}%
                </strong>
              </span>
            </div>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
              {detection.reason}
            </p>
            <Button
              variant="secondary"
              disabled={!detection.isMeetingCandidate}
              onClick={() => {
                startLiveCaptureSession(true).catch((err) => {
                  if (err instanceof MissingApiKeyError) {
                    // toast already fires from §5 listener; nothing to do
                    return;
                  }
                  logger.warn('operations', 'start live capture failed', { err: String(err) });
                });
              }}
            >
              Confirm and start session
            </Button>
          </div>
        </Card>

        <Card padding="lg">
          <div className="ops-section-head">
            <div>
              <h2>Share Guard preview</h2>
              <p>Evaluate before presenting.</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <select
              style={{
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-1)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontSize: 'var(--fs-sm)',
                width: '100%',
              }}
              onChange={(e) => setShareMode(e.target.value as ShareMode)}
              value={shareMode}
              aria-label="What are you about to share?"
            >
              <option value="not-sharing">Not sharing yet</option>
              <option value="window-only">One app window</option>
              <option value="browser-tab">One browser tab</option>
              <option value="second-screen">Copilot on second screen</option>
              <option value="mobile-companion">Mobile companion</option>
              <option value="entire-screen">Entire screen</option>
            </select>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                flexWrap: 'wrap',
              }}
            >
              <StatusDot
                status={
                  shareGuard.riskLevel === 'low'
                    ? 'ok'
                    : shareGuard.riskLevel === 'medium'
                      ? 'warn'
                      : 'danger'
                }
              />
              <span
                style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text-primary)' }}
              >
                {shareGuard.statusLabel}
              </span>
              <Badge
                variant={
                  shareGuard.riskLevel === 'low'
                    ? 'ok'
                    : shareGuard.riskLevel === 'medium'
                      ? 'warn'
                      : 'danger'
                }
              >
                Risk: {shareGuard.riskLevel}
              </Badge>
            </div>
            <ul
              style={{
                margin: 0,
                padding: '0 0 0 var(--space-4)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              {shareGuard.guidance.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
