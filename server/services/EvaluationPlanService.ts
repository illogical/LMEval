import { join } from 'node:path';
import { EVALUATIONS_DIR, readJsonSafe, writeJsonAtomic } from './FileService';
import { sha256 } from './CanonicalHashService';
import { parseServerQualifiedModel } from './ServerQualifiedModelService';
import type {
  AssertionStrategy, EvalPurposeTemplate, EvalTemplate, EvaluationConfig,
  EvaluationExecutionInputs, EvaluationWorkItem, EvaluationWorkPlan,
  JudgeQualification, PromptManifest, TestCase,
} from '../../src/types/eval';

export interface CreatePlanInput {
  config: EvaluationConfig;
  prompts: Array<{ manifest: PromptManifest; version: number; content: string }>;
  testCases: TestCase[];
  template: EvalTemplate | null;
  purposeTemplate: EvalPurposeTemplate | null;
  judgeQualification?: JudgeQualification;
}

const SUPPORTED_PROMPTFOO_RESULT_SCHEMA_VERSIONS = [1];

export function executionInputHash(inputs: EvaluationExecutionInputs): string {
  const stable: Partial<EvaluationExecutionInputs> = { ...inputs };
  delete stable.createdAt;
  return sha256(stable);
}

function judgeCallCount(template: EvalTemplate | null, strategy: AssertionStrategy | null): number {
  if (!template) return 0;
  return template.perspectives.length * (strategy?.type === 'grounded-summary' ? 3 : 1);
}

export const EvaluationPlanService = {
  create(input: CreatePlanInput): { inputs: EvaluationExecutionInputs; plan: EvaluationWorkPlan } {
    const { config, prompts, testCases, template, purposeTemplate, judgeQualification } = input;
    const candidates = config.modelIds.map(parseServerQualifiedModel);
    const assertionStrategy = purposeTemplate?.assertionStrategy ?? null;
    const promptInputs = prompts.map(prompt => ({
      promptId: prompt.manifest.id,
      version: prompt.version,
      content: prompt.content,
      contentSha256: sha256(prompt.content),
      tools: prompt.manifest.tools,
    }));
    const judge: EvaluationExecutionInputs['judge'] = config.judgeModelId ? {
      model: parseServerQualifiedModel(config.judgeModelId),
      policy: judgeQualification?.qualified ? 'qualified-required' : 'advisory-allowed',
      qualificationSnapshot: judgeQualification,
      gradingTemperature: 0 as const,
    } : undefined;
    const inputs: EvaluationExecutionInputs = {
      schemaVersion: 1,
      evalId: config.id,
      prompts: promptInputs,
      testCases,
      testCasesSha256: sha256(testCases),
      candidates,
      runsPerCell: config.runsPerCell ?? 1,
      template,
      purposeCategory: purposeTemplate?.purposeCategory,
      assertionStrategy,
      resolvedInference: config.resolvedInference,
      benchmarkProvenance: config.benchmarkProvenance,
      transportProvenance: config.transportProvenance,
      comparisonMode: config.comparisonMode,
      judge,
      promptfoo: { packageVersion: '0.122.2', resultSchemaVersion: 1 },
      createdAt: new Date().toISOString(),
    };
    const inputHash = executionInputHash(inputs);
    const assertionPlanSha256 = sha256({ template, assertionStrategy, judge });
    const plannedJudgeCalls = judgeCallCount(template, assertionStrategy);
    const items: EvaluationWorkItem[] = [];
    for (const prompt of promptInputs) {
      for (const model of candidates) {
        for (const testCase of testCases) {
          const testCaseSha256 = sha256(testCase);
          for (let repetition = 1; repetition <= inputs.runsPerCell; repetition++) {
            const cellKey = sha256({
              executionInputSha256: inputHash,
              promptId: prompt.promptId,
              promptVersion: prompt.version,
              promptContentSha256: prompt.contentSha256,
              model: model.canonicalId,
              testCaseId: testCase.id,
              testCaseSha256,
              repetition,
              assertionPlanSha256,
              judgePlanSha256: judge ? sha256(judge) : null,
            });
            items.push({
              ordinal: items.length,
              cellId: `cell-${cellKey.slice(0, 24)}`,
              cellKey,
              promptId: prompt.promptId,
              promptVersion: prompt.version,
              promptContentSha256: prompt.contentSha256,
              model,
              testCaseId: testCase.id,
              testCaseSha256,
              repetition,
              assertionPlanSha256,
              plannedJudgeCalls,
            });
          }
        }
      }
    }
    if (new Set(items.map(item => item.cellId)).size !== items.length) {
      throw Object.assign(new Error('Stable cell identity collision'), { code: 'CELL_ID_COLLISION' });
    }
    const plan: EvaluationWorkPlan = {
      schemaVersion: 1,
      evalId: config.id,
      executionInputSha256: inputHash,
      planSha256: sha256({ schemaVersion: 1, promptfoo: inputs.promptfoo, executionInputSha256: inputHash, cellKeys: items.map(item => item.cellKey) }),
      items,
      totals: {
        cells: items.length,
        candidateCalls: items.length,
        judgeCalls: items.reduce((total, item) => total + item.plannedJudgeCalls, 0),
      },
      createdAt: inputs.createdAt,
    };
    return { inputs, plan };
  },

  persist(evalId: string, inputs: EvaluationExecutionInputs, plan: EvaluationWorkPlan): void {
    const dir = join(EVALUATIONS_DIR, evalId);
    writeJsonAtomic(join(dir, 'execution-inputs.json'), inputs);
    writeJsonAtomic(join(dir, 'work-plan.json'), plan);
  },

  load(evalId: string): { inputs: EvaluationExecutionInputs; plan: EvaluationWorkPlan } | null {
    const dir = join(EVALUATIONS_DIR, evalId);
    const inputResult = readJsonSafe<EvaluationExecutionInputs>(join(dir, 'execution-inputs.json'));
    const planResult = readJsonSafe<EvaluationWorkPlan>(join(dir, 'work-plan.json'));
    if (inputResult.state !== 'valid' || planResult.state !== 'valid') return null;
    return { inputs: inputResult.value, plan: planResult.value };
  },

  validate(inputs: EvaluationExecutionInputs, plan: EvaluationWorkPlan): string[] {
    const failures: string[] = [];
    if (inputs.schemaVersion !== 1) failures.push('EXECUTION_INPUT_MISMATCH');
    if (plan.schemaVersion !== 1) failures.push('PLAN_HASH_MISMATCH');
    if (!SUPPORTED_PROMPTFOO_RESULT_SCHEMA_VERSIONS.includes(inputs.promptfoo.resultSchemaVersion)) failures.push('PROMPTFOO_SCHEMA_UNSUPPORTED');
    if (executionInputHash(inputs) !== plan.executionInputSha256) failures.push('EXECUTION_INPUT_MISMATCH');
    const expectedPlanHash = sha256({ schemaVersion: 1, promptfoo: inputs.promptfoo, executionInputSha256: plan.executionInputSha256, cellKeys: plan.items.map(item => item.cellKey) });
    if (expectedPlanHash !== plan.planSha256) failures.push('PLAN_HASH_MISMATCH');
    return [...new Set(failures)];
  },
};
