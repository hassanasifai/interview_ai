import type { AIProvider } from '../providers/aiProvider';

export type WorkEntry = {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  bullets: string[];
};

export type ResumeSection = {
  heading: string;
  content: string;
};

const SECTION_SYSTEM_PROMPT = `You are a professional resume writer.
Transform the provided work experience into strong, ATS-optimized resume bullets using the
XYZ formula: "Accomplished [X] by doing [Y] resulting in [Z]."
Return ONLY a JSON object with keys: heading (string), content (string — newline-separated bullets).
Start each bullet with a strong past-tense action verb. Quantify results wherever possible.`;

const IMPROVE_SYSTEM_PROMPT = `You are a professional resume writer.
Improve the provided resume bullet to be stronger, more quantified, and ATS-optimized.
Return ONLY the improved bullet as plain text — no JSON, no explanation.`;

export async function generateResumeSection(
  entry: WorkEntry,
  provider: AIProvider,
  targetRole?: string,
): Promise<ResumeSection> {
  const userPrompt = [
    `Company: ${entry.company}`,
    `Role: ${entry.role}`,
    `Period: ${entry.startDate} – ${entry.endDate}`,
    `Responsibilities/Achievements:\n${entry.bullets.join('\n')}`,
    targetRole ? `Target role: ${targetRole}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await provider.complete({
      systemPrompt: SECTION_SYSTEM_PROMPT,
      userPrompt,
    });
    const parsed = JSON.parse(response) as Partial<ResumeSection>;
    return {
      heading: parsed.heading ?? `${entry.role} at ${entry.company}`,
      content: parsed.content ?? entry.bullets.join('\n'),
    };
  } catch {
    return {
      heading: `${entry.role} at ${entry.company}`,
      content: entry.bullets.join('\n'),
    };
  }
}

export async function improveResumeBullet(bullet: string, provider: AIProvider): Promise<string> {
  try {
    const response = await provider.complete({
      systemPrompt: IMPROVE_SYSTEM_PROMPT,
      userPrompt: `Bullet to improve: ${bullet}`,
    });
    // Response should be plain text; strip any JSON wrapping if present
    try {
      const parsed = JSON.parse(response) as { content?: string; bullet?: string };
      return parsed.content ?? parsed.bullet ?? response.trim();
    } catch {
      return response.trim();
    }
  } catch {
    return bullet;
  }
}
