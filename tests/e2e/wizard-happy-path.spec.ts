/**
 * Wizard Happy Path — full 4-step walkthrough
 *
 * Navigates through Prompts → Prepare → Run → Results, verifying each step
 * completes and transitions correctly.
 */
import { test, expect } from '@playwright/test';

test.describe('Wizard happy path', () => {
  test('completes all 4 steps end-to-end', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.removeItem('lmeval:wizard:state'));
    // ── Step 1: Prompts ────────────────────────────────────────────────────────
    await page.goto('/eval/prompts');
    await expect(page).toHaveURL(/\/eval\/prompts/);

    // Page should have prompt columns
    await expect(page.locator('.pp-selector-bar')).toHaveCount(2);

    // Type into Prompt A — the first column's textarea or content area
    await page.getByLabel('Upload prompt A file').setInputFiles({
      name: 'prompt-a.txt', mimeType: 'text/plain',
      buffer: Buffer.from('You are a helpful assistant for e2e testing.'),
    });
    await page.getByLabel('Upload prompt B file').setInputFiles({
      name: 'prompt-b.txt', mimeType: 'text/plain',
      buffer: Buffer.from('You are a concise assistant for e2e testing.'),
    });

    // Model selector — wait for models to load then select the first one
    await page.locator('.ms-trigger').click();
    await page.getByLabel('Filter models').fill('gemma3:12b');
    await page.getByRole('option', { name: /gemma3:12b/ }).first().click();

    // Next button should be enabled
    const nextBtn = page.locator('button:has-text("Next")');
    await expect(nextBtn).toBeEnabled({ timeout: 5000 });
    await nextBtn.click();

    // ── Step 2: Prepare ────────────────────────────────────────────────────────
    await expect(page).toHaveURL(/\/eval\/config/);

    // Enter a quick test case
    // Try the quick message input specifically
    const userMsgInput = page.locator('.tce-textarea');
    await userMsgInput.fill('What is 2+2?');
    await expect(userMsgInput).toHaveValue('What is 2+2?');

    // Run Evaluation button should be visible
    const runBtn = page.locator('button:has-text("Run Evaluation")');
    await expect(runBtn).toBeVisible({ timeout: 5000 });
    await expect(runBtn).toBeEnabled({ timeout: 10_000 });
    await runBtn.click();

    // ── Step 3: Run ────────────────────────────────────────────────────────────
    await expect(page).toHaveURL(/\/eval\/run\//, { timeout: 10_000 });

    // WebSocket status should be visible
    await expect(page.locator('.ws-status-dot')).toBeVisible({ timeout: 5000 });

    // Wait for run to complete, then click through to results
    await expect(page.locator('button:has-text("View Results")')).toBeVisible({ timeout: 120_000 });
    await page.locator('button:has-text("View Results")').click();
    await expect(page).toHaveURL(/\/eval\/results\//);

    // ── Step 4: Results ────────────────────────────────────────────────────────
    // Scoreboard tab should be active by default
    await expect(page.locator('.rp-tab-active')).toContainText('Scoreboard');
    await expect(page.locator('.rp-tabs')).toBeVisible();
  });
});
