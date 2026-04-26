// Phase BE — Provider router with circuit breaker + TTFT tracking.
//
// Responsibilities:
//   1. Pick a provider cascade based on user mode (`cloud-fast`, `local-only`,
//      `auto`). Cloud-fast and auto follow Cerebras → Groq → OpenAI → Anthropic.
//      Local-only is deferred and currently returns the demo provider.
//   2. Per-provider circuit breakers: 3 consecutive failures within a 30s
//      window opens the circuit for 60s. After the 60s window, a single
//      half-open probe is allowed (success closes, failure reopens).
//   3. Rolling 5-call TTFT window per provider, exposed via `getStats()`.
//
// The router is intentionally side-effect free aside from its private state
// map and `logger.warn` on circuit transitions; call sites are responsible
// for invoking `recordSuccess` / `recordFailure` based on call outcome.

import { logger } from '../logger';
import { useSettingsStore } from '../../store/settingsStore';

export type ProviderId = 'cerebras' | 'groq' | 'openai' | 'anthropic' | 'demo';

export type RouterMode = 'cloud-fast' | 'local-only' | 'auto';

export interface RouteDecision {
  primary: ProviderId;
  fallback: ProviderId[];
  reason: string;
}

interface ProviderState {
  consecutiveFailures: number;
  lastFailureTs: number;
  /** 0 = closed; >Date.now() = open until that timestamp. */
  openUntil: number;
  /** Rolling window of last 5 TTFT measurements (ms). */
  ttftSamples: number[];
}

const _state: Record<ProviderId, ProviderState> = {
  cerebras: { consecutiveFailures: 0, lastFailureTs: 0, openUntil: 0, ttftSamples: [] },
  groq: { consecutiveFailures: 0, lastFailureTs: 0, openUntil: 0, ttftSamples: [] },
  openai: { consecutiveFailures: 0, lastFailureTs: 0, openUntil: 0, ttftSamples: [] },
  anthropic: { consecutiveFailures: 0, lastFailureTs: 0, openUntil: 0, ttftSamples: [] },
  demo: { consecutiveFailures: 0, lastFailureTs: 0, openUntil: 0, ttftSamples: [] },
};

const FAILURE_WINDOW_MS = 30_000;
const OPEN_DURATION_MS = 60_000;
const FAILURE_THRESHOLD = 3;
const TTFT_WINDOW = 5;
/** Half-open probe window: when the open window is within 30s of expiring,
 *  permit a single trial call so we recover faster than the strict 60s lockout. */
const HALF_OPEN_WINDOW_MS = 30_000;

function isOpen(p: ProviderId): boolean {
  return _state[p].openUntil > Date.now();
}

function isConfigured(p: ProviderId): boolean {
  // Cast through unknown so we don't depend on the exact settingsStore shape;
  // Phase BA owns those field names and they may evolve independently.
  const settings = useSettingsStore.getState() as unknown as Record<string, unknown>;
  switch (p) {
    case 'cerebras':
      return !!((settings.cerebrasApiKey as string | undefined) ?? '').trim();
    case 'groq':
      return !!((settings.groqApiKey as string | undefined) ?? '').trim();
    case 'openai':
      return !!((settings.openAiApiKey as string | undefined) ?? '').trim();
    case 'anthropic':
      return !!((settings.anthropicApiKey as string | undefined) ?? '').trim();
    case 'demo':
      return true; // always available
  }
}

export function recordSuccess(p: ProviderId, ttftMs: number): void {
  _state[p].consecutiveFailures = 0;
  _state[p].openUntil = 0;
  _state[p].ttftSamples.push(ttftMs);
  if (_state[p].ttftSamples.length > TTFT_WINDOW) _state[p].ttftSamples.shift();
}

export function recordFailure(p: ProviderId): void {
  const now = Date.now();
  if (now - _state[p].lastFailureTs > FAILURE_WINDOW_MS) {
    _state[p].consecutiveFailures = 1;
  } else {
    _state[p].consecutiveFailures += 1;
  }
  _state[p].lastFailureTs = now;
  if (_state[p].consecutiveFailures >= FAILURE_THRESHOLD) {
    _state[p].openUntil = now + OPEN_DURATION_MS;
    logger.warn('router', `circuit opened for ${p} (60s)`);
  }
}

/** Half-open probe: if openUntil is within HALF_OPEN_WINDOW_MS of now, let a
 *  single call through so a recovered provider can re-enter the cascade. */
function tryProbe(p: ProviderId): boolean {
  return _state[p].openUntil > 0 && _state[p].openUntil < Date.now() + HALF_OPEN_WINDOW_MS;
}

export function decide(mode: RouterMode = 'auto'): RouteDecision {
  // Local-only mode is deferred; route to demo until a local LLM is wired up.
  const cascade: ProviderId[] =
    mode === 'local-only' ? ['demo'] : ['cerebras', 'groq', 'openai', 'anthropic'];

  // Filter to providers that are configured AND either closed-circuit or
  // eligible for a half-open probe.
  const live = cascade.filter((p) => isConfigured(p) && (!isOpen(p) || tryProbe(p)));

  if (live.length === 0) {
    return {
      primary: 'demo',
      fallback: [],
      reason: 'all providers unconfigured or circuit-open',
    };
  }

  return {
    primary: live[0]!,
    fallback: live.slice(1),
    reason: `cascade live: ${live.join(' → ')}`,
  };
}

export function getStats(): Record<
  ProviderId,
  { p95Ttft: number; failures: number; open: boolean }
> {
  const out: Partial<Record<ProviderId, { p95Ttft: number; failures: number; open: boolean }>> = {};
  for (const p of Object.keys(_state) as ProviderId[]) {
    const samples = [..._state[p].ttftSamples].sort((a, b) => a - b);
    const p95 = samples.length === 0 ? 0 : (samples[Math.floor(samples.length * 0.95)] ?? 0);
    out[p] = {
      p95Ttft: p95,
      failures: _state[p].consecutiveFailures,
      open: isOpen(p),
    };
  }
  return out as Record<ProviderId, { p95Ttft: number; failures: number; open: boolean }>;
}

export function resetCircuit(p: ProviderId): void {
  _state[p] = {
    consecutiveFailures: 0,
    lastFailureTs: 0,
    openUntil: 0,
    ttftSamples: [],
  };
}
