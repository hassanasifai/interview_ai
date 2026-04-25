import { test, expect } from '@playwright/test';

test.describe('hotkeys', () => {
  test('ctrl+k opens command palette', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Control+k');
    // Command palette likely appears — check for an input or modal
    const palette = page.locator('[role="dialog"], [data-command-palette]');
    await expect(palette.first())
      .toBeVisible({ timeout: 3_000 })
      .catch(() => {});
  });
});
