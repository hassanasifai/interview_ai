// Phase 2G (G10, I16): Compliance audit log. Every event carries a fresh
// request_id and the current session_id (when known) so downstream forensics
// can correlate UI actions against Rust-side records. Events are flushed to
// the Rust process in batches of 50 (or every 1s, whichever first); a
// per-(target, msg) dedupe ring caps any single noisy source at 5 events per
// minute.

import { persistAuditEvent, readPersistedAuditEvents, type AuditEvent } from './tauri';
import { logger } from './logger';

const AUDIT_LOG_KEY = 'meetingmind-compliance-audit-log';

export type ComplianceAuditEventType =
  | 'assistant_startup'
  | 'assistant_shutdown'
  | 'automatic_hide_trigger'
  | 'force_show_action'
  | 'sensitive_knowledge_base_query';

export type ComplianceAuditEvent = {
  id: string;
  type: ComplianceAuditEventType;
  timestamp: string;
  request_id: string;
  session_id: string | null;
  details: Record<string, string | number | boolean>;
};

// ── Local-storage fallback ───────────────────────────────────────────────────

function canUseLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function readFallbackLog(): ComplianceAuditEvent[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const raw = localStorage.getItem(AUDIT_LOG_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as ComplianceAuditEvent[];
  } catch (err) {
    logger.warn('auditLogger', 'corrupt fallback log; resetting', { err: String(err) });
    localStorage.removeItem(AUDIT_LOG_KEY);
    return [];
  }
}

function writeFallbackLog(events: ComplianceAuditEvent[]) {
  if (!canUseLocalStorage()) {
    return;
  }

  localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(events.slice(-1_000)));
}

// ── ID + session helpers ─────────────────────────────────────────────────────

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type StoreLike = {
  getState: () => { sessionId?: string | null };
};
let _storeRef: StoreLike | null = null;
let _storeLoading = false;

async function loadStore() {
  if (_storeRef || _storeLoading) return;
  _storeLoading = true;
  try {
    const mod = (await import('../store/sessionStore')) as unknown as {
      useSessionStore?: StoreLike;
    };
    if (mod.useSessionStore && typeof mod.useSessionStore.getState === 'function') {
      _storeRef = mod.useSessionStore;
    }
  } catch (err) {
    // Tests / SSR — leave session id as null.
    logger.debug('auditLogger', 'sessionStore lazy-load failed', { err: String(err) });
  } finally {
    _storeLoading = false;
  }
}

function resolveSessionId(): string | null {
  if (_storeRef) {
    try {
      return _storeRef.getState().sessionId ?? null;
    } catch (err) {
      logger.debug('auditLogger', 'sessionId read failed', { err: String(err) });
      return null;
    }
  }
  loadStore().catch((err) => {
    logger.debug('auditLogger', 'loadStore rejected', { err: String(err) });
  });
  return null;
}

// ── Dedupe ───────────────────────────────────────────────────────────────────

const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX = 5;
const _dedupe = new Map<string, number[]>();

function hashKey(target: string, msg: string): string {
  return `${target}::${msg}`;
}

function shouldSuppress(target: string, msg: string): boolean {
  const key = hashKey(target, msg);
  const now = Date.now();
  const stamps = (_dedupe.get(key) ?? []).filter((t) => now - t < DEDUPE_WINDOW_MS);
  if (stamps.length >= DEDUPE_MAX) {
    _dedupe.set(key, stamps);
    return true;
  }
  stamps.push(now);
  _dedupe.set(key, stamps);
  return false;
}

// ── Batched flush ────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_THRESHOLD = 50;
let _pending: ComplianceAuditEvent[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _batchPathBroken = false;

function canUseTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function toNativeAuditEvent(event: ComplianceAuditEvent): AuditEvent {
  // The Rust side currently accepts the legacy {id, type, timestamp, details}
  // shape, so we stash request_id + session_id inside `details` to keep them
  // round-trip-able without breaking the IPC contract.
  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    details: {
      ...event.details,
      __request_id: event.request_id,
      __session_id: event.session_id ?? '',
    },
  };
}

function fromNativeAuditEvent(event: AuditEvent): ComplianceAuditEvent | null {
  const knownTypes: ComplianceAuditEventType[] = [
    'assistant_startup',
    'assistant_shutdown',
    'automatic_hide_trigger',
    'force_show_action',
    'sensitive_knowledge_base_query',
  ];

  if (!knownTypes.includes(event.type as ComplianceAuditEventType)) {
    return null;
  }

  const details = { ...event.details };
  const request_id = typeof details.__request_id === 'string' ? details.__request_id : '';
  const session_id =
    typeof details.__session_id === 'string' && details.__session_id.length > 0
      ? details.__session_id
      : null;
  delete details.__request_id;
  delete details.__session_id;

  return {
    id: event.id,
    type: event.type as ComplianceAuditEventType,
    timestamp: event.timestamp,
    request_id,
    session_id,
    details,
  };
}

async function flushPending() {
  _flushTimer = null;
  if (_pending.length === 0) return;
  const batch = _pending.splice(0);
  const native = batch.map(toNativeAuditEvent);

  if (!canUseTauri()) {
    // No Rust runtime; the localStorage copy is authoritative.
    return;
  }

  if (!_batchPathBroken) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('audit_append_batch', { events: native });
      return;
    } catch (e) {
      // Command not registered (current Rust build only has
      // append_audit_event). Fall back per-event for the rest of this run.
      _batchPathBroken = true;
      logger.debug('audit', 'audit_append_batch unavailable; falling back', {
        err: String(e),
      });
    }
  }

  for (const event of native) {
    try {
      await persistAuditEvent(event);
    } catch (e) {
      logger.warn('audit', 'persist failed', { err: String(e), id: event.id });
      // Re-buffer so the localStorage copy can still be reconciled later.
      writeFallbackLog([...readFallbackLog(), ...batch.filter((b) => b.id === event.id)]);
    }
  }
}

function scheduleFlush() {
  if (_pending.length >= FLUSH_THRESHOLD) {
    flushPending().catch((err) => {
      logger.debug('auditLogger', 'threshold flush rejected', { err: String(err) });
    });
    return;
  }
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    flushPending().catch((err) => {
      logger.debug('auditLogger', 'timer flush rejected', { err: String(err) });
    });
  }, FLUSH_INTERVAL_MS);
}

function createEvent(
  type: ComplianceAuditEventType,
  details: ComplianceAuditEvent['details'] = {},
): ComplianceAuditEvent {
  return {
    id: `compliance-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    timestamp: new Date().toISOString(),
    request_id: newRequestId(),
    session_id: resolveSessionId(),
    details,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function logComplianceEvent(
  type: ComplianceAuditEventType,
  details: ComplianceAuditEvent['details'] = {},
) {
  const msg =
    typeof details.reason === 'string'
      ? details.reason
      : typeof details.query === 'string'
        ? `q[${(details.query as string).length}]`
        : '';
  if (shouldSuppress(type, msg)) {
    return;
  }

  const event = createEvent(type, details);

  // Always mirror to localStorage so a crash before the IPC fires still leaves
  // a forensic record on disk.
  writeFallbackLog([...readFallbackLog(), event]);

  _pending.push(event);
  scheduleFlush();
}

export async function listAuditLog(): Promise<ComplianceAuditEvent[]> {
  try {
    const nativeEvents = await readPersistedAuditEvents();
    const complianceEvents = nativeEvents
      .map(fromNativeAuditEvent)
      .filter((event): event is ComplianceAuditEvent => Boolean(event));

    if (complianceEvents.length > 0) {
      return complianceEvents;
    }
  } catch (e) {
    logger.warn('audit', 'read native audit failed', { err: String(e) });
    return readFallbackLog();
  }

  return readFallbackLog();
}

export function clearAuditLog() {
  if (canUseLocalStorage()) {
    localStorage.removeItem(AUDIT_LOG_KEY);
  }
  _pending = [];
  _dedupe.clear();
}

/** Force any buffered compliance events to flush now (test/debug). */
export function flushComplianceEventsNow(): Promise<void> {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  return flushPending();
}

export function logAssistantStartup() {
  return logComplianceEvent('assistant_startup');
}

export function logAssistantShutdown() {
  return logComplianceEvent('assistant_shutdown');
}

export function logAutoHideTrigger(reason: string) {
  return logComplianceEvent('automatic_hide_trigger', { reason });
}

export function logForceShowAction(reason: string) {
  return logComplianceEvent('force_show_action', { reason });
}

export function logSensitiveKnowledgeBaseQuery(query: string) {
  return logComplianceEvent('sensitive_knowledge_base_query', {
    query,
    queryLength: query.length,
  });
}
