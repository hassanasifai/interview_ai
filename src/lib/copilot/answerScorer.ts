import type { QuestionType } from './questionDetector';
import { logger } from '../logger';
import { tryParseJson } from './jsonRepair';

export type ScoringDimension = { name: string; score: number; comment: string };
export type AnswerScore = {
  overall: number;
  dimensions: ScoringDimension[];
  feedback: string;
  improvements: string[];
};

export async function scoreAnswer(
  question: string,
  answer: string,
  questionType: QuestionType,
  apiKey: string,
): Promise<AnswerScore> {
  const dimensions =
    questionType === 'behavioral'
      ? [
          'Situation clarity (0-25)',
          'Task specificity (0-25)',
          'Action detail (0-25)',
          'Result measurability (0-25)',
        ]
      : questionType === 'system-design'
        ? [
            'Requirements coverage (0-25)',
            'Scalability (0-25)',
            'Trade-off awareness (0-25)',
            'Tech stack justification (0-25)',
          ]
        : ['Correctness (0-40)', 'Depth (0-30)', 'Communication clarity (0-30)'];

  const prompt = `Score this interview answer. Return only JSON:
{"overall":0-100,"dimensions":[{"name":"...","score":0-25,"comment":"..."}],"feedback":"one sentence","improvements":["...","..."]}

Question: ${question.slice(0, 200)}
Answer: ${answer.slice(0, 500)}
Dimensions to score: ${dimensions.join(', ')}`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = tryParseJson<AnswerScore>(content);
    if (parsed && typeof parsed.overall === 'number') return parsed;
  } catch (err) {
    logger.warn('answerScorer', 'scoring failed, returning default', { err: String(err) });
  }

  return { overall: 70, dimensions: [], feedback: 'Scoring unavailable', improvements: [] };
}
