import { expect, test } from '@playwright/test';

test('API draft can be reviewed, saved, started, and reopened read-only', async ({ page, request }) => {
  const modelsResponse = await request.get('/api/eval/models/by-server');
  test.skip(!modelsResponse.ok(), 'LMApi model discovery is unavailable');
  const catalog = await modelsResponse.json() as { servers: Array<{ name: string; models: string[] }> };
  const server = catalog.servers.find(item => item.models.length > 0);
  test.skip(!server, 'No loaded model is available');
  const modelId = `${server!.name}::${server!.models[0]}`;

  const promptResponse = await request.post('/api/eval/prompts', {
    data: { name: `e2e-test-agent-draft-${Date.now()}`, content: 'Return the requested answer exactly.' },
  });
  expect(promptResponse.ok()).toBeTruthy();
  const prompt = await promptResponse.json() as { id: string };

  const draftResponse = await request.post('/api/eval/evaluations/drafts', {
    data: {
      name: 'e2e-test-agent-draft', promptIds: [prompt.id], promptVersions: [{ promptId: prompt.id, version: 1 }],
      modelIds: [modelId], comparisonMode: 'matrix', userMessage: 'Reply with OK', runsPerCell: 1,
      inference: { temperature: 0.3, maxTokens: 1000 },
    },
  });
  expect(draftResponse.status()).toBe(201);
  const draft = await draftResponse.json() as { evaluation: { id: string } };

  try {
    await page.goto(`/eval/config/${draft.evaluation.id}`);
    await expect(page.getByRole('heading', { name: 'e2e-test-agent-draft' })).toBeVisible();
    await expect(page.getByText(/Status: draft/)).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');

    const readBack = await request.get(`/api/eval/evaluations/${draft.evaluation.id}`);
    expect((await readBack.json()).promptVersions).toEqual([{ promptId: prompt.id, version: 1 }]);

    await page.getByRole('button', { name: 'Start evaluation' }).click();
    await expect(page).toHaveURL(new RegExp(`/eval/run/${draft.evaluation.id}$`));
    await page.goto(`/eval/config/${draft.evaluation.id}`);
    await expect(page.getByText(/Status: (pending|running|completed|failed|cancelled)/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  } finally {
    await request.delete(`/api/eval/evaluations/${draft.evaluation.id}`);
    await request.delete(`/api/eval/prompts/${prompt.id}`);
  }
});
