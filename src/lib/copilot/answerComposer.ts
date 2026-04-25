import type { TranscriptItem } from '../../store/sessionStore';
import type { AIProvider } from '../providers/aiProvider';
import { getRuntimeConfig } from '../runtime/appConfig';
import { composeStar } from './starEngine';
import { composeSystemDesign } from './systemDesignEngine';
import type { QuestionDetection } from './questionDetector';

type ComposeAnswerArgs = {
  provider: AIProvider;
  question: QuestionDetection;
  conversationWindow: TranscriptItem[];
  ragChunks: string[];
  profileContext?: string;
  extraInstructions?: string;
  /** Optional callback invoked with each token chunk as it arrives from the provider. */
  onChunk?: (chunk: string) => void;
  profile: {
    userName: string;
    userRole: string;
    companyName: string;
    resumeText?: string;
  };
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

type AnswerPayload = {
  answer: string;
  bullets: string[];
  confidence: number;
  sources: string[];
};

export async function composeAnswer({
  provider,
  question,
  conversationWindow,
  ragChunks,
  profileContext,
  extraInstructions,
  onChunk,
  profile,
  conversationHistory,
}: ComposeAnswerArgs): Promise<AnswerPayload> {
  const config = getRuntimeConfig();

  // ── Inject follow-up context into question text ───────────────────────────
  if (question.isFollowUp && conversationHistory && conversationHistory.length > 0) {
    const lastTurn = conversationHistory.slice(-1)[0];
    question = {
      ...question,
      questionText: `[Follow-up context: previous exchange had ${conversationHistory.length} turns. Most recent: "${lastTurn?.content?.slice(0, 200)}"] ${question.questionText}`,
    };
  }

  // ── Build conversation history context for enriched RAG chunks ────────────
  const historyContext = (conversationHistory ?? [])
    .slice(-4)
    .map((t) => `${t.role === 'user' ? 'Question' : 'Answer'}: ${t.content.slice(0, 300)}`)
    .join('\n');
  const enrichedChunks = historyContext
    ? [`[Conversation context:\n${historyContext}]`, ...ragChunks]
    : ragChunks;

  // ── Behavioral questions → STAR engine ────────────────────────────────────────────
  if (question.questionType === 'behavioral') {
    const resumeChunks = profile.resumeText
      ? [profile.resumeText.slice(0, 600), ...enrichedChunks]
      : enrichedChunks;
    const star = await composeStar(
      question.questionText,
      provider,
      profileContext ?? `${profile.userName}, ${profile.userRole} at ${profile.companyName}`,
      resumeChunks,
    );
    return {
      answer: star.oneLiner,
      bullets: [
        `S: ${star.situation}`,
        `T: ${star.task}`,
        `A: ${star.action}`,
        `R: ${star.result}`,
      ],
      confidence: 0.87,
      sources: [],
    };
  }

  // ── System design questions → design engine ────────────────────────────────────────────
  if (question.questionType === 'system-design') {
    const design = await composeSystemDesign(question.questionText, provider);
    return {
      answer: design.highLevelComponents.join(' → '),
      bullets: [
        ...design.requirements.slice(0, 2).map((r) => `Req: ${r}`),
        ...design.scalingConsiderations.slice(0, 2).map((s) => `Scale: ${s}`),
        ...design.tradeoffs.slice(0, 1).map((t) => `Trade-off: ${t}`),
      ],
      confidence: 0.82,
      sources: design.techStack,
    };
  }

  // ── General questions → standard LLM path ───────────────────────────────────────────────
  const normalizedProfileContext = profileContext?.trim() ?? '';
  const normalizedExtraInstructions = extraInstructions?.trim() ?? '';

  const systemPrompt = [
    `You are an AI copilot for ${profile.userName}.`,
    `Role: ${profile.userRole}.`,
    `Company: ${profile.companyName}.`,
    normalizedExtraInstructions ? `Operator instructions: ${normalizedExtraInstructions}` : '',
    normalizedProfileContext ? `Host profile context: ${normalizedProfileContext}` : '',
    'Return concise spoken-language guidance in JSON: { answer: string, bullets: string[], confidence: number, sources: string[] }.',
    'Keep claims grounded in retrieved context and flag uncertainty when context is weak.',
  ]
    .filter(Boolean)
    .join(' ');

  const userPrompt = [
    `Question: ${question.questionText}`,
    `Question type: ${question.questionType}`,
    `Conversation context: ${conversationWindow.map((i) => `${i.speaker}: ${i.text}`).join(' | ')}`,
    `Retrieved context: ${enrichedChunks.join(' | ')}`,
  ].join('\n');

  try {
    // Prefer the streaming path when the provider supports it and a chunk
    // callback has been supplied — this emits tokens to the UI in real time.
    const providerCall =
      onChunk !== undefined && typeof provider.stream === 'function'
        ? provider.stream({ systemPrompt, userPrompt }, onChunk)
        : provider.complete({ systemPrompt, userPrompt });

    const response = await Promise.race([
      providerCall,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Provider request timed out')), config.providerTimeoutMs),
      ),
    ]);

    const parsed = JSON.parse(response) as Partial<AnswerPayload>;
    return {
      answer: parsed.answer ?? 'I can provide a careful draft based on what is known.',
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets.slice(0, config.maxAnswerBullets)
        : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.4,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch {
    return {
      answer: 'I can share a short draft now and verify details after the call.',
      bullets: [
        'The model response was unavailable or not valid JSON.',
        'Use a clarification-first answer to avoid over-committing.',
      ],
      confidence: 0.25,
      sources: [],
    };
  }
}
