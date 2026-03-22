import type { EvalSocketState } from '../../hooks/useEvalSocket';

interface WsStatusDotProps {
  status: EvalSocketState['status'];
}

const STATUS_LABELS: Record<EvalSocketState['status'], string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Reconnecting…',
  error: 'Error',
};

const STATUS_CLASSES: Record<EvalSocketState['status'], string> = {
  idle: 'ws-dot--idle',
  connecting: 'ws-dot--connecting',
  open: 'ws-dot--open',
  closed: 'ws-dot--closed',
  error: 'ws-dot--error',
};

export function WsStatusDot({ status }: WsStatusDotProps) {
  return (
    <div className={`ws-status-dot ${STATUS_CLASSES[status]}`} title={`WebSocket: ${STATUS_LABELS[status]}`}>
      <span className="ws-dot-indicator" aria-hidden="true" />
      <span className="ws-dot-label">{STATUS_LABELS[status]}</span>
    </div>
  );
}
