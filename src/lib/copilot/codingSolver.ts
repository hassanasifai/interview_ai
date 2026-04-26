import type { AIProvider } from '../providers/aiProvider';
import type { CodingSolution } from '../../store/overlayStore';
import { extractJson as sharedExtractJson, repairJson as sharedRepairJson } from './jsonRepair';

const SYSTEM_PROMPT = `You are an expert competitive programmer and software engineer specializing in Python, AI/ML, and backend systems.
Given a coding problem, produce a complete, correct, well-commented solution.

CRITICAL: Respond with ONLY a raw JSON object — no markdown fences, no explanation outside the JSON.
JSON shape:
{
  "approach": "algorithm name or strategy",
  "timeComplexity": "O(...)",
  "spaceComplexity": "O(...)",
  "pseudocode": ["step 1", "step 2", "step 3", "step 4"],
  "code": "complete runnable code here",
  "language": "python",
  "keyInsights": ["insight 1", "insight 2"]
}

Rules:
- Default to Python 3 unless the problem specifies another language.
- Write idiomatic, production-quality code with clear variable names.
- Include type hints for Python.
- For pattern problems (star, number patterns), always use nested loops.
- For AI/ML problems, use scikit-learn, numpy, or pytorch as appropriate.
- keyInsights must explain WHY the approach works, not just what it does.`;

// extractJson + repairJson live in ./jsonRepair so every answer engine shares
// the same parsing/repair pipeline (AUDIT §24 recommendation).
const extractJson = sharedExtractJson;
const repairJson = sharedRepairJson;

function tryParseJson(raw: string): Partial<CodingSolution> | null {
  const candidate = extractJson(raw);
  try {
    return JSON.parse(candidate) as Partial<CodingSolution>;
  } catch {
    /* try repair */
  }
  try {
    return JSON.parse(repairJson(candidate)) as Partial<CodingSolution>;
  } catch {
    /* give up */
  }
  return null;
}

export async function solveCodingProblem(
  problemText: string,
  provider: AIProvider,
  preferredLanguage?: string,
): Promise<CodingSolution> {
  const lang = preferredLanguage ?? 'python';
  const userPrompt = `Preferred language: ${lang}\n\nCoding problem:\n${problemText.trim()}`;

  let raw = '';
  try {
    raw = await provider.complete({ systemPrompt: SYSTEM_PROMPT, userPrompt });
  } catch (err) {
    return {
      approach: 'Network/API error',
      timeComplexity: 'Unknown',
      spaceComplexity: 'Unknown',
      pseudocode: ['Check your API key', 'Check internet connection', 'Try again'],
      code: `# Provider call failed: ${String(err).slice(0, 200)}`,
      language: lang,
      keyInsights: ['Verify API key is valid in Settings'],
    };
  }

  const parsed = tryParseJson(raw);
  if (parsed) {
    return {
      approach: parsed.approach ?? 'Direct implementation',
      timeComplexity: parsed.timeComplexity ?? 'O(n)',
      spaceComplexity: parsed.spaceComplexity ?? 'O(1)',
      pseudocode: Array.isArray(parsed.pseudocode) ? parsed.pseudocode : [],
      code: parsed.code ?? '# No code returned',
      language: parsed.language ?? lang,
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
    };
  }

  // Both parse and repair-parse failed. Treat raw as code if it looks like code.
  if (raw.trim().length > 20 && !raw.includes('"approach"')) {
    return {
      approach: 'Direct solution (raw output)',
      timeComplexity: 'See code',
      spaceComplexity: 'See code',
      pseudocode: ['Analyze the problem', 'Implement step by step', 'Test with examples'],
      code: raw.trim(),
      language: lang,
      keyInsights: ['Review the generated code above'],
    };
  }

  return {
    approach: 'Parse error — see raw response in code panel',
    timeComplexity: 'Unknown',
    spaceComplexity: 'Unknown',
    pseudocode: [
      'The AI response was not valid JSON',
      'Try clicking Solve with AI again',
      'Or rephrase the problem',
    ],
    code: `# Raw AI response (could not parse as JSON):\n${raw.slice(0, 2000)}`,
    language: lang,
    keyInsights: ['Click Solve again — Groq sometimes returns malformed JSON on the first try'],
  };
}
