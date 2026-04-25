import { composeAnswer } from '../src/lib/copilot/answerComposer';
import { writeRuntimeConfig } from '../src/lib/runtime/appConfig';
import type { AIProvider } from '../src/lib/providers/aiProvider';

describe('answer composer runtime behavior', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('times out and returns safe fallback when provider exceeds configured timeout', async () => {
    writeRuntimeConfig({
      providerTimeoutMs: 1000,
    });

    const slowProvider: AIProvider = {
      complete: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve('{"answer":"late"}');
          }, 1200);
        }),
    };

    const response = await composeAnswer({
      provider: slowProvider,
      question: {
        isQuestion: true,
        questionText: 'What is the pricing?',
        questionType: 'pricing',
        confidence: 0.9,
        isFollowUp: false,
      },
      conversationWindow: [],
      ragChunks: ['Pricing Guide: seat based plans.'],
      profile: {
        userName: 'Host',
        userRole: 'SE',
        companyName: 'MeetingMind',
      },
    });

    expect(response.confidence).toBeLessThan(0.5);
    expect(response.answer).toContain('short draft');
  });
});
