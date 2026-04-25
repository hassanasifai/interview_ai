import {
  appendAuditEvent,
  clearAuditEvents,
  listAuditEvents,
} from '../src/lib/runtime/auditEvents';

describe('audit events', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAuditEvents();
  });

  it('stores and lists audit events', () => {
    appendAuditEvent('session_started', { mode: 'demo' });
    appendAuditEvent('session_ended', { transcriptItems: 5 });

    const events = listAuditEvents();

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('session_started');
    expect(events[1].type).toBe('session_ended');
  });
});
