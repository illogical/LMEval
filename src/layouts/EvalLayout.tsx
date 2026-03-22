import { Outlet, Link, useLocation } from 'react-router-dom';
import { EvalWizardProvider } from '../contexts/EvalWizardContext';
import { EvalHeaderActionProvider, useEvalHeaderAction } from '../contexts/EvalHeaderActionContext';
import { EvalStepIndicator } from '../components/layout/EvalStepIndicator';
import './EvalLayout.css';

function EvalLayoutInner() {
  const location = useLocation();
  const { headerAction } = useEvalHeaderAction();

  function getActiveStep(): 1 | 2 | 3 | 4 | 5 {
    if (location.pathname.includes('/prompts')) return 1;
    if (location.pathname.includes('/config')) return 2;
    if (location.pathname.includes('/run/')) return 3;
    if (location.pathname.includes('/results/')) return 4;
    if (location.pathname.includes('/summary/')) return 5;
    return 1;
  }

  return (
    <div className="eval-layout">
      <header className="eval-header">
        <Link to="/" className="eval-logo">LMEval</Link>
        <nav className="eval-nav">
          <Link to="/compare" className={`eval-nav-link${location.pathname === '/compare' ? ' active' : ''}`}>Compare</Link>
          <Link to="/eval" className={`eval-nav-link${location.pathname.startsWith('/eval') ? ' active' : ''}`}>Eval</Link>
        </nav>
      </header>
      <EvalStepIndicator activeStep={getActiveStep()} rightSlot={headerAction} />
      <main className="eval-main">
        <Outlet />
      </main>
    </div>
  );
}

export function EvalLayout() {
  return (
    <EvalHeaderActionProvider>
      <EvalWizardProvider>
        <EvalLayoutInner />
      </EvalWizardProvider>
    </EvalHeaderActionProvider>
  );
}
