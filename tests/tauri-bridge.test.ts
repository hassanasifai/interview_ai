import { persistSessionSummary, readPersistedSessions } from '../src/lib/tauri';

describe('tauri bridge fallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and reads session summaries through the local fallback', async () => {
    await persistSessionSummary({
      id: 'session-1',
      customerName: 'Acme',
      title: 'Renewal planning',
      durationMinutes: 27,
      summary: 'Covered pricing, rollout, and security review.',
    });

    const sessions = await readPersistedSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].customerName).toBe('Acme');
  });
});
