/**
 * Shared JSON-repair utilities for LLM responses. Extracted from codingSolver
 * so every answer engine (STAR, system design, JD matcher, vision, scorer)
 * can use the same repair pipeline. AUDIT §24 recommendation: universal JSON
 * repair across engines.
 */

/** Extract JSON object from LLM response that may be wrapped in markdown fences. */
export function extractJson(raw: string): string {
  if (!raw) return '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace?.[0]) return brace[0];
  return raw.trim();
}

/**
 * Repair common LLM JSON mistakes: unescaped newlines/tabs/quotes inside
 * string values, trailing commas, smart quotes. Walks the string char by
 * char and tracks string state.
 */
export function repairJson(input: string): string {
  if (!input) return input;
  let out = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escapeNext) {
      out += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
    }
    out += ch;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  return out;
}

/**
 * Try to parse `raw` as JSON. Falls back to extract→parse, then
 * extract→repair→parse. Returns null if all paths fail.
 */
export function tryParseJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  // Direct parse first — many providers return clean JSON.
  try {
    return JSON.parse(raw) as T;
  } catch {
    /* fall through */
  }
  const candidate = extractJson(raw);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* try repair */
  }
  try {
    return JSON.parse(repairJson(candidate)) as T;
  } catch {
    /* give up */
  }
  return null;
}
