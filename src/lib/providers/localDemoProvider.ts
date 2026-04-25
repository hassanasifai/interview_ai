import type { AIProvider } from './aiProvider';

export class LocalDemoProvider implements AIProvider {
  async complete(payload: { systemPrompt: string; userPrompt: string }): Promise<string> {
    const isCodingMode =
      payload.systemPrompt.includes('competitive programmer') ||
      payload.systemPrompt.includes('approach') ||
      payload.userPrompt.includes('Coding problem:');

    if (isCodingMode) {
      const problem = payload.userPrompt.replace(/^.*Coding problem:\s*/s, '').slice(0, 200);
      return JSON.stringify({
        approach: 'Demo mode — add a Groq API key in Settings for real solutions',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        pseudocode: [
          'Go to Settings and add your Groq API key (free at console.groq.com)',
          'Groq is free and fast — llama-3.3-70b works great for coding',
          'Once key is saved, click Solve with AI again',
        ],
        code: `# Demo mode — no API key configured.\n# Problem: ${problem}\n#\n# Add your free Groq key in Settings → API Keys → Groq\n# Get one free at: console.groq.com\nprint("Add Groq API key to get real solutions")`,
        language: 'python',
        keyInsights: [
          'No API key is set — using demo mode',
          'Get a free Groq API key at console.groq.com',
          'Groq supports llama-3.3-70b with generous free limits',
        ],
      });
    }

    const questionLine = payload.userPrompt
      .split('\n')
      .find((line) => line.startsWith('Question:'))
      ?.replace('Question:', '')
      .trim();

    const lowerQuestion = (questionLine ?? '').toLowerCase();
    const isPricing = lowerQuestion.includes('pricing') || lowerQuestion.includes('cost');
    const isSecurity = lowerQuestion.includes('security') || lowerQuestion.includes('soc2');

    const oneLiner = isPricing
      ? 'Pricing is usually based on seats, support level, and rollout scope.'
      : isSecurity
        ? 'Security posture is covered with a documented control set and review package.'
        : 'The safest response is a short answer plus one clarifying question.';

    return JSON.stringify({
      answer: oneLiner,
      bullets: [
        'Lead with what is confirmed in the knowledge base.',
        'Avoid unverified commitments in live calls.',
        'Offer to confirm edge-case details after the meeting.',
      ],
      confidence: 0.64,
      sources: ['Local demo provider'],
    });
  }
}
