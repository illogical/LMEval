import { Link } from 'react-router-dom';
import type { EvaluationConfig } from '../../types/eval';
import './CampaignContextBadge.css';

export function CampaignContextBadge({ config }: { config: Pick<EvaluationConfig, 'campaignId' | 'campaignRole'> }) {
  if (!config.campaignId || config.campaignRole !== 'supplemental') return null;
  return (
    <div className="campaign-context-badge" role="note">
      <span>Supplemental campaign evidence</span>
      <Link to={`/campaigns/${encodeURIComponent(config.campaignId)}`}>View guided selection</Link>
    </div>
  );
}
