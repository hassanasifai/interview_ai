import './shareguard.css';
import { useEffect, useMemo, useState } from 'react';
import { ShareGuardDashboard } from './ShareGuardDashboard';
import {
  evaluateShareGuard,
  isLikelyFullScreenShare,
  type ShareGuardResult,
} from '../../lib/runtime/shareGuard';
import {
  forceShowAssistant,
  listProtectionHistory,
  readAutoHiddenState,
  SHARE_GUARD_HIDE_EVENT,
  SHARE_GUARD_RESTORE_EVENT,
  type ShareGuardProtectionHistoryEntry,
} from '../../lib/runtime/shareGuardState';
import { logger } from '../../lib/logger';
import { getShareGuardRuntimeSnapshot, type ShareGuardRuntimeSnapshot } from '../../lib/tauri';
import { useSettingsStore } from '../../store/settingsStore';
import { Card, StatusDot } from '../../components/ui';

const fallbackSnapshot: ShareGuardRuntimeSnapshot = {
  activeWindowProcessName: null,
  activeWindowTitle: null,
  assistantDisplay: 'unknown',
  monitorCount: 1,
  windowBounds: null,
  monitorBounds: [],
};

export function ShareGuardPage() {
  const [snapshot, setSnapshot] = useState<ShareGuardRuntimeSnapshot>(fallbackSnapshot);
  const [autoHidden, setAutoHidden] = useState(readAutoHiddenState);
  const [history, setHistory] = useState<ShareGuardProtectionHistoryEntry[]>(listProtectionHistory);
  // Selector hooks (I21/I22) — read individual settings fields so this page
  // only re-renders when one of these four ShareGuard inputs actually changes.
  const autoHideOnFullScreenShare = useSettingsStore((s) => s.autoHideOnFullScreenShare);
  const hasSecondScreen = useSettingsStore((s) => s.hasSecondScreen);
  const preferSecondScreen = useSettingsStore((s) => s.preferSecondScreen);
  const shareMode = useSettingsStore((s) => s.shareMode);

  const isFullScreenShareActive =
    snapshot.windowBounds && snapshot.monitorBounds.length > 0
      ? isLikelyFullScreenShare({
          windowBounds: snapshot.windowBounds,
          monitorBounds: snapshot.monitorBounds,
        })
      : shareMode === 'entire-screen';

  const shareGuard: ShareGuardResult = useMemo(
    () =>
      evaluateShareGuard({
        shareMode,
        autoHideOnFullScreenShare,
        preferSecondScreen,
        hasSecondScreen: hasSecondScreen || snapshot.monitorCount > 1,
        activeWindowProcessName: snapshot.activeWindowProcessName,
        activeWindowTitle: snapshot.activeWindowTitle,
        assistantDisplay: snapshot.assistantDisplay,
        isFullScreenShareActive: Boolean(isFullScreenShareActive),
        monitorCount: snapshot.monitorCount,
      }),
    [
      snapshot.activeWindowProcessName,
      snapshot.activeWindowTitle,
      autoHideOnFullScreenShare,
      hasSecondScreen,
      isFullScreenShareActive,
      preferSecondScreen,
      shareMode,
      snapshot.assistantDisplay,
      snapshot.monitorCount,
    ],
  );

  useEffect(() => {
    let isMounted = true;

    async function refreshSnapshot() {
      const next = await getShareGuardRuntimeSnapshot();
      if (isMounted) setSnapshot(next);
    }

    refreshSnapshot().catch((err) => {
      logger.warn('share-guard', 'refreshSnapshot failed', { err: String(err) });
    });
    const intervalId = window.setInterval(() => {
      refreshSnapshot().catch((err) => {
        logger.warn('share-guard', 'refreshSnapshot tick failed', { err: String(err) });
      });
    }, 2_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    function refreshProtectionState() {
      setAutoHidden(readAutoHiddenState());
      setHistory(listProtectionHistory());
    }

    window.addEventListener(SHARE_GUARD_HIDE_EVENT, refreshProtectionState);
    window.addEventListener(SHARE_GUARD_RESTORE_EVENT, refreshProtectionState);

    return () => {
      window.removeEventListener(SHARE_GUARD_HIDE_EVENT, refreshProtectionState);
      window.removeEventListener(SHARE_GUARD_RESTORE_EVENT, refreshProtectionState);
    };
  }, []);

  async function handleForceShow() {
    await forceShowAssistant('accepted-risk');
    setAutoHidden(false);
    setHistory(listProtectionHistory());
  }

  const displayStatus = snapshot.assistantDisplay;
  const dotStatus =
    displayStatus === 'non-primary' ? 'ok' : displayStatus === 'primary' ? 'warn' : 'neutral';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        padding: 'var(--space-5)',
      }}
    >
      <ShareGuardDashboard
        autoHidden={autoHidden}
        monitorCount={snapshot.monitorCount}
        onForceShow={handleForceShow}
        protectionHistory={history}
        riskLevel={shareGuard.riskLevel}
        safeDisplayMode={shareGuard.safeDisplayMode}
        shareMode={shareMode}
      />

      {/* ── Runtime signals ── */}
      <Card padding="lg">
        <div className="sg-section-head">
          <div>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, margin: 0 }}>
              Runtime detection signals
            </h2>
            <p
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Live window-level data polled every 2 s via Tauri IPC.
            </p>
          </div>
        </div>
        <div className="sg-runtime-grid">
          <div className="sg-runtime-card">
            <span className="sg-runtime-card__label">Active process</span>
            <span className="sg-runtime-card__value">
              {snapshot.activeWindowProcessName ?? (
                <span style={{ color: 'var(--text-tertiary)' }}>Unavailable</span>
              )}
            </span>
          </div>
          <div className="sg-runtime-card">
            <span className="sg-runtime-card__label">Active window title</span>
            <span className="sg-runtime-card__value" style={{ fontSize: 'var(--fs-xs)' }}>
              {snapshot.activeWindowTitle ?? (
                <span style={{ color: 'var(--text-tertiary)' }}>Unavailable</span>
              )}
            </span>
          </div>
          <div className="sg-runtime-card">
            <span className="sg-runtime-card__label">Assistant display</span>
            <span className="sg-runtime-card__value">
              <StatusDot status={dotStatus} label={snapshot.assistantDisplay} />
            </span>
          </div>
          <div className="sg-runtime-card">
            <span className="sg-runtime-card__label">Monitor count</span>
            <span className="sg-runtime-card__value">{snapshot.monitorCount}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
