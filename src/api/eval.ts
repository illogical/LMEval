import type { PromptManifest, PromptVersionMeta, EvalTemplate, TestSuite, TestCase, EvaluationConfig, EvalMatrixCell, EvaluationSummary, EvalPreset } from '../types/eval';
import type { SessionManifest, SessionSlot } from '../types/session';

const BASE = '/api/eval';

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
  config: Omit<EvaluationConfig, 'id' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<EvaluationConfig & { evalRunId?: string }> {
  return apiFetch('/evaluations', { method: 'POST', body: JSON.stringify(config) });
}
export async function getEvaluation(id: string): Promise<EvaluationConfig> {
  return apiFetch(`/evaluations/${id}`);
}
export async function getEvaluationResults(id: string): Promise<{ cells: EvalMatrixCell[] }> {
  return apiFetch(`/evaluations/${id}/results`);
}
export async function getEvaluationSummary(id: string): Promise<EvaluationSummary> {
  return apiFetch(`/evaluations/${id}/summary`);
}
export async function exportEvaluation(id: string, format: 'html' | 'md'): Promise<Blob> {
  const res = await fetch(`/api/eval/evaluations/${id}/export?format=${format}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.blob();
}
export async function saveBaseline(id: string, slug: string): Promise<void> {
  await apiFetch(`/evaluations/${id}/baseline`, { method: 'POST', body: JSON.stringify({ slug }) });
}

// Models
export async function listModels(): Promise<{ servers: Array<{ name: string; models: string[] }> }> {
  return apiFetch('/models');
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
