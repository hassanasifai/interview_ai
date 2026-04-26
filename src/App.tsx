import { useEffect, type ReactElement } from 'react';
import { HashRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CompanionWindow } from './features/companion/CompanionWindow';
import { DashboardWindow } from './features/dashboard/DashboardWindow';
import { CaptureExcludedOverlay } from './features/overlay/CaptureExcludedOverlay';
import { OverlayWindow } from './features/overlay/OverlayWindow';
import { detectWindowRole, type WindowRole } from './app/windowRole';
import {
  logAssistantShutdown,
  logAssistantStartup,
  setSessionStoreRef as setAuditLoggerStoreRef,
} from './lib/auditLogger';
import { logger } from './lib/logger';
import { MissingApiKeyError } from './lib/providers/contracts';
import { warmupProvider } from './lib/providers/providerFactory';
import { createTTSProvider, setTTSProvider } from './lib/providers/ttsProvider';
import { setSessionStoreRef as setAuditEventsStoreRef } from './lib/runtime/auditEvents';
import { setupAutoActivation } from './lib/runtime/liveCaptureOrchestrator';
import { startMeetingDetectionDaemon } from './lib/runtime/meetingDaemon';
import { armPersistedRefreshes } from './lib/integrations/oauthRefresh';
import { checkForUpdatesOnStartup } from './lib/runtime/appUpdater';
import { useIntegrationStore } from './store/integrationStore';
import { replayPendingTranscriptPersist, useSessionStore } from './store/sessionStore';
import { useSettingsStore } from './store/settingsStore';
import { ToastViewport, toastStore } from './components/ui';

// Inject the session store into modules that previously used a dynamic import
// to break the circular dep. Done at module-evaluation time (after both
// modules are fully loaded) so all subsequent audit events resolve sessionId
// synchronously.
setAuditLoggerStoreRef(useSessionStore);
setAuditEventsStoreRef(useSessionStore);

type AppProps = {
  windowRole?: WindowRole;
};

function App({ windowRole }: AppProps) {
  const role = windowRole ?? detectWindowRole();

  useEffect(() => {
    useSettingsStore.getState().hydrate();
    useIntegrationStore.getState().hydrate();
    // D8 fix: arm OAuth refresh schedulers for any persisted Zoom/Google
    // tokens. Runs after hydrate() returns synchronously; the actual
    // keychain reads inside hydrate are async and will arm again as they
    // resolve, so this is a fast-path arm for the synchronous in-memory copy.
    armPersistedRefreshes();

    // Production-grade auto-update check. Silent in dev, silent if no update
    // is available, surfaces a toast + restart prompt when one is found.
    checkForUpdatesOnStartup().catch((err) => {
      logger.debug('app', 'update check skipped', { err: String(err) });
    });

    // Hydrate API keys from OS keychain, then fall back to VITE_ env vars
    useSettingsStore
      .getState()
      .hydrateApiKeys()
      .then(() => {
        const s = useSettingsStore.getState();
        const envGroq = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
        if (!s.groqApiKey && envGroq?.trim()) {
          useSettingsStore
            .getState()
            .patch({ groqApiKey: envGroq.trim(), selectedProvider: 'groq' });
          useSettingsStore
            .getState()
            .saveApiKey('groq', envGroq.trim())
            .catch((err) => {
              logger.warn('app', 'saveApiKey failed', { err: String(err) });
            });
        }

        // Initialize TTS provider from persisted settings. If the configured
        // provider is missing its key (common in tests / fresh installs),
        // silently fall back to BrowserTTSProvider rather than letting
        // MissingApiKeyError propagate up the boot chain.
        const fresh = useSettingsStore.getState();
        try {
          setTTSProvider(
            createTTSProvider(fresh.ttsProvider, fresh.openAiApiKey, fresh.elevenlabsApiKey),
          );
        } catch (err) {
          if (!(err instanceof MissingApiKeyError)) {
            logger.warn('app', 'createTTSProvider failed', { err: String(err) });
          }
          setTTSProvider(createTTSProvider('browser'));
        }

        // Pre-warm TCP connection to the selected LLM endpoint
        const activeKey =
          fresh.selectedProvider === 'openai'
            ? fresh.openAiApiKey
            : fresh.selectedProvider === 'anthropic'
              ? fresh.anthropicApiKey
              : fresh.groqApiKey;
        warmupProvider(fresh.selectedProvider, activeKey).catch((err) => {
          logger.warn('app', 'Provider warmup failed', { err: String(err) });
        });

        // Sync persisted VAD threshold to Rust side on boot.
        invoke('set_vad_threshold', {
          threshold: useSettingsStore.getState().vadThreshold,
        }).catch((err) => {
          logger.warn('app', 'set_vad_threshold sync failed', { err: String(err) });
        });

        // Gap 10: re-apply persisted target monitor on startup so the
        // overlay/companion windows return to the user's chosen display
        // without requiring them to re-pick from Settings each launch.
        const persistedMonitorId = fresh.targetMonitorId;
        if (persistedMonitorId !== null) {
          invoke<Array<{ id: number; x: number; y: number; width: number; height: number }>>(
            'get_monitors',
          )
            .then((monitors) => {
              const m = monitors.find((mon) => mon.id === persistedMonitorId);
              if (!m) return;
              return invoke('set_overlay_monitor', {
                x: m.x,
                y: m.y,
                width: m.width,
                height: m.height,
              });
            })
            .catch((err) => {
              logger.warn('app', 'restore target monitor failed', { err: String(err) });
            });
        }

        // D1 follow-up: replay any transcript items the WAL captured the
        // last time persistence failed (e.g. mid-write crash).
        try {
          replayPendingTranscriptPersist();
        } catch {
          /* noop */
        }
      })
      .catch((err) => {
        logger.warn('app', 'hydrateApiKeys failed', { err: String(err) });
      });

    logAssistantStartup().catch((err) => {
      logger.warn('app', 'logAssistantStartup failed', { err: String(err) });
    });

    function handleUnload() {
      logAssistantShutdown().catch((err) => {
        logger.warn('app', 'logAssistantShutdown failed', { err: String(err) });
      });
    }

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  // Auto-meeting detection daemon (dashboard window only)
  useEffect(() => {
    if (role !== 'dashboard') return;
    let stopDaemon: (() => void) | null = null;
    let unlistenAutoActivation: (() => void) | null = null;

    startMeetingDetectionDaemon(({ platform }) => {
      window.dispatchEvent(new CustomEvent('meeting_detected', { detail: { platform } }));
    })
      .then((stop) => {
        stopDaemon = stop;
      })
      .catch((err) => {
        logger.warn('app', 'startMeetingDetectionDaemon failed', { err: String(err) });
      });

    // Wire auto-activation: show overlay when a meeting is detected (if enabled)
    if (useSettingsStore.getState().autoActivate) {
      setupAutoActivation(() => {
        window.dispatchEvent(new CustomEvent('meeting_detected', { detail: { platform: 'auto' } }));
        useSessionStore
          .getState()
          .startLiveCaptureSession(true)
          .catch((err) => {
            if (err instanceof MissingApiKeyError) {
              // toast already fires from §5 listener; nothing to do
              return;
            }
            logger.warn('auto-activation', 'start live capture failed', { err: String(err) });
          });
      })
        .then((unlisten) => {
          unlistenAutoActivation = unlisten;
        })
        .catch((err) => {
          logger.warn('app', 'setupAutoActivation failed', { err: String(err) });
        });
    }

    return () => {
      stopDaemon?.();
      unlistenAutoActivation?.();
    };
  }, [role]);

  useEffect(() => {
    if (role !== 'dashboard') {
      return;
    }

    let unlisten: null | (() => void) = null;
    let unlistenHotkeyFail: null | (() => void) = null;
    let unlistenCaptureLost: null | (() => void) = null;

    (async () => {
      try {
        unlisten = await listen('share_guard_toggle_shortcut', () => {
          useSessionStore
            .getState()
            .toggleShortcutWithShareGuard()
            .catch((err) => {
              logger.warn('app', 'toggleShortcutWithShareGuard failed', { err: String(err) });
            });
        });

        // LOW 21: surface hotkey-register failures as a toast so the user
        // knows why their chord isn't firing (most common cause: another
        // app already owns it).
        unlistenHotkeyFail = await listen<{
          chord: string;
          event: string;
          reason: string;
        }>('hotkey_register_failed', (e) => {
          const { chord, event, reason } = e.payload;
          toastStore.show({
            variant: 'warn',
            title: 'Hotkey unavailable',
            description: `${chord} (${event}) couldn't be registered: ${reason}. Remap it in Settings → Hotkeys.`,
            durationMs: 8000,
          });
        });

        // S2: surface screen_capture_lost so the user can re-grant capture
        // permission instead of staring at a black screenshot.
        unlistenCaptureLost = await listen<{ reason: string }>('screen_capture_lost', (e) => {
          toastStore.show({
            variant: 'danger',
            title: 'Screen capture revoked',
            description: e.payload?.reason
              ? `${e.payload.reason}. Re-grant capture access in System Settings.`
              : 'Re-grant capture access in System Settings, then try again.',
            durationMs: 10000,
          });
        });
      } catch (err) {
        logger.warn('app', 'share_guard listener setup failed', { err: String(err) });
        unlisten = null;
      }
    })().catch((err) => {
      logger.warn('app', 'share_guard listener IIFE failed', { err: String(err) });
    });

    return () => {
      unlisten?.();
      unlistenHotkeyFail?.();
      unlistenCaptureLost?.();
    };
  }, [role]);

  // Active screen-share auto-relocate: when a meeting transitions to
  // screen-sharing, move the overlay to a non-primary monitor (if one
  // exists) so it's invisible in the share. When sharing stops, restore
  // the user's chosen target monitor.
  useEffect(() => {
    if (role !== 'dashboard') return;
    let unlistenShare: null | (() => void) = null;
    let restoreMonitorId: number | null = null;

    (async () => {
      unlistenShare = await listen<{ sharing: boolean }>('mm:share-mode-changed', (e) => {
        void (async () => {
          const sharing = !!e.payload?.sharing;
          try {
            const monitors =
              await invoke<
                Array<{
                  id: number;
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  isPrimary: boolean;
                }>
              >('get_monitors');
            if (sharing) {
              // Save the user's current preference so we can restore it.
              restoreMonitorId = useSettingsStore.getState().targetMonitorId;
              const offShare = monitors.find((m) => !m.isPrimary) ?? monitors[0];
              if (offShare) {
                await invoke('set_overlay_monitor', {
                  x: offShare.x,
                  y: offShare.y,
                  width: offShare.width,
                  height: offShare.height,
                });
                toastStore.show({
                  variant: 'info',
                  title: 'Screen sharing detected',
                  description:
                    monitors.length > 1
                      ? 'Overlay moved to your secondary display.'
                      : 'Overlay stays hidden via WDA_EXCLUDEFROMCAPTURE.',
                  durationMs: 5000,
                });
              }
            } else if (restoreMonitorId !== null) {
              const target = monitors.find((m) => m.id === restoreMonitorId);
              if (target) {
                await invoke('set_overlay_monitor', {
                  x: target.x,
                  y: target.y,
                  width: target.width,
                  height: target.height,
                });
              }
              restoreMonitorId = null;
            }
          } catch (err) {
            logger.warn('app', 'share-mode auto-relocate failed', { err: String(err) });
          }
        })();
      });
    })().catch((err) => {
      logger.warn('app', 'share-mode listener setup failed', { err: String(err) });
    });

    return () => {
      unlistenShare?.();
    };
  }, [role]);

  let body: ReactElement;
  if (role === 'overlay') {
    body = <OverlayWindow />;
  } else if (role === 'capture-excluded-overlay') {
    body = <CaptureExcludedOverlay />;
  } else if (role === 'companion') {
    body = <CompanionWindow />;
  } else {
    body = (
      <HashRouter>
        <DashboardWindow />
      </HashRouter>
    );
  }

  return (
    <>
      <ToastViewport />
      {body}
    </>
  );
}

export default App;
