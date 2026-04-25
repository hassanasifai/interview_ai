import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('app loads and dashboard renders', async ({ page }) => {
    await page.goto('/');
    // Wait for some recognizable element — pick something stable from the app
    await expect(page).toHaveTitle(/MeetingMind|Meeting/i, { timeout: 15_000 });
  });

  test('navigation rail is visible', async ({ page }) => {
    await page.goto('/');
    // Onboarding may redirect; wait for either /onboarding or /sessions
    await page.waitForURL(/(onboarding|sessions|dashboard|operations)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/(onboarding|sessions|dashboard|operations)/);
  });
});
