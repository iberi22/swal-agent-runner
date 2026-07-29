import { test, expect } from '@playwright/test';

test.describe('Visual Regression — Core Views', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('app shell matches baseline', async ({ page }) => {
    await expect(page).toHaveScreenshot('app-shell.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('mesh tab view matches baseline', async ({ page }) => {
    await page.click('[data-tab="mesh"]');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('mesh-tab.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('new task view matches baseline', async ({ page }) => {
    await page.click('[data-tab="new-task"]');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('new-task-tab.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('memory sync panel matches baseline', async ({ page }) => {
    await page.click('[data-tab="memory"]');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('memory-tab.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
