import { appendAuditEvent, listAuditEvents } from '../src/lib/runtime/auditEvents';
import {
  clearAllLocalProductData,
  pruneAuditEventsByRetention,
} from '../src/lib/runtime/dataMaintenance';
import { writeRuntimeConfig } from '../src/lib/runtime/appConfig';

describe('data maintenance', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prunes audit events according to retention policy', () => {
    writeRuntimeConfig({ auditRetentionDays: 1 });
    appendAuditEvent('session_started', { mode: 'demo' });

    const events = listAuditEvents();
    expect(events.length).toBe(1);

    pruneAuditEventsByRetention();
    expect(listAuditEvents().length).toBe(1);
  });

  it('clears product local storage keys', () => {
    localStorage.setItem('meetingmind-settings', '{}');
    localStorage.setItem('meetingmind-session-summaries', '[]');
    clearAllLocalProductData();

    expect(localStorage.getItem('meetingmind-settings')).toBeNull();
    expect(localStorage.getItem('meetingmind-session-summaries')).toBeNull();
  });
});
