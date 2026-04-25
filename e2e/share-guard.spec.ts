import { test, expect } from '@playwright/test';

test.describe('share guard', () => {
  test('share guard page loads', async ({ page }) => {
    await page.goto('/share-guard');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('share-guard');
  });
});
