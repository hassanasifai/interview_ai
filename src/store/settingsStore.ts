import { create } from 'zustand';
import { retrieveApiKey, storeApiKey } from '../lib/tauri';
import type { ProviderName } from '../lib/tauri';
import { DEFAULT_GROQ_MODEL, normalizeGroqModel } from '../lib/providers/providerModels';
import type { ShareMode } from '../lib/runtime/shareGuard';
import { logger } from '../lib/logger';

const STORAGE_KEY = 'meetingmind-settings';

export type SettingsProfile = {
  userName: string;
  userRole: string;
  companyName: string;
  resumeText?: string;
};

export type JdAnalysis = {
  requiredSkills: string[];
  niceToHaveSkills: string[];
  keywords: string[];
};

type SettingsState = {
  profile: SettingsProfile;
  // API keys — stored in OS keychain; these fields are only in-memory
  groqApiKey: string;
  openAiApiKey: string;
  anthropicApiKey: string;
  // ElevenLabs API key — in-memory only, persisted via OS keychain separately
  elevenlabsApiKey: string;
  // Provider selection
  selectedProvider: ProviderName;
  providerModel: string;
  // Session behaviour
  extraInstructions: string;
  enableResumeGrounding: boolean;
  autoHideOnFullScreenShare: boolean;
  preferSecondScreen: boolean;
  shareMode: ShareMode;
  hasSecondScreen: boolean;
  consentAccepted: boolean;
  // STT language (Whisper ISO 639-1 code, e.g. "en")
  sttLanguage: string;
  // STT mode: 'local' uses native WASAPI pipeline, 'groq' uses cloud, 'auto' prefers local with Groq fallback
  sttMode: 'local' | 'groq' | 'auto';
  // VAD silence threshold in ms (range 0–3000)
  vadThreshold: number;
  // Auto-show overlay when a meeting is detected
  autoActivate: boolean;
  // TTS provider selection
  ttsProvider: 'openai' | 'elevenlabs' | 'browser';
  // Target monitor (null = primary)
  targetMonitorId: number | null;
  // Job description context
  jobDescription: string;
  jdAnalysis: JdAnalysis | null;
  // Actions
  hydrate: () => void;
  hydrateApiKeys: () => Promise<void>;
  patch: (
    next: Partial<
      Omit<
        SettingsState,
        'hydrate' | 'hydrateApiKeys' | 'patch' | 'saveApiKey' | 'saveElevenlabsKey'
      >
    >,
  ) => void;
  saveApiKey: (provider: ProviderName, key: string) => Promise<void>;
  saveElevenlabsKey: (key: string) => Promise<void>;
};

const defaultState = {
  profile: { userName: '', userRole: '', companyName: '', resumeText: '' },
  groqApiKey: '',
  openAiApiKey: '',
  anthropicApiKey: '',
  elevenlabsApiKey: '',
  selectedProvider: 'groq' as ProviderName,
  providerModel: DEFAULT_GROQ_MODEL,
  extraInstructions: `I am a software engineer specializing in Python, AI/ML, and backend systems. My stack includes Python 3, FastAPI, PyTorch, scikit-learn, pandas, numpy, PostgreSQL, Redis, Docker, and AWS. I have experience building LLM-powered applications, REST APIs, and data pipelines. For coding problems prefer Python with type hints. For behavioral questions use concrete examples from building scalable systems. For system design focus on microservices, caching strategies, and ML serving infrastructure.`,
  enableResumeGrounding: true,
  autoHideOnFullScreenShare: true,
  preferSecondScreen: true,
  shareMode: 'not-sharing' as ShareMode,
  hasSecondScreen: false,
  consentAccepted: false,
  sttLanguage: 'en',
  sttMode: 'groq' as 'local' | 'groq' | 'auto',
  vadThreshold: 300,
  autoActivate: false,
  ttsProvider: 'browser' as 'openai' | 'elevenlabs' | 'browser',
  targetMonitorId: null as number | null,
  jobDescription: '',
  jdAnalysis: null as JdAnalysis | null,
};

/** Keys that are safe to persist in localStorage (no secrets). */
function saveSettings(
  state: Omit<
    SettingsState,
    'hydrate' | 'hydrateApiKeys' | 'patch' | 'saveApiKey' | 'saveElevenlabsKey'
  >,
) {
  const persisted = {
    profile: state.profile,
    selectedProvider: state.selectedProvider,
    providerModel: normalizeGroqModel(state.providerModel),
    extraInstructions: state.extraInstructions,
    enableResumeGrounding: state.enableResumeGrounding,
    autoHideOnFullScreenShare: state.autoHideOnFullScreenShare,
    preferSecondScreen: state.preferSecondScreen,
    shareMode: state.shareMode,
    hasSecondScreen: state.hasSecondScreen,
    consentAccepted: state.consentAccepted,
    sttLanguage: state.sttLanguage,
    sttMode: state.sttMode,
    vadThreshold: state.vadThreshold,
    autoActivate: state.autoActivate,
    ttsProvider: state.ttsProvider,
    targetMonitorId: state.targetMonitorId,
    jobDescription: state.jobDescription,
    jdAnalysis: state.jdAnalysis,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaultState,

  hydrate: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<typeof defaultState> | null;
      // Deep-merge parsed payload onto defaults so older configs that lack
      // newly rolled-out fields don't end up with `undefined` values.
      const merged = {
        ...defaultState,
        ...(parsed ?? {}),
        profile: { ...defaultState.profile, ...(parsed?.profile ?? {}) },
        providerModel: normalizeGroqModel(parsed?.providerModel),
        enableResumeGrounding: parsed?.enableResumeGrounding ?? defaultState.enableResumeGrounding,
        sttMode: parsed?.sttMode ?? defaultState.sttMode,
        vadThreshold: parsed?.vadThreshold ?? defaultState.vadThreshold,
        autoActivate: parsed?.autoActivate ?? defaultState.autoActivate,
        ttsProvider: parsed?.ttsProvider ?? defaultState.ttsProvider,
        targetMonitorId: parsed?.targetMonitorId ?? defaultState.targetMonitorId,
      };
      set(merged);
    } catch (err) {
      logger.warn('settingsStore', 'corrupt persisted settings; resetting', {
        err: String(err),
      });
      localStorage.removeItem(STORAGE_KEY);
      set(defaultState);
    }
  },

  hydrateApiKeys: async () => {
    // G12: never fall back to localStorage when the OS keychain fails. If a
    // retrieve call rejects, surface the failure via a custom event so the UI
    // can prompt the user; we intentionally leave the in-memory key empty.
    const safeRetrieve = (provider: ProviderName | 'elevenlabs') =>
      retrieveApiKey(provider).catch(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mm:keychain-error', {
              detail: { provider, op: 'retrieve' },
            }),
          );
        }
        return null;
      });

    const [groq, openai, anthropic, elevenlabs] = await Promise.all([
      safeRetrieve('groq'),
      safeRetrieve('openai'),
      safeRetrieve('anthropic'),
      safeRetrieve('elevenlabs'),
    ]);
    set({
      groqApiKey: groq ?? '',
      openAiApiKey: openai ?? '',
      anthropicApiKey: anthropic ?? '',
      elevenlabsApiKey: elevenlabs ?? '',
    });
  },

  saveApiKey: async (provider, key) => {
    try {
      await storeApiKey(provider, key);
    } catch (err) {
      // G12: keychain unavailable — DO NOT fall back to localStorage.
      // Surface to UI so the user can take action.
      logger.warn('settingsStore', 'keychain store failed', {
        err: String(err),
        provider,
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mm:keychain-error', {
            detail: { provider, op: 'store' },
          }),
        );
      }
      throw new Error(`Failed to store ${provider} API key in OS keychain`);
    }
    if (provider === 'groq') set({ groqApiKey: key });
    else if (provider === 'openai') set({ openAiApiKey: key });
    else if (provider === 'anthropic') set({ anthropicApiKey: key });
  },

  saveElevenlabsKey: async (key) => {
    // Store in OS keychain using the raw storeApiKey helper with a fixed label.
    // elevenlabsApiKey is in-memory only and never written to localStorage.
    try {
      await storeApiKey('elevenlabs' as ProviderName, key);
    } catch (err) {
      logger.warn('settingsStore', 'keychain store failed', {
        err: String(err),
        provider: 'elevenlabs',
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mm:keychain-error', {
            detail: { provider: 'elevenlabs', op: 'store' },
          }),
        );
      }
      throw new Error('Failed to store ElevenLabs API key in OS keychain');
    }
    set({ elevenlabsApiKey: key });
  },

  patch: (next) => {
    const updated = { ...get(), ...next };
    saveSettings(updated);
    set(next);
  },
}));
