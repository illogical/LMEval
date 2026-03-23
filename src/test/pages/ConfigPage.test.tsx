import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigPage } from '../../pages/ConfigPage';
import { EvalWizardProvider } from '../../contexts/EvalWizardContext';
import { EvalHeaderActionProvider, useEvalHeaderAction } from '../../contexts/EvalHeaderActionContext';

vi.mock('../../api/eval', () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  listTestSuites: vi.fn().mockResolvedValue([]),
  listModels: vi.fn().mockResolvedValue({ servers: [] }),
  listPresets: vi.fn().mockResolvedValue([]),
  createEvaluation: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function HeaderSlot() {
  const { headerAction } = useEvalHeaderAction();
  return <>{headerAction}</>;
}

function renderConfigPage() {
  return render(
    <MemoryRouter>
      <EvalWizardProvider>
        <EvalHeaderActionProvider>
          <HeaderSlot />
          <ConfigPage />
        </EvalHeaderActionProvider>
      </EvalWizardProvider>
    </MemoryRouter>
  );
}

describe('ConfigPage', () => {
  it('renders template selector', () => {
    renderConfigPage();
    expect(screen.getByText('Evaluation Template')).toBeInTheDocument();
  });

  it('renders test cases section', () => {
    renderConfigPage();
    expect(screen.getByText('Test Cases')).toBeInTheDocument();
  });

  it('renders judge configuration', () => {
    renderConfigPage();
    expect(screen.getByText('Judge Configuration')).toBeInTheDocument();
  });

  it('renders run evaluation button', () => {
    renderConfigPage();
    expect(screen.getByText('Run Evaluation')).toBeInTheDocument();
  });

  it('renders execution preview', () => {
    renderConfigPage();
    expect(screen.getByLabelText('Execution preview')).toBeInTheDocument();
  });
});
