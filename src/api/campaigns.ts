import type { CampaignDraftFromEvaluationInput, CampaignFeedback, CampaignValidationResult, JudgeQualificationRun, JudgeQualificationStatus, ModelSelectionCampaign, ModelSelectionCampaignInput } from '../types/eval';
const base = `${import.meta.env.BASE_URL}api/eval`;
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? response.statusText), { validation: data.validation });
  return data;
}
export const qualificationStatus = (id: string) => request<JudgeQualificationStatus>(`/judges/${encodeURIComponent(id)}/qualification-status`);
export const startQualification = (id: string) => request<JudgeQualificationRun>(`/judges/${encodeURIComponent(id)}/qualification-runs`, 'POST', {});
export const cancelQualification = (id: string) => request<JudgeQualificationRun>(`/judges/qualification-runs/${encodeURIComponent(id)}/cancel`, 'POST', {});
export const listCampaigns = () => request<ModelSelectionCampaign[]>('/model-selection');
export const getCampaign = (id: string) => request<ModelSelectionCampaign>(`/model-selection/${encodeURIComponent(id)}`);
export const campaignFeedback = (id: string) => request<CampaignFeedback>(`/model-selection/${encodeURIComponent(id)}/feedback`);
export const validateCampaign = (input: ModelSelectionCampaignInput) => request<CampaignValidationResult>('/model-selection/validate', 'POST', input);
export const saveCampaign = (input: ModelSelectionCampaignInput, id?: string) => request<ModelSelectionCampaign>(id ? `/model-selection/${encodeURIComponent(id)}` : '/model-selection/drafts', id ? 'PATCH' : 'POST', input);
export const createCampaignFromEvaluation = (input: CampaignDraftFromEvaluationInput) => request<ModelSelectionCampaign>('/model-selection/drafts/from-evaluation', 'POST', input);
export const startCampaign = (id: string, acknowledgedWarningCodes: string[]) => request<ModelSelectionCampaign>(`/model-selection/${encodeURIComponent(id)}/run`, 'POST', { acknowledgedWarningCodes });
export const cancelCampaign = (id: string) => request(`/model-selection/${encodeURIComponent(id)}/cancel`, 'POST', {});
