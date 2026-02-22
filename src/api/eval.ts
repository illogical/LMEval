import type {
  EvalTemplate,
  PromptManifest,
  TestSuite,
  EvaluationConfig,
  EvaluationResults,
  EvaluationSummary,
} from '../types/eval';

const BASE = '/api/eval';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// Templates
export const evalApi = {
  // Templates
  listTemplates: () => request<EvalTemplate[]>('/templates'),
  getTemplate: (id: string) => request<EvalTemplate>(`/templates/${id}`),
  createTemplate: (data: Omit<EvalTemplate, 'id' | 'createdAt' | 'updatedAt'>) =>
    request<EvalTemplate>('/templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: Partial<EvalTemplate>) =>
    request<EvalTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) =>
    request<void>(`/templates/${id}`, { method: 'DELETE' }),

  // Prompts
  listPrompts: () => request<PromptManifest[]>('/prompts'),
  getPrompt: (id: string) => request<PromptManifest>(`/prompts/${id}`),
  getPromptContent: (id: string, version: number) =>
    fetch(`${BASE}/prompts/${id}/versions/${version}`).then(r => r.text()),
  createPrompt: (data: { name: string; content: string; notes?: string }) =>
    request<PromptManifest>('/prompts', { method: 'POST', body: JSON.stringify(data) }),
  savePromptVersion: (id: string, data: { content: string; notes?: string }) =>
    request<PromptManifest>(`/prompts/${id}/versions`, { method: 'POST', body: JSON.stringify(data) }),
  getPromptHistory: (id: string) =>
    request<Array<{ evalId: string; score: number; date: string }>>(`/prompts/${id}/history`),

  // Test suites
  listTestSuites: () => request<TestSuite[]>('/test-suites'),
  getTestSuite: (id: string) => request<TestSuite>(`/test-suites/${id}`),
  createTestSuite: (data: Omit<TestSuite, 'id' | 'createdAt' | 'updatedAt'>) =>
    request<TestSuite>('/test-suites', { method: 'POST', body: JSON.stringify(data) }),
  updateTestSuite: (id: string, data: Partial<TestSuite>) =>
    request<TestSuite>(`/test-suites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTestSuite: (id: string) =>
    request<void>(`/test-suites/${id}`, { method: 'DELETE' }),

  // Evaluations
  listEvaluations: () => request<EvaluationConfig[]>('/evaluations'),
  getEvaluation: (id: string) => request<EvaluationConfig>(`/evaluations/${id}`),
  createEvaluation: (data: Omit<EvaluationConfig, 'id' | 'createdAt' | 'status'>) =>
    request<EvaluationConfig>('/evaluations', { method: 'POST', body: JSON.stringify(data) }),
  startEvaluation: (id: string) =>
    request<{ started: boolean }>(`/evaluations/${id}/start`, { method: 'POST' }),
  getResults: (id: string) => request<EvaluationResults>(`/evaluations/${id}/results`),
  getSummary: (id: string) => request<EvaluationSummary>(`/evaluations/${id}/summary`),
  exportHtml: (id: string) =>
    fetch(`${BASE}/evaluations/${id}/export/html`).then(r => r.text()),
  exportMarkdown: (id: string) =>
    fetch(`${BASE}/evaluations/${id}/export/md`).then(r => r.text()),
  saveBaseline: (id: string, slug: string) =>
    request<void>(`/evaluations/${id}/baseline`, { method: 'POST', body: JSON.stringify({ slug }) }),

  // Models
  listModels: () =>
    request<Array<{ serverId: string; serverName: string; modelId: string; isRunning: boolean }>>('/models'),

  // Auto-generate template
  generateTemplate: (promptContent: string) =>
    request<EvalTemplate>('/templates/generate', {
      method: 'POST',
      body: JSON.stringify({ promptContent }),
    }),
};
