import { analyzeCodingPrompt } from '../src/lib/coding/codingAssistant';

describe('coding assistant', () => {
  it('extracts topic hints from coding prompt text', () => {
    const result = analyzeCodingPrompt(
      'Given an array of integers, return the two sum indices using a hash map.',
    );

    expect(result.detectedTopics).toContain('arrays');
    expect(result.detectedTopics).toContain('hash map');
    expect(result.suggestedApproach.length).toBeGreaterThan(0);
  });
});
