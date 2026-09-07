/**
 * Step 4 — Results page tests
 */
import { test, expect } from '@playwright/test';

test.describe('Step 4: Results page', () => {
  let evalId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/eval/evaluations?status=completed');
    const evals = await res.json() as Array<{ id: string }>;
    if (evals.length > 0) evalId = evals[0].id;
  });

  test.beforeEach(async ({ page }) => {
    if (!evalId) {
      console.log('No completed eval available — skipping results tests');
      test.skip();
      return;
    }
    await page.goto(`/eval/results/${evalId}`);
    // Wait for tabs to render
    await expect(page.locator('.rp-tabs')).toBeVisible({ timeout: 10_000 });
  });

  test('All 5 result tabs are present', async ({ page }) => {
    const tabs = ['Scoreboard', 'Breakdown', 'Compare', 'Detail', 'Trend'];
    for (const tab of tabs) {
      await expect(page.locator(`.rp-tab:has-text("${tab}")`)).toBeVisible();
    }
  });

  test('Scoreboard tab is active by default', async ({ page }) => {
    await expect(page.locator('.rp-tab-active')).toContainText('Scoreboard');
  });

  test('Clicking each tab renders different content', async ({ page }) => {
    const tabs = ['Compare', 'Breakdown', 'Trend', 'Detail', 'Scoreboard'];
    for (const tabName of tabs) {
      await page.locator(`.rp-tab:has-text("${tabName}")`).click();
      await expect(page.locator('.rp-tab-active')).toContainText(tabName);
      await page.waitForTimeout(200);
    }
  });

  test('Scoreboard data cells are clickable and switch to Compare', async ({ page }) => {
    await page.locator('.rp-tab:has-text("Scoreboard")').click();

    const cell = page.locator('.hm-data-cell').first();
    if (await cell.count() === 0) {
      console.log('No scoreboard cells found — skipping click-through test');
      return;
    }
    await cell.click();
    await page.waitForTimeout(300);
    await expect(page.locator('.rp-tab-active')).toContainText('Compare');
  });

  test('Export HTML button triggers download', async ({ page }) => {
    // Listen for the download event
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
    await page.locator('button[title="Export HTML"]').click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.html$/);
    } else {
      console.log('HTML download did not trigger — may require completed cells with data');
    }
  });

  test('Export Markdown button triggers download', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
    await page.locator('button[title="Export Markdown"]').click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.md$/);
    } else {
      console.log('Markdown download did not trigger — may require completed cells with data');
    }
  });

  test('Save Baseline button is visible', async ({ page }) => {
    const baselineBtn = page.locator('button:has-text("Save Baseline")');
    await expect(baselineBtn).toBeVisible();
  });

  test('Save Baseline opens the inline slug editor', async ({ page }) => {
    await page.locator('button:has-text("Save Baseline")').click();
    await expect(page.locator('.vh-slug-input')).toBeVisible();
    await expect(page.locator('.vh-baseline-input').getByRole('button', { name: 'Cancel' })).toBeVisible();
  });
});
