/**
 * LMEvalClient — typed SDK for the LMEval REST API.
 *
 * Designed for use by agents, test scripts, and harness loops that need to
 * drive the full evaluation workflow without a browser.
 *
 * Usage:
 *   import { LMEvalClient } from './scripts/lib/LMEvalClient';
 *   const client = new LMEvalClient();                    // default: http://localhost:$PORT/api/eval
 *   const client = new LMEvalClient('http://host:17105/api/eval');
 */

import WebSocket from 'ws';
import type {
  PromptManifest,
  PromptVersionMeta,
  EvalTemplate,
  TestSuite,
  TestCase,
  EvaluationConfig,
  EvalMatrixCell,
  EvaluationSummary,
  EvalPreset,
  EvalPurposeTemplate,
  EvaluationInput,
  EvaluationValidationResult,
  EvaluationBrowserPaths,
  EvaluationFeedback,
} from '../../src/types/eval';
import type { SessionManifest, SessionSlot } from '../../src/types/session';
import type { ParseResult } from '../../src/utils/testCaseIO';

// ─── internal helpers ─────────────────────────────────────────────────────────

interface ApiError {
  error?: string;
}

async function apiFetch<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as ApiError;
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── public types ─────────────────────────────────────────────────────────────

export type { PromptManifest, PromptVersionMeta, EvalTemplate, TestSuite, TestCase,
  EvaluationConfig, EvalMatrixCell, EvaluationSummary, EvalPreset };
export type { SessionManifest, SessionSlot };

export interface CreateEvaluationInput {
  name: string;
  promptIds: string[];
  modelIds: string[];
  testSuiteId?: string;
  userMessage?: string;
  inlineTestCases?: TestCase[];
  templateId?: string;
  judgeModelId?: string;
  enablePairwise?: boolean;
  runsPerCell?: number;
  sessionId?: string;
  sessionVersion?: number;
  comparisonMode?: EvaluationInput['comparisonMode'];
  purposeTemplateId?: string;
  promptVersions?: EvaluationInput['promptVersions'];
  inference?: EvaluationInput['inference'];
  benchmarkMode?: EvaluationInput['benchmarkMode'];
}

export interface ModelList {
  servers: Array<{ name: string; models: string[] }>;
}

export interface ParsedTestCases extends ParseResult {
  cases: TestCase[];
}

// ─── client ───────────────────────────────────────────────────────────────────

export class LMEvalClient {
  private baseUrl: string;
  private wsBaseUrl: string;

  constructor(baseUrl = `http://localhost:${process.env.PORT ?? 3200}/api/eval`) {
    this.baseUrl = baseUrl;
    // Derive WebSocket URL from HTTP base URL
    this.wsBaseUrl = baseUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')
      .replace('/api/eval', '');
  }

  private fetch<T>(path: string, options?: RequestInit): Promise<T> {
    return apiFetch<T>(this.baseUrl, path, options);
  }

  // ── Prompts ─────────────────────────────────────────────────────────────────

  createPrompt(name: string, content: string): Promise<PromptManifest> {
    return this.fetch('/prompts', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    });
  }

  addPromptVersion(id: string, content: string, description?: string): Promise<PromptManifest> {
    return this.fetch(`/prompts/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ content, description }),
    });
  }

  listPrompts(): Promise<PromptManifest[]> {
    return this.fetch('/prompts');
  }

  async getPromptContent(id: string, version?: number): Promise<string> {
    const q = version != null ? `?version=${version}` : '';
    const data = await this.fetch<{ content: string }>(`/prompts/${id}/content${q}`);
    return data.content;
  }

  async deletePrompt(id: string): Promise<void> {
    await this.fetch(`/prompts/${id}`, { method: 'DELETE' });
  }

  // ── Templates ───────────────────────────────────────────────────────────────

  listTemplates(): Promise<EvalTemplate[]> {
    return this.fetch('/templates');
  }

  getTemplate(id: string): Promise<EvalTemplate> {
    return this.fetch(`/templates/${id}`);
  }

  generateTemplate(promptContent: string, tools?: unknown[]): Promise<Partial<EvalTemplate>> {
    return this.fetch('/templates/generate', {
      method: 'POST',
      body: JSON.stringify({ promptContent, tools }),
    });
  }

  createTemplate(data: Partial<Omit<EvalTemplate, 'id' | 'createdAt' | 'updatedAt'>>): Promise<EvalTemplate> {
    return this.fetch('/templates', { method: 'POST', body: JSON.stringify(data) });
  }

  updateTemplate(id: string, data: Partial<EvalTemplate>): Promise<EvalTemplate> {
    return this.fetch(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.fetch(`/templates/${id}`, { method: 'DELETE' });
  }

  // ── Test Suites ──────────────────────────────────────────────────────────────

  listTestSuites(): Promise<TestSuite[]> {
    return this.fetch('/test-suites');
  }

  getTestSuite(id: string): Promise<TestSuite> {
    return this.fetch(`/test-suites/${id}`);
  }

  createTestSuite(data: {
    name: string;
    description?: string;
    testCases?: Omit<TestCase, 'id'>[];
  }): Promise<TestSuite> {
    return this.fetch('/test-suites', { method: 'POST', body: JSON.stringify(data) });
  }

  listPurposeTemplates(): Promise<EvalPurposeTemplate[]> {
    return this.fetch('/purpose-templates');
  }

  /** Parse CSV or JSON text server-side and return TestCase objects with IDs assigned. */
  parseTestCases(content: string, format: 'csv' | 'json'): Promise<ParsedTestCases> {
    return this.fetch('/test-suites/parse', {
      method: 'POST',
      body: JSON.stringify({ content, format }),
    });
  }

  async deleteTestSuite(id: string): Promise<void> {
    await this.fetch(`/test-suites/${id}`, { method: 'DELETE' });
  }

  // ── Evaluations ──────────────────────────────────────────────────────────────

  async createEvaluation(config: CreateEvaluationInput): Promise<{ evalId: string; evalRunId?: string }> {
    const result = await this.fetch<EvaluationConfig & { evalRunId?: string }>('/evaluations', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    return { evalId: result.id, evalRunId: result.evalRunId };
  }

  validateEvaluation(config: EvaluationInput): Promise<EvaluationValidationResult> {
    return this.fetch('/evaluations/validate', { method: 'POST', body: JSON.stringify(config) });
  }

  createEvaluationDraft(config: EvaluationInput): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; browserPaths: EvaluationBrowserPaths }> {
    return this.fetch('/evaluations/drafts', { method: 'POST', body: JSON.stringify(config) });
  }

  patchEvaluationDraft(id: string, patch: Partial<EvaluationInput>): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; browserPaths: EvaluationBrowserPaths }> {
    return this.fetch(`/evaluations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  startEvaluationDraft(id: string): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; browserPaths: EvaluationBrowserPaths }> {
    return this.fetch(`/evaluations/${id}/run`, { method: 'POST' });
  }

  getFeedback(id: string): Promise<EvaluationFeedback> {
    return this.fetch(`/evaluations/${id}/feedback`);
  }

  getEvaluation(id: string): Promise<EvaluationConfig> {
    return this.fetch(`/evaluations/${id}`);
  }

  listEvaluations(params?: { status?: string; promptId?: string }): Promise<EvaluationConfig[]> {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return this.fetch(`/evaluations${q}`);
  }

  getResults(id: string): Promise<{ cells: EvalMatrixCell[] }> {
    return this.fetch(`/evaluations/${id}/results`);
  }

  getSummary(id: string): Promise<EvaluationSummary> {
    return this.fetch(`/evaluations/${id}/summary`);
  }

  async exportEvaluation(id: string, format: 'html' | 'md'): Promise<string> {
    const res = await fetch(`${this.baseUrl}/evaluations/${id}/export?format=${format}`);
    if (!res.ok) throw new Error(res.statusText);
    return res.text();
  }

  async saveBaseline(id: string, slug: string): Promise<void> {
    await this.fetch(`/evaluations/${id}/baseline`, {
      method: 'POST',
      body: JSON.stringify({ slug }),
    });
  }

  async cancelEvaluation(id: string): Promise<void> {
    await this.fetch(`/evaluations/${id}/cancel`, { method: 'POST' });
  }

  async deleteEvaluation(id: string): Promise<void> {
    await this.fetch(`/evaluations/${id}`, { method: 'DELETE' });
  }

  /**
   * Wait for an evaluation to reach a terminal state (completed, failed, or cancelled).
   *
   * Strategy:
   * 1. Connect to the WebSocket and listen for `eval:completed`, `eval:failed`, or `eval:cancelled`.
   * 2. If the WebSocket is unavailable, fall back to polling GET /evaluations/:id every 2s.
   * 3. Reject with a timeout error if `timeoutMs` is exceeded (default: 5 minutes).
   */
  waitForCompletion(evalId: string, timeoutMs = 300_000): Promise<EvaluationSummary> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let settled = false;

      const finish = async (status: 'completed' | 'failed' | 'cancelled', errMsg?: string) => {
        if (settled) return;
        settled = true;
        if (status === 'completed') {
          try {
            resolve(await this.getSummary(evalId));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(errMsg ?? `Evaluation ${status}: ${evalId}`));
        }
      };

      // ── WebSocket path ──────────────────────────────────────────────────────
      let ws: WebSocket | null = null;
      let wsOk = false;
      try {
        ws = new WebSocket(`${this.wsBaseUrl}/ws/eval`);

        ws.on('open', () => { wsOk = true; });

        ws.on('message', (raw: WebSocket.RawData) => {
          try {
            const msg = JSON.parse(raw.toString()) as { type: string; evalId: string; data: Record<string, unknown> };
            if (msg.evalId !== evalId) return;
            if (msg.type === 'eval:completed') finish('completed');
            else if (msg.type === 'eval:cancelled') finish('cancelled', `Evaluation was cancelled`);
            else if (msg.type === 'eval:failed') finish('failed', (msg.data?.error as string) ?? 'Evaluation failed');
          } catch { /* ignore parse errors */ }
        });

        ws.on('error', () => {
          if (!wsOk) startPolling();
        });

        ws.on('close', () => {
          if (!settled && wsOk) startPolling();
        });
      } catch {
        startPolling();
      }

      // ── Polling fallback ────────────────────────────────────────────────────
      let pollTimer: ReturnType<typeof setTimeout> | null = null;

      const startPolling = () => {
        if (settled) return;
        ws?.terminate();
        ws = null;
        poll();
      };

      const poll = async () => {
        if (settled) return;
        if (Date.now() > deadline) {
          settled = true;
          reject(new Error(`waitForCompletion timed out after ${timeoutMs}ms for eval ${evalId}`));
          return;
        }
        try {
          const config = await this.getEvaluation(evalId);
          if (config.status === 'completed') finish('completed');
          else if (config.status === 'failed') finish('failed', 'Evaluation failed');
          else if (config.status === 'cancelled') finish('cancelled', 'Evaluation was cancelled');
          else pollTimer = setTimeout(poll, 2000);
        } catch (e) {
          pollTimer = setTimeout(poll, 2000);
        }
      };

      // Timeout guard
      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws?.terminate();
          if (pollTimer) clearTimeout(pollTimer);
          reject(new Error(`waitForCompletion timed out after ${timeoutMs}ms for eval ${evalId}`));
        }
      }, timeoutMs);

      // Ensure timeout timer doesn't block process exit
      if (typeof timeoutTimer === 'object' && 'unref' in timeoutTimer) {
        (timeoutTimer as NodeJS.Timeout).unref();
      }

      // Start with a quick poll in case the eval already finished
      setTimeout(async () => {
        if (settled) return;
        try {
          const config = await this.getEvaluation(evalId);
          if (config.status === 'completed') finish('completed');
          else if (config.status === 'failed') finish('failed', 'Evaluation failed');
          else if (config.status === 'cancelled') finish('cancelled', 'Evaluation was cancelled');
        } catch { /* will fall through to WS or polling */ }
      }, 100);
    });
  }

  // ── Models ───────────────────────────────────────────────────────────────────

  listModels(): Promise<ModelList> {
    return this.fetch('/models/by-server');
  }

  // ── Presets ──────────────────────────────────────────────────────────────────

  listPresets(): Promise<EvalPreset[]> {
    return this.fetch('/presets');
  }

  getPreset(id: string): Promise<EvalPreset> {
    return this.fetch(`/presets/${id}`);
  }

  createPreset(data: Omit<EvalPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<EvalPreset> {
    return this.fetch('/presets', { method: 'POST', body: JSON.stringify(data) });
  }

  updatePreset(id: string, data: Partial<EvalPreset>): Promise<EvalPreset> {
    return this.fetch(`/presets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  async deletePreset(id: string): Promise<void> {
    await this.fetch(`/presets/${id}`, { method: 'DELETE' });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────

  listSessions(): Promise<SessionManifest[]> {
    return this.fetch('/sessions');
  }

  getSession(id: string): Promise<SessionManifest> {
    return this.fetch(`/sessions/${id}`);
  }

  createSession(data: {
    name: string;
    description?: string;
    promptA: SessionSlot;
    promptB: SessionSlot;
  }): Promise<SessionManifest> {
    return this.fetch('/sessions', { method: 'POST', body: JSON.stringify(data) });
  }

  addSessionVersion(
    id: string,
    data: { description?: string; promptA: SessionSlot; promptB: SessionSlot }
  ): Promise<SessionManifest> {
    return this.fetch(`/sessions/${id}/versions`, { method: 'POST', body: JSON.stringify(data) });
  }

  async deleteSession(id: string): Promise<void> {
    await this.fetch(`/sessions/${id}`, { method: 'DELETE' });
  }

  // ── Cleanup helper ───────────────────────────────────────────────────────────

  /**
   * Delete all resources whose name starts with `prefix` (default `'e2e-test-'`).
   * Safe to call in a `finally` block — errors are logged but not thrown.
   */
  async cleanupTestResources(prefix = 'e2e-test-'): Promise<void> {
    const log = (msg: string) => console.log(`  [cleanup] ${msg}`);
    const safe = async (label: string, fn: () => Promise<void>) => {
      try { await fn(); log(`deleted ${label}`); }
      catch (e) { log(`warn: could not delete ${label}: ${(e as Error).message}`); }
    };

    // Evaluations
    try {
      const evals = await this.listEvaluations();
      for (const e of evals) {
        if (e.name.startsWith(prefix)) {
          await safe(`evaluation ${e.id} (${e.name})`, () => this.deleteEvaluation(e.id));
        }
      }
    } catch (e) { log(`warn: could not list evaluations: ${(e as Error).message}`); }

    // Sessions
    try {
      const sessions = await this.listSessions();
      for (const s of sessions) {
        if (s.name.startsWith(prefix)) {
          await safe(`session ${s.id} (${s.name})`, () => this.deleteSession(s.id));
        }
      }
    } catch (e) { log(`warn: could not list sessions: ${(e as Error).message}`); }

    // Test suites
    try {
      const suites = await this.listTestSuites();
      for (const s of suites) {
        if (s.name.startsWith(prefix)) {
          await safe(`test-suite ${s.id} (${s.name})`, () => this.deleteTestSuite(s.id));
        }
      }
    } catch (e) { log(`warn: could not list test-suites: ${(e as Error).message}`); }

    // Templates (custom only — don't touch built-ins)
    try {
      const templates = await this.listTemplates();
      for (const t of templates) {
        if (!t.builtIn && t.name.startsWith(prefix)) {
          await safe(`template ${t.id} (${t.name})`, () => this.deleteTemplate(t.id));
        }
      }
    } catch (e) { log(`warn: could not list templates: ${(e as Error).message}`); }

    // Presets
    try {
      const presets = await this.listPresets();
      for (const p of presets) {
        if (p.name.startsWith(prefix)) {
          await safe(`preset ${p.id} (${p.name})`, () => this.deletePreset(p.id));
        }
      }
    } catch (e) { log(`warn: could not list presets: ${(e as Error).message}`); }

    // Prompts
    try {
      const prompts = await this.listPrompts();
      for (const p of prompts) {
        if (p.name.startsWith(prefix)) {
          await safe(`prompt ${p.id} (${p.name})`, () => this.deletePrompt(p.id));
        }
      }
    } catch (e) { log(`warn: could not list prompts: ${(e as Error).message}`); }
  }
}

export default LMEvalClient;
