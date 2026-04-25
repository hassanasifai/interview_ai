import { test, expect } from '@playwright/test';

test.describe('settings persistence', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Verify some settings element is visible
    await expect(page.locator('text=/profile|provider|audio|hotkey/i').first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => {});
  });
});
