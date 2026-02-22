import { join } from 'path';
import { FileService } from './FileService.ts';
import { LmapiClient } from './LmapiClient.ts';
import { MetricsService } from './MetricsService.ts';
import { JudgeService } from './JudgeService.ts';
import { SummaryService } from './SummaryService.ts';
import { ReportService } from './ReportService.ts';
import { broadcast } from '../ws.ts';
import type {
  EvaluationConfig,
  EvalMatrixCell,
  EvaluationResults,
  JudgeResult,
  PairwiseRanking,
  TestCase,
  ToolDefinition
} from '../../src/types/eval.ts';
import type { ToolCall } from '../../src/types/lmapi.ts';
import { PromptService } from './PromptService.ts';
import { TestSuiteService } from './TestSuiteService.ts';
import { TemplateService } from './TemplateService.ts';

// Configurable concurrency limits via environment variables
const COMPLETION_CONCURRENCY = parseInt(process.env.EVAL_COMPLETION_CONCURRENCY ?? '8', 10);
const JUDGE_CONCURRENCY = parseInt(process.env.EVAL_JUDGE_CONCURRENCY ?? '4', 10);
const MAX_RETRIES = parseInt(process.env.EVAL_MAX_RETRIES ?? '1', 10);

class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    await new Promise<void>(resolve => this.queue.push(resolve));
    this.running++;
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const activeControllers = new Map<string, AbortController>();

export class ExecutionService {
  static async run(evalId: string): Promise<void> {
    const evalDir = join(FileService.evalsDir(), 'evaluations', evalId);
    const controller = new AbortController();
    activeControllers.set(evalId, controller);

    try {
      const config = FileService.readJson<EvaluationConfig>(join(evalDir, 'config.json'));
      if (!config) throw new Error('Config not found');

      // Update status to running
      FileService.writeJson(join(evalDir, 'config.json'), { ...config, status: 'running' });

      broadcast({ type: 'eval:progress', evalId, data: { phase: 1, message: 'Building matrix' }, timestamp: new Date().toISOString() });

      // Phase 1: Build matrix
      const matrix = await ExecutionService.buildMatrix(config);

      // Phase 2: Run completions
      broadcast({ type: 'eval:progress', evalId, data: { phase: 2, message: 'Running completions', total: matrix.length }, timestamp: new Date().toISOString() });
      await ExecutionService.runCompletions(evalId, config, matrix, controller.signal);

      if (controller.signal.aborted) {
        FileService.writeJson(join(evalDir, 'config.json'), { ...config, status: 'failed', errorMessage: 'Cancelled' });
        return;
      }

      // Phase 3: Run judging
      const template = TemplateService.get(config.templateId);
      const judgeResults: JudgeResult[] = [];
      const pairwiseRankings: PairwiseRanking[] = [];

      if (template?.judgeConfig?.enabled && template.judgeConfig.model) {
        broadcast({ type: 'eval:progress', evalId, data: { phase: 3, message: 'Running judge evaluation' }, timestamp: new Date().toISOString() });
        const { judgeResults: jr, pairwiseRankings: pr } = await ExecutionService.runJudging(
          evalId, config, matrix, template.judgeConfig, controller.signal
        );
        judgeResults.push(...jr);
        pairwiseRankings.push(...pr);
      }

      if (controller.signal.aborted) return;

      // Phase 4: Aggregate
      broadcast({ type: 'eval:progress', evalId, data: { phase: 4, message: 'Aggregating results' }, timestamp: new Date().toISOString() });
      await ExecutionService.aggregate(evalId, config, matrix, judgeResults, pairwiseRankings);

      // Mark completed
      const updatedConfig = { ...config, status: 'completed' as const, completedAt: new Date().toISOString() };
      FileService.writeJson(join(evalDir, 'config.json'), updatedConfig);

      broadcast({ type: 'eval:completed', evalId, data: { totalCells: matrix.length }, timestamp: new Date().toISOString() });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[ExecutionService] Eval ${evalId} failed:`, errMsg);
      const config = FileService.readJson<EvaluationConfig>(join(evalDir, 'config.json'));
      if (config) {
        FileService.writeJson(join(evalDir, 'config.json'), { ...config, status: 'failed', errorMessage: errMsg });
      }
      broadcast({ type: 'eval:failed', evalId, data: { error: errMsg }, timestamp: new Date().toISOString() });
    } finally {
      activeControllers.delete(evalId);
    }
  }

  static cancel(evalId: string): boolean {
    const controller = activeControllers.get(evalId);
    if (controller) {
      controller.abort();
      activeControllers.delete(evalId);
      return true;
    }
    return false;
  }

  static async buildMatrix(config: EvaluationConfig): Promise<EvalMatrixCell[]> {
    const matrix: EvalMatrixCell[] = [];

    // Resolve test cases
    let testCases: TestCase[] = [];
    if (config.testSuiteId) {
      const suite = TestSuiteService.get(config.testSuiteId);
      testCases = suite?.testCases ?? [];
    }
    if (config.inlineTestCases && config.inlineTestCases.length > 0) {
      testCases = [...testCases, ...config.inlineTestCases];
    }
    if (testCases.length === 0) {
      testCases = [{ id: 'default', name: 'Default', userMessage: 'Hello' }];
    }

    const runs = config.judgeConfig?.runsPerCombination ?? 1;

    for (const pv of config.promptVersions) {
      for (const modelId of config.models) {
        for (const tc of testCases) {
          for (let run = 1; run <= runs; run++) {
            matrix.push({
              id: FileService.generateId(),
              promptId: pv.promptId,
              promptVersion: pv.version,
              modelId,
              testCaseId: tc.id,
              runNumber: run,
              status: 'pending',
              response: { content: '', finishReason: '' },
              metrics: {
                inputTokens: 0,
                outputTokens: 0,
                durationMs: 0,
                tokensPerSecond: 0,
                serverName: '',
                formatCompliant: null,
                jsonSchemaValid: null,
                toolCallsValid: null,
                tokenCount: 0
              }
            });
          }
        }
      }
    }

    return matrix;
  }

  static async runCompletions(
    evalId: string,
    config: EvaluationConfig,
    matrix: EvalMatrixCell[],
    signal: AbortSignal
  ): Promise<void> {
    const semaphore = new Semaphore(COMPLETION_CONCURRENCY);
    const template = TemplateService.get(config.templateId);
    const toolDefs: ToolDefinition[] = config.toolDefinitions ?? [];

    // Resolve test cases map
    let testCasesMap = new Map<string, TestCase>();
    let testCases: TestCase[] = [];
    if (config.testSuiteId) {
      const suite = TestSuiteService.get(config.testSuiteId);
      testCases = suite?.testCases ?? [];
    }
    if (config.inlineTestCases) testCases = [...testCases, ...config.inlineTestCases];
    for (const tc of testCases) testCasesMap.set(tc.id, tc);

    let completedCount = 0;
    const tasks = matrix.map(cell => async () => {
      if (signal.aborted) return;
      await semaphore.acquire();
      if (signal.aborted) { semaphore.release(); return; }

      try {
        cell.status = 'running';
        broadcast({ type: 'cell:started', evalId, data: { cellId: cell.id, modelId: cell.modelId }, timestamp: new Date().toISOString() });

        // Get prompt content
        const promptContent = PromptService.getVersionContent(cell.promptId, cell.promptVersion) ?? '';
        const tc = testCasesMap.get(cell.testCaseId);
        const userMessage = tc?.userMessage ?? 'Hello';

        const startTime = Date.now();
        let retries = 0;

        while (retries <= MAX_RETRIES) {
          try {
            const response = await LmapiClient.chatCompletion({
              model: cell.modelId,
              messages: [
                { role: 'system', content: promptContent },
                { role: 'user', content: userMessage }
              ],
              tools: toolDefs.length > 0 ? toolDefs : undefined,
              stream: false,
              groupId: evalId
            });

            const durationMs = Date.now() - startTime;
            const choice = response.choices?.[0];
            const content = choice?.message?.content ?? '';
            const toolCallsRaw: ToolCall[] = choice?.message?.tool_calls ?? [];
            const inputTokens = response.usage?.prompt_tokens ?? 0;
            const outputTokens = response.usage?.completion_tokens ?? 0;
            const serverName = response.lmapi?.server_name ?? '';

            // Run deterministic checks
            let toolCallResults = undefined;
            if (toolDefs.length > 0 && toolCallsRaw.length > 0) {
              const vr = MetricsService.validateToolCalls(toolCallsRaw, toolDefs);
              toolCallResults = vr.results;
            }

            const deterministicUpdates = template
              ? MetricsService.computeDeterministicMetrics(cell, template, toolDefs, toolCallsRaw)
              : {};

            cell.response = {
              content,
              toolCalls: toolCallResults,
              finishReason: choice?.finish_reason ?? ''
            };
            cell.metrics = {
              inputTokens,
              outputTokens,
              durationMs,
              tokensPerSecond: outputTokens > 0 && durationMs > 0 ? (outputTokens / durationMs) * 1000 : 0,
              serverName,
              formatCompliant: null,
              jsonSchemaValid: null,
              toolCallsValid: null,
              tokenCount: outputTokens,
              ...deterministicUpdates
            };
            cell.status = 'completed';
            break;
          } catch (e) {
            if (retries < MAX_RETRIES) {
              retries++;
              await new Promise(r => setTimeout(r, 2000));
            } else {
              throw e;
            }
          }
        }

        completedCount++;
        broadcast({
          type: 'cell:completed',
          evalId,
          data: { cellId: cell.id, modelId: cell.modelId, metrics: cell.metrics, progress: completedCount / matrix.length },
          timestamp: new Date().toISOString()
        });
        broadcast({
          type: 'eval:progress',
          evalId,
          data: { phase: 2, completed: completedCount, total: matrix.length, pct: completedCount / matrix.length },
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        cell.status = 'failed';
        cell.errorMessage = errMsg;
        completedCount++;
        broadcast({ type: 'cell:failed', evalId, data: { cellId: cell.id, error: errMsg }, timestamp: new Date().toISOString() });
      } finally {
        semaphore.release();
      }
    });

    await Promise.allSettled(tasks.map(t => t()));
  }

  static async runJudging(
    evalId: string,
    config: EvaluationConfig,
    matrix: EvalMatrixCell[],
    judgeConfig: EvaluationConfig['judgeConfig'],
    signal: AbortSignal
  ): Promise<{ judgeResults: JudgeResult[]; pairwiseRankings: PairwiseRanking[] }> {
    const judgeResults: JudgeResult[] = [];
    const pairwiseRankings: PairwiseRanking[] = [];
    const semaphore = new Semaphore(JUDGE_CONCURRENCY);

    const completedCells = matrix.filter(c => c.status === 'completed');

    // Resolve test cases for prompts
    let testCasesMap = new Map<string, TestCase>();
    let testCases: TestCase[] = [];
    if (config.testSuiteId) {
      const suite = TestSuiteService.get(config.testSuiteId);
      testCases = suite?.testCases ?? [];
    }
    if (config.inlineTestCases) testCases = [...testCases, ...config.inlineTestCases];
    for (const tc of testCases) testCasesMap.set(tc.id, tc);

    broadcast({ type: 'judge:started', evalId, data: { totalCells: completedCells.length, perspectives: judgeConfig.perspectives.length }, timestamp: new Date().toISOString() });

    // Rubric judging: one judge call per cell × perspective
    const judgeTasks = completedCells.flatMap(cell => {
      return judgeConfig.perspectives.map(perspective => async () => {
        if (signal.aborted) return;
        await semaphore.acquire();
        if (signal.aborted) { semaphore.release(); return; }

        try {
          const promptContent = PromptService.getVersionContent(cell.promptId, cell.promptVersion) ?? '';
          const tc = testCasesMap.get(cell.testCaseId);
          const userMessage = tc?.userMessage ?? '';

          const messages = JudgeService.buildRubricPrompt(
            perspective,
            promptContent,
            userMessage,
            cell.response.content
          );

          const startTime = Date.now();
          const response = await LmapiClient.chatCompletion({
            model: judgeConfig.model,
            messages,
            stream: false,
            groupId: evalId
          });

          const raw = response.choices?.[0]?.message?.content ?? '';
          const parsed = JudgeService.parseRubricResponse(raw);

          if (parsed) {
            judgeResults.push({
              cellId: cell.id,
              perspectiveId: perspective.id,
              judgeModel: judgeConfig.model,
              score: parsed.score,
              justification: parsed.justification,
              durationMs: Date.now() - startTime
            });
          }
        } catch (e) {
          console.warn(`[ExecutionService] Judge failed for cell ${cell.id}:`, e);
        } finally {
          semaphore.release();
        }
      });
    });

    await Promise.allSettled(judgeTasks.map(t => t()));

    // Pairwise ranking
    if (judgeConfig.pairwiseComparison) {
      // Group by testCaseId
      const testCaseGroups = new Map<string, EvalMatrixCell[]>();
      for (const cell of completedCells) {
        const group = testCaseGroups.get(cell.testCaseId) ?? [];
        group.push(cell);
        testCaseGroups.set(cell.testCaseId, group);
      }

      const pairwiseTasks = [];
      for (const [tcId, cells] of testCaseGroups) {
        const tc = testCasesMap.get(tcId);
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            const cellA = cells[i];
            const cellB = cells[j];
            pairwiseTasks.push(async () => {
              if (signal.aborted) return;
              await semaphore.acquire();
              if (signal.aborted) { semaphore.release(); return; }

              try {
                const promptContent = PromptService.getVersionContent(cellA.promptId, cellA.promptVersion) ?? '';
                const { messages, swapped } = JudgeService.buildPairwisePrompt(
                  promptContent,
                  tc?.userMessage ?? '',
                  cellA,
                  cellB
                );

                const response = await LmapiClient.chatCompletion({
                  model: judgeConfig.model,
                  messages,
                  stream: false,
                  groupId: evalId
                });

                const raw = response.choices?.[0]?.message?.content ?? '';
                const parsed = JudgeService.parsePairwiseResponse(raw, swapped, cellA.id, cellB.id);
                if (parsed) {
                  parsed.judgeModel = judgeConfig.model;
                  pairwiseRankings.push(parsed);
                }
              } catch (e) {
                console.warn(`[ExecutionService] Pairwise judge failed:`, e);
              } finally {
                semaphore.release();
              }
            });
          }
        }
      }

      await Promise.allSettled(pairwiseTasks.map(t => t()));
    }

    broadcast({ type: 'judge:completed', evalId, data: { judgeResults: judgeResults.length }, timestamp: new Date().toISOString() });
    return { judgeResults, pairwiseRankings };
  }

  static async aggregate(
    evalId: string,
    config: EvaluationConfig,
    matrix: EvalMatrixCell[],
    judgeResults: JudgeResult[],
    pairwiseRankings: PairwiseRanking[]
  ): Promise<void> {
    const evalDir = join(FileService.evalsDir(), 'evaluations', evalId);

    const results: EvaluationResults = {
      evalId,
      matrix,
      judgeResults,
      pairwiseRankings: pairwiseRankings.length > 0 ? pairwiseRankings : undefined,
      completedAt: new Date().toISOString()
    };

    FileService.writeJson(join(evalDir, 'results.json'), results);

    const template = TemplateService.get(config.templateId);
    const perspectives = template?.judgeConfig?.perspectives ?? [];

    let summary = SummaryService.computeSummary(evalId, results, perspectives.map(p => ({ id: p.id, weight: p.weight })));

    // Compute regression if baseline provided
    if (config.baselineId) {
      const baselinePath = join(FileService.evalsDir(), 'baselines', `${config.baselineId}.json`);
      const baseline = FileService.readJson<{ summary: typeof summary; evalId: string }>(baselinePath);
      if (baseline?.summary) {
        summary.regression = SummaryService.computeRegression(summary, baseline.summary);
      }
    }

    FileService.writeJson(join(evalDir, 'summary.json'), summary);

    // Generate reports
    try {
      ReportService.writeReports(evalId);
    } catch (e) {
      console.warn('[ExecutionService] Report generation failed:', e);
    }
  }

  static estimateCost(config: EvaluationConfig): { totalCells: number; estimatedTokens: number } {
    const promptCount = config.promptVersions.length;
    const modelCount = config.models.length;
    const testCaseCount = (config.inlineTestCases?.length ?? 0) || 1;
    const runs = config.judgeConfig?.runsPerCombination ?? 1;
    const totalCells = promptCount * modelCount * testCaseCount * runs;
    const estimatedTokens = totalCells * 500; // rough estimate
    return { totalCells, estimatedTokens };
  }
}
