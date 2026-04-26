import type { AIProvider } from '../providers/aiProvider';
import type { JdAnalysis } from '../../store/settingsStore';
import { tryParseJson } from './jsonRepair';

const SYSTEM_PROMPT = `You are an expert talent acquisition specialist and resume coach.
Extract structured information from a job description.
Return ONLY a JSON object with keys:
requiredSkills (string[]), niceToHaveSkills (string[]), keywords (string[]).
Keep each array to the 5-8 most important items.`;

export async function analyzeJobDescription(
  jdText: string,
  provider: AIProvider,
): Promise<JdAnalysis> {
  try {
    const response = await provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Job description:\n${jdText}`,
    });
    const parsed = tryParseJson<Partial<JdAnalysis>>(response) ?? ({} as Partial<JdAnalysis>);
    return {
      requiredSkills: Array.isArray(parsed.requiredSkills) ? parsed.requiredSkills : [],
      niceToHaveSkills: Array.isArray(parsed.niceToHaveSkills) ? parsed.niceToHaveSkills : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { requiredSkills: [], niceToHaveSkills: [], keywords: [] };
  }
}

/** Append JD alignment context to an answer's bullet list. */
export function tailorAnswerToJd(bullets: string[], jd: JdAnalysis): string[] {
  if (!jd.requiredSkills.length) return bullets;
  const aligned = jd.requiredSkills.filter((skill) =>
    bullets.some((b) => b.toLowerCase().includes(skill.toLowerCase())),
  );
  if (!aligned.length) return bullets;
  return [...bullets, `Aligns with: ${aligned.join(', ')}`];
}
