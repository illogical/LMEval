import { expect, test } from '@playwright/test';

const now = '2026-09-07T12:00:00.000Z';
const draft = {
  id: 'campaign-browser', status: 'draft', tasks: ['classification'], incumbentModelId: 'local::incumbent',
  candidateSlate: [{ modelId: 'local::incumbent', lmapiServer: 'local' }, { modelId: 'local::candidate', lmapiServer: 'local' }],
  promptIdsByTask: { classification: ['prompt-a', 'prompt-b'] }, promptPinsByTask: { classification: [{ promptId: 'prompt-a', version: 1 }, { promptId: 'prompt-b', version: 1 }] },
  testSuiteIdByTask: { classification: 'memory-classification-v1' }, phase1EvalIds: {}, phase2EvalIds: {}, phase3EvalIds: {}, phase3AttemptEvalIds: {}, recommendations: {}, createdAt: now, updatedAt: now,
};

test('campaign builder saves exact prompt pins and hands off to draft review', async ({ page }) => {
  await page.route('**/api/eval/models/by-server', route => route.fulfill({ json: { servers: [{ name: 'local', models: ['incumbent', 'candidate'] }] } }));
  await page.route('**/api/eval/prompts', route => route.fulfill({ json: [
    { id: 'prompt-a', slug: 'a', name: 'Prompt A', versions: [{ version: 1, createdAt: now, tokensEstimate: 1 }], createdAt: now, updatedAt: now },
    { id: 'prompt-b', slug: 'b', name: 'Prompt B', versions: [{ version: 1, createdAt: now, tokensEstimate: 1 }], createdAt: now, updatedAt: now },
  ] }));
  await page.route('**/api/eval/test-suites', route => route.fulfill({ json: [{ id: 'memory-classification-v1', name: 'Classification benchmark', purposeCategory: 'classification', version: '1.0.0', builtIn: true, testCases: [], provenance: { reviewStatus: 'pending-human-review' }, createdAt: now, updatedAt: now }] }));
  await page.route('**/api/eval/purpose-templates', route => route.fulfill({ json: [{ id: 'classification', name: 'Classification', purposeCategory: 'classification', defaultTestSuiteId: 'memory-classification-v1' }] }));
  await page.route('**/api/eval/model-selection/drafts', async route => {
    const body = route.request().postDataJSON();
    expect(body.promptPinsByTask.classification).toEqual([{ promptId: 'prompt-a', version: 1 }, { promptId: 'prompt-b', version: 1 }]);
    await route.fulfill({ status: 201, json: draft });
  });
  await page.route('**/api/eval/model-selection/campaign-browser/feedback', route => route.fulfill({ json: { campaign: draft, validation: { valid: true, issues: [{ code: 'PENDING_GROUND_TRUTH_REVIEW', severity: 'warning', path: 'classification.testSuiteId', message: 'Benchmark is pending human review.', requiresAcknowledgement: false }], callEstimate: [{ task: 'classification', phaseOne: 288, phaseTwo: 384, phaseThreeMinimum: 144, phaseThreeMaximum: 288, totalMinimum: 816, totalMaximum: 960 }] }, phases: [], browserPath: '/campaigns/campaign-browser' } }));

  await page.goto('/campaigns/new');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Incumbent model').selectOption('local::incumbent');
  await page.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByLabel('Candidate 1').selectOption('local::incumbent');
  await page.getByLabel('Candidate 2').selectOption('local::candidate');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Add classification prompt' }).click();
  await page.getByRole('button', { name: 'Add classification prompt' }).click();
  await page.getByLabel('classification prompt 1').selectOption('prompt-a');
  await page.getByLabel('classification prompt 2').selectOption('prompt-b');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Save draft for review' }).click();
  await expect(page).toHaveURL(/\/campaigns\/campaign-browser$/);
  await expect(page.getByRole('cell', { name: '288', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start campaign' })).toBeEnabled();
});

test('completed recommendation keeps advisory, tie group, and confirmation evidence visible', async ({ page }) => {
  const recommendation = {
    task: 'classification', recommendedModelId: 'local::candidate', runnerUpModelIds: ['local::incumbent'], discardedByGate: [],
    primaryMetric: { name: 'accuracy', value: 0.85, ci95: [0.75, 0.94] }, p95LatencyMs: 900,
    inference: { temperature: 0.3, maxTokens: 50 }, promptId: 'prompt-b', promptVersion: 1, suiteId: 'memory-classification-v1', suiteVersion: '1.0.0', provenance: { taxonomySha256: 't', datasetSha256: 'd', sourceRevision: 'r' }, evaluationId: 'eval-confirm', generatedAt: now,
    ordering: { tieGroups: [{ rank: 1, modelIds: ['local::candidate', 'local::incumbent'] }], discardedByGate: [], primaryMetrics: { 'local::candidate': { value: 0.85, ci95: [0.75, 0.94] }, 'local::incumbent': { value: 0.82, ci95: [0.73, 0.91] } }, p95LatencyMs: { 'local::candidate': 900, 'local::incumbent': 1100 }, stability: { 'local::candidate': { runToRunAgreement: 0.9, avgOutputTokens: 2 }, 'local::incumbent': { runToRunAgreement: 0.8, avgOutputTokens: 2 } } },
    confirmation: { ranModelId: 'local::candidate', passed: false, reason: 'Accuracy interval did not clear the gate.' }, confirmationAttempts: [{ evaluationId: 'eval-confirm', modelId: 'local::candidate', passed: false, reason: 'Inconclusive.' }], advisory: true,
  };
  const completed = { ...draft, status: 'completed', recommendations: { classification: recommendation }, bestSingleModel: { modelId: 'local::candidate', qualityDelta: { classification: 0 } } };
  await page.route('**/api/eval/model-selection/campaign-browser/feedback', route => route.fulfill({ json: { campaign: completed, validation: { valid: true, issues: [], callEstimate: [] }, phases: [{ task: 'classification', phase: 'confirmation', evaluationId: 'eval-confirm', status: 'completed', browserPath: '/eval/results/eval-confirm' }], browserPath: '/campaigns/campaign-browser' } }));
  await page.goto('/campaigns/campaign-browser');
  await expect(page.getByText('Advisory — not promotable')).toBeVisible();
  await expect(page.getByText(/95% CI 0.750–0.940/)).toBeVisible();
  await expect(page.getByRole('table', { name: /Statistical tie groups/ })).toContainText('local::incumbent');
  await expect(page.getByText(/Inconclusive/)).toBeVisible();
});

test('judge qualification starts asynchronously and refreshes to a qualified result', async ({ page }) => {
  await page.route('**/api/eval/models/by-server', route => route.fulfill({ json: { servers: [{ name: 'local', models: ['incumbent', 'candidate', 'judge'] }] } }));
  await page.route('**/api/eval/prompts', route => route.fulfill({ json: [{ id: 'prompt-summary', slug: 'summary', name: 'Summary prompt', versions: [{ version: 1, createdAt: now, tokensEstimate: 1 }], createdAt: now, updatedAt: now }] }));
  await page.route('**/api/eval/test-suites', route => route.fulfill({ json: [{ id: 'memory-summarization-v1', name: 'Summary benchmark', purposeCategory: 'summarization', version: '1.0.0', builtIn: true, testCases: [], createdAt: now, updatedAt: now }] }));
  await page.route('**/api/eval/purpose-templates', route => route.fulfill({ json: [{ id: 'summarization', name: 'Summarization', purposeCategory: 'summarization', defaultTestSuiteId: 'memory-summarization-v1' }] }));
  let started = false;
  await page.route('**/api/eval/judges/**/qualification-runs', async route => {
    started = true;
    await route.fulfill({ status: 202, json: { id: 'qualification-1', judgeModelId: 'local::judge', calibrationSetId: 'summarization-v0', calibrationSetHash: 'hash', status: 'pending', totalCalls: 66, completedCalls: 0, createdAt: now, updatedAt: now } });
  });
  await page.route('**/api/eval/judges/**/qualification-status', route => route.fulfill({ json: started ? {
    state: 'qualified', current: true,
    record: { judgeModelId: 'local::judge', calibrationSetHash: 'hash', qualifiedAt: now, spearman: 0.8, faithfulnessWithin1Pct: 0.9, meanInflation: 0.1, selfConsistencyMAD: { overall: 0.1 }, qualified: true },
    run: { id: 'qualification-1', judgeModelId: 'local::judge', calibrationSetId: 'summarization-v0', calibrationSetHash: 'hash', status: 'completed', totalCalls: 66, completedCalls: 66, createdAt: now, updatedAt: now },
  } : { state: 'missing', current: false, record: null } }));

  await page.goto('/campaigns/new');
  await page.getByLabel('summarization').check();
  await page.getByLabel('classification').uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Incumbent model').selectOption('local::incumbent');
  await page.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByLabel('Candidate 1').selectOption('local::incumbent');
  await page.getByLabel('Candidate 2').selectOption('local::candidate');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Add summarization prompt' }).click();
  await page.getByLabel('summarization prompt 1').selectOption('prompt-summary');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Judge model').selectOption('local::judge');
  await expect(page.getByText('Never tested')).toBeVisible();
  await page.getByRole('button', { name: 'Run qualification' }).click();
  await expect(page.getByText('Qualified')).toBeVisible();
  await expect(page.getByText(/66 \/ 66 calls parsed/)).toBeVisible();
});
