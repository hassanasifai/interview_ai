// Phase 2G (G10, I16): Audit-event sink with request_id + session_id stamping,
// batched flush to the Rust side, and client-side dedupe so a chatty subsystem
// cannot blow out the audit table.

import { logger } from '../logger';

const STORAGE_KEY = 'meetingmind-audit-events';

export type AuditEventType =
  | 'app_initialized'
  | 'consent_updated'
  | 'session_started'
  | 'session_paused'
  | 'session_resumed'
  | 'session_ended'
  | 'transcript_ingested'
  | 'answer_generated'
  | 'answer_generation_failed'
  | 'export_generated'
  | 'capture_exclusion_activated'
  | 'capture_exclusion_activation_failed'
  | 'capture_exclusion_fallback_hidden'
  | 'capture_exclusion_removed';

export type AuditEvent = {
  id: string;
  type: AuditEventType;
  timestamp: string;
  request_id: string;
  session_id: string | null;
  details: Record<string, string | number | boolean>;
};

// ── Persistence helpers ──────────────────────────────────────────────────────

function readEvents(): AuditEvent[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as AuditEvent[];
  } catch (err) {
    logger.warn('auditEvents', 'corrupt persisted events; resetting', { err: String(err) });
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeEvents(events: AuditEvent[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

// ── ID + session helpers ─────────────────────────────────────────────────────

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Cached reference to the zustand store so we can read sessionId synchronously
// at fire-time without forcing an eager import (which would create a cycle
// with feature/* code that depends on auditEvents).
type StoreLike = {
  getState: () => { sessionId?: string | null };
};
let _storeRef: StoreLike | null = null;
let _storeLoading = false;

async function loadStore() {
  if (_storeRef || _storeLoading) return;
  _storeLoading = true;
  try {
    const mod = (await import('../../store/sessionStore')) as unknown as {
      useSessionStore?: StoreLike;
    };
    if (mod.useSessionStore && typeof mod.useSessionStore.getState === 'function') {
      _storeRef = mod.useSessionStore;
    }
  } catch (err) {
    // Store not available (test/SSR). Session id stays null.
    logger.debug('auditEvents', 'sessionStore lazy-load failed', { err: String(err) });
  } finally {
    _storeLoading = false;
  }
}

function resolveSessionId(): string | null {
  if (_storeRef) {
    try {
      return _storeRef.getState().sessionId ?? null;
    } catch (err) {
      logger.debug('auditEvents', 'sessionId read failed', { err: String(err) });
      return null;
    }
  }
  // Kick off async load; subsequent events will pick up the id.
  loadStore().catch((err) => {
    logger.debug('auditEvents', 'loadStore rejected', { err: String(err) });
  });
  return null;
}

// ── Dedupe (≤5 of the same (type, msg) per minute) ──────────────────────────

const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX = 5;
const _dedupe = new Map<string, number[]>();

function dedupeKey(type: string, details: AuditEvent['details']): string {
  const msg = typeof details.msg === 'string' ? details.msg : '';
  return `${type}::${msg}`;
}

function shouldSuppress(key: string): boolean {
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
let _pending: AuditEvent[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _batchPathBroken = false;

function canUseTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function flushPending() {
  _flushTimer = null;
  if (_pending.length === 0) return;
  const batch = _pending.splice(0);

  if (!canUseTauri()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (!_batchPathBroken) {
      try {
        await invoke('audit_append_batch', { events: batch });
        return;
      } catch (err) {
        // Command not registered on this build — fall back to per-event for
        // the rest of this session.
        _batchPathBroken = true;
        logger.debug('auditEvents', 'audit_append_batch unavailable; falling back', {
          err: String(err),
        });
      }
    }
    for (const event of batch) {
      try {
        await invoke('append_audit_event', { event });
      } catch (err) {
        // Caller already has the localStorage copy; this is best-effort.
        logger.debug('auditEvents', 'append_audit_event failed', {
          err: String(err),
          id: event.id,
        });
      }
    }
  } catch (err) {
    // Tauri import failed; we still have the localStorage copy.
    logger.debug('auditEvents', 'tauri core import failed', { err: String(err) });
  }
}

function scheduleFlush() {
  if (_pending.length >= FLUSH_THRESHOLD) {
    flushPending().catch((err) => {
      logger.debug('auditEvents', 'threshold flush rejected', { err: String(err) });
    });
    return;
  }
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    flushPending().catch((err) => {
      logger.debug('auditEvents', 'timer flush rejected', { err: String(err) });
    });
  }, FLUSH_INTERVAL_MS);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function appendAuditEvent(type: AuditEventType, details: AuditEvent['details']) {
  const key = dedupeKey(type, details);
  if (shouldSuppress(key)) return;

  const event: AuditEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    request_id: newRequestId(),
    session_id: resolveSessionId(),
    details,
  };

  // Append to localStorage immediately so a crash before flush still keeps
  // the event. Bounded to the last 500.
  const next = [...readEvents(), event].slice(-500);
  writeEvents(next);

  _pending.push(event);
  scheduleFlush();
}

export function listAuditEvents(): AuditEvent[] {
  return readEvents();
}

export function clearAuditEvents() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
  _pending = [];
  _dedupe.clear();
}

/** Test/debug hook: force any buffered events to the Rust side now. */
export function flushAuditEventsNow(): Promise<void> {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  return flushPending();
}
