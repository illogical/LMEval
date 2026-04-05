/**
 * Wizard Happy Path — full 4-step walkthrough
 *
 * Navigates through Prompts → Prepare → Run → Results, verifying each step
 * completes and transitions correctly.
 */
import { test, expect } from '@playwright/test';

test.describe('Wizard happy path', () => {
  test('completes all 4 steps end-to-end', async ({ page }) => {
    // ── Step 1: Prompts ────────────────────────────────────────────────────────
    await page.goto('/eval/prompts');
    await expect(page).toHaveURL(/\/eval\/prompts/);

    // Page should have prompt columns
    await expect(page.locator('.pp-prompt-col')).toHaveCount(2);

    // Type into Prompt A — the first column's textarea or content area
    const promptATextarea = page.locator('.pp-prompt-col').first().locator('textarea').first();
    await promptATextarea.fill('You are a helpful assistant for e2e testing.');

    // Model selector — wait for models to load then select the first one
    await page.waitForSelector('.model-selector, [class*="model"]', { timeout: 10_000 });
    const firstModelCheckbox = page.locator('input[type="checkbox"]').first();
    if (!(await firstModelCheckbox.isChecked())) {
      await firstModelCheckbox.click();
    }

    // Next button should be enabled
    const nextBtn = page.locator('button:has-text("Next")');
    await expect(nextBtn).toBeEnabled({ timeout: 5000 });
    await nextBtn.click();

    // ── Step 2: Prepare ────────────────────────────────────────────────────────
    await expect(page).toHaveURL(/\/eval\/config/);

    // Enter a quick test case
    const quickInput = page.locator('textarea, input[type="text"]').filter({ hasText: '' }).first();
    // Try the quick message input specifically
    const userMsgInput = page.locator('[placeholder*="user message"], [placeholder*="Enter a message"], .tc-quick-input');
    if (await userMsgInput.count() > 0) {
      await userMsgInput.first().fill('What is 2+2?');
    }

    // Run Evaluation button should be visible
    const runBtn = page.locator('button:has-text("Run Evaluation")');
    await expect(runBtn).toBeVisible({ timeout: 5000 });
    await runBtn.click();

    // ── Step 3: Run ────────────────────────────────────────────────────────────
    await expect(page).toHaveURL(/\/eval\/run\//, { timeout: 10_000 });

    // WebSocket status should be visible
    await expect(page.locator('.ws-status-dot')).toBeVisible({ timeout: 5000 });

    // Wait for run to complete (eval:completed navigates to results)
    await expect(page).toHaveURL(/\/eval\/results\//, { timeout: 120_000 });

    // ── Step 4: Results ────────────────────────────────────────────────────────
    // Scoreboard tab should be active by default
    await expect(page.locator('.rp-tab-active')).toContainText('Scoreboard');
    await expect(page.locator('.rp-tabs')).toBeVisible();
  });
});
