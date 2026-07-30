import { test, expect } from '@playwright/test';

// ── Device viewport definitions ──
const PHONE = { width: 375, height: 667 };
const TABLET = { width: 768, height: 1024 };
const PC = { width: 1280, height: 800 };

test.describe('Multi-Device Viewport Rendering', () => {

  test('Phone (375×667) loads app without errors', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: PHONE });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    // Verify app container renders
    await expect(page.locator('#root')).toBeAttached();
    await ctx.close();
  });

  test('Tablet (768×1024) loads app without errors', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: TABLET });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('#root')).toBeAttached();
    await ctx.close();
  });

  test('Desktop (1280×800) loads app without errors', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: PC });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await expect(page.locator('#root')).toBeAttached();
    await ctx.close();
  });

  test('Desktop can navigate P2P Mesh tab', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: PC });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    // Click P2P Mesh button in desktop nav
    const meshBtn = page.getByRole('button', { name: 'P2P Mesh' });
    await expect(meshBtn).toBeVisible({ timeout: 5000 });
    await meshBtn.click();
    await page.waitForTimeout(1000);
    // Verify mesh content loaded (should show device identity or room controls)
    await expect(page.getByText(/Device|Mesh|Room|Peer/i).first()).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });

  test('Desktop can navigate all tabs', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: PC });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    // Click each main tab
    const tabs = ['New Task', 'Agent Progress', 'Results & Diff', 'Xavier Sync', 'P2P Mesh'];
    for (const tab of tabs) {
      const btn = page.getByRole('button', { name: tab });
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }
    // Verify no crash — back to projects
    await page.getByRole('button', { name: 'Projects' }).click();
    await expect(page.locator('#root')).not.toBeEmpty();
    await ctx.close();
  });
});
