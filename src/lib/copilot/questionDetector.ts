import type { TranscriptItem } from '../../store/sessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { logger } from '../logger';

export type QuestionType =
  | 'factual'
  | 'pricing'
  | 'technical'
  | 'objection'
  | 'behavioral'
  | 'system-design'
  | 'coding'
  | 'hr'
  | 'other';

export type QuestionDetection = {
  isQuestion: boolean;
  questionText: string;
  questionType: QuestionType;
  confidence: number;
  isFollowUp: boolean;
};

const pricingSignals = ['price', 'pricing', 'cost', 'quote', 'billing', 'subscription', 'fee'];
const objectionSignals = ['too expensive', 'not sure', 'concern', 'worried', 'hesitant'];
const technicalSignals = [
  'api',
  'integration',
  'sso',
  'security',
  'technical',
  'implement',
  'architecture',
  'database',
  'performance',
  'latency',
  'throughput',
];
const behavioralSignals = [
  'tell me about a time',
  'describe a situation',
  'give me an example',
  'how did you handle',
  'what did you do when',
  'walk me through',
  'have you ever',
  'describe your experience',
  'tell me about your',
  'how have you',
  'what was a challenge',
];
const systemDesignSignals = [
  'design a',
  'design the',
  'how would you design',
  'system design',
  'scale',
  'distributed',
  'how would you build',
  'architect',
  'design an',
  'design this',
  'build a system',
];
const codingSignals = [
  'write a function',
  'implement',
  'code',
  'algorithm',
  'complexity',
  'data structure',
  'leetcode',
  'solve this',
  'write code',
  'write an algorithm',
];
const hrSignals = [
  'tell me about yourself',
  'why do you want',
  'where do you see yourself',
  'what are your strengths',
  'what are your weaknesses',
  'why should we hire',
  'salary expectation',
  'notice period',
  'available to start',
];

const followUpSignals = [
  'follow up',
  'follow-up',
  'can you elaborate',
  'tell me more',
  'what about',
  'how did you',
  'can you explain',
  'go deeper',
  'expand on',
  'give me an example of that',
];

function isFollowUpQuestion(text: string, previousText: string): boolean {
  const normalized = text.toLowerCase();
  return (
    followUpSignals.some((s) => normalized.includes(s)) ||
    (normalized.split(' ').length < 12 && previousText.length > 0)
  );
}

// ── In-memory result cache keyed by normalised text (last 32 entries) ────────
const CACHE_MAX = 32;
const _cache = new Map<string, QuestionDetection>();

function cacheGet(key: string): QuestionDetection | undefined {
  return _cache.get(key);
}

function cacheSet(key: string, value: QuestionDetection): void {
  if (_cache.size >= CACHE_MAX) {
    // Evict the oldest entry (insertion-order in Map).
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(key, value);
}

// ── Debounce state — 150 ms gate before classifier fires ─────────────────────
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingTranscript: TranscriptItem[] | null = null;
let _pendingResolvers: Array<(r: QuestionDetection) => void> = [];

// ── LLM classification state ──────────────────────────────────────────────────
let _lastQuestionText = '';

async function classifyWithLLM(
  text: string,
): Promise<{ type: QuestionType; confidence: number } | null> {
  try {
    const apiKey = useSettingsStore.getState().groqApiKey;
    if (!apiKey) return null;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(1500),
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 60,
        messages: [
          {
            role: 'system',
            content:
              'Classify this interview question. Return only JSON: {"type":"behavioral"|"system-design"|"coding"|"technical"|"hr"|"pricing"|"factual"|"other","confidence":0.0-1.0}',
          },
          { role: 'user', content: text.slice(0, 300) },
        ],
      }),
    });
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content.match(/\{.*\}/s)?.[0] ?? '{}');
    if (parsed.type && parsed.confidence)
      return { type: parsed.type as QuestionType, confidence: parsed.confidence };
  } catch (err) {
    logger.debug('questionDetector', 'LLM classify failed, falling back to regex', {
      err: String(err),
    });
  }
  return null;
}

/**
 * detectQuestion — public signature unchanged.
 * Debounces 150 ms; regex short-circuits for obvious patterns; caches results.
 * Now includes hybrid LLM+regex classification and follow-up detection.
 */
export function detectQuestion(transcript: TranscriptItem[]): QuestionDetection {
  // Prefer the latest customer/interviewer line (real meeting case).
  // Fall back to the latest user line so solo testing & user-asked questions
  // ("how would I...?") still trigger the copilot. This matches Parakeet/Cluely
  // behavior where the assistant responds whenever a question is detected
  // regardless of who said it.
  const latestCustomerLine = [...transcript].reverse().find((item) => item.speaker === 'customer');
  const latestUserLine = [...transcript].reverse().find((item) => item.speaker === 'user');
  const target = latestCustomerLine ?? latestUserLine;

  if (!target) {
    return {
      isQuestion: false,
      questionText: '',
      questionType: 'other',
      confidence: 0.1,
      isFollowUp: false,
    };
  }

  const text = target.text.trim();
  const normalized = text.toLowerCase();

  // Cache check on normalised text.
  const cached = cacheGet(normalized);
  if (cached) return cached;

  // ── Regex short-circuit (no LLM needed for obvious patterns) ─────────────
  // Liberal interrogative + imperative detection. Whisper rarely emits
  // question marks for spoken speech, so we lean heavily on prefixes and
  // verb-first patterns that signal a request.
  const interrogativeStarts = [
    'can you', 'could you', 'would you', 'will you',
    'what', 'when', 'where', 'who', 'whom', 'whose', 'which', 'how', 'why',
    'tell me', 'describe', 'design', 'explain', 'walk me', 'walk us',
    'give me', 'show me', 'help me', 'teach me', 'guide me',
    'is there', 'are there', 'do you', 'does this', 'have you', 'has this',
    'should i', 'should we', 'could we', 'shall we',
    'write a', 'write me', 'implement', 'solve', 'optimize',
  ];
  const containsInterrogative = /\b(why|how|what|when|where|which|who)\b/i.test(text);
  const isQuestion =
    text.includes('?') ||
    interrogativeStarts.some((p) => normalized.startsWith(p)) ||
    // Sentence ≥ 4 words containing an interrogative anywhere is likely a question
    (containsInterrogative && text.split(/\s+/).length >= 4);

  if (!isQuestion) {
    const result: QuestionDetection = {
      isQuestion: false,
      questionText: '',
      questionType: 'other',
      confidence: 0.2,
      isFollowUp: isFollowUpQuestion(text, _lastQuestionText),
    };
    cacheSet(normalized, result);
    _lastQuestionText = text;
    return result;
  }

  let questionType: QuestionType = 'factual';

  if (behavioralSignals.some((s) => normalized.includes(s))) {
    questionType = 'behavioral';
  } else if (systemDesignSignals.some((s) => normalized.includes(s))) {
    questionType = 'system-design';
  } else if (codingSignals.some((s) => normalized.includes(s))) {
    questionType = 'coding';
  } else if (hrSignals.some((s) => normalized.includes(s))) {
    questionType = 'hr';
  } else if (pricingSignals.some((s) => normalized.includes(s))) {
    questionType = 'pricing';
  } else if (technicalSignals.some((s) => normalized.includes(s))) {
    questionType = 'technical';
  } else if (objectionSignals.some((s) => normalized.includes(s))) {
    questionType = 'objection';
  }

  const followUp = isFollowUpQuestion(text, _lastQuestionText);
  const regexConfidence = 0.93;

  const result: QuestionDetection = {
    isQuestion: true,
    questionText: text,
    questionType,
    confidence: regexConfidence,
    isFollowUp: followUp,
  };
  cacheSet(normalized, result);

  // If regex confidence is high, return immediately without LLM
  if (regexConfidence >= 0.85) {
    _lastQuestionText = text;
    return result;
  }

  // Otherwise fire LLM async and update cache if it returns
  classifyWithLLM(text)
    .then((llmResult) => {
      if (llmResult) {
        const updated: QuestionDetection = {
          ...result,
          questionType: llmResult.type,
          confidence: llmResult.confidence,
        };
        cacheSet(normalized, updated);
      }
    })
    .catch(() => {
      // LLM classification failures are non-fatal; regex result already cached.
    });

  _lastQuestionText = text;
  return result;
}

// ── Debounced variant used by sessionStore ingestTranscript ──────────────────
/**
 * detectQuestionDebounced — waits 150 ms after the last call before
 * resolving; all callers within the window share the same result.
 * Preserves fast-path cache hits without waiting.
 */
export function detectQuestionDebounced(transcript: TranscriptItem[]): Promise<QuestionDetection> {
  // Fast-path: if the latest customer line is cached, resolve immediately.
  const latestCustomerLine = [...transcript].reverse().find((item) => item.speaker === 'customer');
  if (latestCustomerLine) {
    const cached = cacheGet(latestCustomerLine.text.trim().toLowerCase());
    if (cached) return Promise.resolve(cached);
  }

  // Accumulate callers and reset the timer.
  _pendingTranscript = transcript;
  return new Promise<QuestionDetection>((resolve) => {
    _pendingResolvers.push(resolve);
    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      const snap = _pendingTranscript!;
      const resolvers = _pendingResolvers;
      _pendingTranscript = null;
      _pendingResolvers = [];
      const result = detectQuestion(snap);
      resolvers.forEach((r) => r(result));
    }, 150);
  });
}
