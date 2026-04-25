import { createLiveAnswerProvider } from '../src/lib/providers/providerFactory';

describe('provider factory', () => {
  it('returns local demo provider when api key is missing', () => {
    const provider = createLiveAnswerProvider('groq', '');

    expect(provider.constructor.name).toBe('LocalDemoProvider');
  });

  it('returns resilient groq provider when a groq key is supplied', () => {
    const provider = createLiveAnswerProvider('groq', 'gsk_test', 'llama-3.1-8b-instant');

    expect(provider.constructor.name).toBe('ResilientGroqProvider');
  });
});
