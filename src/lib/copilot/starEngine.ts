import type { AIProvider } from '../providers/aiProvider';

export type StarAnswer = {
  situation: string;
  task: string;
  action: string;
  result: string;
  oneLiner: string;
};

const SYSTEM_PROMPT = `You are an expert career coach specializing in behavioral interviews.
Given a behavioral question, a candidate profile, and resume context, construct a compelling
STAR-format answer. Return ONLY a JSON object with keys:
situation (string), task (string), action (string), result (string), oneLiner (string).
Keep each field to 1-2 sentences. Be specific and quantify results where possible.`;

export async function composeStar(
  question: string,
  provider: AIProvider,
  profileContext: string,
  resumeChunks: string[],
): Promise<StarAnswer> {
  const userPrompt = [
    `Behavioral question: ${question}`,
    profileContext ? `Candidate profile: ${profileContext}` : '',
    resumeChunks.length > 0 ? `Resume context: ${resumeChunks.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await provider.complete({ systemPrompt: SYSTEM_PROMPT, userPrompt });
    const parsed = JSON.parse(response) as Partial<StarAnswer>;
    return {
      situation: parsed.situation ?? 'In a previous role...',
      task: parsed.task ?? 'I was responsible for...',
      action: parsed.action ?? 'I took the following steps...',
      result: parsed.result ?? 'This resulted in...',
      oneLiner: parsed.oneLiner ?? 'I successfully handled a similar challenge by...',
    };
  } catch {
    return {
      situation: 'In a relevant previous experience...',
      task: 'I faced a challenge that required...',
      action:
        'I approached it by identifying priorities, communicating clearly, and executing systematically.',
      result: 'The outcome was positive, with measurable improvements to the team and project.',
      oneLiner: 'I have direct experience with this type of challenge and handled it effectively.',
    };
  }
}
