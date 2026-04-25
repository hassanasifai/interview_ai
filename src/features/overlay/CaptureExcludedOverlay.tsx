import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, StatusDot } from '../../components/ui';
import { logger } from '../../lib/logger';
import { useOverlayStore } from '../../store/overlayStore';
import { useSessionStore } from '../../store/sessionStore';
import './overlay.css';

interface ExclusionSupport {
  supported: boolean;
  method: string;
}

interface ExclusionResult {
  success: boolean;
  method: string;
  error?: string | null;
}

interface OverlayState {
  visible: boolean;
  exclusionActive: boolean;
  safetyFallback: boolean;
}

export function CaptureExcludedOverlay() {
  const [support, setSupport] = useState<ExclusionSupport | null>(null);
  const [state, setState] = useState<OverlayState>({
    visible: false,
    exclusionActive: false,
    safetyFallback: false,
  });

  // Live data from stores
  const transcript = useSessionStore((s) => s.rollingWindow);
  const suggestion = useOverlayStore((s) => s.currentSuggestion);
  const statusLabel = useOverlayStore((s) => s.statusLabel);

  useEffect(() => {
    invoke<ExclusionSupport>('get_capture_exclusion_support')
      .then((result) => {
        setSupport({ supported: result.supported, method: result.method });
      })
      .catch((error) => {
        logger.error('capture-excluded', 'failed to read capture exclusion support', {
          err: String(error),
        });
      });
  }, []);

  const activateExclusion = useCallback(async (): Promise<boolean> => {
    try {
      const result = await invoke<ExclusionResult>('set_capture_excluded', {
        windowLabel: 'capture-excluded-overlay',
        excluded: true,
      });

      if (result.success) {
        setState((prev) => ({ ...prev, exclusionActive: true, safetyFallback: false }));
        return true;
      }

      setState((prev) => ({ ...prev, exclusionActive: false, safetyFallback: true }));
      logger.warn('capture-excluded', 'exclusion failed, activating safety fallback', {
        err: String(result.error),
      });
      return false;
    } catch (error) {
      setState((prev) => ({ ...prev, exclusionActive: false, safetyFallback: true }));
      logger.error('capture-excluded', 'failed to activate capture exclusion', {
        err: String(error),
      });
      return false;
    }
  }, []);

  const showOverlay = useCallback(async () => {
    let exclusionReady = state.exclusionActive;

    if (!state.exclusionActive && !state.safetyFallback) {
      exclusionReady = await activateExclusion();
    }

    if (exclusionReady || !support?.supported) {
      await invoke('toggle_overlay', {
        label: 'capture-excluded-overlay',
        visible: true,
      });
      setState((prev) => ({ ...prev, visible: true }));
    }
  }, [activateExclusion, state.exclusionActive, state.safetyFallback, support?.supported]);

  const hideOverlay = useCallback(async () => {
    await invoke('toggle_overlay', { label: 'capture-excluded-overlay', visible: false });
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  if (state.safetyFallback) {
    return (
      <div
        className="capture-excluded-fallback"
        role="alertdialog"
        aria-labelledby="cx-fallback-title"
      >
        <ShieldAlert size={40} aria-hidden />
        <h2 id="cx-fallback-title" className="capture-excluded-fallback__title">
          Safety fallback active
        </h2>
        <p className="capture-excluded-fallback__body">
          Capture exclusion is not available on this platform. The assistant is hidden to prevent
          accidental exposure during screen sharing.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            hideOverlay().catch((err) => {
              logger.warn('capture-excluded', 'hideOverlay (fallback) failed', {
                err: String(err),
              });
            });
          }}
        >
          Hide assistant
        </Button>
      </div>
    );
  }

  const isActive = state.exclusionActive;
  return (
    <div className="capture-excluded-shell" role="region" aria-label="Capture-excluded overlay">
      <header className="capture-excluded-header">
        <span
          className={
            isActive
              ? 'capture-excluded-banner capture-excluded-banner--ok'
              : 'capture-excluded-banner capture-excluded-banner--warn'
          }
        >
          {isActive ? (
            <>
              <ShieldCheck size={14} aria-hidden />
              <StatusDot status="ok" aria-label="Capture excluded" />
              Capture exclusion active
            </>
          ) : (
            <>
              <ShieldAlert size={14} aria-hidden />
              <StatusDot status="warn" aria-label="Setting up" />
              Setting up capture exclusion…
            </>
          )}
        </span>
        <span className="capture-excluded-method">{support?.method ?? 'Unknown method'}</span>
      </header>

      <main className="capture-excluded-main">
        <section className="capture-excluded-panel" aria-label="Live transcript preview">
          <h3 className="capture-excluded-panel__title">Live transcript</h3>
          <div className="capture-excluded-panel__body">
            {transcript.length === 0 ? (
              <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                Waiting for session…
              </p>
            ) : (
              <p
                style={{
                  margin: 0,
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-sm)',
                  lineHeight: 1.5,
                }}
              >
                {transcript[transcript.length - 1]?.text ?? ''}
              </p>
            )}
          </div>
        </section>

        <section className="capture-excluded-panel" aria-label="AI suggestion preview">
          <h3 className="capture-excluded-panel__title">
            AI suggestions
            {statusLabel ? (
              <span
                style={{
                  marginLeft: 8,
                  fontWeight: 400,
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-muted)',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                — {statusLabel}
              </span>
            ) : null}
          </h3>
          <div className="capture-excluded-suggestion">
            {suggestion
              ? suggestion.oneLiner || 'Answer suggestion ready — hidden from screen share.'
              : 'Answer suggestions appear here — hidden from the shared screen.'}
          </div>
        </section>
      </main>

      <footer className="capture-excluded-footer">
        <Button
          variant="primary"
          disabled={state.visible}
          onClick={() => {
            showOverlay().catch((err) => {
              logger.warn('capture-excluded', 'showOverlay failed', { err: String(err) });
            });
          }}
          style={{ flex: 1 }}
        >
          Show
        </Button>
        <Button
          variant="secondary"
          disabled={!state.visible}
          onClick={() => {
            hideOverlay().catch((err) => {
              logger.warn('capture-excluded', 'hideOverlay failed', { err: String(err) });
            });
          }}
          style={{ flex: 1 }}
        >
          Hide
        </Button>
      </footer>
    </div>
  );
}
