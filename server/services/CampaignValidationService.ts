import { z } from 'zod';
import { EvaluationService } from './EvaluationService';
import { PurposeTemplateService } from './PurposeTemplateService';
import { TestSuiteService } from './TestSuiteService';
import { JudgeQualificationService } from './JudgeQualificationService';
import { LatencyBudgetService } from './LatencyBudgetService';
import type { ModelSelectionCampaignInput, CampaignTask, CampaignPhase, EvaluationInput, CampaignValidationResult } from '../../src/types/eval';

const schema = z.object({
  tasks: z.array(z.enum(['classification', 'tagging', 'summarization'])).min(1),
  incumbentModelId: z.string().min(1),
  candidateSlate: z.array(z.object({ modelId: z.string().min(1), lmapiServer: z.string(), parameterSize: z.string().optional(), quantization: z.string().optional(), contextLength: z.number().int().positive().optional() })).min(2),
  promptPinsByTask: z.record(z.string(), z.array(z.object({ promptId: z.string().min(1), version: z.number().int().positive() }))),
  testSuiteIdByTask: z.record(z.string(), z.string()),
  judgeModelId: z.string().optional(), totalVramBudgetGb: z.number().positive().optional(),
});

/** A single phase recipe is used for estimation, validation and execution. */
export function campaignPhaseInput(input: ModelSelectionCampaignInput, task: CampaignTask, phase: CampaignPhase,
  pin = input.promptPinsByTask[task]?.[0], modelId = input.candidateSlate[0]?.modelId): EvaluationInput {
  const purpose = PurposeTemplateService.get(task);
  const pins = phase === 'prompt-sweep' ? input.promptPinsByTask[task] ?? [] : pin ? [pin] : [];
  return {
    name: `Campaign ${phase} (${task})`, promptIds: pins.map(p => p.promptId), promptVersions: pins,
    modelIds: phase === 'prompt-sweep' ? [input.incumbentModelId] : phase === 'model-sweep' ? input.candidateSlate.map(m => m.modelId) : [modelId],
    comparisonMode: phase === 'prompt-sweep' ? 'prompt' : phase === 'model-sweep' ? 'model' : 'matrix',
    purposeTemplateId: task, testSuiteId: input.testSuiteIdByTask[task],
    benchmarkMode: phase === 'model-sweep' ? 'promotion-check' : 'calibration',
    runsPerCell: 3,
    templateId: purpose?.assertionStrategy?.type === 'grounded-summary' ? purpose.assertionStrategy.config.templateId : undefined,
    judgeModelId: task === 'summarization' ? input.judgeModelId : undefined,
    // Match MemoryApi's production task contract used by the current baselines.
    inference: { temperature: 0.3, maxTokens: task === 'classification' ? 50 : task === 'tagging' ? 100 : 150 },
  };
}

export const CampaignValidationService = {
  async validate(raw: unknown): Promise<CampaignValidationResult> {
    const result: CampaignValidationResult = { valid: false, issues: [], callEstimate: [] };
    const add = (code: string, path: string, message: string, severity: 'error' | 'warning' = 'error', requiresAcknowledgement = false) => {
      if (!result.issues.some(i => i.code === code && i.path === path)) result.issues.push({ code, path, message, severity, requiresAcknowledgement });
    };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) add(i.path[0] === 'tasks' ? 'INVALID_TASK' : 'INVALID_FIELD', i.path.join('.'), i.message);
      return result;
    }
    const input = parsed.data;
    if (new Set(input.tasks).size !== input.tasks.length) add('INVALID_TASK', 'tasks', 'Tasks must be unique.');
    if (new Set(input.candidateSlate.map(c => c.modelId)).size !== input.candidateSlate.length) add('DUPLICATE_CANDIDATE', 'candidateSlate', 'Candidate models must be unique.');
    if (!input.candidateSlate.some(candidate => candidate.modelId === input.incumbentModelId)) add('INCUMBENT_NOT_IN_SLATE', 'candidateSlate', 'The incumbent must be included in the candidate slate.');
    for (const [index, candidate] of input.candidateSlate.entries()) {
      if (candidate.modelId.split('::')[0] !== candidate.lmapiServer) add('CANDIDATE_SERVER_MISMATCH', `candidateSlate.${index}.lmapiServer`, 'Declared server must match the server::model identifier.');
    }
    for (const task of input.tasks) {
      const pins = input.promptPinsByTask[task];
      if (!pins || pins.length < 2) add('MISSING_PROMPT_PIN', `promptPinsByTask.${task}`, 'Choose at least two distinct prompts with exact versions.');
      const suite = TestSuiteService.get(input.testSuiteIdByTask[task]);
      if (!suite) add('MISSING_SUITE', `testSuiteIdByTask.${task}`, 'Choose an existing suite.');
      else if (suite.purposeCategory !== task) add('MISMATCHED_SUITE', `testSuiteIdByTask.${task}`, 'Suite purpose must match the task.');
      if (LatencyBudgetService.get()?.[task] == null) add('MISSING_LATENCY_BUDGET', task, 'No latency budget configured; latency is not a deployment-cost measurement.', 'warning');
      if (task === 'summarization') {
        if (!input.judgeModelId) add('MISSING_JUDGE', 'judgeModelId', 'Summarization requires an explicit rubric judge.');
        else {
          const state = JudgeQualificationService.status(input.judgeModelId);
          if (!state.current || !state.record?.qualified) add(state.record && !state.current ? 'STALE_JUDGE' : 'UNQUALIFIED_JUDGE', 'judgeModelId', 'Judge is not currently qualified. Summarization remains advisory.', 'warning', true);
          if ([input.incumbentModelId, ...input.candidateSlate.map(c => c.modelId)].includes(input.judgeModelId)) add('SELF_JUDGE', 'judgeModelId', 'Judge overlaps the evaluated models. Summarization remains advisory.', 'warning', true);
        }
      }
      for (const phase of ['prompt-sweep', 'model-sweep', 'confirmation'] as const) {
        const checked = await EvaluationService.validate(campaignPhaseInput(input, task, phase));
        for (const issue of checked.validation.errors) add(issue.code === 'MODEL_NOT_FOUND' ? 'UNROUTABLE_MODEL' : issue.code, `${task}.${issue.field ?? ''}`, issue.message);
        for (const issue of checked.validation.warnings) add(issue.code === 'BENCHMARK_PENDING_REVIEW' ? 'PENDING_GROUND_TRUTH_REVIEW' : issue.code, `${task}.${issue.field ?? ''}`, issue.message, 'warning');
      }
      // Grounded summary: four rubric dimensions, each scored three times.
      const multiplier = task === 'summarization' ? 13 : 1;
      const calibration = suite?.testCases.filter(c => !suite.builtIn || c.caseTags?.includes('split:calibration')).length ?? 0;
      const full = suite?.testCases.length ?? 0;
      const phaseOne = calibration * (pins?.length ?? 0) * 3 * multiplier;
      const phaseTwo = full * input.candidateSlate.length * 3 * multiplier;
      const phaseThreeMinimum = calibration * 3 * multiplier;
      result.callEstimate.push({ task, phaseOne, phaseTwo, phaseThreeMinimum, phaseThreeMaximum: phaseThreeMinimum * 2,
        totalMinimum: phaseOne + phaseTwo + phaseThreeMinimum, totalMaximum: phaseOne + phaseTwo + phaseThreeMinimum * 2 });
    }
    result.valid = !result.issues.some(i => i.severity === 'error');
    return result;
  },
};
