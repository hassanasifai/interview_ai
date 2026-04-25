import { getRuntimeConfig } from './appConfig';
import { listAuditEvents } from './auditEvents';
import { logger } from '../logger';

const KEY_SESSION_SUMMARIES = 'meetingmind-session-summaries';
const KEY_SETTINGS = 'meetingmind-settings';
const KEY_KNOWLEDGE = 'meetingmind-knowledge-base';
const KEY_AUDIT_EVENTS = 'meetingmind-audit-events';
const KEY_RUNTIME_CONFIG = 'meetingmind-runtime-config';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function pruneAuditEventsByRetention() {
  const { auditRetentionDays } = getRuntimeConfig();
  const events = listAuditEvents();
  const cutoff = Date.now() - auditRetentionDays * 24 * 60 * 60 * 1000;
  const retained = events.filter((event) => Date.parse(event.timestamp) >= cutoff);

  localStorage.setItem(KEY_AUDIT_EVENTS, JSON.stringify(retained));

  if (events.length !== retained.length) {
    logger.info('data.maintenance', 'Pruned expired audit events', {
      pruned: events.length - retained.length,
      retained: retained.length,
      retention_days: auditRetentionDays,
    });
  }
}

let _retentionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * G25: Schedule periodic audit-retention sweeps. Idempotent — calling more
 * than once is a no-op so multiple windows can call it on boot safely.
 */
export function startRetentionScheduler() {
  try {
    pruneAuditEventsByRetention();
  } catch (e) {
    logger.warn('data.maintenance', 'Initial retention sweep failed', { err: String(e) });
  }
  if (_retentionInterval) return;
  if (typeof setInterval === 'undefined') return;
  _retentionInterval = setInterval(() => {
    try {
      pruneAuditEventsByRetention();
    } catch (e) {
      logger.warn('data.maintenance', 'Scheduled retention sweep failed', { err: String(e) });
    }
  }, SIX_HOURS_MS);
}

export function stopRetentionScheduler() {
  if (_retentionInterval) {
    clearInterval(_retentionInterval);
    _retentionInterval = null;
  }
}

export function clearAllLocalProductData() {
  localStorage.removeItem(KEY_SESSION_SUMMARIES);
  localStorage.removeItem(KEY_SETTINGS);
  localStorage.removeItem(KEY_KNOWLEDGE);
  localStorage.removeItem(KEY_AUDIT_EVENTS);
  localStorage.removeItem(KEY_RUNTIME_CONFIG);
}

export function getDataFootprintSummary() {
  const keys = [
    KEY_SESSION_SUMMARIES,
    KEY_SETTINGS,
    KEY_KNOWLEDGE,
    KEY_AUDIT_EVENTS,
    KEY_RUNTIME_CONFIG,
  ];

  return keys.map((key) => ({
    key,
    bytes: (localStorage.getItem(key) ?? '').length,
  }));
}
