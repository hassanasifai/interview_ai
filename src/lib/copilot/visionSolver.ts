import { logger } from '../logger';

export type ExtractedProblem = {
  title: string;
  description: string;
  constraints: string[];
  examples: string[];
  type: 'coding' | 'system-design' | 'behavioral' | 'unknown';
};

export async function extractProblemFromScreenshot(
  base64Png: string,
  apiKey: string,
): Promise<ExtractedProblem> {
  const prompt =
    'Extract the interview question from this screenshot. Return only JSON: {"title":"...","description":"...","constraints":[],"examples":[],"type":"coding"|"system-design"|"behavioral"|"unknown"}';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${base64Png}`, detail: 'low' },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    if (parsed.title) return parsed as ExtractedProblem;
  } catch (err) {
    logger.warn('visionSolver', 'extract failed, returning unknown', { err: String(err) });
  }
  return { title: 'Unknown', description: '', constraints: [], examples: [], type: 'unknown' };
}
