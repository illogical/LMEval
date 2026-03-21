import { join } from 'path';
import {
  readJson, writeJson, ensureDir, generateId, EVALUATIONS_DIR,
} from './FileService';
import { LmapiClient } from './LmapiClient';
import { MetricsService } from './MetricsService';
import { SummaryService } from './SummaryService';
import { PromptService } from './PromptService';
import { TestSuiteService } from './TestSuiteService';
import type {
  EvaluationConfig, EvalMatrixCell, EvaluationSummary, TestCase, ToolCallResult,
} from '../../src/types/eval';

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

const CONCURRENCY_LIMIT = Math.max(1, parseInt(process.env.EVAL_CONCURRENCY ?? '8', 10) || 8);
  type: string;
  evalId: string;
  data: Record<string, unknown>;
  timestamp: number;
}) => void;

let broadcast: BroadcastFn = () => {};

export function setBroadcast(fn: BroadcastFn) {
  broadcast = fn;
}

const activeControllers = new Map<string, AbortController>();

export const ExecutionService = {
  buildMatrix(config: EvaluationConfig, testCases: TestCase[]): EvalMatrixCell[] {
    const cells: EvalMatrixCell[] = [];
    const runsPerCell = config.runsPerCell ?? 1;

    for (const promptId of config.promptIds) {
      const prompt = PromptService.get(promptId);
      if (!prompt) continue;
      const promptVersion = prompt.versions.at(-1)?.version ?? 1;

      for (const modelId of config.modelIds) {
        for (const testCase of testCases) {
          for (let run = 1; run <= runsPerCell; run++) {
            cells.push({
              id: generateId('cell'),
              evalId: config.id,
              promptId,
              promptVersion,
              modelId,
              testCaseId: testCase.id,
              run,
              status: 'pending',
            });
          }
        }
      }
    }
    return cells;
  },

  estimateCost(
    config: EvaluationConfig,
    testCases: TestCase[]
  ): { totalCells: number; estimatedMinutes: number } {
    const cells = this.buildMatrix(config, testCases);
    return {
      totalCells: cells.length,
      estimatedMinutes: Math.ceil(cells.length * 0.5),
    };
  },

  async runCompletions(
    evalId: string,
    config: EvaluationConfig,
    cells: EvalMatrixCell[],
    testCasesMap: Map<string, TestCase>,
    controller: AbortController,
    startMs: number
  ): Promise<EvalMatrixCell[]> {
    const semaphore = new Semaphore(CONCURRENCY_LIMIT);
    const results = [...cells];

    const tasks = results.map(async (cell, idx) => {
      await semaphore.acquire();

      if (controller.signal.aborted) {
        results[idx] = { ...cell, status: 'failed', error: 'Cancelled' };
        semaphore.release();
        return;
      }

      broadcast({ type: 'cell:started', evalId, data: { cellId: cell.id }, timestamp: Date.now() });
      results[idx] = { ...cell, status: 'running' };

      const testCase = testCasesMap.get(cell.testCaseId);
      const promptContent = PromptService.getVersionContent(cell.promptId, cell.promptVersion);

      if (!promptContent || !testCase) {
        results[idx] = {
          ...results[idx],
          status: 'failed',
          error: 'Prompt content or test case not found',
        };
        broadcast({
          type: 'cell:failed',
          evalId,
          data: { cellId: cell.id, error: results[idx].error },
          timestamp: Date.now(),
        });
        semaphore.release();
        return;
      }

      const userMessage = testCase.userMessage || config.userMessage || '';
      const retryAttempts: Array<{ attemptNumber: number; error: string; timestamp: string }> = [];

      try {
        const cellStartMs = Date.now();
        const response = await LmapiClient.chatCompletion(
          {
            model: cell.modelId,
            messages: [
              { role: 'system', content: promptContent },
              { role: 'user', content: userMessage },
            ],
            stream: false,
            groupId: evalId,
          },
          (attemptNum, err) => {
            retryAttempts.push({
              attemptNumber: attemptNum,
              error: err.message,
              timestamp: new Date().toISOString(),
            });
          }
        );
        const durationMs = Date.now() - cellStartMs;

        const responseContent = response.choices[0]?.message.content ?? '';
        const usage = response.usage;
        const inputTokens = usage?.prompt_tokens;
        const outputTokens = usage?.completion_tokens;
        const serverName = response.lmapi?.server_name;

        const prompt = PromptService.get(cell.promptId);
        const keywordCheck = MetricsService.checkKeywords(
          responseContent,
          testCase.expectedKeywords,
          testCase.forbiddenKeywords
        );

        let jsonSchemaValid: boolean | undefined;
        let jsonSchemaErrors: string[] | undefined;
        if (testCase.jsonSchema) {
          const r = MetricsService.validateJsonSchema(responseContent, testCase.jsonSchema);
          jsonSchemaValid = r.valid;
          jsonSchemaErrors = r.errors;
        }

        let toolCallResults: ToolCallResult[] | undefined;
        if (testCase.expectedToolCalls && prompt?.tools) {
          toolCallResults = MetricsService.validateToolCalls(
            responseContent,
            prompt.tools,
            testCase.expectedToolCalls
          );
        }

        results[idx] = {
          ...results[idx],
          status: 'completed',
          request: { systemPrompt: promptContent, userMessage, model: cell.modelId },
          response: responseContent,
          finishReason: response.choices[0]?.finish_reason,
          inputTokens,
          outputTokens,
          durationMs,
          tokensPerSecond:
            outputTokens && durationMs > 0
              ? Math.round((outputTokens / durationMs) * 1000)
              : undefined,
          serverName,
          deterministicMetrics: {
            keywordsFound: keywordCheck.found,
            keywordsMissing: keywordCheck.missing,
            forbiddenFound: keywordCheck.forbiddenFound,
            jsonSchemaValid,
            jsonSchemaErrors,
            toolCallResults,
          },
          retryAttempts: retryAttempts.length > 0 ? retryAttempts : undefined,
        };

        broadcast({
          type: 'cell:completed',
          evalId,
          data: {
            cellId: cell.id,
            modelId: cell.modelId,
            durationMs,
            inputTokens,
            outputTokens,
          },
          timestamp: Date.now(),
        });
      } catch (err) {
        results[idx] = {
          ...results[idx],
          status: 'failed',
          error: (err as Error).message,
          retryAttempts: retryAttempts.length > 0 ? retryAttempts : undefined,
        };
        broadcast({
          type: 'cell:failed',
          evalId,
          data: { cellId: cell.id, error: (err as Error).message },
          timestamp: Date.now(),
        });
      }

      const completedSoFar = results.filter(
        c => c.status === 'completed' || c.status === 'failed'
      ).length;
      broadcast({
        type: 'eval:progress',
        evalId,
        data: {
          phase: 2,
          totalPhases: 4,
          completedCells: completedSoFar,
          totalCells: cells.length,
          elapsedMs: Date.now() - startMs,
        },
        timestamp: Date.now(),
      });

      semaphore.release();
    });

    await Promise.allSettled(tasks);
    return results;
  },

  async aggregate(
    evalId: string,
    cells: EvalMatrixCell[]
  ): Promise<EvaluationSummary> {
    const summary = SummaryService.computeSummary(evalId, cells);
    const evalDir = join(EVALUATIONS_DIR, evalId);
    writeJson(join(evalDir, 'results.json'), cells);
    writeJson(join(evalDir, 'summary.json'), summary);
    return summary;
  },

  cancel(evalId: string): boolean {
    const controller = activeControllers.get(evalId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(evalId);
    return true;
  },

  async run(evalId: string): Promise<void> {
    const evalDir = join(EVALUATIONS_DIR, evalId);
    const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
    if (!config) {
      console.error(`[ExecutionService] No config found for eval ${evalId}`);
      return;
    }

    const controller = new AbortController();
    activeControllers.set(evalId, controller);
    const startMs = Date.now();

    config.status = 'running';
    config.updatedAt = new Date().toISOString();
    writeJson(join(evalDir, 'config.json'), config);

    try {
      let testCases: TestCase[] = [];
      if (config.testSuiteId) {
        const suite = TestSuiteService.get(config.testSuiteId);
        testCases = suite?.testCases ?? [];
      } else if (config.userMessage) {
        testCases = [{
          id: generateId('tc'),
          userMessage: config.userMessage,
        }];
      }

      if (testCases.length === 0) {
        throw new Error('No test cases found for evaluation');
      }

      const testCasesMap = new Map(testCases.map(tc => [tc.id, tc]));

      const cells = this.buildMatrix(config, testCases);
      writeJson(join(evalDir, 'cells.json'), cells);

      const completedCells = await this.runCompletions(
        evalId, config, cells, testCasesMap, controller, startMs
      );

      await this.aggregate(evalId, completedCells);

      config.status = 'completed';
      config.updatedAt = new Date().toISOString();
      writeJson(join(evalDir, 'config.json'), config);

      broadcast({ type: 'eval:completed', evalId, data: {}, timestamp: Date.now() });

      if (config.sessionId) {
        try {
          const { SessionService } = await import('./SessionService');
          const runs = SessionService.listEvalRuns(config.sessionId);
          const run = runs.find(r => r.evalId === evalId);
          if (run) {
            const summary = readJson<EvaluationSummary>(join(evalDir, 'summary.json'));
            const promptSummaries = summary?.promptSummaries ?? [];
            const scoreSummary = {
              totalCells: summary?.totalCells ?? 0,
              completedCells: summary?.completedCells ?? 0,
              failedCells: summary?.failedCells ?? 0,
              promptAScore: promptSummaries[0]?.avgCompositeScore,
              promptBScore: promptSummaries[1]?.avgCompositeScore,
              scoreDelta:
                promptSummaries[1]?.avgCompositeScore != null &&
                promptSummaries[0]?.avgCompositeScore != null
                  ? promptSummaries[1].avgCompositeScore - promptSummaries[0].avgCompositeScore
                  : undefined,
            };
            SessionService.updateEvalRun(config.sessionId, run.id, {
              status: 'completed',
              completedAt: new Date().toISOString(),
              scoreSummary,
            });
          }
        } catch (e) {
          console.error('[ExecutionService] Failed to update session run:', e);
        }
      }
    } catch (err) {
      config.status = 'failed';
      config.updatedAt = new Date().toISOString();
      writeJson(join(evalDir, 'config.json'), config);

      broadcast({
        type: 'eval:failed',
        evalId,
        data: { error: (err as Error).message },
        timestamp: Date.now(),
      });

      if (config.sessionId) {
        try {
          const { SessionService } = await import('./SessionService');
          const runs = SessionService.listEvalRuns(config.sessionId);
          const run = runs.find(r => r.evalId === evalId);
          if (run) {
            SessionService.updateEvalRun(config.sessionId, run.id, {
              status: 'failed',
              completedAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.error('[ExecutionService] Failed to update session run on failure:', e);
        }
      }
    } finally {
      activeControllers.delete(evalId);
    }
  },
};
