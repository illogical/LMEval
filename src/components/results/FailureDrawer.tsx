import type { EvalMatrixCell, TestCase } from '../../types/eval';
import { DetailView } from './DetailView';
import './FailureDrawer.css';

interface FailureDrawerProps {
  cell: EvalMatrixCell;
  cells: EvalMatrixCell[];
  testCases: TestCase[];
  onClose: () => void;
  onSelectCell: (cell: EvalMatrixCell) => void;
  onCompareCell: (cellId: string) => void;
  onRetryCell: (cellId: string) => void | Promise<void>;
  retryingCellId: string | null;
}

/** Modal shell around DetailView, opened when a failed heatmap cell is clicked —
 * reuses DetailView's rendering wholesale rather than duplicating cell-forensic UI. */
export function FailureDrawer({ cell, cells, testCases, onClose, onSelectCell, onCompareCell, onRetryCell, retryingCellId }: FailureDrawerProps) {
  return (
    <div className="fd-overlay" onClick={onClose}>
      <div className="fd-panel" onClick={e => e.stopPropagation()}>
        <div className="fd-header">
          <span>Cell failure detail</span>
          <button className="fd-close" onClick={onClose}>×</button>
        </div>
        <div className="fd-body">
          <DetailView
            cell={cell}
            cells={cells}
            testCases={testCases}
            onSelectCell={onSelectCell}
            onCompareCell={onCompareCell}
            onRetryCell={onRetryCell}
            retryingCellId={retryingCellId}
          />
        </div>
      </div>
    </div>
  );
}
