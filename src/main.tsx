import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { appendAuditEvent } from './lib/runtime/auditEvents';
import { logger } from './lib/logger';
import { startRetentionScheduler } from './lib/runtime/dataMaintenance';
import { toastStore } from './components/ui';

// G9: Catch every promise rejection and uncaught error that escapes the
// React boundary so we still get a structured log entry instead of a silent
// drop into the console.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('global', 'Unhandled promise rejection', {
      reason: String(event.reason),
    });
  });
  window.addEventListener('error', (event) => {
    logger.error('global', 'Uncaught error', {
      msg: event.message,
      src: event.filename,
      line: event.lineno,
    });
  });

  // G26: API-down detector. Network code dispatches `mm:network-timeout`
  // events; once we see 3 inside a 60-second sliding window we fire
  // `mm:api-down` so the UI can flip into degraded mode.
  let _timeoutCount = 0;
  let _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('mm:network-timeout', () => {
    _timeoutCount++;
    if (_timeoutTimer) clearTimeout(_timeoutTimer);
    _timeoutTimer = setTimeout(() => {
      _timeoutCount = 0;
    }, 60_000);
    if (_timeoutCount >= 3) {
      window.dispatchEvent(
        new CustomEvent('mm:api-down', { detail: { reason: '3 timeouts in 60s' } }),
      );
    }
  });

  // Bridge keychain / STT / api-down custom events into visible toasts so the
  // user sees actionable feedback instead of silent dispatch.
  window.addEventListener('mm:keychain-error', (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {};
    toastStore.show({
      title: detail.op === 'missing' ? 'Add API key in Settings' : 'OS keychain error',
      description: `Provider: ${detail.provider ?? 'unknown'}`,
      variant: 'warn',
    });
  });

  window.addEventListener('mm:stt-error', (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {};
    if (detail.status === 401) {
      toastStore.show({ title: 'Invalid Groq API key', variant: 'danger' });
    } else if (detail.status === 429) {
      toastStore.show({
        title: 'STT rate-limited',
        description: 'Will retry shortly',
        variant: 'warn',
      });
    } else {
      toastStore.show({
        title: 'STT error',
        description: String(detail.reason ?? detail.status ?? 'unknown'),
        variant: 'warn',
      });
    }
  });

  window.addEventListener('mm:api-down', () => {
    toastStore.show({
      title: 'API down',
      description: 'Multiple timeouts in 60s. Falling back to local providers if available.',
      variant: 'danger',
    });
  });
}

appendAuditEvent('app_initialized', {
  runtime: 'web',
  mode: import.meta.env.MODE,
});

// G25: Start the audit-event retention sweeper. Runs once on boot and then
// every 6 hours so old events do not accumulate past the configured window.
startRetentionScheduler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
