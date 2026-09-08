import { ModelSelectionService } from './ModelSelectionService';
import { CampaignValidationService } from './CampaignValidationService';
import { EvaluationService, browserPaths } from './EvaluationService';
import { EvaluationFeedbackService } from './EvaluationFeedbackService';
import { EVALUATIONS_DIR, listDir, readJson } from './FileService';
import { join } from 'path';
import type { CampaignFeedback, CampaignPhase, EvaluationConfig } from '../../src/types/eval';

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
    const supplementalEvaluations = listDir(EVALUATIONS_DIR).flatMap(evaluationId => {
      const evaluation = readJson<EvaluationConfig>(join(EVALUATIONS_DIR, evaluationId, 'config.json'));
      if (!evaluation || evaluation.campaignId !== id || evaluation.campaignRole !== 'supplemental') return [];
      const paths = browserPaths(evaluationId, base);
      return [{ evaluationId, name: evaluation.name, status: evaluation.status, createdAt: evaluation.createdAt,
        browserPath: ['draft'].includes(evaluation.status) ? paths.config : ['pending', 'running'].includes(evaluation.status) ? paths.run : paths.results }];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { campaign, validation, phases, supplementalEvaluations, browserPath: `${base.replace(/\/$/, '')}/campaigns/${id}`,
      activeEvaluation: campaign.activeWork ? await EvaluationFeedbackService.get(campaign.activeWork.evaluationId, base) ?? undefined : undefined };
  },
};
