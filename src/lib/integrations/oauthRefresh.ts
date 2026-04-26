/**
 * Zoom + Google OAuth token-refresh implementations (D8 fix).
 *
 * The integrationStore previously held no-op refresh handlers and let access
 * tokens silently expire. These functions implement the real
 * refresh-token grant against each provider's OAuth endpoint, then write the
 * refreshed pair back into the keychain via the store's `saveTokens`.
 *
 * Client credentials live in build-time env vars (see `.env.example`):
 *
 *   VITE_ZOOM_CLIENT_ID, VITE_ZOOM_CLIENT_SECRET
 *   VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_CLIENT_SECRET
 *
 * If they're missing the refresher logs a clear warning and skips — the app
 * still works in "session-only" mode where the user re-authenticates each
 * time the access token expires.
 */

import { logger } from '../logger';
import {
  useIntegrationStore,
  type OAuthProvider,
  type OAuthTokens,
} from '../../store/integrationStore';

// Vite exposes import.meta.env at build time. We read once and cache so a
// missing-credential branch logs once per session, not per refresh tick.
const env = import.meta.env as Record<string, string | undefined>;
const zoomClientId = env.VITE_ZOOM_CLIENT_ID ?? '';
const zoomClientSecret = env.VITE_ZOOM_CLIENT_SECRET ?? '';
const googleClientId = env.VITE_GOOGLE_CLIENT_ID ?? '';
const googleClientSecret = env.VITE_GOOGLE_CLIENT_SECRET ?? '';

const _missingCredsWarned: Partial<Record<OAuthProvider, boolean>> = {};
function warnMissingCreds(provider: OAuthProvider) {
  if (_missingCredsWarned[provider]) return;
  _missingCredsWarned[provider] = true;
  logger.warn(
    'oauthRefresh',
    `${provider} OAuth client credentials not configured (build-time env vars). ` +
      `Token refresh disabled — user will need to re-auth on expiry.`,
    { provider },
  );
}

type RefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

async function postRefresh(
  url: string,
  body: URLSearchParams,
  authHeader: string | null,
): Promise<RefreshResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`refresh ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as RefreshResponse;
}

/** Refresh a Zoom access token using the stored refresh_token. */
export async function refreshZoomToken(): Promise<void> {
  const store = useIntegrationStore.getState();
  const current = store.tokens.zoom;
  if (!current?.refreshToken) {
    logger.warn('oauthRefresh', 'no zoom refresh_token to refresh against', {});
    return;
  }
  if (!zoomClientId || !zoomClientSecret) {
    warnMissingCreds('zoom');
    return;
  }
  const basic = btoa(`${zoomClientId}:${zoomClientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });
  const json = await postRefresh('https://zoom.us/oauth/token', body, `Basic ${basic}`);
  if (!json.access_token) {
    logger.warn('oauthRefresh', 'zoom refresh response missing access_token', { json });
    return;
  }
  const next: OAuthTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? current.refreshToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 3600 * 1000,
  };
  // Re-arm the refresh scheduler with this same function so the next cycle
  // also refreshes (the store will reset the timer for us).
  await store.saveTokens('zoom', next, refreshZoomToken);
}

/** Refresh a Google access token using the stored refresh_token. */
export async function refreshGoogleToken(): Promise<void> {
  const store = useIntegrationStore.getState();
  const current = store.tokens.google;
  if (!current?.refreshToken) {
    logger.warn('oauthRefresh', 'no google refresh_token to refresh against', {});
    return;
  }
  if (!googleClientId || !googleClientSecret) {
    warnMissingCreds('google');
    return;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: googleClientId,
    client_secret: googleClientSecret,
  });
  const json = await postRefresh('https://oauth2.googleapis.com/token', body, null);
  if (!json.access_token) {
    logger.warn('oauthRefresh', 'google refresh response missing access_token', { json });
    return;
  }
  // Google's refresh-token grant typically returns a *new* access_token but
  // does NOT return a new refresh_token (it's long-lived) — preserve the
  // existing one.
  const next: OAuthTokens = {
    accessToken: json.access_token,
    refreshToken: current.refreshToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 3600 * 1000,
  };
  await store.saveTokens('google', next, refreshGoogleToken);
}

/** Pick the right refresh function for a provider. */
export function getRefreshFn(provider: OAuthProvider): () => Promise<void> {
  if (provider === 'zoom') return refreshZoomToken;
  return refreshGoogleToken;
}

/**
 * Hook: arm refresh for any tokens already in the store. Call once at app
 * boot after `integrationStore.hydrate()` so a returning user with valid
 * refresh tokens never sees an "access expired" surprise.
 */
export function armPersistedRefreshes(): void {
  const store = useIntegrationStore.getState();
  for (const provider of ['zoom', 'google'] as const) {
    const t = store.tokens[provider];
    if (!t || !t.refreshToken || !t.expiresAt) continue;
    // Re-save tokens unchanged but with the proper refreshFn so the timer
    // gets armed. saveTokens is idempotent against the keychain.
    store.saveTokens(provider, t, getRefreshFn(provider)).catch((err) => {
      logger.warn('oauthRefresh', 'arm refresh failed', { provider, err: String(err) });
    });
  }
}
