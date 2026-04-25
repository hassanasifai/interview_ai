import {
  clearPersistedAuditEvents,
  persistAuditEvent,
  persistTranscriptItem,
  readPersistedAuditEvents,
  readPersistedTranscriptItems,
} from '../src/lib/tauri';

describe('native persistence bridge fallbacks', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists transcript items by session through the browser fallback', async () => {
    await persistTranscriptItem('session-a', {
      id: 'line-1',
      speaker: 'customer',
      text: 'Can you confirm the rollout plan?',
      timestamp: 1710000000,
    });

    const items = await readPersistedTranscriptItems('session-a');

    expect(items).toHaveLength(1);
    expect(items[0].text).toContain('rollout plan');
  });

  it('persists, lists, and clears audit events through the browser fallback', async () => {
    await persistAuditEvent({
      id: 'evt-1',
      type: 'session_started',
      timestamp: '2026-04-20T12:00:00.000Z',
      details: { mode: 'demo' },
    });

    expect(await readPersistedAuditEvents()).toHaveLength(1);

    await clearPersistedAuditEvents();

    expect(await readPersistedAuditEvents()).toHaveLength(0);
  });
});
