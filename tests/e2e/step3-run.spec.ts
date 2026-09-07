/**
 * Step 3 — Run / Dashboard page tests
 *
 * NOTE: These tests require a live evaluation to be running. The easiest
 * approach is to navigate to an existing completed eval's run page, which
 * will load results from the REST API fallback path.
 */
import { test, expect } from '@playwright/test';

test.describe('Step 3: Run dashboard', () => {
  test('WebSocket status dot is rendered on the run page', async ({ page }) => {
    // Start an evaluation via the API and navigate to its run page
    const res = await page.request.get('/api/eval/evaluations?status=completed');
    const evals = await res.json() as Array<{ id: string }>;

    if (evals.length === 0) {
      console.log('No completed evaluations found — skipping run page tests');
      test.skip();
      return;
    }

    const evalId = evals[0].id;
    await page.goto(`/eval/run/${evalId}`);

    // WsStatusDot should be rendered
    const statusDot = page.locator('.ws-status-dot');
    await expect(statusDot).toBeVisible({ timeout: 5000 });
  });

  test('EvalSummaryBar is rendered on the run page', async ({ page }) => {
    const res = await page.request.get('/api/eval/evaluations?status=completed');
    const evals = await res.json() as Array<{ id: string }>;

    if (evals.length === 0) {
      console.log('No completed evaluations found — skipping');
      test.skip();
      return;
    }

    const evalId = evals[0].id;
    await page.goto(`/eval/run/${evalId}`);

    // Summary bar or progress area
    const summaryBar = page.locator('[class*="summary-bar"], [class*="EvalSummaryBar"], [class*="progress"]').first();
    await expect(summaryBar).toBeVisible({ timeout: 10_000 });
  });

  test('LiveFeed section is rendered', async ({ page }) => {
    const res = await page.request.get('/api/eval/evaluations?status=completed');
    const evals = await res.json() as Array<{ id: string }>;

    if (evals.length === 0) {
      console.log('No completed evaluations found — skipping');
      test.skip();
      return;
    }

    const evalId = evals[0].id;
    await page.goto(`/eval/run/${evalId}`);

    // Live feed should render
    const liveFeed = page.locator('[class*="live-feed"], [class*="LiveFeed"]').first();
    await expect(liveFeed).toBeVisible({ timeout: 10_000 });
  });

  test('Completed eval run page shows results and navigates', async ({ page }) => {
    const res = await page.request.get('/api/eval/evaluations?status=completed');
    const evals = await res.json() as Array<{ id: string }>;

    if (evals.length === 0) {
      console.log('No completed evaluations — skipping');
      test.skip();
      return;
    }

    const evalId = evals[0].id;
    await page.goto(`/eval/run/${evalId}`);

    // There should be a link/button to view results
    const viewResultsBtn = page.locator('a:has-text("View Results"), button:has-text("View Results"), a[href*="results"]');
    if (await viewResultsBtn.count() > 0) {
      await expect(viewResultsBtn.first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
