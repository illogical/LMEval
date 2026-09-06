import type { PromptManifest, PromptVersionMeta, EvalTemplate, TestSuite, TestCase, EvaluationConfig, EvalMatrixCell, EvaluationSummary, EvalPreset, EvalPurposeTemplate, EvaluationHistoryEntry, BaselineSummary, RegressionResult, EvaluationInput, EvaluationValidationResult, EvaluationBrowserPaths, EvaluationFeedback } from '../types/eval';
import type { ParseResult } from '../utils/testCaseIO';
import type { SessionManifest, SessionSlot, EvalRun, SummaryAnalysis } from '../types/session';

// "/api/eval" standalone, "/lmeval/api/eval" when hosted under HomeBase —
// derived from Vite's BASE_URL (docs/plans/2026-08-23-homebase-integration.md §4).
const BASE = `${import.meta.env.BASE_URL}api/eval`.replace(/\/\/+/g, '/');

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function createPrompt(name: string, content: string): Promise<PromptManifest> {
  return apiFetch('/prompts', {
    method: 'POST',
    body: JSON.stringify({ name, content }),
  });
}

export async function addPromptVersion(id: string, content: string, description?: string): Promise<PromptManifest> {
  return apiFetch(`/prompts/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ content, description }),
  });
}

export async function createSession(data: {
  name: string;
  description?: string;
  promptA: SessionSlot;
  promptB: SessionSlot;
}): Promise<SessionManifest> {
  return apiFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function addSessionVersion(
  sessionId: string,
  data: { description?: string; promptA: SessionSlot; promptB: SessionSlot }
): Promise<SessionManifest> {
  return apiFetch(`/sessions/${sessionId}/versions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Prompts
export async function listPrompts(): Promise<PromptManifest[]> {
  return apiFetch('/prompts');
}
export async function getPromptContent(id: string, version?: number): Promise<{ content: string }> {
  const q = version != null ? `?version=${version}` : '';
  return apiFetch(`/prompts/${id}/content${q}`);
}
export async function listPromptVersions(id: string): Promise<PromptVersionMeta[]> {
  return apiFetch(`/prompts/${id}/versions`);
}

// Templates
export async function listTemplates(): Promise<EvalTemplate[]> {
  return apiFetch('/templates');
}
export async function getTemplate(id: string): Promise<EvalTemplate> {
  return apiFetch(`/templates/${id}`);
}
export async function generateTemplate(promptContent: string, tools?: unknown[]): Promise<Partial<EvalTemplate>> {
  return apiFetch('/templates/generate', {
    method: 'POST',
    body: JSON.stringify({ promptContent, tools }),
  });
}

// Purpose templates
export async function listPurposeTemplates(): Promise<EvalPurposeTemplate[]> {
  return apiFetch('/purpose-templates');
}
export async function getPurposeTemplate(id: string): Promise<EvalPurposeTemplate> {
  return apiFetch(`/purpose-templates/${id}`);
}
export async function createPurposeTemplate(
  data: Omit<EvalPurposeTemplate, 'id' | 'builtIn' | 'createdAt' | 'updatedAt' | 'purposeCategory'>
): Promise<EvalPurposeTemplate> {
  return apiFetch('/purpose-templates', { method: 'POST', body: JSON.stringify(data) });
}

// Test Suites
export async function listTestSuites(): Promise<TestSuite[]> {
  return apiFetch('/test-suites');
}
export async function getTestSuite(id: string): Promise<TestSuite> {
  return apiFetch(`/test-suites/${id}`);
}
export async function createTestSuite(data: { name: string; description?: string; testCases?: Omit<TestCase, 'id'>[] }): Promise<TestSuite> {
  return apiFetch('/test-suites', { method: 'POST', body: JSON.stringify(data) });
}

// Sessions
export async function listSessions(): Promise<SessionManifest[]> {
  return apiFetch('/sessions');
}

// Evaluations
export async function listEvaluations(params?: { status?: string; promptId?: string }): Promise<EvaluationConfig[]> {
  const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return apiFetch(`/evaluations${q}`);
}
export async function createEvaluation(
  config: EvaluationInput
): Promise<EvaluationConfig & { evalRunId?: string }> {
  return apiFetch('/evaluations', { method: 'POST', body: JSON.stringify(config) });
}
export async function getEvaluation(id: string): Promise<EvaluationConfig> {
  return apiFetch(`/evaluations/${id}`);
}
export async function validateEvaluation(config: EvaluationInput): Promise<EvaluationValidationResult> {
  return apiFetch('/evaluations/validate', { method: 'POST', body: JSON.stringify(config) });
}
export async function createEvaluationDraft(config: EvaluationInput): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; browserPaths: EvaluationBrowserPaths }> {
  return apiFetch('/evaluations/drafts', { method: 'POST', body: JSON.stringify(config) });
}
export async function patchEvaluationDraft(id: string, patch: Partial<EvaluationInput>): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; browserPaths: EvaluationBrowserPaths }> {
  return apiFetch(`/evaluations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export async function startEvaluationDraft(id: string): Promise<{ evaluation: EvaluationConfig; validation: EvaluationValidationResult; browserPaths: EvaluationBrowserPaths }> {
  return apiFetch(`/evaluations/${id}/run`, { method: 'POST' });
}
export async function getEvaluationFeedback(id: string): Promise<EvaluationFeedback> {
  return apiFetch(`/evaluations/${id}/feedback`);
}
export async function getEvaluationResults(id: string): Promise<EvalMatrixCell[]> {
  return apiFetch(`/evaluations/${id}/results`);
}
export async function getEvaluationSummary(id: string): Promise<EvaluationSummary> {
  return apiFetch(`/evaluations/${id}/summary`);
}
export async function exportEvaluation(id: string, format: 'html' | 'md'): Promise<Blob> {
  const res = await fetch(`${BASE}/evaluations/${id}/export?format=${format}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.blob();
}
export async function saveBaseline(id: string, slug: string): Promise<void> {
  await apiFetch(`/evaluations/${id}/baseline`, { method: 'POST', body: JSON.stringify({ slug }) });
}
export async function listBaselines(): Promise<BaselineSummary[]> {
  return apiFetch('/evaluations/baselines');
}
export async function getEvaluationTestCases(id: string): Promise<TestCase[]> {
  return apiFetch(`/evaluations/${id}/testcases`);
}
export async function getEvaluationHistory(id: string): Promise<EvaluationHistoryEntry[]> {
  return apiFetch(`/evaluations/${id}/history`);
}
export async function getEvaluationRegression(id: string, baselineSlug: string): Promise<RegressionResult> {
  return apiFetch(`/evaluations/${id}/regression?baselineSlug=${encodeURIComponent(baselineSlug)}`);
}
export async function retryEvaluationCells(
  id: string,
  body: { cellIds?: string[]; failedCellsOnly?: boolean }
): Promise<{ evalId: string; evalRunId?: string; retriedCells?: number }> {
  return apiFetch(`/evaluations/${id}/retry`, { method: 'POST', body: JSON.stringify(body) });
}
export async function listSessionRuns(sessionId: string): Promise<EvalRun[]> {
  return apiFetch(`/sessions/${sessionId}/runs`);
}
export async function getHealth(): Promise<{ status: string; refinementModelConfigured: boolean }> {
  return apiFetch('/health');
}
export async function getSummaryAnalysis(evalId: string): Promise<SummaryAnalysis | null> {
  const res = await fetch(`${BASE}/evaluations/${evalId}/summary-analysis`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText })) as { error?: string }).error ?? res.statusText);
  return res.json() as Promise<SummaryAnalysis>;
}
export async function generateSummaryAnalysis(evalId: string, refinementModel?: string): Promise<SummaryAnalysis> {
  return apiFetch(`/evaluations/${evalId}/summary-analysis`, { method: 'POST', body: JSON.stringify({ refinementModel }) });
}

// Models
export async function listModels(): Promise<{ servers: Array<{ name: string; models: string[] }> }> {
  return apiFetch('/models/by-server');
}

// Presets
export async function listPresets(): Promise<EvalPreset[]> {
  return apiFetch('/presets');
}
export async function getPreset(id: string): Promise<EvalPreset> {
  return apiFetch(`/presets/${id}`);
}
export async function createPreset(data: Omit<EvalPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<EvalPreset> {
  return apiFetch('/presets', { method: 'POST', body: JSON.stringify(data) });
}
export async function updatePreset(id: string, data: Partial<EvalPreset>): Promise<EvalPreset> {
  return apiFetch(`/presets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}
export async function deletePreset(id: string): Promise<void> {
  await apiFetch(`/presets/${id}`, { method: 'DELETE' });
}

// Delete operations (for cleanup / agent use)
export async function deletePrompt(id: string): Promise<void> {
  await apiFetch(`/prompts/${id}`, { method: 'DELETE' });
}
export async function deleteEvaluation(id: string): Promise<void> {
  await apiFetch(`/evaluations/${id}`, { method: 'DELETE' });
}
export async function cancelEvaluation(id: string): Promise<void> {
  await apiFetch(`/evaluations/${id}/cancel`, { method: 'POST' });
}
export async function deleteSession(id: string): Promise<void> {
  await apiFetch(`/sessions/${id}`, { method: 'DELETE' });
}
export async function deleteTestSuite(id: string): Promise<void> {
  await apiFetch(`/test-suites/${id}`, { method: 'DELETE' });
}
export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch(`/templates/${id}`, { method: 'DELETE' });
}

// Server-side test case parsing (CSV or JSON text → TestCase[])
export async function parseTestCases(
  content: string,
  format: 'csv' | 'json'
): Promise<ParseResult & { cases: (TestCase)[] }> {
  return apiFetch('/test-suites/parse', {
    method: 'POST',
    body: JSON.stringify({ content, format }),
  });
}
