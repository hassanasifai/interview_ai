import { composeAnswer } from '../src/lib/copilot/answerComposer';
import { detectQuestion } from '../src/lib/copilot/questionDetector';
import type { AIProvider } from '../src/lib/providers/aiProvider';
import type { TranscriptItem } from '../src/store/sessionStore';

const transcript: TranscriptItem[] = [
  {
    id: '1',
    speaker: 'customer',
    text: 'Can you explain your enterprise pricing?',
    timestamp: 1,
  },
  {
    id: '2',
    speaker: 'user',
    text: 'Yes, happy to walk through the options.',
    timestamp: 2,
  },
];

describe('questionDetector', () => {
  it('detects a completed customer question', () => {
    const result = detectQuestion(transcript);

    expect(result.isQuestion).toBe(true);
    expect(result.questionText).toContain('enterprise pricing');
    expect(result.questionType).toBe('pricing');
  });
});

describe('answerComposer', () => {
  it('builds answer bullets from an AI provider response', async () => {
    const provider: AIProvider = {
      complete: async () =>
        JSON.stringify({
          answer: 'We price by seats, support level, and onboarding scope.',
          bullets: [
            'Pricing scales with team size.',
            'Support tier changes the final quote.',
            'Onboarding is scoped separately when needed.',
          ],
          confidence: 0.92,
          sources: ['Pricing guide'],
        }),
    };

    const answer = await composeAnswer({
      provider,
      question: detectQuestion(transcript),
      conversationWindow: transcript,
      ragChunks: ['Pricing guide: enterprise plans include onboarding options.'],
      profile: {
        userName: 'Hassan',
        userRole: 'Sales Engineer',
        companyName: 'MeetingMind',
      },
    });

    expect(answer.bullets).toHaveLength(3);
    expect(answer.sources).toContain('Pricing guide');
  });
});
