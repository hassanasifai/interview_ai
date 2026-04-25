// Phase 2G: Lightweight client-side PII redaction. Mirrors the patterns the
// Rust audit logger uses so that ANY string about to be persisted, exported,
// or shipped through telemetry can be scrubbed deterministically.

const EMAIL_PATTERN = /[\w.-]+@[\w-]+\.[\w.-]+/g;
// Phone-ish: 10+ digits with optional separators. Anchored by word boundary
// where possible to avoid eating raw IDs.
const PHONE_PATTERN = /\+?\d[\d\s().-]{9,}\d/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
// Credit-card-ish: 13-19 digits with optional spaces/dashes. Validated with
// the Luhn check below before redacting.
const CC_PATTERN = /\b(?:\d[\s-]?){13,19}\b/g;

type ReplacementToken = '[EMAIL]' | '[PHONE]' | '[SSN]' | '[CC]' | '[ID]';

const PATTERNS: Array<[RegExp, ReplacementToken]> = [
  [EMAIL_PATTERN, '[EMAIL]'],
  [SSN_PATTERN, '[SSN]'],
  [CC_PATTERN, '[CC]'],
  [PHONE_PATTERN, '[PHONE]'],
];

function luhnValid(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number.parseInt(digits[i]!, 10);
    if (Number.isNaN(n)) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export type RedactionLevel = 'off' | 'standard' | 'strict';

/**
 * Redacts well-known PII shapes in `text`. The returned string is safe to
 * log, persist, or transmit. Idempotent — running it multiple times is a
 * no-op.
 */
export function redactPII(text: string, level: RedactionLevel = 'standard'): string {
  if (level === 'off') return text;
  if (typeof text !== 'string' || text.length === 0) return text;

  let redacted = text;
  for (const [pattern, replacement] of PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      if (replacement === '[CC]' && !luhnValid(match)) return match;
      return replacement;
    });
  }
  if (level === 'strict') {
    // Long opaque numeric runs (potential customer IDs, account numbers).
    redacted = redacted.replace(/\b\d{6,}\b/g, '[ID]');
  }
  return redacted;
}

/**
 * Recursively redacts PII from any JSON-shaped value. Useful for scrubbing
 * audit-event detail bags before persistence.
 */
export function redactPIIDeep<T>(value: T, level: RedactionLevel = 'standard'): T {
  if (level === 'off') return value;
  if (typeof value === 'string') return redactPII(value, level) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => redactPIIDeep(v, level)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPIIDeep(v, level);
    }
    return out as unknown as T;
  }
  return value;
}
