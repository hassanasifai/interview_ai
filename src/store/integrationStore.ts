import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../lib/logger';

// G13: OAuth tokens migrated out of localStorage and into the OS keychain.
// Tokens live in memory in this store; only the keychain copy persists. We
// keep the legacy `zoomAccessToken` / `googleAccessToken` flat fields so the
// IntegrationsPage UI keeps working unchanged, but the canonical, per-provider
// API is `saveTokens` / `loadTokens` / `disconnect`.
//
// G24: token refresh is scheduled in-process. The `refreshFn` is provider-
// specific and is wired in by integration call-sites; a no-op placeholder is
// fine for providers without an automated refresh implementation yet.

const LEGACY_STORAGE_KEY = 'meetingmind-integrations';

export type OAuthProvider = 'zoom' | 'google';

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch-ms timestamp when the access token expires. 0 = unknown. */
  expiresAt?: number;
};

type RefreshFn = () => Promise<void>;

type IntegrationState = {
  /** Legacy flat fields, kept for IntegrationsPage UI compatibility. */
  zoomAccessToken: string;
  googleAccessToken: string;
  /** Per-provider in-memory token state (canonical). */
  tokens: Partial<Record<OAuthProvider, OAuthTokens>>;
  hydrate: () => void;
  /** Legacy patcher used by IntegrationsPage; routes through saveTokens. */
  patch: (next: Partial<Pick<IntegrationState, 'zoomAccessToken' | 'googleAccessToken'>>) => void;
  clearTokens: () => void;
  /** Persist tokens to keychain + memory and arm the refresh scheduler. */
  saveTokens: (
    provider: OAuthProvider,
    tokens: OAuthTokens,
    refreshFn?: RefreshFn,
  ) => Promise<void>;
  /** Load tokens from keychain into memory. Resolves to null if absent. */
  loadTokens: (provider: OAuthProvider) => Promise<OAuthTokens | null>;
  /** Clear keychain entries + scheduler + memory for one provider. */
  disconnect: (provider: OAuthProvider) => Promise<void>;
};

const defaultState: Pick<IntegrationState, 'zoomAccessToken' | 'googleAccessToken' | 'tokens'> = {
  zoomAccessToken: '',
  googleAccessToken: '',
  tokens: {},
};

// ── Per-provider refresh schedulers ──────────────────────────────────────────
const _refreshTimers: Partial<Record<OAuthProvider, ReturnType<typeof setTimeout>>> = {};

function scheduleRefresh(provider: OAuthProvider, expiresAt: number, refreshFn: RefreshFn) {
  const existing = _refreshTimers[provider];
  if (existing) clearTimeout(existing);
  // Fire 5 minutes before expiry. If we're already inside that window or
  // expiresAt is 0/unknown, skip — caller can re-arm after a manual refresh.
  const fiveMinBefore = expiresAt - Date.now() - 5 * 60 * 1000;
  if (fiveMinBefore > 0) {
    _refreshTimers[provider] = setTimeout(() => {
      refreshFn().catch((err) => {
        logger.warn('integrationStore', 'scheduled refresh failed', {
          err: String(err),
          provider,
        });
      });
    }, fiveMinBefore);
  }
}

function clearRefresh(provider: OAuthProvider) {
  const existing = _refreshTimers[provider];
  if (existing) {
    clearTimeout(existing);
    delete _refreshTimers[provider];
  }
}

function keychainKey(
  provider: OAuthProvider,
  field: 'access_token' | 'refresh_token' | 'expires_at',
) {
  return `integration.${provider}.${field}`;
}

async function writeKeychain(provider: OAuthProvider, tokens: OAuthTokens) {
  await invoke('store_api_key', {
    provider: keychainKey(provider, 'access_token'),
    apiKey: tokens.accessToken,
  });
  if (tokens.refreshToken !== undefined) {
    await invoke('store_api_key', {
      provider: keychainKey(provider, 'refresh_token'),
      apiKey: tokens.refreshToken,
    });
  }
  if (tokens.expiresAt !== undefined) {
    await invoke('store_api_key', {
      provider: keychainKey(provider, 'expires_at'),
      apiKey: String(tokens.expiresAt),
    });
  }
}

async function readKeychain(provider: OAuthProvider): Promise<OAuthTokens | null> {
  const accessToken = await invoke<string | null>('retrieve_api_key', {
    provider: keychainKey(provider, 'access_token'),
  });
  if (!accessToken) return null;
  const refreshToken =
    (await invoke<string | null>('retrieve_api_key', {
      provider: keychainKey(provider, 'refresh_token'),
    })) ?? undefined;
  const expiresRaw =
    (await invoke<string | null>('retrieve_api_key', {
      provider: keychainKey(provider, 'expires_at'),
    })) ?? undefined;
  const expiresAtRaw = expiresRaw ? Number(expiresRaw) : undefined;
  const expiresAt = Number.isFinite(expiresAtRaw) ? expiresAtRaw : undefined;
  // exactOptionalPropertyTypes: only attach optional fields when defined so the
  // returned shape conforms to OAuthTokens (where refreshToken/expiresAt are
  // `?: T` rather than `T | undefined`).
  const out: OAuthTokens = { accessToken };
  if (refreshToken) out.refreshToken = refreshToken;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return out;
}

async function deleteKeychain(provider: OAuthProvider) {
  await invoke('delete_api_key', { provider: keychainKey(provider, 'access_token') }).catch(
    () => undefined,
  );
  await invoke('delete_api_key', { provider: keychainKey(provider, 'refresh_token') }).catch(
    () => undefined,
  );
  await invoke('delete_api_key', { provider: keychainKey(provider, 'expires_at') }).catch(
    () => undefined,
  );
}

function flatFieldFor(provider: OAuthProvider): 'zoomAccessToken' | 'googleAccessToken' {
  return provider === 'zoom' ? 'zoomAccessToken' : 'googleAccessToken';
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  ...defaultState,
  hydrate: () => {
    // Best-effort migration: drain any legacy localStorage payload into the
    // keychain on first hydrate, then nuke the localStorage record. Tokens
    // henceforth only live in keychain + memory.
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<
          Pick<IntegrationState, 'zoomAccessToken' | 'googleAccessToken'>
        >;
        if (parsed.zoomAccessToken) {
          get()
            .saveTokens('zoom', { accessToken: parsed.zoomAccessToken })
            .catch((err) => {
              logger.warn('integrationStore', 'legacy zoom migration failed', { err: String(err) });
            });
        }
        if (parsed.googleAccessToken) {
          get()
            .saveTokens('google', { accessToken: parsed.googleAccessToken })
            .catch((err) => {
              logger.warn('integrationStore', 'legacy google migration failed', {
                err: String(err),
              });
            });
        }
      } catch (err) {
        logger.warn('integrationStore', 'legacy storage parse failed', { err: String(err) });
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    // Pull any keychain-resident tokens back into memory so the UI shows them.
    get()
      .loadTokens('zoom')
      .catch((err) => {
        logger.warn('integrationStore', 'load zoom tokens failed', { err: String(err) });
      });
    get()
      .loadTokens('google')
      .catch((err) => {
        logger.warn('integrationStore', 'load google tokens failed', { err: String(err) });
      });
  },
  patch: (next) => {
    // Legacy patch path: IntegrationsPage edits flat fields. Forward each
    // changed field through saveTokens so we keep keychain in sync. We
    // intentionally fire-and-forget since the page already shows toasts.
    const onPatchError = (op: string, provider: OAuthProvider) => (err: unknown) => {
      logger.warn('integrationStore', 'patch path failed', {
        err: String(err),
        op,
        provider,
      });
    };
    if (typeof next.zoomAccessToken === 'string') {
      const value = next.zoomAccessToken.trim();
      if (value) {
        get().saveTokens('zoom', { accessToken: value }).catch(onPatchError('save', 'zoom'));
      } else {
        get().disconnect('zoom').catch(onPatchError('disconnect', 'zoom'));
      }
    }
    if (typeof next.googleAccessToken === 'string') {
      const value = next.googleAccessToken.trim();
      if (value) {
        get().saveTokens('google', { accessToken: value }).catch(onPatchError('save', 'google'));
      } else {
        get().disconnect('google').catch(onPatchError('disconnect', 'google'));
      }
    }
  },
  clearTokens: () => {
    const onClearError = (provider: OAuthProvider) => (err: unknown) => {
      logger.warn('integrationStore', 'clearTokens disconnect failed', {
        err: String(err),
        provider,
      });
    };
    get().disconnect('zoom').catch(onClearError('zoom'));
    get().disconnect('google').catch(onClearError('google'));
    // Belt-and-braces: remove any stray legacy localStorage entry.
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    set(defaultState);
  },
  saveTokens: async (provider, tokens, refreshFn) => {
    await writeKeychain(provider, tokens);
    set((state) => ({
      tokens: { ...state.tokens, [provider]: tokens },
      [flatFieldFor(provider)]: tokens.accessToken,
    }));
    if (tokens.expiresAt && tokens.expiresAt > 0) {
      // TODO: real refresh handlers are vendor-specific (Zoom / Google use
      // different endpoints + scopes). Until those land, the no-op is harmless
      // — the timer simply fires and exits, leaving the access token in place.
      const fn: RefreshFn = refreshFn ?? (async () => undefined);
      scheduleRefresh(provider, tokens.expiresAt, fn);
    } else {
      clearRefresh(provider);
    }
  },
  loadTokens: async (provider) => {
    const tokens = await readKeychain(provider).catch(() => null);
    if (!tokens) {
      set((state) => ({
        tokens: { ...state.tokens, [provider]: undefined },
        [flatFieldFor(provider)]: '',
      }));
      return null;
    }
    set((state) => ({
      tokens: { ...state.tokens, [provider]: tokens },
      [flatFieldFor(provider)]: tokens.accessToken,
    }));
    return tokens;
  },
  disconnect: async (provider) => {
    clearRefresh(provider);
    await deleteKeychain(provider);
    set((state) => ({
      tokens: { ...state.tokens, [provider]: undefined },
      [flatFieldFor(provider)]: '',
    }));
  },
}));
