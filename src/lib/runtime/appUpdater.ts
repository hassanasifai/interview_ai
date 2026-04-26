import { logger } from '../logger';
import { toastStore } from '../../components/ui';

/**
 * Production update check (D-grade: D8 follow-up + production hygiene).
 *
 * Calls into tauri-plugin-updater to see if a newer release is on the feed.
 * If yes, shows a toast that links into the install flow. The actual feed
 * URL + signing key live in src-tauri/tauri.conf.json under `plugins.updater`
 * and are no-ops until the publisher fills them in.
 *
 * Safe to call unconditionally — when running in dev (where the updater is
 * inactive) or when no update is available, the function silently returns.
 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  // Don't bother in dev — the updater plugin returns "no update" and we want
  // to keep dev consoles quiet.
  if (import.meta.env.DEV) return;

  try {
    // Lazy import so the updater bundle isn't pulled into chunks that don't
    // need it (and so the plugin's absence in older builds doesn't break boot).
    const mod = await import('@tauri-apps/plugin-updater').catch(() => null);
    if (!mod) {
      logger.debug('appUpdater', 'plugin-updater not installed; skipping check', {});
      return;
    }
    const { check } = mod as { check: () => Promise<unknown> };
    const update = (await check()) as null | {
      available: boolean;
      version: string;
      body?: string;
      downloadAndInstall: () => Promise<void>;
    };
    if (!update || !update.available) return;

    toastStore.show({
      variant: 'info',
      title: `Update available — ${update.version}`,
      description:
        update.body?.slice(0, 200) ?? 'Click to install. The app will restart automatically.',
      durationMs: 12000,
    });

    // Defer the install to the next idle tick so the toast renders first.
    setTimeout(() => {
      update.downloadAndInstall().catch((err) => {
        logger.warn('appUpdater', 'downloadAndInstall failed', { err: String(err) });
        toastStore.show({
          variant: 'danger',
          title: 'Update failed',
          description: String(err).slice(0, 200),
          durationMs: 10000,
        });
      });
    }, 1500);
  } catch (err) {
    logger.warn('appUpdater', 'update check failed', { err: String(err) });
  }
}
