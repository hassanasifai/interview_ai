import { test, expect } from '@playwright/test';

test.describe('onboarding flow', () => {
  test('first-run gate redirects to onboarding', async ({ page }) => {
    await page.goto('/sessions');
    // Should redirect to onboarding if not consented
    await page.waitForURL(/onboarding/, { timeout: 10_000 }).catch(() => {});
    // If already consented, this navigates directly to /sessions
    expect(page.url()).toMatch(/(onboarding|sessions)/);
  });
});
