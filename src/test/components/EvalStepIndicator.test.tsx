import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EvalStepIndicator } from '../../components/layout/EvalStepIndicator';
import { EvalWizardProvider } from '../../contexts/EvalWizardContext';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderStepIndicator(activeStep: 1 | 2 | 3 | 4 | 5) {
  return render(
    <MemoryRouter>
      <EvalWizardProvider>
        <EvalStepIndicator activeStep={activeStep} />
      </EvalWizardProvider>
    </MemoryRouter>
  );
}

describe('EvalStepIndicator', () => {
  it('renders all 5 steps', () => {
    renderStepIndicator(1);
    expect(screen.getByText('Prompts')).toBeInTheDocument();
    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('marks active step with aria-current=step', () => {
    renderStepIndicator(2);
    const configBtn = screen.getByRole('button', { name: /config/i });
    expect(configBtn).toHaveAttribute('aria-current', 'step');
  });

  it('marks step 1 active when activeStep=1', () => {
    renderStepIndicator(1);
    const promptsBtn = screen.getByRole('button', { name: /prompts/i });
    expect(promptsBtn).toHaveClass('step-active');
  });

  it('shows Soon badge on step 5', () => {
    renderStepIndicator(1);
    expect(screen.getByText('Soon')).toBeInTheDocument();
  });
});
