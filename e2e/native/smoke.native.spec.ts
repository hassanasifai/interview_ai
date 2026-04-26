/**
 * Native Tauri smoke test driven by tauri-driver.
 *
 * Run with:
 *   npx playwright test --config=e2e/tauri-driver.config.ts
 *
 * Verifies the production-built binary boots, the dashboard window renders,
 * and the IPC bridge is alive (a no-op invoke returns without error).
 *
 * NOTE: tauri-driver requires the binary to be available at the path set in
 * `tauri-driver.config.ts`. Build it first with `cargo tauri build`.
 */
import { expect, test } from '@playwright/test';

test.describe('native binary smoke', () => {
  test('dashboard renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MeetingMind|app/i, { timeout: 15_000 });
  });

  test('IPC bridge alive — get_monitors returns at least one entry', async ({ page }) => {
    await page.goto('/');
    // Run inside the page's window context so we hit the real Tauri bridge.
    const result = await page.evaluate(async () => {
      // The Tauri @tauri-apps/api/core import is async-imported at runtime;
      // the test page should expose a global bridge via main.tsx in dev mode
      // or the production preload in release mode.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (w.__TAURI__?.core?.invoke) {
        return w.__TAURI__.core.invoke('get_monitors');
      }
      const mod = await import('@tauri-apps/api/core');
      return mod.invoke('get_monitors');
    });
    expect(Array.isArray(result)).toBeTruthy();
    expect((result as unknown[]).length).toBeGreaterThan(0);
  });
});
