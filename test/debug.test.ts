import { test, expect } from '@playwright/test';

test('debug nav buttons', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // Check what buttons exist
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map((b, i) => ({
      index: i,
      text: b.textContent?.trim().substring(0, 80),
      visible: b.offsetParent !== null,
      parentTag: b.parentElement?.tagName || '',
      parentClass: b.parentElement?.className?.substring(0, 40) || '',
    }));
  });
  
  for (const b of buttons) {
    console.log(`[${b.index}] parent=${b.parentTag} visible=${b.visible} text="${b.text}" parentClass="${b.parentClass}"`);
  }
  
  // Check accessible names
  const p2pRole = await page.getByRole('button', { name: 'P2P Mesh' }).count();
  console.log(`\ngetByRole('button', { name: 'P2P Mesh' }) count: ${p2pRole}`);
  
  const meshRole = await page.getByRole('button', { name: 'Mesh' }).count();
  console.log(`getByRole('button', { name: 'Mesh' }) count: ${meshRole}`);
  
  const p2pText = await page.getByText('P2P Mesh').count();
  console.log(`getByText('P2P Mesh') count: ${p2pText}`);
  
  const meshText = await page.getByText('Mesh').count();
  console.log(`getByText('Mesh') count: ${meshText}`);
  
  // Try clicking different ways
  console.log('\nTrying getByRole P2P Mesh click...');
  try {
    await page.getByRole('button', { name: 'P2P Mesh' }).click({ timeout: 2000 });
    console.log('  SUCCESS');
  } catch(e: any) {
    console.log(`  FAILED: ${e.message?.substring(0, 100)}`);
  }
  
  // Try force
  console.log('\nTrying getByText P2P Mesh force click...');
  try {
    await page.getByText('P2P Mesh').first().click({ force: true, timeout: 2000 });
    console.log('  SUCCESS');
    await page.waitForTimeout(600);
    const hasPanel = await page.getByText('Mesh Panel').count();
    console.log(`  Mesh Panel count after click: ${hasPanel}`);
  } catch(e: any) {
    console.log(`  FAILED: ${e.message?.substring(0, 100)}`);
  }

  expect(true).toBe(true);
});
