const RESUME_SIGNAL_PATTERN =
  /(experience|years|speciali|built|led|owned|stack|skills|certif|domain|industry|python|typescript|react|rust|go|java|aws|gcp|azure)/i;

function cleanLine(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildResumeProfileContext(chunks: string[], maxLines = 6): string {
  const unique = new Set<string>();
  const selected: string[] = [];

  for (const chunk of chunks) {
    const normalizedChunk = cleanLine(chunk);

    if (!normalizedChunk) {
      continue;
    }

    const candidates = normalizedChunk
      .split(/(?<=[.!?])\s+/)
      .map((line) => cleanLine(line))
      .filter((line) => line.length > 0);

    for (const candidate of candidates) {
      if (!RESUME_SIGNAL_PATTERN.test(candidate)) {
        continue;
      }

      const dedupeKey = candidate.toLowerCase();

      if (unique.has(dedupeKey)) {
        continue;
      }

      unique.add(dedupeKey);
      selected.push(candidate);

      if (selected.length >= maxLines) {
        return selected.join(' | ');
      }
    }
  }

  if (selected.length > 0) {
    return selected.join(' | ');
  }

  const fallback = chunks
    .map((chunk) => cleanLine(chunk))
    .filter((chunk) => chunk.length > 0)
    .slice(0, 2)
    .map((chunk) => chunk.slice(0, 220));

  return fallback.join(' | ');
}
