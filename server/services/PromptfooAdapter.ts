import Ajv from 'ajv';
import type { Assertion, ApiProvider } from 'promptfoo';
import { LmapiClient } from './LmapiClient';
import { config as serverConfig } from '../config';
import { checkSummaryDeterministics } from './summarizationChecks';
import type {
  EvaluationConfig, TestCase, EvalTemplate, ToolDefinition, AssertionStrategy, InferenceParams,
} from '../../src/types/eval';

const ajv = new Ajv({ allErrors: true });

/**
 * Builds a promptfoo ApiProvider that dispatches through LmapiClient, replicating
 * the system+user message shape ExecutionService used to build directly, and
 * stashing retry/latency/server details on ProviderResponse.metadata since
 * promptfoo's ProviderResponse has no dedicated fields for them (see
 * mapEvaluateResultToCell in ExecutionService, which reads this metadata back).
 */
export function buildLmapiProvider(modelId: string, evalId: string, inference?: InferenceParams): ApiProvider {
  const separatorIdx = modelId.indexOf('::');
  const serverName = separatorIdx !== -1 ? modelId.slice(0, separatorIdx) : undefined;
  const modelName = separatorIdx !== -1 ? modelId.slice(separatorIdx + 2) : modelId;

  return {
    id: () => modelId,
    label: modelId,
    async callApi(prompt: string, context?: { vars?: Record<string, unknown> }) {
      const userMessage = String(context?.vars?.userMessage ?? '');
      const retryAttempts: Array<{ attemptNumber: number; error: string; timestamp: string }> = [];
      const onRetry = (attemptNum: number, err: Error) => {
        retryAttempts.push({ attemptNumber: attemptNum, error: err.message, timestamp: new Date().toISOString() });
      };
      const chatReq = {
        model: modelName,
        messages: [
          { role: 'system' as const, content: prompt },
          { role: 'user' as const, content: userMessage },
        ],
        stream: false as const,
        groupId: evalId,
        ...(inference && {
          temperature: inference.temperature,
          max_tokens: inference.maxTokens,
          ...(inference.seed != null && { seed: inference.seed }),
        }),
      };
      try {
        const response = serverName
          ? await LmapiClient.chatCompletionOnServer(chatReq, serverName, onRetry)
          : await LmapiClient.chatCompletion(chatReq, onRetry);
        const choice = response.choices[0];
        return {
          output: choice?.message.content ?? '',
          tokenUsage: {
            prompt: response.usage?.prompt_tokens,
            completion: response.usage?.completion_tokens,
            total: response.usage?.total_tokens,
          },
          metadata: {
            retryAttempts,
            serverName: response.lmapi?.server_name ?? serverName,
            durationMs: response.lmapi?.duration_ms,
            finishReason: choice?.finish_reason,
          },
        };
      } catch (err) {
        return {
          error: (err as Error).message,
          metadata: { retryAttempts },
        };
      }
    },
  };
}

/**
 * Judge provider for llm-rubric / select-best assertions. Unlike buildLmapiProvider,
 * this forwards promptfoo's fully-assembled grading prompt as a single user message —
 * promptfoo owns the rubric prompt template and JSON-parsing of the grading response,
 * so this must NOT wrap it in our own system/user split.
 */
export function buildJudgeProvider(judgeModelId: string, evalId: string): ApiProvider {
  return {
    id: () => `judge:${judgeModelId}`,
    label: judgeModelId,
    async callApi(prompt: string) {
      try {
        const response = await LmapiClient.chatCompletion({
          model: judgeModelId,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          groupId: `judge-${evalId}`,
          // R6: judge passes run at t=0 — the grading call should be as
          // reproducible as the backend allows, independent of the run's own
          // sampling temperature.
          temperature: 0,
        });
        return { output: response.choices[0]?.message.content ?? '' };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  };
}

function buildDeterministicAssertions(testCase: TestCase, tools?: ToolDefinition[]): Assertion[] {
  const assertions: Assertion[] = [];

  for (const kw of testCase.expectedKeywords ?? []) {
    assertions.push({ type: 'icontains', value: kw, metric: 'keywords' });
  }
  for (const kw of testCase.forbiddenKeywords ?? []) {
    assertions.push({ type: 'not-icontains', value: kw, metric: 'keywords' });
  }

  if (testCase.jsonSchema) {
    const schema = testCase.jsonSchema;
    assertions.push({
      type: 'javascript',
      metric: 'json-schema',
      value: (output: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          return { pass: false, score: 0, reason: 'Response is not valid JSON' };
        }
        const validateFn = ajv.compile(schema);
        const valid = validateFn(parsed) as boolean;
        const reason = valid
          ? 'Matches JSON schema'
          : (validateFn.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ');
        return { pass: valid, score: valid ? 1 : 0, reason };
      },
    });
  }

  if (testCase.expectedToolCalls?.length && tools?.length) {
    const toolNames = new Set(tools.map(t => t.function.name));
    const expectedCalls = testCase.expectedToolCalls;
    assertions.push({
      type: 'javascript',
      metric: 'tool-calls',
      value: (output: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          return { pass: false, score: 0, reason: 'Response is not valid JSON for tool call matching' };
        }
        const calls = Array.isArray(parsed) ? parsed : ((parsed as Record<string, unknown>)?.tool_calls ?? []);
        const results = expectedCalls.map(expected => {
          const match = (calls as Array<Record<string, unknown>>).find(
            c => c.function === expected.functionName || c.name === expected.functionName
          );
          if (!match || !toolNames.has(expected.functionName)) {
            return { functionName: expected.functionName, matched: false };
          }
          let args: Record<string, unknown> = {};
          try {
            const rawArgs = (match.arguments ?? match.args ?? '{}') as string;
            args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs as Record<string, unknown>);
          } catch {
            // ignore parse error, treated as no matching args below
          }
          let matched = true;
          if (expected.argumentMatchers) {
            for (const [key, val] of Object.entries(expected.argumentMatchers)) {
              if (args[key] !== val) { matched = false; break; }
            }
          }
          return { functionName: expected.functionName, matched };
        });
        const allMatched = results.length > 0 && results.every(r => r.matched);
        return {
          pass: allMatched,
          score: allMatched ? 1 : 0,
          reason: results.map(r => `${r.functionName}: ${r.matched ? 'matched' : 'no match'}`).join('; '),
        };
      },
    });
  }

  return assertions;
}

function buildLabelOverlapAssertion(testCase: TestCase, threshold: number): Assertion | null {
  if (!testCase.tags?.length) return null;
  const expected = testCase.tags.map(t => t.trim().toLowerCase()).filter(Boolean);
  return {
    type: 'javascript',
    metric: 'label-overlap',
    value: (output: string) => {
      const actual = output.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const expectedSet = new Set(expected);
      const actualSet = new Set(actual);
      const intersection = [...expectedSet].filter(t => actualSet.has(t));
      const union = new Set([...expectedSet, ...actualSet]);
      const jaccard = union.size > 0 ? intersection.length / union.size : 0;
      return {
        pass: jaccard >= threshold,
        score: jaccard,
        reason: `Jaccard overlap ${jaccard.toFixed(2)} (expected: ${expected.join(', ') || '(none)'}; got: ${actual.join(', ') || '(none)'})`,
      };
    },
  };
}

/**
 * R1: classification, replacing `expectedKeywords` prose-matching. The response
 * must equal (after trimming only — no stripping of punctuation or case-folding
 * on the pass/fail check itself, since a trailing period or wrong case is
 * exactly the format-compliance failure this assertion exists to catch) one of
 * the declared labels, and it must match TestCase.expectedOutput specifically —
 * `expectedKeywords` is no longer consulted for grading a classification case.
 */
function buildExactLabelAssertion(testCase: TestCase, labels: string[]): Assertion | null {
  const expected = testCase.expectedOutput?.trim();
  if (!expected) return null;
  const labelSet = new Set(labels);
  return {
    type: 'javascript',
    metric: 'exact-label',
    value: (output: string) => {
      const predicted = output.trim();
      const validLabel = labelSet.has(predicted);
      const pass = predicted === expected;
      return {
        pass,
        score: pass ? 1 : 0,
        reason: pass
          ? `Matched expected label "${expected}"`
          : `Expected "${expected}", got "${predicted}"${validLabel ? '' : ' (not a declared label)'}`,
      };
    },
  };
}

/**
 * R2: 'custom' has a validated config (see AssertionStrategyService) but,
 * per the plan's Key Decisions, no generalized plugin execution — a custom
 * strategy is recorded and its description surfaces in the UI, but it adds no
 * assertion of its own. Building a declarative custom-check runner is the
 * deferred plugin-architecture work in TASK.md Track F, not this pass.
 */

function buildRubricAssertions(template: EvalTemplate, judgeProvider: ApiProvider): Assertion[] {
  return template.perspectives.map(p => ({
    type: 'llm-rubric' as const,
    value: `${p.criteria}\n\nScoring guide: ${p.scoringGuide}`,
    weight: p.weight,
    metric: p.name,
    provider: judgeProvider,
  }));
}

const JUDGE_PASS_COUNT = 3;

/**
 * R6: "three independent judge passes at t=0 aggregated by median." Chosen
 * implementation (the plan's Outstanding Questions left this open): three
 * separate llm-rubric assertions per rubric dimension, metric-suffixed
 * `${perspectiveName}#1..3`, rather than a bespoke repeated-grading harness —
 * this reuses promptfoo's existing llm-rubric dispatch/parsing untouched and
 * SummaryService only has to group-by-stripped-suffix and take the median
 * (see SummaryService.medianOfJudgePasses). buildJudgeProvider forces t=0 on
 * the judge call itself; "independent" here means each pass is a separate
 * dispatched grading call, not that they are guaranteed to diverge under a
 * deterministic backend — three agreeing passes is itself a legitimate,
 * informative outcome (self-consistency), not a wasted call.
 */
function buildGroundedSummaryRubricAssertions(template: EvalTemplate, judgeProvider: ApiProvider): Assertion[] {
  const assertions: Assertion[] = [];
  for (const p of template.perspectives) {
    for (let pass = 1; pass <= JUDGE_PASS_COUNT; pass++) {
      assertions.push({
        type: 'llm-rubric',
        value: `${p.criteria}\n\nScoring guide: ${p.scoringGuide}`,
        weight: p.weight,
        metric: `${p.name}#${pass}`,
        provider: judgeProvider,
      });
    }
  }
  return assertions;
}

/**
 * R6 deterministic guards, run before model grading: no preamble/heading/fence
 * wrapper text, compression ratio within range, protected tokens preserved
 * verbatim, and no literal forbidden claim substring present. Each sub-check
 * is reported in `reason` so a failure is diagnosable without re-reading the
 * raw response.
 */
function buildSummaryDeterministicAssertion(testCase: TestCase, compressionRange: [number, number]): Assertion {
  return {
    type: 'javascript',
    metric: 'summary-deterministic',
    value: (output: string) => {
      const result = checkSummaryDeterministics(output, testCase, compressionRange);
      return {
        pass: result.pass,
        score: result.pass ? 1 : 0,
        reason: result.pass ? 'Passes all deterministic checks' : result.failures.join('; '),
      };
    },
  };
}

/**
 * DISABLED — see docs/plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md
 * Phase 10 open-question #2. A live smoke test against the installed promptfoo
 * 0.122.2 (evaluate() called directly with fake providers, no LMApi needed)
 * found `select-best` throws "Invalid provider definition" from BOTH a
 * function-valued ApiProvider
 * (dropped by an internal clone before matchesSelectBest re-resolves it) and a
 * plain serializable `{ id: 'openai:chat:<model>', config: {...} }` reference
 * (still fails on a second internal resolution pass, even once the first pass
 * successfully constructs a real provider instance from it) — this looks like
 * a genuine bug in this promptfoo version's select-best/getAndCheckProvider
 * path when used via the programmatic Node API, not a config-shape mistake.
 * Left unused rather than wired in half-broken; enablePairwise is a no-op
 * under the new engine until this is resolved (flagged to the user as a
 * decision point: fix upstream/upgrade promptfoo vs. reintroduce a bespoke
 * pairwise judge call outside promptfoo's assertion system).
 */
function buildSelectBestAssertion(judgeModelId: string): Assertion {
  return {
    type: 'select-best',
    value: "Choose the response that best fulfills the system prompt's instructions and is most helpful, accurate, and well-formatted.",
    metric: 'pairwise',
    provider: {
      id: `openai:chat:${judgeModelId}`,
      config: {
        apiBaseUrl: `${serverConfig.lmapiBaseUrl}/v1`,
        apiKey: 'not-needed',
      },
    },
  };
}
void buildSelectBestAssertion;

export interface PromptContentEntry {
  promptId: string;
  content: string;
  tools?: ToolDefinition[];
}

export interface BuiltTestSuite {
  prompts: string[];
  providers: ApiProvider[];
  tests: Array<{ description?: string; vars: Record<string, string>; assert: Assertion[] }>;
}

export interface BuildTestSuiteResult {
  testSuite: BuiltTestSuite;
  promptOrder: string[];
  testCaseOrder: string[];
}

export const PromptfooAdapter = {
  buildTestSuite(params: {
    evalId: string;
    config: EvaluationConfig;
    promptContents: PromptContentEntry[];
    testCases: TestCase[];
    template: EvalTemplate | null;
    purposeStrategy: AssertionStrategy | null;
  }): BuildTestSuiteResult {
    const { evalId, config, promptContents, testCases, template, purposeStrategy } = params;

    const providers = config.modelIds.map(modelId => buildLmapiProvider(modelId, evalId, config.resolvedInference));
    const judgeProvider = config.judgeModelId ? buildJudgeProvider(config.judgeModelId, evalId) : null;
    const overlapThreshold =
      purposeStrategy?.type === 'label-overlap' ? purposeStrategy.config.minimumCaseF1 : 0.5;

    const tests = testCases.map(tc => {
      const assertions: Assertion[] = [
        ...buildDeterministicAssertions(tc, promptContents[0]?.tools),
      ];

      if (purposeStrategy?.type === 'exact-label') {
        const exactLabelAssertion = buildExactLabelAssertion(tc, purposeStrategy.config.labels);
        if (exactLabelAssertion) assertions.push(exactLabelAssertion);
      }

      if (purposeStrategy?.type === 'label-overlap') {
        const overlapAssertion = buildLabelOverlapAssertion(tc, overlapThreshold);
        if (overlapAssertion) assertions.push(overlapAssertion);
      }

      if (purposeStrategy?.type === 'grounded-summary') {
        assertions.push(buildSummaryDeterministicAssertion(tc, purposeStrategy.config.compressionRange ?? [0.05, 0.6]));
      }

      if (template && judgeProvider) {
        assertions.push(
          ...(purposeStrategy?.type === 'grounded-summary'
            ? buildGroundedSummaryRubricAssertions(template, judgeProvider)
            : buildRubricAssertions(template, judgeProvider))
        );
      }

      // enablePairwise / select-best intentionally not wired — see
      // buildSelectBestAssertion's doc comment above.

      return {
        description: tc.description,
        vars: { userMessage: tc.userMessage },
        assert: assertions,
      };
    });

    return {
      testSuite: {
        prompts: promptContents.map(p => p.content),
        providers,
        tests,
      },
      promptOrder: promptContents.map(p => p.promptId),
      testCaseOrder: testCases.map(tc => tc.id),
    };
  },
};
