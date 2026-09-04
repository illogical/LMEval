import { WifiOff, RefreshCw, XCircle } from 'lucide-react';

interface ConnectionLostBannerProps {
  onRefreshStatus: () => void;
  onCancel: () => void;
  refreshing?: boolean;
  cancelling?: boolean;
}

export function ConnectionLostBanner({ onRefreshStatus, onCancel, refreshing = false, cancelling = false }: ConnectionLostBannerProps) {
  return (
    <div className="connection-lost-banner" role="alert" aria-label="Connection lost">
      <WifiOff size={16} className="clb-icon" aria-hidden="true" />
      <span className="clb-text">Connection lost — the evaluation may still be running on the server.</span>
      <div className="clb-actions">
        <button className="clb-btn" onClick={onRefreshStatus} disabled={refreshing}>
          <RefreshCw size={14} />
          {refreshing ? 'Checking…' : 'Refresh Status'}
        </button>
        <button className="clb-btn clb-btn--danger" onClick={onCancel} disabled={cancelling}>
          <XCircle size={14} />
          {cancelling ? 'Cancelling…' : 'Cancel Evaluation'}
        </button>
      </div>
    </div>
  );
}
