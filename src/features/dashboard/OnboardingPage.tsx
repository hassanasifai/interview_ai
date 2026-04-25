import { BrainCircuit, CheckCircle2, Sparkles, Shield, Database, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { seedDemoKnowledgeBase } from '../../fixtures/demoKnowledge';
import { logger } from '../../lib/logger';
import { createLiveAnswerProvider } from '../../lib/providers/providerFactory';
import { appendAuditEvent } from '../../lib/runtime/auditEvents';
import { getDisclosureTemplate } from '../../lib/runtime/disclosureTemplates';
import { useSettingsStore } from '../../store/settingsStore';
import type { ProviderName } from '../../lib/tauri';
import {
  Badge,
  Button,
  Card,
  Input,
  SegmentedControl,
  Toggle,
  useToast,
} from '../../components/ui';
import './onboarding.css';

const profileSchema = z.object({
  userName: z.string().trim().min(1, 'Name is required.'),
  userRole: z.string().trim().min(1, 'Role is required.'),
  companyName: z.string().trim().min(1, 'Company is required.'),
});

type StepId = 'welcome' | 'profile' | 'provider' | 'consent' | 'demo';

type StepMeta = {
  id: StepId;
  title: string;
  description: string;
};

const STEPS: StepMeta[] = [
  { id: 'welcome', title: 'Welcome', description: 'A quick tour before your first session.' },
  { id: 'profile', title: 'Your profile', description: 'Tells the copilot how to frame answers.' },
  { id: 'provider', title: 'AI provider', description: 'Pick an LLM and connect securely.' },
  {
    id: 'consent',
    title: 'Consent & disclosure',
    description: 'Stay on the right side of meeting etiquette.',
  },
  {
    id: 'demo',
    title: 'Demo knowledge',
    description: 'Optional sample RAG corpus to try things out.',
  },
];

const PROVIDER_OPTIONS: { value: ProviderName; label: string }[] = [
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

function providerHint(provider: ProviderName): string {
  if (provider === 'openai') return 'Begins with sk-… Saved to OS keychain on blur.';
  if (provider === 'anthropic') return 'Begins with sk-ant-… Saved to OS keychain on blur.';
  return 'Begins with gsk_… Saved to OS keychain on blur.';
}

function providerPlaceholder(provider: ProviderName): string {
  if (provider === 'openai') return 'sk-...';
  if (provider === 'anthropic') return 'sk-ant-...';
  return 'gsk_...';
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const {
    profile,
    groqApiKey,
    openAiApiKey,
    anthropicApiKey,
    selectedProvider,
    consentAccepted,
    patch,
    saveApiKey,
  } = useSettingsStore();

  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<{
    userName?: string;
    userRole?: string;
    companyName?: string;
  }>({});
  const [seedDemo, setSeedDemo] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [authorizedUse, setAuthorizedUse] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const currentStep = STEPS[stepIndex];

  function updateProfile(field: keyof typeof profile, value: string) {
    patch({ profile: { ...profile, [field]: value } });
  }

  const currentApiKey = useMemo(() => {
    if (selectedProvider === 'openai') return openAiApiKey;
    if (selectedProvider === 'anthropic') return anthropicApiKey;
    return groqApiKey;
  }, [selectedProvider, openAiApiKey, anthropicApiKey, groqApiKey]);

  function setApiKeyInMemory(value: string) {
    if (selectedProvider === 'groq') patch({ groqApiKey: value });
    else if (selectedProvider === 'openai') patch({ openAiApiKey: value });
    else patch({ anthropicApiKey: value });
  }

  async function persistApiKey(value: string) {
    if (!value.trim()) return;
    await saveApiKey(selectedProvider, value.trim());
  }

  async function testConnection() {
    const key = currentApiKey.trim();
    if (!key) {
      setTestState('fail');
      toast.show({ title: 'Enter an API key first', variant: 'warn' });
      return;
    }
    setTestState('testing');
    try {
      const provider = createLiveAnswerProvider(selectedProvider, key);
      const answer = await provider.complete({
        systemPrompt: 'Reply with a single word: OK',
        userPrompt: 'Health check.',
      });
      if (answer && answer.length > 0) {
        setTestState('ok');
        toast.show({ title: 'Connection verified', variant: 'success' });
      } else {
        setTestState('fail');
        toast.show({ title: 'Empty response from provider', variant: 'warn' });
      }
    } catch (err) {
      logger.warn('onboarding', 'connection test failed', { err: String(err) });
      setTestState('fail');
      toast.show({
        title: 'Connection failed',
        description: 'Check the API key and try again.',
        variant: 'danger',
      });
    }
  }

  function validateProfile(): boolean {
    const result = profileSchema.safeParse({
      userName: profile.userName,
      userRole: profile.userRole,
      companyName: profile.companyName,
    });
    if (!result.success) {
      const flattened = result.error.flatten().fieldErrors;
      const next: { userName?: string; userRole?: string; companyName?: string } = {};
      if (flattened.userName?.[0]) next.userName = flattened.userName[0];
      if (flattened.userRole?.[0]) next.userRole = flattened.userRole[0];
      if (flattened.companyName?.[0]) next.companyName = flattened.companyName[0];
      setErrors(next);
      return false;
    }
    setErrors({});
    return true;
  }

  function canAdvance(): boolean {
    if (currentStep.id === 'profile') {
      return (
        profile.userName.trim().length > 0 &&
        profile.userRole.trim().length > 0 &&
        profile.companyName.trim().length > 0
      );
    }
    if (currentStep.id === 'consent') {
      return consentAccepted && authorizedUse;
    }
    return true;
  }

  function handleNext() {
    if (currentStep.id === 'profile' && !validateProfile()) return;
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1);
  }

  function handleBack() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  function finishOnboarding() {
    if (seedDemo && !seeded) {
      seedDemoKnowledgeBase();
      setSeeded(true);
    }
    appendAuditEvent('consent_updated', {
      accepted: consentAccepted,
      source: 'onboarding-finish',
    });
    toast.show({
      title: 'Setup complete',
      description: 'Jumping into Sessions — ready when you are.',
      variant: 'success',
    });
    void navigate('/sessions');
  }

  const consentGateMessage =
    currentStep.id === 'consent' && !canAdvance()
      ? 'Tick both consent acknowledgements below to continue. Sessions cannot start until consent is on file.'
      : null;

  return (
    <div className="ob-container">
      <div
        role="note"
        aria-label="Onboarding gating notice"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          marginBottom: 'var(--space-4)',
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
          borderRadius: 'var(--radius-md, 10px)',
          background: 'var(--surface-2, rgba(124, 108, 240, 0.06))',
          fontSize: 'var(--fs-sm, 13px)',
          lineHeight: 1.5,
        }}
      >
        <Lock size={14} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <strong>First-run setup is required.</strong> MeetingMind will not unlock the dashboard,
          sessions, or overlay until you complete every step:{' '}
          <em>Profile → Provider → Consent → Demo</em>. Navigating away mid-flow returns you here.
          Your inputs are saved between steps so you can resume safely.
        </div>
      </div>

      <StepsIndicator currentIndex={stepIndex} />

      {consentGateMessage ? (
        <div
          role="status"
          style={{
            padding: 'var(--space-2) var(--space-3)',
            margin: 'var(--space-2) 0',
            border: '1px solid var(--warn, rgba(229, 165, 36, 0.4))',
            borderRadius: 'var(--radius-sm, 8px)',
            color: 'var(--warn, #e5a524)',
            fontSize: 'var(--fs-sm, 13px)',
          }}
        >
          {consentGateMessage}
        </div>
      ) : null}

      {currentStep.id === 'welcome' ? (
        <Card variant="elevated" padding="none" className="ob-step-card">
          <div className="ob-hero-gradient">
            <div className="ob-hero-icon" aria-hidden>
              <BrainCircuit size={30} />
            </div>
            <h1 className="ob-hero-title">Welcome to MeetingMind</h1>
            <p className="ob-hero-lede">
              A local-first AI copilot that listens with you, surfaces grounded answers, and keeps
              your meeting etiquette airtight. Nothing leaves your machine without your say-so.
            </p>
            <div className="ob-hero-features">
              <Badge variant="gold">
                <Sparkles size={12} style={{ marginRight: 4 }} />
                Grounded answers
              </Badge>
              <Badge variant="blue">
                <Shield size={12} style={{ marginRight: 4 }} />
                Share Guard
              </Badge>
              <Badge variant="violet">
                <Database size={12} style={{ marginRight: 4 }} />
                Your knowledge
              </Badge>
            </div>
            <div className="ob-cta-row ob-cta-row--center">
              <Button size="lg" variant="primary" onClick={handleNext}>
                Get started
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {currentStep.id === 'profile' ? (
        <Card variant="elevated" padding="lg" className="ob-step-card">
          <StepHeader index={1} meta={currentStep} />
          <div className="ob-field-stack">
            <Input
              label="Full name"
              placeholder="Alex Johnson"
              value={profile.userName}
              onChange={(e) => updateProfile('userName', e.target.value)}
              error={errors.userName}
              autoFocus
            />
            <div className="ob-field-grid">
              <Input
                label="Role"
                placeholder="Software Engineer"
                value={profile.userRole}
                onChange={(e) => updateProfile('userRole', e.target.value)}
                error={errors.userRole}
              />
              <Input
                label="Company"
                placeholder="MeetingMind"
                value={profile.companyName}
                onChange={(e) => updateProfile('companyName', e.target.value)}
                error={errors.companyName}
              />
            </div>
          </div>
          <FooterRow onBack={handleBack} onNext={handleNext} nextDisabled={!canAdvance()} />
        </Card>
      ) : null}

      {currentStep.id === 'provider' ? (
        <Card variant="elevated" padding="lg" className="ob-step-card">
          <StepHeader index={2} meta={currentStep} />
          <div className="ob-field-stack">
            <div>
              <div className="ob-disclosure-box__label">LLM provider</div>
              <SegmentedControl<ProviderName>
                aria-label="AI provider"
                value={selectedProvider}
                onChange={(val) => {
                  patch({ selectedProvider: val });
                  setTestState('idle');
                }}
                options={PROVIDER_OPTIONS}
              />
            </div>

            <Input
              label="API key"
              type="password"
              placeholder={providerPlaceholder(selectedProvider)}
              hint={providerHint(selectedProvider)}
              value={currentApiKey}
              onChange={(e) => {
                setApiKeyInMemory(e.target.value);
                setTestState('idle');
              }}
              onBlur={(e) => void persistApiKey(e.target.value)}
            />

            <div className="ob-test-row">
              <Button
                variant="secondary"
                size="sm"
                loading={testState === 'testing'}
                onClick={() => void testConnection()}
              >
                Test connection
              </Button>
              {testState === 'ok' ? <Badge variant="ok">Connected</Badge> : null}
              {testState === 'fail' ? <Badge variant="danger">Failed</Badge> : null}
            </div>
          </div>
          <FooterRow onBack={handleBack} onNext={handleNext} />
        </Card>
      ) : null}

      {currentStep.id === 'consent' ? (
        <Card variant="elevated" padding="lg" className="ob-step-card">
          <StepHeader index={3} meta={currentStep} />
          <div className="ob-disclosure-box">
            <span className="ob-disclosure-box__label">Suggested disclosure</span>
            {getDisclosureTemplate('global')}
          </div>
          <div className="ob-toggle-stack">
            <Toggle
              checked={consentAccepted}
              onChange={(next) => {
                patch({ consentAccepted: next });
                appendAuditEvent('consent_updated', {
                  accepted: next,
                  source: 'onboarding',
                });
              }}
              label="I consent to meeting capture in contexts where all parties are aware."
              hint="This toggle is logged to the local audit trail."
            />
            <Toggle
              checked={authorizedUse}
              onChange={setAuthorizedUse}
              label="I understand this tool is for authorized use only."
              hint="You are responsible for applicable recording and disclosure laws."
            />
          </div>
          <FooterRow onBack={handleBack} onNext={handleNext} nextDisabled={!canAdvance()} />
        </Card>
      ) : null}

      {currentStep.id === 'demo' ? (
        <Card variant="elevated" padding="lg" className="ob-step-card">
          <StepHeader index={4} meta={currentStep} />
          <div className="ob-toggle-stack">
            <Toggle
              checked={seedDemo}
              onChange={setSeedDemo}
              label="Seed a demo knowledge base"
              hint="Adds pricing, security, and objection-handling snippets so you can test RAG immediately."
            />
            {seeded ? (
              <div className="ob-test-row">
                <Badge variant="ok">
                  <CheckCircle2 size={12} style={{ marginRight: 4 }} />
                  Demo knowledge loaded
                </Badge>
              </div>
            ) : null}
          </div>
          <div className="ob-cta-row">
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
            <div className="ob-cta-row__right">
              <Button variant="primary" size="lg" onClick={finishOnboarding}>
                Finish setup
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function StepsIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <div
      className="ob-steps-indicator"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={currentIndex + 1}
    >
      {STEPS.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        return (
          <span
            key={step.id}
            className={
              'ob-step-dot' +
              (state === 'done' ? ' ob-step-dot--done' : '') +
              (state === 'current' ? ' ob-step-dot--current' : '')
            }
            aria-label={step.title}
          />
        );
      })}
      <span className="ob-step-count">
        Step {currentIndex + 1} of {STEPS.length}
      </span>
    </div>
  );
}

function StepHeader({ index, meta }: { index: number; meta: StepMeta }) {
  return (
    <div className="ob-step-header">
      <div className="ob-step-number" aria-hidden>
        {index}
      </div>
      <div className="ob-step-heading">
        <div className="ob-step-heading__title">{meta.title}</div>
        <div className="ob-step-heading__desc">{meta.description}</div>
      </div>
    </div>
  );
}

function FooterRow({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = 'Continue',
}: {
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="ob-cta-row">
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <div className="ob-cta-row__right">
        <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
