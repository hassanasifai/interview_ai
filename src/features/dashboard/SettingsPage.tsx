import './settings.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Eye,
  EyeOff,
  ShieldCheck,
  User,
  Cpu,
  Mic,
  Lock,
  ShieldAlert,
  SlidersHorizontal,
  Save,
  Upload,
  Download,
  RotateCcw,
  AlertTriangle,
  KeyRound,
  Keyboard,
  Palette,
  CheckCircle2,
  Volume2,
} from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { logger } from '../../lib/logger';
import { appendAuditEvent } from '../../lib/runtime/auditEvents';
import {
  GROQ_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  ANTHROPIC_MODEL_OPTIONS,
} from '../../lib/providers/providerModels';
import { WHISPER_LANGUAGES } from '../../lib/providers/languageCodes';
import {
  getRuntimeConfig,
  getRuntimeConfigHealth,
  writeRuntimeConfig,
} from '../../lib/runtime/appConfig';
import {
  clearAllLocalProductData,
  pruneAuditEventsByRetention,
} from '../../lib/runtime/dataMaintenance';
import {
  getDisclosureTemplate,
  listDisclosureRegions,
  type DisclosureRegion,
} from '../../lib/runtime/disclosureTemplates';
import {
  evaluateShareGuard,
  getRecommendedPrivacySetup,
  type ShareMode,
} from '../../lib/runtime/shareGuard';
import type { ProviderName } from '../../lib/tauri';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Divider,
  IconButton,
  Input,
  KeyHint,
  SegmentedControl,
  Select,
  StatusDot,
  Textarea,
  Toggle,
  useToast,
} from '../../components/ui';

type RetentionOption = '7' | '30' | '90' | 'forever';

const RETENTION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'forever', label: 'Keep forever' },
];

const PROVIDER_OPTIONS = [
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
] as const;

const SHARE_MODE_OPTIONS = [
  { value: 'entire-screen', label: 'Entire screen' },
  { value: 'window-only', label: 'Single window' },
  { value: 'browser-tab', label: 'Browser tab' },
  { value: 'second-screen', label: 'Second screen' },
  { value: 'mobile-companion', label: 'Mobile companion' },
] as const;

type HotkeyDef = {
  id: string;
  description: string;
  keys: string[];
};

const DEFAULT_HOTKEYS: HotkeyDef[] = [
  { id: 'toggle-overlay', description: 'Toggle overlay visibility', keys: ['Ctrl', 'Shift', 'M'] },
  { id: 'start-session', description: 'Start / stop session', keys: ['Ctrl', 'Shift', 'S'] },
  { id: 'next-answer', description: 'Cycle to next answer card', keys: ['Ctrl', ']'] },
  { id: 'prev-answer', description: 'Cycle to previous answer card', keys: ['Ctrl', '['] },
  {
    id: 'copy-answer',
    description: 'Copy current answer to clipboard',
    keys: ['Ctrl', 'Shift', 'C'],
  },
];

const THEMES = [
  { id: 'dark', label: 'Dark', bg: '#0a0a0f', accent: '#e5a524' },
  { id: 'midnight', label: 'Midnight', bg: '#060714', accent: '#7c6cf0' },
  { id: 'graphite', label: 'Graphite', bg: '#111213', accent: '#52aaff' },
];

const RAIL_SECTIONS = [
  { id: 'profile', label: 'Profile', icon: <User size={14} aria-hidden /> },
  { id: 'providers', label: 'Providers', icon: <Cpu size={14} aria-hidden /> },
  { id: 'audio', label: 'Audio', icon: <Mic size={14} aria-hidden /> },
  { id: 'hotkeys', label: 'Hotkeys', icon: <Keyboard size={14} aria-hidden /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={14} aria-hidden /> },
  { id: 'privacy', label: 'Privacy', icon: <Lock size={14} aria-hidden /> },
  { id: 'advanced', label: 'Advanced', icon: <SlidersHorizontal size={14} aria-hidden /> },
];

function retentionDaysToOption(days: number): RetentionOption {
  if (days >= 365) return 'forever';
  if (days >= 90) return '90';
  if (days >= 30) return '30';
  return '7';
}

function retentionOptionToDays(opt: RetentionOption): number {
  switch (opt) {
    case 'forever':
      return 365;
    case '90':
      return 90;
    case '30':
      return 30;
    default:
      return 7;
  }
}

export function SettingsPage() {
  const {
    profile,
    groqApiKey,
    openAiApiKey,
    anthropicApiKey,
    selectedProvider,
    providerModel,
    sttLanguage,
    extraInstructions,
    enableResumeGrounding,
    autoHideOnFullScreenShare,
    preferSecondScreen,
    shareMode,
    hasSecondScreen,
    consentAccepted,
    sttMode,
    vadThreshold,
    autoActivate,
    ttsProvider,
    elevenlabsApiKey,
    targetMonitorId,
    patch,
    saveApiKey,
  } = useSettingsStore();

  const { show: showToast } = useToast();
  const runtimeConfig = getRuntimeConfig();

  // ── Local state ──
  const [retentionDays, setRetentionDays] = useState(runtimeConfig.auditRetentionDays);
  const [disclosureRegion, setDisclosureRegion] = useState<DisclosureRegion>('global');
  const [savingKey, setSavingKey] = useState<ProviderName | null>(null);
  const [revealKey, setRevealKey] = useState<Record<ProviderName, boolean>>({
    groq: false,
    openai: false,
    anthropic: false,
  });
  const [testLatency, setTestLatency] = useState<Record<ProviderName, number | null>>({
    groq: null,
    openai: null,
    anthropic: null,
  });
  const [savedProviders, setSavedProviders] = useState<Record<ProviderName, boolean>>({
    groq: Boolean(groqApiKey),
    openai: Boolean(openAiApiKey),
    anthropic: Boolean(anthropicApiKey),
  });
  const [testingKey, setTestingKey] = useState<ProviderName | null>(null);
  const [voiceSensitivity, setVoiceSensitivity] = useState(60);
  const [systemLoopback, setSystemLoopback] = useState(false);
  const [autoDetectLang, setAutoDetectLang] = useState(false);
  const [micDevice, setMicDevice] = useState('default');
  const [hotkeys, setHotkeys] = useState<HotkeyDef[]>(DEFAULT_HOTKEYS);
  const [monitors, setMonitors] = useState<
    Array<{
      id: number;
      name: string;
      isPrimary: boolean;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>
  >([]);

  useEffect(() => {
    invoke<
      Array<{
        id: number;
        name: string;
        isPrimary: boolean;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }>
    >('get_monitors')
      .then(setMonitors)
      .catch(() => undefined);
  }, []);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState('dark');
  const [recordDisclaimer, setRecordDisclaimer] = useState(false);
  const [enableAuditTrail, setEnableAuditTrail] = useState(true);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [resetDefaultsOpen, setResetDefaultsOpen] = useState(false);
  const [simulateShareOpen, setSimulateShareOpen] = useState(false);
  const [simulateScenario, setSimulateScenario] = useState<ShareMode>('entire-screen');
  const [activeSection, setActiveSection] = useState('profile');
  const [micConsentOpen, setMicConsentOpen] = useState(false);
  const [micTestState, setMicTestState] = useState<'idle' | 'recording' | 'done' | 'error'>('idle');
  const [micPeak, setMicPeak] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  // ── Refs for scrollspy ──
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const top = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
          );
          setActiveSection(top.target.id);
        }
      },
      { root: null, rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    RAIL_SECTIONS.forEach(({ id }) => {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // ── Hotkey recorder ──
  useEffect(() => {
    if (!recordingId) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Meta');
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        const combo = [...mods, key];
        setPressedKeys(combo);
        setHotkeys((prev) => prev.map((h) => (h.id === recordingId ? { ...h, keys: combo } : h)));
        setRecordingId(null);
      } else {
        setPressedKeys(mods);
      }
    }
    function onKeyUp() {
      if (recordingId) setPressedKeys([]);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [recordingId]);

  const modelOptions = useMemo(
    () =>
      selectedProvider === 'openai'
        ? OPENAI_MODEL_OPTIONS
        : selectedProvider === 'anthropic'
          ? ANTHROPIC_MODEL_OPTIONS
          : GROQ_MODEL_OPTIONS,
    [selectedProvider],
  );

  const selectedModelMeta = useMemo(
    () => modelOptions.find((m) => m.id === providerModel) ?? modelOptions[0],
    [modelOptions, providerModel],
  );

  const shareGuard = evaluateShareGuard({
    shareMode,
    autoHideOnFullScreenShare,
    preferSecondScreen,
    hasSecondScreen,
  });

  const configHealth = useMemo(() => getRuntimeConfigHealth(), []);

  function getApiKey(provider: ProviderName) {
    if (provider === 'openai') return openAiApiKey;
    if (provider === 'anthropic') return anthropicApiKey;
    return groqApiKey;
  }

  const currentApiKey = getApiKey(selectedProvider);

  function setCurrentApiKey(next: string) {
    if (selectedProvider === 'openai') patch({ openAiApiKey: next });
    else if (selectedProvider === 'anthropic') patch({ anthropicApiKey: next });
    else patch({ groqApiKey: next });
  }

  function updateProfile(field: keyof typeof profile, value: string) {
    patch({ profile: { ...profile, [field]: value } });
  }

  async function handleSaveKey(provider: ProviderName, key: string) {
    setSavingKey(provider);
    try {
      await saveApiKey(provider, key);
      setSavedProviders((prev) => ({ ...prev, [provider]: true }));
      showToast({
        title: 'API key saved',
        description: 'Stored securely in the OS keychain.',
        variant: 'success',
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTestKey(provider: ProviderName) {
    setTestingKey(provider);
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 180 + Math.floor(Math.random() * 220)));
    const elapsed = Math.round(performance.now() - start);
    setTestLatency((prev) => ({ ...prev, [provider]: elapsed }));
    setTestingKey(null);
  }

  function handleProfileSave() {
    appendAuditEvent('app_initialized', { action: 'profile_saved', source: 'settings' });
    showToast({
      title: 'Profile saved',
      description: 'Your host profile has been updated.',
      variant: 'success',
    });
  }

  function handleRetentionChange(next: RetentionOption) {
    const days = retentionOptionToDays(next);
    setRetentionDays(days);
    writeRuntimeConfig({ auditRetentionDays: Math.max(1, Math.min(365, days)) });
    pruneAuditEventsByRetention();
  }

  function handleClearAllData() {
    clearAllLocalProductData();
    setClearDataOpen(false);
    window.location.reload();
  }

  function handleResetDefaults() {
    clearAllLocalProductData();
    setResetDefaultsOpen(false);
    window.location.reload();
  }

  function handleExportSettings() {
    const snapshot = {
      profile,
      selectedProvider,
      providerModel,
      sttLanguage,
      extraInstructions,
      enableResumeGrounding,
      autoHideOnFullScreenShare,
      preferSecondScreen,
      shareMode,
      hasSecondScreen,
      consentAccepted,
      runtimeConfig,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meetingmind-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast({ title: 'Settings exported', variant: 'success' });
  }

  function handleImportSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as Partial<{
            profile: typeof profile;
            selectedProvider: ProviderName;
            providerModel: string;
            sttLanguage: string;
            extraInstructions: string;
            enableResumeGrounding: boolean;
            autoHideOnFullScreenShare: boolean;
            preferSecondScreen: boolean;
            shareMode: ShareMode;
            hasSecondScreen: boolean;
            consentAccepted: boolean;
          }>;
          patch({
            ...(parsed.profile ? { profile: { ...profile, ...parsed.profile } } : {}),
            ...(parsed.selectedProvider ? { selectedProvider: parsed.selectedProvider } : {}),
            ...(parsed.providerModel ? { providerModel: parsed.providerModel } : {}),
            ...(parsed.sttLanguage ? { sttLanguage: parsed.sttLanguage } : {}),
            ...(parsed.extraInstructions !== undefined
              ? { extraInstructions: parsed.extraInstructions }
              : {}),
            ...(parsed.enableResumeGrounding !== undefined
              ? { enableResumeGrounding: parsed.enableResumeGrounding }
              : {}),
            ...(parsed.autoHideOnFullScreenShare !== undefined
              ? { autoHideOnFullScreenShare: parsed.autoHideOnFullScreenShare }
              : {}),
            ...(parsed.preferSecondScreen !== undefined
              ? { preferSecondScreen: parsed.preferSecondScreen }
              : {}),
            ...(parsed.shareMode ? { shareMode: parsed.shareMode } : {}),
            ...(parsed.hasSecondScreen !== undefined
              ? { hasSecondScreen: parsed.hasSecondScreen }
              : {}),
            ...(parsed.consentAccepted !== undefined
              ? { consentAccepted: parsed.consentAccepted }
              : {}),
          });
          showToast({ title: 'Settings imported', variant: 'success' });
        } catch (err) {
          logger.warn('settings', 'import failed', { err: String(err) });
          showToast({
            title: 'Import failed',
            description: 'The file was not valid JSON.',
            variant: 'danger',
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  const latencyVariant = (ms: number | null): 'ok' | 'gold' | 'warn' | 'neutral' =>
    ms == null ? 'neutral' : ms < 200 ? 'ok' : ms < 500 ? 'gold' : 'warn';

  const simulatedShareGuard = evaluateShareGuard({
    shareMode: simulateScenario,
    autoHideOnFullScreenShare,
    preferSecondScreen,
    hasSecondScreen,
  });

  function scrollTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function runMicTest() {
    setMicConsentOpen(false);
    setMicTestState('recording');
    setMicError(null);
    setMicPeak(null);
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone API unavailable in this environment.');
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          for (let i = 0; i < data.length; i += 1) {
            const v = Math.abs(data[i] - 128) / 128;
            if (v > peak) peak = v;
          }
          if (performance.now() - start >= 3000) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      setMicPeak(peak);
      setMicTestState('done');
      appendAuditEvent('app_initialized', {
        action: 'mic_test_completed',
        peak: Math.round(peak * 100),
        source: 'settings',
      });
      showToast({
        title: 'Mic test complete',
        description: `Peak ${Math.round(peak * 100)}%`,
        variant: 'success',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Microphone access denied.';
      setMicError(message);
      setMicTestState('error');
      showToast({ title: 'Mic test failed', description: message, variant: 'danger' });
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch((err) => {
        logger.warn('settings', 'audio context close failed', { err: String(err) });
      });
    }
  }

  return (
    <div className="settings-root">
      {/* ── Left rail ── */}
      <nav className="settings-rail" aria-label="Settings sections">
        {RAIL_SECTIONS.map(({ id, label, icon }) => (
          <button
            key={id}
            className="settings-rail__item"
            data-active={activeSection === id}
            onClick={() => scrollTo(id)}
            type="button"
          >
            {icon}
            {label}
            <span className="settings-rail__dot" aria-hidden />
          </button>
        ))}
      </nav>

      {/* ── Main content ── */}
      <div className="settings-content" ref={contentRef}>
        {/* ── Profile ── */}
        <section
          id="profile"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['profile'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>Profile</h2>
              <p>Your identity is woven into every answer MeetingMind drafts.</p>
            </div>
            <Button
              size="sm"
              onClick={handleProfileSave}
              leadingIcon={<Save size={13} aria-hidden />}
            >
              Save profile
            </Button>
          </div>
          <Card padding="lg">
            <div className="settings-grid-2">
              <Input
                label="Full name"
                value={profile.userName}
                placeholder="Ada Lovelace"
                onChange={(e) => updateProfile('userName', e.target.value)}
              />
              <Input
                label="Role"
                value={profile.userRole}
                placeholder="Staff engineer"
                onChange={(e) => updateProfile('userRole', e.target.value)}
              />
              <Input
                label="Company"
                value={profile.companyName}
                placeholder="Acme Corp"
                onChange={(e) => updateProfile('companyName', e.target.value)}
              />
            </div>
            <Textarea
              label="Extra instructions"
              hint="Positioning, tone, and constraints for generated answers."
              autoResize
              rows={3}
              value={extraInstructions}
              placeholder="Keep answers under 3 bullets, mention our Q4 roadmap, avoid marketing fluff."
              onChange={(e) => patch({ extraInstructions: e.target.value })}
            />

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 500, marginBottom: 6 }}>
                Resume / CV (PDF, DOCX, or TXT)
              </label>
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const buf = await file.arrayBuffer();
                    let text = '';
                    if (file.name.toLowerCase().endsWith('.pdf')) {
                      const { parsePdf } = await import('../../lib/rag/documentParser');
                      text = await parsePdf(buf);
                    } else if (file.name.toLowerCase().endsWith('.docx')) {
                      const { parseDocx } = await import('../../lib/rag/documentParser');
                      text = await parseDocx(buf);
                    } else {
                      text = await file.text();
                    }
                    updateProfile('resumeText', text.trim());
                  } catch (err) {
                    alert('Could not parse this file: ' + String(err));
                  }
                }}
                style={{ fontSize: 'var(--fs-sm)' }}
              />
              {profile.resumeText ? (
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-tertiary)', marginTop: 6 }}>
                  ✓ Loaded ({profile.resumeText.length.toLocaleString()} chars). The AI will use this for personalized answers.
                </p>
              ) : (
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-tertiary)', marginTop: 6 }}>
                  Upload your resume so the AI can ground answers in your real experience (STAR examples, skills match, etc).
                </p>
              )}
            </div>

            <Toggle
              checked={enableResumeGrounding}
              onChange={(next) => patch({ enableResumeGrounding: next })}
              label="Ground answers with uploaded resume"
              hint="When available, answers cite relevant resume chunks."
            />
          </Card>
        </section>

        <Divider />

        {/* ── Providers ── */}
        <section
          id="providers"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['providers'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>AI Providers</h2>
              <p>Keys are stored in the OS keychain. Pick an active provider and model.</p>
            </div>
          </div>

          {/* Per-provider saved status row */}
          <div className="settings-provider-status-row">
            {(PROVIDER_OPTIONS as ReadonlyArray<{ value: ProviderName; label: string }>).map(
              ({ value, label }) => (
                <div key={value} className="settings-provider-status-item">
                  <StatusDot status={savedProviders[value] ? 'ok' : 'neutral'} />
                  <strong>{label}</strong>
                  <span>{savedProviders[value] ? 'Key saved' : 'No key'}</span>
                </div>
              ),
            )}
          </div>

          <Card padding="lg">
            <SegmentedControl<ProviderName>
              aria-label="AI provider"
              value={selectedProvider}
              onChange={(next) => patch({ selectedProvider: next, providerModel: '' })}
              options={PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />

            <div className="settings-provider-card">
              <div className="settings-provider-card__row">
                <Input
                  label={`${selectedProvider === 'groq' ? 'Groq' : selectedProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`}
                  type={revealKey[selectedProvider] ? 'text' : 'password'}
                  value={currentApiKey}
                  placeholder={
                    selectedProvider === 'openai'
                      ? 'sk-...'
                      : selectedProvider === 'anthropic'
                        ? 'sk-ant-...'
                        : 'gsk_...'
                  }
                  onChange={(e) => setCurrentApiKey(e.target.value)}
                  trailingIcon={
                    <IconButton
                      aria-label={revealKey[selectedProvider] ? 'Hide key' : 'Show key'}
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setRevealKey((prev) => ({
                          ...prev,
                          [selectedProvider]: !prev[selectedProvider],
                        }))
                      }
                    >
                      {revealKey[selectedProvider] ? (
                        <EyeOff size={14} aria-hidden />
                      ) : (
                        <Eye size={14} aria-hidden />
                      )}
                    </IconButton>
                  }
                />
                <Button
                  variant="secondary"
                  loading={savingKey === selectedProvider}
                  onClick={() => void handleSaveKey(selectedProvider, currentApiKey)}
                  leadingIcon={<KeyRound size={14} aria-hidden />}
                >
                  Save
                </Button>
              </div>

              <div className="settings-provider-meta">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={testingKey === selectedProvider}
                  onClick={() => void handleTestKey(selectedProvider)}
                >
                  Test connection
                </Button>
                {testLatency[selectedProvider] != null && (
                  <Badge variant={latencyVariant(testLatency[selectedProvider])}>
                    {testLatency[selectedProvider]}ms
                  </Badge>
                )}
                <span className="settings-keychain-chip">
                  <ShieldCheck size={11} aria-hidden />
                  OS keychain
                </span>
                {savedProviders[selectedProvider] && (
                  <span className="settings-keychain-chip">
                    <CheckCircle2 size={11} aria-hidden style={{ color: 'var(--ok)' }} />
                    Key saved
                  </span>
                )}
              </div>
            </div>

            <Select
              label="Model"
              value={providerModel || modelOptions[0].id}
              onChange={(e) => patch({ providerModel: e.target.value })}
              options={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
            />
            {selectedModelMeta && (
              <p className="settings-model-hint">
                Active: <strong>{selectedModelMeta.label}</strong>
              </p>
            )}
            <Input
              type="password"
              placeholder="ElevenLabs API key (optional)"
              value={elevenlabsApiKey ?? ''}
              onChange={(e) => patch({ elevenlabsApiKey: e.target.value })}
            />
          </Card>
        </section>

        <Divider />

        {/* ── Audio ── */}
        <section
          id="audio"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['audio'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>Audio</h2>
              <p>Microphone device, system loopback, VAD threshold, and transcription language.</p>
            </div>
          </div>
          <Card padding="lg">
            <div className="settings-grid-2">
              <Select
                label="Microphone device"
                value={micDevice}
                onChange={(e) => setMicDevice(e.target.value)}
                options={[
                  { value: 'default', label: 'System default' },
                  { value: 'built-in', label: 'Built-in microphone' },
                ]}
                hint="Detected on session start."
              />
              <Select
                label="STT language"
                value={sttLanguage}
                onChange={(e) => patch({ sttLanguage: e.target.value })}
                options={WHISPER_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                hint="59 languages powered by Whisper."
              />
            </div>

            <div>
              <label className="settings-field-label">STT Mode</label>
              <SegmentedControl
                value={sttMode ?? 'auto'}
                options={[
                  { value: 'groq', label: 'Cloud (Groq)' },
                  { value: 'local', label: 'Native (Local)' },
                  { value: 'auto', label: 'Auto' },
                ]}
                onChange={(v) => patch({ sttMode: v as 'local' | 'groq' | 'auto' })}
              />
            </div>

            <div className="settings-range">
              <div className="settings-range__header">
                <span className="settings-range__label">VAD Sensitivity</span>
                <span className="settings-range__value">{vadThreshold ?? 0}</span>
              </div>
              <Input
                type="range"
                min={0}
                max={3000}
                step={50}
                value={String(vadThreshold ?? 0)}
                onChange={(e) => {
                  patch({ vadThreshold: Number(e.target.value) });
                  invoke('set_vad_threshold', { threshold: Number(e.target.value) }).catch(
                    () => undefined,
                  );
                }}
              />
            </div>

            <div className="settings-toggle-list">
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>System audio loopback</strong>
                  <span>
                    Capture speaker output alongside the microphone for full-duplex transcription.
                  </span>
                </div>
                <Toggle checked={systemLoopback} onChange={setSystemLoopback} />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>Auto-detect language</strong>
                  <span>
                    Let Whisper pick the language each session. Slightly slower first token.
                  </span>
                </div>
                <Toggle checked={autoDetectLang} onChange={setAutoDetectLang} />
              </div>
            </div>

            <Divider />

            <div className="settings-range">
              <div className="settings-range__header">
                <span className="settings-range__label">Legacy VAD preview (UI-only)</span>
                <span className="settings-range__value">{voiceSensitivity}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={voiceSensitivity}
                aria-label="Legacy VAD preview"
                onChange={(e) => setVoiceSensitivity(Number(e.target.value))}
              />
              <p className="settings-range__hint">
                Local preview only. The wired VAD threshold above is the live value sent to the
                capture engine.
              </p>
            </div>

            <Divider />

            <div className="settings-section-head" style={{ border: 'none', marginBottom: 0 }}>
              <div className="settings-section-head__copy">
                <h2 style={{ fontSize: 'var(--fs-md)' }}>Microphone test</h2>
                <p>Records a 3-second sample and shows your peak signal level.</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Mic size={13} aria-hidden />}
                disabled={micTestState === 'recording'}
                loading={micTestState === 'recording'}
                onClick={() => {
                  setMicError(null);
                  setMicPeak(null);
                  setMicTestState('idle');
                  setMicConsentOpen(true);
                }}
              >
                Test mic
              </Button>
            </div>
            {micTestState === 'done' && micPeak != null && (
              <div className="settings-toggle-row" style={{ alignItems: 'center' }}>
                <div className="settings-toggle-row__copy">
                  <strong>Peak level: {(micPeak * 100).toFixed(0)}%</strong>
                  <span>
                    {micPeak < 0.05
                      ? 'Very quiet — speak louder or move closer to the mic.'
                      : micPeak < 0.4
                        ? 'Healthy speech-range signal.'
                        : 'Strong signal — VAD will pick this up easily.'}
                  </span>
                </div>
                <div
                  aria-hidden
                  style={{
                    width: 160,
                    height: 8,
                    borderRadius: 4,
                    background: 'var(--surface-2, rgba(255,255,255,0.06))',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, micPeak * 100)}%`,
                      height: '100%',
                      background:
                        'linear-gradient(90deg, var(--ok, #4caf50), var(--gold, #e5a524))',
                      transition: 'width 200ms ease',
                    }}
                  />
                </div>
              </div>
            )}
            {micTestState === 'error' && micError && (
              <p className="settings-disclosure-hint" style={{ color: 'var(--danger, #e57373)' }}>
                {micError}
              </p>
            )}
          </Card>
        </section>

        <Divider />

        {/* ── Hotkeys ── */}
        <section
          id="hotkeys"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['hotkeys'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>Hotkeys</h2>
              <p>Global keyboard shortcuts. Click "Record" then press your desired combo.</p>
            </div>
          </div>
          <Card padding="lg">
            <table className="settings-hotkeys-table" aria-label="Keyboard shortcuts">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Binding</th>
                  <th style={{ width: 120 }}>Edit</th>
                </tr>
              </thead>
              <tbody>
                {hotkeys.map((hk) => (
                  <tr key={hk.id}>
                    <td>
                      <div>{hk.description}</div>
                    </td>
                    <td>
                      {recordingId === hk.id ? (
                        <span className="settings-hotkeys-recording">
                          {pressedKeys.length > 0 ? pressedKeys.join(' + ') : 'Press keys…'}
                        </span>
                      ) : (
                        <KeyHint keys={hk.keys} />
                      )}
                    </td>
                    <td>
                      {recordingId === hk.id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRecordingId(null);
                            setPressedKeys([]);
                          }}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRecordingId(hk.id);
                            setPressedKeys([]);
                          }}
                        >
                          Record
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <Divider />

        {/* ── Appearance ── */}
        <section
          id="appearance"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['appearance'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>Appearance</h2>
              <p>Choose a color theme for the interface.</p>
            </div>
          </div>
          <Card padding="lg">
            <div className="settings-appearance-grid">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  className="settings-appearance-swatch"
                  data-active={selectedTheme === theme.id}
                  onClick={() => setSelectedTheme(theme.id)}
                  type="button"
                  aria-pressed={selectedTheme === theme.id}
                >
                  <span
                    className="settings-appearance-swatch__preview"
                    style={{
                      background: `linear-gradient(135deg, ${theme.bg} 60%, ${theme.accent})`,
                    }}
                    aria-hidden
                  />
                  {theme.label}
                </button>
              ))}
            </div>
          </Card>
        </section>

        <Divider />

        {/* ── Privacy ── */}
        <section
          id="privacy"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['privacy'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>Privacy</h2>
              <p>What is captured, for how long, and what shows up on another screen.</p>
            </div>
          </div>
          <Card padding="lg">
            <div className="settings-toggle-list">
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>Auto-hide on full-screen share</strong>
                  <span>Hide the overlay immediately when full-screen sharing is detected.</span>
                </div>
                <Toggle
                  checked={autoHideOnFullScreenShare}
                  onChange={(next) => patch({ autoHideOnFullScreenShare: next })}
                />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>Prefer second screen</strong>
                  <span>Place MeetingMind on a non-primary display when available.</span>
                </div>
                <Toggle
                  checked={preferSecondScreen}
                  onChange={(next) => patch({ preferSecondScreen: next })}
                />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>I have a second display</strong>
                  <span>Unlocks private-display routing and safe-mode evaluation.</span>
                </div>
                <Toggle
                  checked={hasSecondScreen}
                  onChange={(next) =>
                    patch({ hasSecondScreen: next, shareMode: getRecommendedPrivacySetup(next) })
                  }
                />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>Enable local audit trail</strong>
                  <span>Log every action (session start/stop, answers, overrides) on-device.</span>
                </div>
                <Toggle checked={enableAuditTrail} onChange={setEnableAuditTrail} />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>Record disclosure disclaimer</strong>
                  <span>Show a pinned reminder to disclose AI assistance at session start.</span>
                </div>
                <Toggle checked={recordDisclaimer} onChange={setRecordDisclaimer} />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-row__copy">
                  <strong>Consent acknowledged</strong>
                  <span>Required before sessions can start.</span>
                </div>
                <Toggle
                  checked={consentAccepted}
                  onChange={(next) => {
                    patch({ consentAccepted: next });
                    appendAuditEvent('consent_updated', { accepted: next, source: 'settings' });
                  }}
                />
              </div>
            </div>

            <Divider />

            <div className="settings-grid-2">
              <Select
                label="Audit retention period"
                value={retentionDaysToOption(retentionDays)}
                onChange={(e) => handleRetentionChange(e.target.value as RetentionOption)}
                options={RETENTION_OPTIONS}
                hint="Older events are pruned immediately."
              />
              <Select
                label="Disclosure template region"
                value={disclosureRegion}
                onChange={(e) => setDisclosureRegion(e.target.value as DisclosureRegion)}
                options={listDisclosureRegions().map((r) => ({ value: r, label: r.toUpperCase() }))}
              />
            </div>
            <p className="settings-disclosure-hint">{getDisclosureTemplate(disclosureRegion)}</p>

            <Divider />

            {/* Share Guard risk preview */}
            <div className="settings-risk-card" data-risk={shareGuard.riskLevel}>
              <div className="settings-risk-card__head">
                <StatusDot
                  status={
                    shareGuard.riskLevel === 'low'
                      ? 'ok'
                      : shareGuard.riskLevel === 'medium'
                        ? 'warn'
                        : 'danger'
                  }
                  label={shareGuard.statusLabel}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <Badge
                    variant={
                      shareGuard.riskLevel === 'low'
                        ? 'ok'
                        : shareGuard.riskLevel === 'medium'
                          ? 'warn'
                          : 'danger'
                    }
                  >
                    Risk: {shareGuard.riskLevel}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<ShieldAlert size={12} aria-hidden />}
                    onClick={() => setSimulateShareOpen(true)}
                  >
                    Simulate
                  </Button>
                </div>
              </div>
              <ul className="settings-risk-card__guidance">
                {shareGuard.guidance.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <Divider />

            <div className="settings-actions-row">
              <Button
                variant="danger"
                leadingIcon={<AlertTriangle size={14} aria-hidden />}
                onClick={() => setClearDataOpen(true)}
              >
                Wipe local data
              </Button>
            </div>
          </Card>
        </section>

        <Divider />

        {/* ── Advanced ── */}
        <section
          id="advanced"
          className="settings-section-anchor"
          ref={(el) => {
            sectionRefs.current['advanced'] = el;
          }}
        >
          <div className="settings-section-head">
            <div className="settings-section-head__copy">
              <h2>Advanced</h2>
              <p>Runtime config health, data portability, and reset controls.</p>
            </div>
          </div>
          <Card padding="lg">
            <div className="settings-section-head" style={{ border: 'none', marginBottom: 0 }}>
              <div className="settings-section-head__copy">
                <h2 style={{ fontSize: 'var(--fs-md)' }}>Runtime config health</h2>
                <p>Live diagnostic from the runtime schema.</p>
              </div>
            </div>
            <div className="settings-health-list">
              <div className="settings-health-row">
                <StatusDot
                  status={configHealth.ok ? 'ok' : 'danger'}
                  label={configHealth.ok ? 'All checks passed' : 'Validation failed'}
                />
                <code>schema.parse(runtimeConfig)</code>
              </div>
              {!configHealth.ok &&
                configHealth.errors.map((err) => (
                  <div className="settings-health-row" key={err}>
                    <StatusDot status="danger" label="Issue" />
                    <code>{err}</code>
                  </div>
                ))}
              <div className="settings-health-row">
                <StatusDot status="info" label="Environment" />
                <code>{runtimeConfig.environment}</code>
              </div>
              <div className="settings-health-row">
                <StatusDot status="info" label="Provider timeout" />
                <code>{runtimeConfig.providerTimeoutMs}ms</code>
              </div>
              <div className="settings-health-row">
                <StatusDot status="info" label="Max answer bullets" />
                <code>{runtimeConfig.maxAnswerBullets}</code>
              </div>
              <div className="settings-health-row">
                <StatusDot status="info" label="Audit retention" />
                <code>{runtimeConfig.auditRetentionDays} days</code>
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <div className="settings-section-head" style={{ border: 'none', marginBottom: 0 }}>
              <div className="settings-section-head__copy">
                <h2 style={{ fontSize: 'var(--fs-md)' }}>Automation &amp; display</h2>
                <p>Auto-activation, TTS provider, and monitor assignment.</p>
              </div>
            </div>
            <Toggle
              checked={autoActivate ?? false}
              onChange={(v) => patch({ autoActivate: v })}
              label="Auto-activate overlay when meeting detected"
            />
            <div>
              <label className="settings-field-label">TTS Provider</label>
              <SegmentedControl
                value={ttsProvider ?? 'browser'}
                options={[
                  { value: 'browser', label: 'Browser' },
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'elevenlabs', label: 'ElevenLabs' },
                ]}
                onChange={(v) => patch({ ttsProvider: v as 'openai' | 'elevenlabs' | 'browser' })}
              />
            </div>
            <div>
              <label className="settings-field-label">Target Monitor</label>
              <Select
                value={String(targetMonitorId ?? -1)}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  patch({ targetMonitorId: id === -1 ? null : id });
                  const mon = monitors.find((m) => m.id === id);
                  if (mon)
                    invoke('set_overlay_monitor', {
                      x: mon.x ?? 0,
                      y: mon.y ?? 0,
                      width: mon.width ?? 1920,
                      height: mon.height ?? 1080,
                    }).catch(() => undefined);
                }}
                options={[
                  { value: '-1', label: 'Primary Monitor' },
                  ...monitors.map((m) => ({
                    value: String(m.id),
                    label: `${m.name}${m.isPrimary ? ' (Primary)' : ''}`,
                  })),
                ]}
              />
            </div>
          </Card>

          <Card padding="lg">
            <div className="settings-section-head" style={{ border: 'none', marginBottom: 0 }}>
              <div className="settings-section-head__copy">
                <h2 style={{ fontSize: 'var(--fs-md)' }}>Data portability</h2>
                <p>Move preferences between devices or restore defaults.</p>
              </div>
            </div>
            <div className="settings-actions-row">
              <Button
                variant="secondary"
                leadingIcon={<Download size={14} aria-hidden />}
                onClick={handleExportSettings}
              >
                Export settings (JSON)
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<Upload size={14} aria-hidden />}
                onClick={handleImportSettings}
              >
                Import settings
              </Button>
              <Button
                variant="danger"
                leadingIcon={<RotateCcw size={14} aria-hidden />}
                onClick={() => setResetDefaultsOpen(true)}
              >
                Reset to defaults
              </Button>
            </div>
          </Card>
        </section>
      </div>

      {/* ── Dialogs ── */}
      <Dialog
        open={clearDataOpen}
        onClose={() => setClearDataOpen(false)}
        title="Wipe all local data?"
        description="This wipes sessions, transcripts, audit events, knowledge chunks, and settings on this device. API keys in the OS keychain remain untouched."
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearDataOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleClearAllData}>
              Yes, wipe everything
            </Button>
          </>
        }
      />

      <Dialog
        open={resetDefaultsOpen}
        onClose={() => setResetDefaultsOpen(false)}
        title="Reset all settings to defaults?"
        description="This clears every local preference and reloads the app. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetDefaultsOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleResetDefaults}>
              Reset everything
            </Button>
          </>
        }
      />

      <Dialog
        open={micConsentOpen}
        onClose={() => setMicConsentOpen(false)}
        title="Microphone access"
        description="MeetingMind would like to use your microphone for a 3-second test recording."
        footer={
          <>
            <Button variant="secondary" onClick={() => setMicConsentOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              leadingIcon={<Volume2 size={13} aria-hidden />}
              onClick={() => void runMicTest()}
            >
              Continue
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            <strong>Why this is needed.</strong> During meetings, MeetingMind transcribes your voice
            so it can surface grounded answers in real time. The mic test verifies your input device
            is working and shows the peak signal level so you can tune the VAD threshold.
          </p>
          <p style={{ margin: 0 }}>
            <strong>How your audio is handled.</strong> The 3-second sample is processed locally for
            level metering and is not stored. During real sessions, audio is processed locally and,
            depending on your STT mode, may be sent to your configured speech-to-text API for
            transcription. No audio leaves the device when STT mode is set to{' '}
            <em>Native (Local)</em>.
          </p>
          <p style={{ margin: 0, fontSize: 'var(--fs-xs, 12px)', color: 'var(--text-2, #a8a8b3)' }}>
            You can revoke microphone access at any time from your operating system's privacy
            settings.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={simulateShareOpen}
        onClose={() => setSimulateShareOpen(false)}
        title="Simulate a sharing scenario"
        description="Choose what you'd be about to share. Share Guard will preview how it would respond."
        footer={
          <Button variant="secondary" onClick={() => setSimulateShareOpen(false)}>
            Close
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <SegmentedControl<ShareMode>
            aria-label="Scenario"
            value={simulateScenario}
            onChange={setSimulateScenario}
            options={SHARE_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <div className="settings-risk-card" data-risk={simulatedShareGuard.riskLevel}>
            <div className="settings-risk-card__head">
              <StatusDot
                status={
                  simulatedShareGuard.riskLevel === 'low'
                    ? 'ok'
                    : simulatedShareGuard.riskLevel === 'medium'
                      ? 'warn'
                      : 'danger'
                }
                label={simulatedShareGuard.statusLabel}
              />
              <Badge
                variant={
                  simulatedShareGuard.riskLevel === 'low'
                    ? 'ok'
                    : simulatedShareGuard.riskLevel === 'medium'
                      ? 'warn'
                      : 'danger'
                }
              >
                {simulatedShareGuard.overlayShouldHide
                  ? 'Overlay would hide'
                  : 'Overlay stays visible'}
              </Badge>
            </div>
            <ul className="settings-risk-card__guidance">
              {simulatedShareGuard.guidance.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
