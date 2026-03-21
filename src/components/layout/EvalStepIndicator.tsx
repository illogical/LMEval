import { useNavigate } from 'react-router-dom';
import { useEvalWizard } from '../../contexts/EvalWizardContext';
import './EvalStepIndicator.css';

const STEPS = [
  { num: 1 as const, label: 'Prompts', path: '/eval/prompts' },
  { num: 2 as const, label: 'Config', path: '/eval/config' },
  { num: 3 as const, label: 'Run', path: null },
  { num: 4 as const, label: 'Results', path: null },
  { num: 5 as const, label: 'Summary', path: null },
];

interface EvalStepIndicatorProps {
  activeStep: 1 | 2 | 3 | 4 | 5;
}

export function EvalStepIndicator({ activeStep }: EvalStepIndicatorProps) {
  const navigate = useNavigate();
  const { state } = useEvalWizard();

  function handleStepClick(step: typeof STEPS[0]) {
    if (step.num > state.maxVisitedStep) return;
    if (step.num === 5) return; // Coming soon
    if (step.path) {
      navigate(step.path);
    } else if (step.num === 3 && state.evalId) {
      navigate(`/eval/run/${state.evalId}`);
    } else if (step.num === 4 && state.evalId) {
      navigate(`/eval/results/${state.evalId}`);
    }
  }

  return (
    <div className="step-indicator" role="navigation" aria-label="Evaluation steps">
      {STEPS.map((step, i) => {
        const isActive = step.num === activeStep;
        const isComplete = step.num < activeStep;
        const isClickable = step.num <= state.maxVisitedStep && step.num !== 5;
        const isSoon = step.num === 5;

        let className = 'step-item';
        if (isActive) className += ' step-active';
        else if (isComplete) className += ' step-complete';
        else className += ' step-pending';
        if (isClickable) className += ' step-clickable';
        if (isSoon) className += ' step-soon';

        return (
          <div key={step.num} className="step-wrapper">
            {i > 0 && <div className={`step-connector${isComplete ? ' connector-complete' : ''}`} />}
            <button
              className={className}
              onClick={() => handleStepClick(step)}
              disabled={!isClickable}
              title={isSoon ? 'Coming Soon' : step.label}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="step-num">
                {isComplete ? '✓' : step.num}
              </span>
              <span className="step-label">{step.label}</span>
              {isSoon && <span className="step-badge">Soon</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
