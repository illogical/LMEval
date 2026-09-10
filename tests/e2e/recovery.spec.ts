import { test, expect } from '@playwright/test';

function baseConfig(evalId: string, status: string) {
  return {
    id: evalId, name: 'Recovery smoke', promptIds: ['prompt-1'], modelIds: ['local::model-a'],
    status, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
  };
}

function baseFeedback(evalId: string, status: string, recovery: Record<string, unknown>) {
  return {
    evalId, status,
    progress: { total: 4, completed: 2, failed: 0, updatedAt: '2026-09-08T00:00:00.000Z' },
    validation: { valid: true, errors: [], warnings: [] }, failures: [],
    readiness: { results: false, summary: false, regression: false, summaryAnalysis: false },
    verdict: null, appBasePath: '/',
    browserPaths: { config: `/eval/config/${evalId}`, run: `/eval/run/${evalId}`, results: `/eval/results/${evalId}`, summary: `/eval/summary/${evalId}` },
    recovery,
  };
}

test.describe('Evaluation recovery dashboard', () => {
  test('shows an interrupted legacy run as diagnostic-only and keeps Resume disabled', async ({ page }) => {
    const feedback = {
      evalId: 'eval-recovery', status: 'interrupted',
      progress: { total: 240, completed: 48, failed: 0, updatedAt: '2026-09-08T00:00:00.000Z' },
      validation: { valid: true, errors: [], warnings: [] }, failures: [],
      readiness: { results: false, summary: false, regression: false, summaryAnalysis: false },
      verdict: null, appBasePath: '/',
      browserPaths: { config: '/eval/config/eval-recovery', run: '/eval/run/eval-recovery', results: '/eval/results/eval-recovery', summary: '/eval/summary/eval-recovery' },
      recovery: { state: 'legacy-unrecoverable', reasonCode: 'LEGACY_NO_CHECKPOINTS', reusedCells: 0, remainingCells: 240, requiresModelCalls: true },
    };
    const config = {
      id: 'eval-recovery', name: 'Interrupted smoke', promptIds: ['prompt-1'], modelIds: ['local::model-a'],
      status: 'interrupted', createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    };
    await page.route('**/api/eval/evaluations/eval-recovery/feedback', route => route.fulfill({ json: feedback }));
    await page.route('**/api/eval/evaluations/eval-recovery', route => route.fulfill({ json: config }));
    await page.goto('/eval/run/eval-recovery');
    await expect(page.getByRole('heading', { name: 'Evaluation Interrupted' })).toBeVisible();
    await expect(page.getByText('LEGACY_NO_CHECKPOINTS')).toBeVisible();
    await expect(page.getByText(/old progress count is diagnostic only/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume this evaluation' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create a full rerun as a new evaluation' })).toBeEnabled();
  });

  test('finalization-only recovery resumes with a single confirmation and no further model calls implied', async ({ page }) => {
    const evalId = 'eval-finalization-only';
    const feedback = baseFeedback(evalId, 'interrupted', {
      state: 'finalization-only', reasonCode: undefined, reusedCells: 4, remainingCells: 0, requiresModelCalls: false,
    });
    let resumeCalled = false;
    await page.route(`**/api/eval/evaluations/${evalId}/feedback`, route => route.fulfill({ json: feedback }));
    await page.route(`**/api/eval/evaluations/${evalId}`, route => route.fulfill({ json: baseConfig(evalId, 'interrupted') }));
    await page.route(`**/api/eval/evaluations/${evalId}/resume`, route => {
      resumeCalled = true;
      return route.fulfill({ json: { evaluationId: evalId, attemptId: 'attempt-2', mode: 'finalization-only', counts: { total: 4, reused: 4, remaining: 0, inFlightLimit: 8 }, preflight: { compatible: true, checks: [] }, browserPaths: feedback.browserPaths } });
    });
    await page.goto(`/eval/run/${evalId}`);
    await expect(page.getByText(/Finalization can continue without model calls/i)).toBeVisible();
    const resumeButton = page.getByRole('button', { name: 'Resume this evaluation' });
    await expect(resumeButton).toBeEnabled();
    await resumeButton.click();
    const dialog = page.getByRole('alertdialog', { name: 'Resume this evaluation?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('4 committed cells will be reused and 0 remain');
    await dialog.getByRole('button', { name: 'Confirm resume' }).click();
    await expect.poll(() => resumeCalled).toBe(true);
  });

  test('a corrupt checkpoint blocks resume with a human-readable reason and no destructive repair action', async ({ page }) => {
    const evalId = 'eval-blocked';
    const feedback = baseFeedback(evalId, 'interrupted', {
      state: 'blocked', reasonCode: 'CHECKPOINT_CORRUPT', reusedCells: 1, remainingCells: 3, requiresModelCalls: true,
    });
    await page.route(`**/api/eval/evaluations/${evalId}/feedback`, route => route.fulfill({ json: feedback }));
    await page.route(`**/api/eval/evaluations/${evalId}`, route => route.fulfill({ json: baseConfig(evalId, 'interrupted') }));
    await page.goto(`/eval/run/${evalId}`);
    await expect(page.getByText(/failed an integrity check/i)).toBeVisible();
    await expect(page.getByText('CHECKPOINT_CORRUPT')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume this evaluation' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /repair/i })).toHaveCount(0);
  });

  test('cancelling without a live controller reports an honest reconciled-interrupted state', async ({ page }) => {
    const evalId = 'eval-cancel-stale';
    const feedback = baseFeedback(evalId, 'running', { state: 'eligible', reasonCode: undefined, reusedCells: 2, remainingCells: 2, requiresModelCalls: true });
    let cancelCalled = false;
    // Force the WS connection closed so the ConnectionLostBanner (the only
    // surface exposing Cancel) renders deterministically, instead of racing
    // against whether the real dev-server WS happens to accept the socket.
    await page.routeWebSocket(/\/ws\/eval/, ws => ws.close());
    await page.route(`**/api/eval/evaluations/${evalId}/feedback`, route => route.fulfill({ json: feedback }));
    await page.route(`**/api/eval/evaluations/${evalId}`, route => route.fulfill({ json: baseConfig(evalId, 'running') }));
    await page.route(`**/api/eval/evaluations/${evalId}/cancel`, route => {
      cancelCalled = true;
      return route.fulfill({ json: { state: 'reconciled-interrupted', evaluationId: evalId, attemptId: 'attempt-1', controllerOwned: false, durablyCommitted: 2, remaining: 2 } });
    });
    await page.goto(`/eval/run/${evalId}`);
    const banner = page.getByRole('alert', { name: 'Connection lost' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Cancel Evaluation' }).click();
    await expect.poll(() => cancelCalled).toBe(true);
    // The banner must not claim a live provider call was aborted — it only
    // reflects the durable reconciled state the mocked /cancel response reports.
    await expect(page.getByText(/aborted/i)).toHaveCount(0);
  });
});
