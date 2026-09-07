import { ModelSelectionService } from './ModelSelectionService';
import { CampaignValidationService } from './CampaignValidationService';
import { EvaluationService, browserPaths } from './EvaluationService';
import { EvaluationFeedbackService } from './EvaluationFeedbackService';
import type { CampaignFeedback, CampaignPhase } from '../../src/types/eval';

export const CampaignFeedbackService = {
  async get(id: string, base = '/'): Promise<CampaignFeedback | null> {
    const campaign = ModelSelectionService.getCampaign(id);
    if (!campaign) return null;
    let validation;
    try { validation = await CampaignValidationService.validate(campaign); }
    catch (error) { validation = { valid: false, callEstimate: [], issues: [{ code: 'MODEL_CATALOG_UNAVAILABLE', severity: 'error' as const, path: 'candidateSlate', message: (error as Error).message, requiresAcknowledgement: false }] }; }
    const phases: CampaignFeedback['phases'] = [];
    for (const task of campaign.tasks) {
      const entries: [CampaignPhase, string | undefined][] = [
        ['prompt-sweep', campaign.phase1EvalIds[task]], ['model-sweep', campaign.phase2EvalIds[task]],
        ...(campaign.phase3AttemptEvalIds?.[task] ?? [campaign.phase3EvalIds[task]]).map(id => ['confirmation', id] as [CampaignPhase, string]),
      ];
      for (const [phase, evaluationId] of entries) if (evaluationId) {
        const status = EvaluationService.get(evaluationId)?.status ?? 'failed';
        const paths = browserPaths(evaluationId, base);
        phases.push({ task, phase, evaluationId, status, browserPath: ['pending', 'running'].includes(status) ? paths.run : paths.results });
      }
    }
    return { campaign, validation, phases, browserPath: `${base.replace(/\/$/, '')}/campaigns/${id}`,
      activeEvaluation: campaign.activeWork ? await EvaluationFeedbackService.get(campaign.activeWork.evaluationId, base) ?? undefined : undefined };
  },
};
