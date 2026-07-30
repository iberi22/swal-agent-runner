import { test, expect } from '@playwright/test';

test('debug nav buttons', async ({ page }) => {
  // Listen for console errors
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  console.log('Initial errors:', errors.length);
  
  // Check active tab before click
  const beforeTab = await page.evaluate(() => {
    // Check which button has the active styling
    const activeBtn = document.querySelector('.bg-accent\\/15');
    return activeBtn?.textContent?.trim() || 'none';
  });
  console.log('Active tab before click:', beforeTab);

  // Click P2P Mesh  
  await page.getByRole('button', { name: 'P2P Mesh' }).click();
  console.log('Clicked P2P Mesh');
  
  await page.waitForTimeout(500);
  
  // Check active tab after click
  const afterTab = await page.evaluate(() => {
    const activeBtn = document.querySelector('.bg-accent\\/15');
    return activeBtn?.textContent?.trim() || 'none';
  });
  console.log('Active tab after click:', afterTab);
  
  // Check what's visible
  const bodyHtml = await page.evaluate(() => {
    // Check if MeshPanel loaded
    const meshPanelEl = document.body.textContent?.includes('Mesh Panel');
    // Check if loading skeleton is visible
    const skeletonEl = document.querySelector('.animate-pulse');
    return {
      hasMeshPanelText: meshPanelEl,
      hasSkeleton: skeletonEl !== null,
      skeletonHtml: skeletonEl?.innerHTML?.substring(0, 200) || 'none',
      hasRootChildren: document.querySelector('#root')?.children.length || 0,
    };
  });
  console.log('After click state:', JSON.stringify(bodyHtml, null, 2));
  
  // Wait longer
  await page.waitForTimeout(3000);
  const afterLongWait = await page.evaluate(() => {
    return {
      hasMeshPanelText: document.body.textContent?.includes('Mesh Panel'),
      textLength: document.body.textContent?.length || 0,
    };
  });
  console.log('After 3s wait:', JSON.stringify(afterLongWait, null, 2));
  console.log(`Console errors (${errors.length}):`, errors);

  expect(true).toBe(true);
});
