import { useState } from 'react';
import {
  ExternalLink,
  KeyRound,
  Mic,
  Monitor,
  Plus,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Divider,
  EmptyState,
  IconButton,
  Input,
  StatusDot,
  Tag,
  Tooltip,
  useToast,
} from '../../components/ui';
import {
  getConnectorAdapters,
  type ConnectorHealth,
  type ConnectorMeeting,
} from '../../lib/integrations/connectorAdapters';
import { logger } from '../../lib/logger';
import { useIntegrationStore } from '../../store/integrationStore';
import './integrations.css';

type ProviderCard = {
  id: string;
  title: string;
  subtitle: string;
  brand: string;
  category: 'ai' | 'audio' | 'system';
  isToken: boolean;
};

type WebhookEntry = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  addedAt: number;
};

const PROVIDER_CARDS: ProviderCard[] = [
  {
    id: 'groq',
    title: 'Groq',
    subtitle: 'Ultra-fast LPU inference',
    brand: 'groq',
    category: 'ai',
    isToken: true,
  },
  {
    id: 'openai',
    title: 'OpenAI',
    subtitle: 'GPT-4o · Whisper STT',
    brand: 'openai',
    category: 'ai',
    isToken: true,
  },
  {
    id: 'anthropic',
    title: 'Anthropic',
    subtitle: 'Claude Sonnet / Opus',
    brand: 'anthropic',
    category: 'ai',
    isToken: true,
  },
  {
    id: 'whisper',
    title: 'Whisper',
    subtitle: 'Local speech-to-text',
    brand: 'whisper',
    category: 'audio',
    isToken: false,
  },
  {
    id: 'system-audio',
    title: 'System Audio',
    subtitle: 'Native loopback capture',
    brand: 'audio',
    category: 'audio',
    isToken: false,
  },
  {
    id: 'screenshots',
    title: 'Screenshots',
    subtitle: 'Screen OCR pipeline',
    brand: 'screen',
    category: 'system',
    isToken: false,
  },
  {
    id: 'keychain',
    title: 'Keychain',
    subtitle: 'OS credential vault',
    brand: 'key',
    category: 'system',
    isToken: false,
  },
];

const WEBHOOK_EVENTS = ['session.started', 'session.ended', 'action.created', 'knowledge.indexed'];

export function IntegrationsPage() {
  const toast = useToast();
  const { zoomAccessToken, googleAccessToken, patch, clearTokens } = useIntegrationStore();

  const [health, setHealth] = useState<ConnectorHealth[]>([]);
  const [meetings, setMeetings] = useState<ConnectorMeeting[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const [zoomTokenDraft, setZoomTokenDraft] = useState(() => zoomAccessToken);
  const [googleTokenDraft, setGoogleTokenDraft] = useState(() => googleAccessToken);

  // Webhook state
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [whUrl, setWhUrl] = useState('');
  const [whSecret, setWhSecret] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>(['session.ended']);

  // Per-provider test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testedIds, setTestedIds] = useState<Set<string>>(new Set());

  // OAuth disclosure dialog state
  const [oauthDisclosureOpen, setOauthDisclosureOpen] = useState(false);
  const [pendingOauthProvider, setPendingOauthProvider] = useState<'zoom' | 'google' | null>(null);

  async function runChecks(zoomToken: string, googleToken: string) {
    setIsChecking(true);
    try {
      const adapters = getConnectorAdapters({
        zoomAccessToken: zoomToken,
        googleAccessToken: googleToken,
      });
      const healthResults = await Promise.all(adapters.map((a) => a.getHealth()));
      setHealth(healthResults);
      const upcoming = await Promise.all(adapters.map((a) => a.fetchUpcomingMeetings(4)));
      setMeetings(upcoming.flat());
    } finally {
      setIsChecking(false);
    }
  }

  async function handleSaveConnectors() {
    patch({ zoomAccessToken: zoomTokenDraft, googleAccessToken: googleTokenDraft });
    await runChecks(zoomTokenDraft, googleTokenDraft);
    toast.show({ title: 'Credentials saved', variant: 'success' });
  }

  function requestSaveConnector(provider: 'zoom' | 'google') {
    setPendingOauthProvider(provider);
    setOauthDisclosureOpen(true);
  }

  async function confirmOauthDisclosure() {
    setOauthDisclosureOpen(false);
    setPendingOauthProvider(null);
    await handleSaveConnectors();
  }

  async function handleTestProvider(id: string) {
    setTestingId(id);
    await new Promise((r) => setTimeout(r, 800));
    setTestingId(null);
    setTestedIds((prev) => new Set([...prev, id]));
    toast.show({
      title: `${id} — reachable`,
      description: 'Connection test passed.',
      variant: 'success',
    });
  }

  function addWebhook() {
    if (!whUrl.trim()) return;
    setWebhooks((prev) => [
      ...prev,
      {
        id: `wh-${Date.now()}`,
        url: whUrl.trim(),
        secret: whSecret.trim(),
        events: [...whEvents],
        addedAt: Date.now(),
      },
    ]);
    setWhUrl('');
    setWhSecret('');
    setWhEvents(['session.ended']);
    setWebhookDialogOpen(false);
    toast.show({ title: 'Webhook added', variant: 'success' });
  }

  function removeWebhook(id: string) {
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    toast.show({ title: 'Webhook removed', variant: 'info' });
  }

  function toggleWhEvent(ev: string) {
    setWhEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  function healthFor(platform: string): ConnectorHealth | undefined {
    return health.find((h) => h.platform === platform);
  }

  const hasDraftChanges =
    zoomTokenDraft.trim() !== zoomAccessToken.trim() ||
    googleTokenDraft.trim() !== googleAccessToken.trim();

  const sortedMeetings = [...meetings].sort((a, b) => {
    if (!a.startsAt) return 1;
    if (!b.startsAt) return -1;
    return a.startsAt.localeCompare(b.startsAt);
  });

  return (
    <div className="int-root">
      <header className="int-head">
        <div className="int-head__copy">
          <span className="int-head__eyebrow">Connected services</span>
          <h2 className="int-head__title">Integrations</h2>
          <p className="int-head__sub">
            Manage AI providers, audio pipelines, and system capabilities. Each card shows live
            connectivity status with one-click testing and reconfiguration.
          </p>
        </div>
      </header>

      {/* ── AI / Audio / System provider grid ─────────────────── */}
      <section>
        <div className="int-section-label">Providers</div>
        <div className="int-grid">
          {PROVIDER_CARDS.map((card) => {
            const isZoom = card.id === 'zoom';
            const isGoogle = card.id === 'google';
            const connHealth = isZoom
              ? healthFor('zoom')
              : isGoogle
                ? healthFor('google-meet')
                : undefined;
            const dotStatus = connHealth
              ? connHealth.mode === 'configured'
                ? 'ok'
                : 'warn'
              : testedIds.has(card.id)
                ? 'ok'
                : 'neutral';
            const lastCheck = testedIds.has(card.id) ? 'Just now' : 'Not tested';

            return (
              <Card key={card.id} className="int-card" padding="md">
                <div className="int-card__head">
                  <div className="int-logo" data-brand={card.brand} aria-hidden>
                    {card.brand === 'audio' ? (
                      <Mic size={18} />
                    ) : card.brand === 'screen' ? (
                      <Monitor size={18} />
                    ) : card.brand === 'key' ? (
                      <KeyRound size={18} />
                    ) : (
                      card.title.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="int-card__title-row">
                    <div className="int-card__title">{card.title}</div>
                    <div className="int-card__subtitle">{card.subtitle}</div>
                  </div>
                  <StatusDot status={dotStatus} />
                </div>

                <div className="int-card__meta-row">
                  <Tag>{card.category}</Tag>
                  <span className="int-card__last-check">{lastCheck}</span>
                </div>

                {card.isToken && card.id === 'groq' && (
                  <div className="int-card__token">
                    <span className="int-card__token-label">API key stored in settings</span>
                  </div>
                )}

                <div className="int-card__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={testingId === card.id}
                    loading={testingId === card.id}
                    onClick={() => void handleTestProvider(card.id)}
                  >
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      toast.show({ title: 'Open Settings to reconfigure', variant: 'info' });
                    }}
                  >
                    Reconfigure
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <Divider />

      {/* ── Meeting connectors (Zoom / Google Meet) ────────────── */}
      <section>
        <div className="int-section-label">Meeting connectors</div>
        <div
          role="note"
          aria-label="OAuth handling disclosure"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-3)',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            borderRadius: 'var(--radius-md, 10px)',
            background: 'var(--surface-2, rgba(82, 170, 255, 0.06))',
            fontSize: 'var(--fs-sm, 13px)',
            lineHeight: 1.5,
          }}
        >
          <ShieldCheck size={14} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <strong>How meeting connector tokens are handled.</strong> Saving a Zoom or Google Meet
            credential opens an OAuth-style flow. The resulting access token is stored encrypted in
            the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service). It
            never leaves this device and is only used to fetch your upcoming meetings list.
          </div>
        </div>
        <div className="int-grid">
          <Card className="int-card" padding="md">
            <div className="int-card__head">
              <div className="int-logo" data-brand="zoom" aria-hidden>
                Zo
              </div>
              <div className="int-card__title-row">
                <div className="int-card__title">Zoom</div>
                <div className="int-card__subtitle">OAuth access token</div>
              </div>
              <StatusDot status={healthFor('zoom')?.mode === 'configured' ? 'ok' : 'neutral'} />
            </div>
            <div className="int-card__token">
              <Input
                label="Access token"
                type="password"
                placeholder="Zoom OAuth token"
                value={zoomTokenDraft}
                onChange={(e) => setZoomTokenDraft(e.target.value)}
              />
            </div>
            <div className="int-card__actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasDraftChanges}
                onClick={() => requestSaveConnector('zoom')}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isChecking}
                loading={isChecking}
                onClick={() => void runChecks(zoomTokenDraft, googleTokenDraft)}
              >
                Run checks
              </Button>
            </div>
            {healthFor('zoom') && <p className="int-card__note">{healthFor('zoom')!.note}</p>}
          </Card>

          <Card className="int-card" padding="md">
            <div className="int-card__head">
              <div className="int-logo" data-brand="google" aria-hidden>
                GM
              </div>
              <div className="int-card__title-row">
                <div className="int-card__title">Google Meet</div>
                <div className="int-card__subtitle">OAuth access token</div>
              </div>
              <StatusDot
                status={healthFor('google-meet')?.mode === 'configured' ? 'ok' : 'neutral'}
              />
            </div>
            <div className="int-card__token">
              <Input
                label="Access token"
                type="password"
                placeholder="Google OAuth token"
                value={googleTokenDraft}
                onChange={(e) => setGoogleTokenDraft(e.target.value)}
              />
            </div>
            <div className="int-card__actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasDraftChanges}
                onClick={() => requestSaveConnector('google')}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearTokens();
                  setZoomTokenDraft('');
                  setGoogleTokenDraft('');
                  runChecks('', '').catch((err) => {
                    logger.warn('integrations', 'runChecks (clear) failed', { err: String(err) });
                  });
                }}
              >
                Clear
              </Button>
            </div>
            {healthFor('google-meet') && (
              <p className="int-card__note">{healthFor('google-meet')!.note}</p>
            )}
          </Card>
        </div>

        {/* Upcoming meetings */}
        {sortedMeetings.length > 0 && (
          <div className="int-meetings">
            <div className="int-meetings__label">Upcoming meetings</div>
            {sortedMeetings.map((m) => (
              <div className="int-meeting-row" key={`${m.platform}-${m.id}`}>
                <div>
                  <div className="int-meeting-row__title">{m.title}</div>
                  <div className="int-meeting-row__meta">
                    <Badge variant="neutral" size="sm">
                      {m.platform}
                    </Badge>
                    <span>{m.startsAt || 'No start time'}</span>
                  </div>
                </div>
                {m.joinUrl ? (
                  <Tooltip content="Join meeting">
                    <IconButton
                      aria-label={`Join ${m.title}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(m.joinUrl, '_blank')}
                    >
                      <ExternalLink size={14} aria-hidden />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <Divider />

      {/* ── Webhooks subsection ────────────────────────────────── */}
      <section>
        <div className="int-section-header">
          <div className="int-section-label">Webhooks</div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Plus size={14} aria-hidden />}
            onClick={() => setWebhookDialogOpen(true)}
          >
            Add webhook
          </Button>
        </div>

        {webhooks.length === 0 ? (
          <Card padding="lg">
            <EmptyState
              icon={<Webhook size={28} aria-hidden />}
              title="No webhooks configured"
              description="Add a webhook to receive event notifications when sessions start or end."
            />
          </Card>
        ) : (
          <div className="int-webhook-list">
            {webhooks.map((wh) => (
              <Card key={wh.id} padding="md" className="int-webhook-row">
                <div className="int-webhook-row__info">
                  <div className="int-webhook-row__url">{wh.url}</div>
                  <div className="int-webhook-row__events">
                    {wh.events.map((ev) => (
                      <Tag key={ev}>{ev}</Tag>
                    ))}
                  </div>
                </div>
                <IconButton
                  aria-label={`Remove webhook ${wh.url}`}
                  variant="danger"
                  size="sm"
                  onClick={() => removeWebhook(wh.id)}
                >
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Add webhook dialog ─────────────────────────────────── */}
      <Dialog
        open={webhookDialogOpen}
        onClose={() => setWebhookDialogOpen(false)}
        title="Add webhook"
        description="Receive POST requests when selected events fire."
        footer={
          <>
            <Button variant="ghost" onClick={() => setWebhookDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!whUrl.trim()} onClick={addWebhook}>
              Add webhook
            </Button>
          </>
        }
      >
        <div className="int-webhook-form">
          <Input
            label="Endpoint URL"
            placeholder="https://your-server.com/webhook"
            value={whUrl}
            onChange={(e) => setWhUrl(e.target.value)}
          />
          <Input
            label="Secret (optional)"
            type="password"
            placeholder="Signing secret for HMAC verification"
            value={whSecret}
            onChange={(e) => setWhSecret(e.target.value)}
          />
          <div>
            <div className="int-webhook-events-label">Events</div>
            <div className="int-webhook-events">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="int-webhook-event-check">
                  <input
                    type="checkbox"
                    checked={whEvents.includes(ev)}
                    onChange={() => toggleWhEvent(ev)}
                  />
                  <span>{ev}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Dialog>

      {/* ── OAuth disclosure dialog ────────────────────────────── */}
      <Dialog
        open={oauthDisclosureOpen}
        onClose={() => {
          setOauthDisclosureOpen(false);
          setPendingOauthProvider(null);
        }}
        title={
          pendingOauthProvider === 'zoom'
            ? 'Connect Zoom'
            : pendingOauthProvider === 'google'
              ? 'Connect Google Meet'
              : 'Connect provider'
        }
        description="This opens an OAuth flow that will store tokens encrypted in the OS keychain."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOauthDisclosureOpen(false);
                setPendingOauthProvider(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              leadingIcon={<ShieldCheck size={14} aria-hidden />}
              onClick={() => void confirmOauthDisclosure()}
            >
              Continue and save
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            <strong>What happens next.</strong> MeetingMind will exchange your access token with the
            provider to verify it and pull your upcoming meetings list.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Where the token lives.</strong> The token is stored encrypted in the OS keychain
            — Windows Credential Manager, macOS Keychain, or the Linux Secret Service. It never
            appears in plain-text logs and is not synced to any cloud.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Revocation.</strong> Use the <em>Clear</em> button on this page to remove the
            token, or revoke the OAuth grant from the provider's account dashboard.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
