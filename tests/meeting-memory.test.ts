import { extractMeetingMemory } from '../src/lib/copilot/memoryExtractor';
import { summarizeMeeting } from '../src/lib/copilot/summarizer';
import type { TranscriptItem } from '../src/store/sessionStore';

const transcript: TranscriptItem[] = [
  {
    id: '1',
    speaker: 'customer',
    text: 'We need pricing for 250 users and a security packet.',
    timestamp: 1,
  },
  {
    id: '2',
    speaker: 'user',
    text: 'I will send the pricing matrix and security packet today.',
    timestamp: 2,
  },
  {
    id: '3',
    speaker: 'customer',
    text: 'Please also schedule a follow-up demo for the admin console.',
    timestamp: 3,
  },
];

describe('extractMeetingMemory', () => {
  it('extracts action items and open questions from transcript content', () => {
    const result = extractMeetingMemory(transcript);

    expect(result.actionItems.length).toBeGreaterThan(0);
    expect(result.actionItems[0].text).toContain('pricing matrix');
  });
});

describe('summarizeMeeting', () => {
  it('builds a concise local summary', () => {
    const result = summarizeMeeting({
      customerName: 'Acme',
      transcript,
      durationMinutes: 30,
      userName: 'Hassan',
      userRole: 'Sales Engineer',
    });

    expect(result.executiveSummary).toContain('Acme');
    expect(result.actionItems.length).toBeGreaterThan(0);
  });
});
