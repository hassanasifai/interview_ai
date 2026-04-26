import { create } from 'zustand';
import { retrieveApiKey, storeApiKey } from '../lib/tauri';
import type { ProviderName } from '../lib/tauri';
import { DEFAULT_GROQ_MODEL, normalizeGroqModel } from '../lib/providers/providerModels';
import type { ShareMode } from '../lib/runtime/shareGuard';
import { logger } from '../lib/logger';

const STORAGE_KEY = 'meetingmind-settings';

/**
 * Phase B widened provider type. ProviderName is owned by lib/tauri.ts and
 * remains the canonical narrow union; ExtendedProviderName covers the new
 * router-only providers (currently 'cerebras') routed through providerFactory.
 */
export type ExtendedProviderName = ProviderName | 'cerebras';

/** STT mode covering local WASAPI, Groq cloud, Deepgram WS cloud, and auto. */
export type SttMode = 'local' | 'groq' | 'deepgram' | 'auto';

/** Voice activity detection engine. 'silero' = browser Silero v5 (recommended). */
export type VadEngine = 'rms' | 'silero';

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
  // Cerebras API key — in-memory only, persisted via OS keychain separately
  cerebrasApiKey: string;
  // Deepgram API key — in-memory only, persisted via OS keychain separately
  deepgramApiKey: string;
  // ElevenLabs API key — in-memory only, persisted via OS keychain separately
  elevenlabsApiKey: string;
  // Provider selection. Stays narrow (ProviderName) so existing
  // ProviderName-typed consumers (OnboardingPage, sessionStore, etc.) keep
  // compiling. UI surfaces that need to display 'cerebras' use
  // ExtendedProviderName locally and cast on patch().
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
  // STT mode: 'local' uses native WASAPI pipeline, 'groq'/'deepgram' use cloud, 'auto' prefers local with cloud fallback
  sttMode: SttMode;
  // VAD silence threshold in ms (range 0–3000) — used by RMS-energy engine
  vadThreshold: number;
  // VAD engine selection: 'silero' = neural browser VAD (default), 'rms' = legacy energy-based
  vadEngine: VadEngine;
  // Silero VAD positive-speech probability threshold (0.0–1.0)
  sileroPositiveThreshold: number;
  // Silero VAD redemption frames before considering speech ended
  sileroRedemptionFrames: number;
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
        | 'hydrate'
        | 'hydrateApiKeys'
        | 'patch'
        | 'saveApiKey'
        | 'saveElevenlabsKey'
        | 'saveCerebrasKey'
        | 'saveDeepgramKey'
      >
    >,
  ) => void;
  saveApiKey: (provider: ExtendedProviderName, key: string) => Promise<void>;
  saveElevenlabsKey: (key: string) => Promise<void>;
  saveCerebrasKey: (key: string) => Promise<void>;
  saveDeepgramKey: (key: string) => Promise<void>;
};

const defaultState = {
  profile: { userName: '', userRole: '', companyName: '', resumeText: '' },
  groqApiKey: '',
  openAiApiKey: '',
  anthropicApiKey: '',
  cerebrasApiKey: '',
  deepgramApiKey: '',
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
  // Default to 'auto': prefer local Whisper when the model + binary feature
  // are present, fall through to cloud Groq otherwise. Gives the best-of-
  // both UX (offline-capable + low-latency) without forcing the user to
  // know which mode they want.
  sttMode: 'auto' as SttMode,
  vadThreshold: 120,
  // Silero is the recommended engine — neural VAD is dramatically more
  // accurate than RMS energy at separating speech from background.
  vadEngine: 'silero' as VadEngine,
  sileroPositiveThreshold: 0.45,
  sileroRedemptionFrames: 8,
  // Auto-activation off by default for privacy: many users want to
  // explicitly opt in to "spy on every meeting I open".
  autoActivate: false,
  // OpenAI TTS sounds materially better than the browser SpeechSynthesis API
  // when a key is configured; we still degrade to browser when no key.
  ttsProvider: 'openai' as 'openai' | 'elevenlabs' | 'browser',
  targetMonitorId: null as number | null,
  jobDescription: '',
  jdAnalysis: null as JdAnalysis | null,
};

/** Keys that are safe to persist in localStorage (no secrets). */
function saveSettings(
  state: Omit<
    SettingsState,
    | 'hydrate'
    | 'hydrateApiKeys'
    | 'patch'
    | 'saveApiKey'
    | 'saveElevenlabsKey'
    | 'saveCerebrasKey'
    | 'saveDeepgramKey'
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
    vadEngine: state.vadEngine,
    sileroPositiveThreshold: state.sileroPositiveThreshold,
    sileroRedemptionFrames: state.sileroRedemptionFrames,
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
        vadEngine: parsed?.vadEngine ?? defaultState.vadEngine,
        sileroPositiveThreshold:
          parsed?.sileroPositiveThreshold ?? defaultState.sileroPositiveThreshold,
        sileroRedemptionFrames:
          parsed?.sileroRedemptionFrames ?? defaultState.sileroRedemptionFrames,
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
    const safeRetrieve = (provider: ExtendedProviderName | 'elevenlabs' | 'deepgram') =>
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

    const [groq, openai, anthropic, cerebras, deepgram, elevenlabs] = await Promise.all([
      safeRetrieve('groq'),
      safeRetrieve('openai'),
      safeRetrieve('anthropic'),
      safeRetrieve('cerebras'),
      safeRetrieve('deepgram'),
      safeRetrieve('elevenlabs'),
    ]);
    set({
      groqApiKey: groq ?? '',
      openAiApiKey: openai ?? '',
      anthropicApiKey: anthropic ?? '',
      cerebrasApiKey: cerebras ?? '',
      deepgramApiKey: deepgram ?? '',
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
    else if (provider === 'cerebras') set({ cerebrasApiKey: key });
  },

  saveElevenlabsKey: async (key) => {
    // Store in OS keychain using the raw storeApiKey helper with a fixed label.
    // elevenlabsApiKey is in-memory only and never written to localStorage.
    try {
      await storeApiKey('elevenlabs', key);
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

  saveCerebrasKey: async (key) => {
    // Store in OS keychain. cerebrasApiKey is in-memory only and never
    // written to localStorage. Mirrors the ElevenLabs pattern.
    try {
      await storeApiKey('cerebras', key);
    } catch (err) {
      logger.warn('settingsStore', 'keychain store failed', {
        err: String(err),
        provider: 'cerebras',
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mm:keychain-error', {
            detail: { provider: 'cerebras', op: 'store' },
          }),
        );
      }
      throw new Error('Failed to store Cerebras API key in OS keychain');
    }
    set({ cerebrasApiKey: key });
  },

  saveDeepgramKey: async (key) => {
    // Store in OS keychain. deepgramApiKey is in-memory only and never
    // written to localStorage. Mirrors the ElevenLabs pattern.
    try {
      await storeApiKey('deepgram', key);
    } catch (err) {
      logger.warn('settingsStore', 'keychain store failed', {
        err: String(err),
        provider: 'deepgram',
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mm:keychain-error', {
            detail: { provider: 'deepgram', op: 'store' },
          }),
        );
      }
      throw new Error('Failed to store Deepgram API key in OS keychain');
    }
    set({ deepgramApiKey: key });
  },

  patch: (next) => {
    const updated = { ...get(), ...next };
    saveSettings(updated);
    set(next);
  },
}));
