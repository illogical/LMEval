import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Play, RotateCcw } from 'lucide-react';
import type { EvaluationFeedback } from '../../types/eval';

interface RecoveryPanelProps {
  feedback: EvaluationFeedback;
  onResume: () => void;
  onFullRerun: () => void;
  resuming: boolean;
  rerunning: boolean;
}

const REASON_TEXT: Record<string, string> = {
  ACTIVE_OWNER: 'Another process currently owns this evaluation.',
  ALREADY_COMPLETE: 'This evaluation already finished.',
  LEGACY_NO_CHECKPOINTS: 'This run predates exact checkpoints, so its old progress count cannot be reused.',
  EXECUTION_INPUT_MISMATCH: 'The evaluation inputs no longer match what was originally planned.',
  PLAN_HASH_MISMATCH: "The work plan no longer matches this run's recorded plan hash.",
  CHECKPOINT_CORRUPT: 'One or more saved results failed an integrity check.',
  CHECKPOINT_SCHEMA_UNSUPPORTED: 'One or more saved results use a schema version this build cannot read.',
  PROMPTFOO_SCHEMA_UNSUPPORTED: 'The evaluation engine result format has changed since this run started.',
  MODEL_ROUTE_UNAVAILABLE: "A model's server route is no longer available.",
  MODEL_CATALOG_UNAVAILABLE: 'The model catalog could not be reached to verify routes.',
  MODEL_ARTIFACT_MISMATCH: 'A model no longer matches the artifact used originally.',
  JUDGE_POLICY_MISMATCH: "This evaluation's judge selection no longer matches its original snapshot.",
  JUDGE_QUALIFICATION_STALE: "The judge is no longer qualified under this run's policy.",
  CAMPAIGN_MANAGED_RUN: 'This evaluation is managed by a campaign and cannot be resumed directly.',
  NO_UNFINISHED_WORK: 'No unfinished work remains for this evaluation.',
};

function reasonText(code: string): string {
  return REASON_TEXT[code] ?? code;
}

export function RecoveryPanel({ feedback, onResume, onFullRerun, resuming, rerunning }: RecoveryPanelProps) {
  const recovery = feedback.recovery;
  const resumeButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (confirmOpen) confirmButtonRef.current?.focus();
  }, [confirmOpen]);

  if (!recovery || recovery.state === 'not-needed') return null;
  const resumable = recovery.state === 'eligible' || recovery.state === 'finalization-only';

  function closeConfirm() {
    setConfirmOpen(false);
    resumeButtonRef.current?.focus();
  }
  function confirmResume() {
    setConfirmOpen(false);
    onResume();
  }
  function handleConfirmKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeConfirm();
  }

  return (
    <section className="recovery-panel" aria-labelledby="recovery-title">
      <div className="recovery-panel__heading">
        <AlertTriangle size={18} aria-hidden="true" />
        <h3 id="recovery-title">Evaluation recovery</h3>
      </div>
      <p>
        {recovery.reusedCells} cells are durably committed; {recovery.remainingCells} remain.
        {recovery.state === 'finalization-only' && ' Finalization can continue without model calls.'}
      </p>
      {recovery.reasonCode && (
        <p className="recovery-panel__reason">
          {reasonText(recovery.reasonCode)} <code>{recovery.reasonCode}</code>
        </p>
      )}
      {recovery.state === 'legacy-unrecoverable' && (
        <p>The old progress count is diagnostic only because this run has no exact cell checkpoints.</p>
      )}
      <div className="recovery-panel__actions">
        <button
          ref={resumeButtonRef}
          onClick={() => setConfirmOpen(true)}
          disabled={!resumable || resuming}
          aria-label="Resume this evaluation"
          aria-haspopup="dialog"
          aria-expanded={confirmOpen}
        >
          <Play size={15} /> {resuming ? 'Resuming…' : 'Resume'}
        </button>
        <button onClick={onFullRerun} disabled={rerunning} aria-label="Create a full rerun as a new evaluation">
          <RotateCcw size={15} /> {rerunning ? 'Starting…' : 'Full rerun'}
        </button>
      </div>
      <small>Resume keeps this evaluation and reuses checkpoints. Full rerun creates a new evaluation.</small>
      {confirmOpen && (
        <div
          className="recovery-panel__confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="recovery-confirm-title"
          aria-describedby="recovery-confirm-desc"
          onKeyDown={handleConfirmKeyDown}
        >
          <h4 id="recovery-confirm-title">Resume this evaluation?</h4>
          <p id="recovery-confirm-desc">
            {recovery.reusedCells} committed cells will be reused and {recovery.remainingCells} remain.
            Previously uncommitted in-flight work may run again.
          </p>
          <div className="recovery-panel__confirm-actions">
            <button type="button" onClick={closeConfirm}>Cancel</button>
            <button type="button" ref={confirmButtonRef} onClick={confirmResume}>Confirm resume</button>
          </div>
        </div>
      )}
    </section>
  );
}
