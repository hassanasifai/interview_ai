const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

const GROQ_MODEL_OPTIONS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (balanced)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fast)' },
  { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (long context)' },
  { id: 'gemma2-9b-it', label: 'Gemma 2 9B (efficient)' },
] as const;

const OPENAI_MODEL_OPTIONS = [
  { id: 'gpt-4o', label: 'GPT-4o (best quality)' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini (faster)' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo (long context)' },
] as const;

const ANTHROPIC_MODEL_OPTIONS = [
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (best)' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (balanced)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fast)' },
] as const;

type GroqModelId = (typeof GROQ_MODEL_OPTIONS)[number]['id'];
type OpenAiModelId = (typeof OPENAI_MODEL_OPTIONS)[number]['id'];
type AnthropicModelId = (typeof ANTHROPIC_MODEL_OPTIONS)[number]['id'];
type ProviderModelId = GroqModelId | OpenAiModelId | AnthropicModelId;

function normalizeGroqModel(model: string | undefined | null): string {
  const candidate = model?.trim();
  if (!candidate) return DEFAULT_GROQ_MODEL;
  return candidate;
}

export {
  DEFAULT_GROQ_MODEL,
  GROQ_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  ANTHROPIC_MODEL_OPTIONS,
  normalizeGroqModel,
};
export type { ProviderModelId, GroqModelId, OpenAiModelId, AnthropicModelId };
