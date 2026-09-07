import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePaths } from '../FileService';
import { PromptService } from '../PromptService';
import { LmapiClient } from '../LmapiClient';
import { CampaignValidationService, campaignPhaseInput } from '../CampaignValidationService';
import type { ModelSelectionCampaignInput } from '../../../src/types/eval';

let dataRoot: string;
let input: ModelSelectionCampaignInput;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'lmeval-campaign-validation-'));
  configurePaths({ dataRoot, repoRoot: process.cwd() });
  const first = PromptService.create({ name: 'Campaign prompt one', content: 'Prompt one' });
  const second = PromptService.create({ name: 'Campaign prompt two', content: 'Prompt two' });
  input = {
    tasks: ['classification'], incumbentModelId: 'local::incumbent',
    candidateSlate: [{ modelId: 'local::incumbent', lmapiServer: 'local' }, { modelId: 'local::candidate', lmapiServer: 'local' }],
    promptPinsByTask: { classification: [{ promptId: first.id, version: 1 }, { promptId: second.id, version: 1 }] },
    testSuiteIdByTask: { classification: 'memory-classification-v1' },
  };
  vi.spyOn(LmapiClient, 'getServers').mockResolvedValue([{ config: { name: 'local', baseUrl: 'http://local' }, isOnline: true, models: ['incumbent', 'candidate', 'judge'], runningModels: [], activeModels: [], activeRequests: 0, lastChecked: Date.now() }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  configurePaths({ dataRoot: join(process.cwd(), 'data'), repoRoot: process.cwd() });
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('CampaignValidationService', () => {
  it('reuses evaluation validation, keeps production inference, and estimates every phase', async () => {
    const result = await CampaignValidationService.validate(input);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PENDING_GROUND_TRUTH_REVIEW', severity: 'warning' })]));
    expect(result.callEstimate).toEqual([{ task: 'classification', phaseOne: 288, phaseTwo: 384, phaseThreeMinimum: 144, phaseThreeMaximum: 288, totalMinimum: 816, totalMaximum: 960 }]);
    expect(campaignPhaseInput(input, 'classification', 'model-sweep').inference).toEqual({ temperature: 0.3, maxTokens: 50 });
  });

  it('returns stable issues for duplicate candidates and inconsistent server metadata', async () => {
    input.candidateSlate[1] = { modelId: 'local::incumbent', lmapiServer: 'other' };
    const result = await CampaignValidationService.validate(input);
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['DUPLICATE_CANDIDATE', 'CANDIDATE_SERVER_MISMATCH']));
  });

  it('includes all twelve rubric calls per summarization response and requires judge acknowledgement', async () => {
    input.tasks = ['summarization'];
    input.promptPinsByTask = { summarization: input.promptPinsByTask.classification };
    input.testSuiteIdByTask = { summarization: 'memory-summarization-v1' };
    input.judgeModelId = 'local::judge';
    const result = await CampaignValidationService.validate(input);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNQUALIFIED_JUDGE', requiresAcknowledgement: true })]));
    expect(result.callEstimate).toEqual([{ task: 'summarization', phaseOne: 2106, phaseTwo: 2808, phaseThreeMinimum: 1053, phaseThreeMaximum: 2106, totalMinimum: 5967, totalMaximum: 7020 }]);
  });
});
