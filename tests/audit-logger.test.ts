import {
  clearAuditLog,
  listAuditLog,
  logAssistantStartup,
  logAutoHideTrigger,
  logForceShowAction,
  logSensitiveKnowledgeBaseQuery,
} from '../src/lib/auditLogger';

describe('auditLogger', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAuditLog();
  });

  it('records compliance events locally', async () => {
    await logAssistantStartup();
    await logAutoHideTrigger('fullscreen-sharing');
    await logForceShowAction('accepted-risk');
    await logSensitiveKnowledgeBaseQuery('product pricing strategy');

    const events = await listAuditLog();

    expect(events.map((event) => event.type)).toEqual([
      'assistant_startup',
      'automatic_hide_trigger',
      'force_show_action',
      'sensitive_knowledge_base_query',
    ]);
    expect(events[1].details.reason).toBe('fullscreen-sharing');
  });
});
