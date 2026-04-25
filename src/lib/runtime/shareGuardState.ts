import { logAutoHideTrigger, logForceShowAction } from '../auditLogger';
import {
  applyShareGuardProtection,
  type ShareGuardProtectionState,
  type ShareGuardResult,
} from './shareGuard';
import { logger } from '../logger';

export type ShareGuardProtectionHistoryEntry = {
  id: string;
  timestamp: string;
  reason: string;
};

export const SHARE_GUARD_HIDE_EVENT = 'meetingmind:share-guard-hide';
export const SHARE_GUARD_RESTORE_EVENT = 'meetingmind:share-guard-restore';

const AUTO_HIDDEN_KEY = 'meetingmind-share-guard-auto-hidden';
const HISTORY_KEY = 'meetingmind-share-guard-protection-history';

function canUseLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function canUseWindowEvents() {
  return typeof window !== 'undefined';
}

export function readAutoHiddenState(): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }

  return localStorage.getItem(AUTO_HIDDEN_KEY) === 'true';
}

export function writeAutoHiddenState(isAutoHidden: boolean) {
  if (!canUseLocalStorage()) {
    return;
  }

  localStorage.setItem(AUTO_HIDDEN_KEY, String(isAutoHidden));
}

export function listProtectionHistory(): ShareGuardProtectionHistoryEntry[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const raw = localStorage.getItem(HISTORY_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as ShareGuardProtectionHistoryEntry[];
  } catch (err) {
    logger.warn('shareGuardState', 'corrupt protection history; resetting', {
      err: String(err),
    });
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }
}

export function recordProtectionTrigger(reason: string) {
  if (!canUseLocalStorage()) {
    return;
  }

  const entry: ShareGuardProtectionHistoryEntry = {
    id: `protection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    reason,
  };

  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([...listProtectionHistory(), entry].slice(-100)),
  );
}

function dispatchShareGuardEvent(eventName: string, detail: ShareGuardProtectionState) {
  if (!canUseWindowEvents()) {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function enforceShareGuardResult(result: ShareGuardResult): ShareGuardProtectionState {
  const previousAutoHidden = readAutoHiddenState();
  const protectionState = applyShareGuardProtection({
    previousAutoHidden,
    result,
  });

  writeAutoHiddenState(protectionState.autoHidden);

  if (protectionState.shouldDispatchHideEvent) {
    recordProtectionTrigger(result.protectionReason);
    dispatchShareGuardEvent(SHARE_GUARD_HIDE_EVENT, protectionState);
    logAutoHideTrigger(result.protectionReason).catch((err) => {
      // Audit logging is best-effort; surface failures via DOM event so the
      // audit listener can record them without crashing the UI thread.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mm:audit-error', {
            detail: { reason: String(err), source: 'auto-hide-trigger' },
          }),
        );
      }
    });
  }

  if (protectionState.shouldDispatchRestoreEvent) {
    dispatchShareGuardEvent(SHARE_GUARD_RESTORE_EVENT, protectionState);
  }

  return protectionState;
}

export async function forceShowAssistant(reason = 'accepted-risk') {
  writeAutoHiddenState(false);
  await logForceShowAction(reason);

  dispatchShareGuardEvent(SHARE_GUARD_RESTORE_EVENT, {
    autoHidden: false,
    shouldDispatchHideEvent: false,
    shouldDispatchRestoreEvent: true,
    toastMessage: null,
  });
}
