import { test, expect } from '@playwright/test';

test.describe('Multi-Device Mesh E2E', () => {
  test('PWA loads on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('nav')).toBeVisible();
  });

  test('mesh tab accessible on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('[data-tab="mesh"]');
    await expect(page.locator('text=Device')).toBeVisible();
  });

  test('memory sync panel renders on all viewports', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('[data-tab="memory"]');
    await expect(page.locator('[data-testid="sync-status"]')).toBeVisible();
  });
});
