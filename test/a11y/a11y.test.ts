import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('Accessibility Audit — axe-core', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('app shell has no critical a11y violations', async ({ page }) => {
    const { violations } = await injectAxeAndRun(page);
    const critical = violations.filter((v: any) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toHaveLength(0);
  });

  test('mesh tab has no critical a11y violations', async ({ page }) => {
    await page.getByText('P2P Mesh').click();
    await page.waitForTimeout(500);
    const { violations } = await injectAxeAndRun(page);
    const critical = violations.filter((v: any) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toHaveLength(0);
  });

  test('new task tab has no critical a11y violations', async ({ page }) => {
    await page.getByRole('button', { name: 'New Task' }).first().click();
    await page.waitForTimeout(500);
    const { violations } = await injectAxeAndRun(page);
    const critical = violations.filter((v: any) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toHaveLength(0);
  });

  test('memory tab has no critical a11y violations', async ({ page }) => {
    await page.getByText('Xavier Sync').click();
    await page.waitForTimeout(500);
    const { violations } = await injectAxeAndRun(page);
    const critical = violations.filter((v: any) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toHaveLength(0);
  });
});

async function injectAxeAndRun(page: any) {
  const results = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  return results;
}
