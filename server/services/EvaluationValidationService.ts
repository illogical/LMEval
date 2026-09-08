import { LmapiClient } from './LmapiClient';
import { PromptService } from './PromptService';
import { PurposeTemplateService } from './PurposeTemplateService';
import { TemplateService } from './TemplateService';
import { TestSuiteService } from './TestSuiteService';
import { SessionService } from './SessionService';
import { JudgeQualificationService } from './JudgeQualificationService';
import { MODEL_SELECTION_DIR, readJson } from './FileService';
import { join } from 'path';
import { z } from 'zod';
import type {
  EvaluationInput, EvaluationValidationIssue, EvaluationValidationResult, TestCase,
} from '../../src/types/eval';

export class ModelCatalogUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCatalogUnavailableError';
  }
}

const TestCaseSchema = z.object({ id: z.string().min(1), userMessage: z.string() }).passthrough();
export const EvaluationInputSchema = z.object({
  name: z.string(),
  promptIds: z.array(z.string().min(1)),
  promptVersions: z.array(z.object({ promptId: z.string().min(1), version: z.number().int().min(1) })).optional(),
  modelIds: z.array(z.string().min(1)),
  comparisonMode: z.enum(['model', 'prompt', 'matrix']).optional(),
  purposeTemplateId: z.string().min(1).optional(),
  testSuiteId: z.string().min(1).optional(),
  userMessage: z.string().optional(),
  inlineTestCases: z.array(TestCaseSchema).optional(),
  templateId: z.string().min(1).optional(),
  judgeModelId: z.string().min(1).optional(),
  enablePairwise: z.boolean().optional(),
  runsPerCell: z.number().optional(),
  sessionId: z.string().min(1).optional(),
  sessionVersion: z.number().int().min(1).optional(),
  inference: z.object({ temperature: z.number(), maxTokens: z.number(), seed: z.number().optional() }).optional(),
  benchmarkMode: z.enum(['calibration', 'promotion-check']).optional(),
  campaignId: z.string().min(1).optional(),
  campaignRole: z.literal('supplemental').optional(),
}).passthrough();

export function validateEvaluationInputShape(input: unknown): EvaluationValidationResult | null {
  const parsed = EvaluationInputSchema.safeParse(input);
  if (parsed.success) return null;
  const errors = parsed.error.issues.map(zodIssue => ({
    code: 'INVALID_FIELD_TYPE',
    field: zodIssue.path.join('.'),
    message: zodIssue.message,
  }));
  return { valid: false, errors, warnings: [] };
}

function issue(code: string, field: string, message: string): EvaluationValidationIssue {
  return { code, field, message };
}

function nonEmptyCases(cases: TestCase[] | undefined): boolean {
  return !!cases?.length && cases.every(testCase => testCase.userMessage?.trim().length > 0);
}

export const EvaluationValidationService = {
  async validate(input: EvaluationInput): Promise<EvaluationValidationResult> {
    const errors: EvaluationValidationIssue[] = [];
    const warnings: EvaluationValidationIssue[] = [];
    const promptIds = input.promptIds ?? [];
    const modelIds = input.modelIds ?? [];

    if (!input.name?.trim()) errors.push(issue('NAME_REQUIRED', 'name', 'Evaluation name is required.'));
    if (promptIds.length === 0) errors.push(issue('PROMPT_REQUIRED', 'promptIds', 'At least one prompt is required.'));
    if (new Set(promptIds).size !== promptIds.length) errors.push(issue('DUPLICATE_PROMPT_ID', 'promptIds', 'Prompt IDs must be unique.'));
    if (modelIds.length === 0) errors.push(issue('MODEL_REQUIRED', 'modelIds', 'At least one model is required.'));
    if (new Set(modelIds).size !== modelIds.length) errors.push(issue('DUPLICATE_MODEL_ID', 'modelIds', 'Model IDs must be unique.'));

    const pins = input.promptVersions ?? [];
    if (pins.length > 0 && (pins.length !== promptIds.length || pins.some((pin, index) => pin.promptId !== promptIds[index]))) {
      errors.push(issue('PROMPT_VERSION_MISMATCH', 'promptVersions', 'Prompt versions must match promptIds in the same order.'));
    }
    for (const promptId of promptIds) {
      if (!PromptService.get(promptId)) errors.push(issue('PROMPT_NOT_FOUND', 'promptIds', `Prompt not found: ${promptId}`));
    }
    for (const pin of pins) {
      if (!Number.isInteger(pin.version) || pin.version < 1 || PromptService.getVersionContent(pin.promptId, pin.version) == null) {
        errors.push(issue('PROMPT_VERSION_NOT_FOUND', 'promptVersions', `Prompt version not found: ${pin.promptId} v${pin.version}`));
      }
    }

    const mode = input.comparisonMode ?? 'matrix';
    if (mode === 'model' && (promptIds.length !== 1 || modelIds.length < 2)) {
      errors.push(issue('MODEL_COMPARISON_REQUIRES_TWO_MODELS', 'modelIds', 'Model comparison requires exactly one prompt and at least two models.'));
    }
    if (mode === 'prompt' && (promptIds.length < 2 || modelIds.length < 1)) {
      errors.push(issue('PROMPT_COMPARISON_REQUIRES_TWO_PROMPTS', 'promptIds', 'Prompt comparison requires at least two prompts and one model.'));
    }

    const suiteSelected = !!input.testSuiteId;
    const inlineSelected = !!input.inlineTestCases?.length;
    const messageSelected = !!input.userMessage?.trim();
    if ([suiteSelected, inlineSelected, messageSelected].filter(Boolean).length !== 1) {
      errors.push(issue('TEST_SOURCE_REQUIRED', 'testSuiteId', 'Select exactly one test source: suite, inline cases, or userMessage.'));
    }
    if (input.inlineTestCases?.length && !nonEmptyCases(input.inlineTestCases)) {
      errors.push(issue('EMPTY_TEST_INPUT', 'inlineTestCases', 'Every inline test case must have a non-empty userMessage.'));
    }

    const runs = input.runsPerCell ?? 1;
    if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
      errors.push(issue('INVALID_RUNS_PER_CELL', 'runsPerCell', 'runsPerCell must be an integer from 1 through 10.'));
    }
    if (input.inference) {
      const { temperature, maxTokens, seed } = input.inference;
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        errors.push(issue('INVALID_TEMPERATURE', 'inference.temperature', 'temperature must be between 0 and 2.'));
      }
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1_000_000) {
        errors.push(issue('INVALID_MAX_TOKENS', 'inference.maxTokens', 'maxTokens must be an integer from 1 through 1000000.'));
      }
      if (seed != null && (!Number.isInteger(seed) || seed < -2_147_483_648 || seed > 2_147_483_647)) {
        errors.push(issue('INVALID_SEED', 'inference.seed', 'seed must be a signed 32-bit integer.'));
      }
    }

    const suite = input.testSuiteId ? TestSuiteService.get(input.testSuiteId) : null;
    if (input.testSuiteId && !suite) errors.push(issue('TEST_SUITE_NOT_FOUND', 'testSuiteId', `Test suite not found: ${input.testSuiteId}`));
    if (input.benchmarkMode === 'promotion-check' && !suite?.builtIn) {
      errors.push(issue('PROMOTION_REQUIRES_BUILT_IN_SUITE', 'benchmarkMode', 'Promotion checks require a built-in test suite.'));
    }
    if (suite?.provenance?.reviewStatus === 'pending-human-review') {
      warnings.push(issue('BENCHMARK_PENDING_REVIEW', 'testSuiteId', 'This benchmark is pending human review, so results remain advisory.'));
    }

    const testCount = suite?.testCases.length ?? input.inlineTestCases?.length ?? (messageSelected ? 1 : 0);
    if (testCount > 0 && testCount < 5) warnings.push(issue('LOW_CASE_COUNT', 'inlineTestCases', 'Fewer than five cases is suitable only for a mechanics smoke test.'));

    const purpose = input.purposeTemplateId ? PurposeTemplateService.get(input.purposeTemplateId) : null;
    if (input.purposeTemplateId && !purpose) errors.push(issue('PURPOSE_TEMPLATE_NOT_FOUND', 'purposeTemplateId', `Purpose template not found: ${input.purposeTemplateId}`));
    if (input.templateId && !TemplateService.get(input.templateId)) errors.push(issue('TEMPLATE_NOT_FOUND', 'templateId', `Judge template not found: ${input.templateId}`));
    if (input.sessionId && !SessionService.get(input.sessionId)) errors.push(issue('SESSION_NOT_FOUND', 'sessionId', `Session not found: ${input.sessionId}`));
    if (input.sessionId && input.sessionVersion != null && !SessionService.getVersion(input.sessionId, input.sessionVersion)) {
      errors.push(issue('SESSION_VERSION_NOT_FOUND', 'sessionVersion', `Session version not found: ${input.sessionVersion}`));
    }
    if (input.sessionVersion != null && !input.sessionId) errors.push(issue('SESSION_ID_REQUIRED', 'sessionId', 'sessionId is required with sessionVersion.'));

    if (input.campaignRole && !input.campaignId) {
      errors.push(issue('CAMPAIGN_ID_REQUIRED', 'campaignId', 'campaignId is required with campaignRole.'));
    }
    if (input.campaignId && input.campaignRole !== 'supplemental') {
      errors.push(issue('CAMPAIGN_ROLE_REQUIRED', 'campaignRole', 'Campaign-linked Wizard evaluations must use the supplemental evidence role.'));
    }
    if (input.campaignId && !readJson(join(MODEL_SELECTION_DIR, input.campaignId, 'campaign.json'))) {
      errors.push(issue('CAMPAIGN_NOT_FOUND', 'campaignId', `Campaign not found: ${input.campaignId}`));
    }

    if (input.enablePairwise) errors.push(issue('PAIRWISE_UNSUPPORTED', 'enablePairwise', 'Pairwise execution is disabled in the installed Promptfoo integration.'));

    if (purpose?.purposeCategory === 'summarization') {
      if (!input.judgeModelId) {
        warnings.push(issue('GROUNDED_SUMMARY_WITHOUT_JUDGE', 'judgeModelId', 'No judge is selected; only deterministic checks can run.'));
      } else {
        if (modelIds.includes(input.judgeModelId)) warnings.push(issue('SELF_JUDGE_ADVISORY', 'judgeModelId', 'A model under evaluation is also the judge, so the verdict will be advisory.'));
        if (!JudgeQualificationService.isQualified(input.judgeModelId)) warnings.push(issue('JUDGE_UNQUALIFIED', 'judgeModelId', 'The selected judge is not qualified, so the verdict will be advisory.'));
      }
    }

    if (modelIds.length > 0 || input.judgeModelId) {
      if ([...modelIds, ...(input.judgeModelId ? [input.judgeModelId] : [])].some(id => !/^.+::.+$/.test(id))) {
        errors.push(issue('INVALID_MODEL_ID', 'modelIds', 'Model IDs must use the server::model form.'));
      } else {
        try {
          const servers = await LmapiClient.getServers();
          const available = new Set(servers.filter(server => server.isOnline).flatMap(server => server.models.map(model => `${server.config.name}::${model}`)));
          for (const modelId of [...modelIds, ...(input.judgeModelId ? [input.judgeModelId] : [])]) {
            if (!available.has(modelId)) errors.push(issue('MODEL_NOT_FOUND', 'modelIds', `Model is not available from LMApi: ${modelId}`));
          }
        } catch (error) {
          throw new ModelCatalogUnavailableError((error as Error).message);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  },
};
