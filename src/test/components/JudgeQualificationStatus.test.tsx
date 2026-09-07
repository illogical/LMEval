import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JudgeQualificationStatus } from '../../components/config/JudgeQualificationStatus';

vi.mock('../../api/campaigns', () => ({
  qualificationStatus: vi.fn().mockResolvedValue({
    state: 'unqualified', current: true,
    record: { judgeModelId: 'local::judge', calibrationSetHash: 'hash', qualifiedAt: '2026-09-07T00:00:00Z', spearman: 0.4, faithfulnessWithin1Pct: 0.75, meanInflation: 0.1, selfConsistencyMAD: { overall: 0.2 }, qualified: false },
    run: { id: 'run-1', judgeModelId: 'local::judge', calibrationSetId: 'summarization-v0', calibrationSetHash: 'hash', status: 'completed', totalCalls: 60, completedCalls: 60, createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:01:00Z' },
  }),
  startQualification: vi.fn(), cancelQualification: vi.fn(),
}));

describe('JudgeQualificationStatus', () => {
  it('distinguishes an unqualified result from an execution failure and exposes its metrics', async () => {
    render(<JudgeQualificationStatus modelId="local::judge" />);
    expect(await screen.findByText('Not qualified')).toBeInTheDocument();
    expect(screen.getByText(/60 \/ 60 calls parsed/)).toBeInTheDocument();
    expect(screen.getByText(/Spearman/)).toBeInTheDocument();
    expect(screen.getByText(/Thresholds not met/)).toBeInTheDocument();
  });
});
