import { useEffect, type ReactElement } from 'react';
import { HashRouter } from 'react-router-dom';
import { CompanionWindow } from './features/companion/CompanionWindow';
import { DashboardWindow } from './features/dashboard/DashboardWindow';
import { CaptureExcludedOverlay } from './features/overlay/CaptureExcludedOverlay';
import { OverlayWindow } from './features/overlay/OverlayWindow';
import { detectWindowRole, type WindowRole } from './app/windowRole';
import { logAssistantShutdown, logAssistantStartup } from './lib/auditLogger';
import { logger } from './lib/logger';
import { warmupProvider } from './lib/providers/providerFactory';
import { createTTSProvider, setTTSProvider } from './lib/providers/ttsProvider';
import { setupAutoActivation } from './lib/runtime/liveCaptureOrchestrator';
import { startMeetingDetectionDaemon } from './lib/runtime/meetingDaemon';
import { useIntegrationStore } from './store/integrationStore';
import { useSessionStore } from './store/sessionStore';
import { useSettingsStore } from './store/settingsStore';
import { ToastViewport } from './components/ui';

type AppProps = {
  windowRole?: WindowRole;
};

function App({ windowRole }: AppProps) {
  const role = windowRole ?? detectWindowRole();

  useEffect(() => {
    useSettingsStore.getState().hydrate();
    useIntegrationStore.getState().hydrate();

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

        // Initialize TTS provider from persisted settings
        const fresh = useSettingsStore.getState();
        setTTSProvider(
          createTTSProvider(fresh.ttsProvider, fresh.openAiApiKey, fresh.elevenlabsApiKey),
        );

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
        useSessionStore.getState().startSession?.();
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

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('share_guard_toggle_shortcut', () => {
          useSessionStore
            .getState()
            .toggleShortcutWithShareGuard()
            .catch((err) => {
              logger.warn('app', 'toggleShortcutWithShareGuard failed', { err: String(err) });
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
      if (unlisten) {
        unlisten();
      }
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
