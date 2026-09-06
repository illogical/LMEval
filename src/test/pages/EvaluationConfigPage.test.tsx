import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EvaluationConfigPage } from '../../pages/EvaluationConfigPage';

vi.mock('../../api/eval', () => ({
  getEvaluation: vi.fn().mockResolvedValue({
    id: 'eval-1', name: 'API draft', status: 'draft', promptIds: ['prompt-1'],
    promptVersions: [{ promptId: 'prompt-1', version: 2 }], modelIds: ['local::model-a'],
    comparisonMode: 'matrix', inlineTestCases: [{ id: 'case-1', userMessage: 'hello' }],
    runsPerCell: 1, createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
  }),
  getEvaluationFeedback: vi.fn().mockResolvedValue({
    evalId: 'eval-1', status: 'draft', progress: { total: 0, completed: 0, failed: 0, updatedAt: '2026-09-06T00:00:00Z' },
    validation: { valid: true, errors: [], warnings: [{ code: 'LOW_CASE_COUNT', message: 'Smoke only.' }] },
    failures: [], readiness: { results: false, summary: false, regression: false, summaryAnalysis: false },
    verdict: null, appBasePath: '/', browserPaths: { config: '/eval/config/eval-1', run: '/eval/run/eval-1', results: '/eval/results/eval-1', summary: '/eval/summary/eval-1' },
  }),
  getPromptContent: vi.fn().mockResolvedValue({ content: 'Pinned prompt content' }),
  addPromptVersion: vi.fn(), patchEvaluationDraft: vi.fn(), startEvaluationDraft: vi.fn(),
}));

describe('EvaluationConfigPage', () => {
  it('hydrates an API-created draft with pinned content and shared validation', async () => {
    render(<MemoryRouter initialEntries={['/eval/config/eval-1']}><Routes><Route path="/eval/config/:evalId" element={<EvaluationConfigPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'API draft' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pinned prompt content')).toBeEnabled();
    expect(screen.getByText(/LOW_CASE_COUNT: Smoke only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    await waitFor(() => expect((screen.getByLabelText('Evaluation configuration JSON') as HTMLTextAreaElement).value).toContain('promptVersions'));
  });
});
