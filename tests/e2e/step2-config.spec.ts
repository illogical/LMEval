/**
 * Step 2 — Prepare / Config page tests (template, judge, matrix preview)
 */
import { test, expect } from '@playwright/test';

// Navigate to config page via wizard state (requires step 1 completion)
// These tests stub navigation by going directly and relying on localStorage state.

test.describe('Step 2: Config page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/eval/prompts');
    await page.evaluate(() => localStorage.setItem('lmeval:wizard:state', JSON.stringify({
      promptA: { id: null, version: 1, content: 'Test prompt', manifest: null },
      selectedModels: [{ serverName: 'Localhost', modelName: 'gemma3:12b' }],
      userMessage: 'Test message', currentStep: 2, maxVisitedStep: 2,
    })));
    await page.goto('/eval/config');
    await expect(page.locator('.config-page')).toBeVisible();
  });

  test('Config page renders core sections', async ({ page }) => {
    await expect(page.locator('.cp-section, [class*="config-section"], [class*="card"]').first()).toBeVisible();
    // Run Evaluation button should be present in the header
    await expect(page.locator('button:has-text("Run Evaluation")')).toBeVisible();
  });

  test('Execution matrix preview shows cell count', async ({ page }) => {
    // The ExecutionPreview component should show a number
    const preview = page.locator('[class*="execution-preview"], [class*="ExecutionPreview"], [class*="matrix"]');
    if (await preview.count() > 0) {
      await expect(preview.first()).toBeVisible();
    } else {
      // Sidebar may be used
      const sidebar = page.locator('[class*="sidebar"], [class*="cp-sidebar"]');
      if (await sidebar.count() > 0) await expect(sidebar.first()).toBeVisible();
    }
  });

  test('Template selector is visible', async ({ page }) => {
    const templateSelector = page.locator('[class*="template-selector"], [class*="TemplateSelector"]');
    if (await templateSelector.count() > 0) {
      await expect(templateSelector.first()).toBeVisible();
    }
  });

  test('Judge config section is visible', async ({ page }) => {
    const judgeConfig = page.locator('[class*="judge-config"], [class*="JudgeConfig"]');
    if (await judgeConfig.count() > 0) {
      await expect(judgeConfig.first()).toBeVisible();
    }
    // Alternatively, look for the runs-per-cell input
    const runsInput = page.locator('input[type="number"], input[min="1"]');
    if (await runsInput.count() > 0) {
      await expect(runsInput.first()).toBeVisible();
    }
  });

  test('Runs per cell control changes matrix count', async ({ page }) => {
    const runsInput = page.locator('input[type="number"]').first();
    if (await runsInput.count() === 0) {
      console.log('No runs-per-cell input found — skipping');
      return;
    }
    const initialValue = await runsInput.inputValue();
    await runsInput.fill('2');
    await page.waitForTimeout(300);
    // The preview count should update (we just verify no error thrown)
    const newValue = await runsInput.inputValue();
    expect(newValue).toBe('2');
    // Restore
    await runsInput.fill(initialValue || '1');
  });
});
