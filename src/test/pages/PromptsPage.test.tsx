import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PromptsPage } from '../../pages/PromptsPage';
import { EvalWizardProvider } from '../../contexts/EvalWizardContext';

// Mock API and hooks
vi.mock('../../api/eval', () => ({
  listPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../hooks/useModelsByServer', () => ({
  useModelsByServer: () => ({ servers: [], loading: false, error: null }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPromptsPage() {
  return render(
    <MemoryRouter>
      <EvalWizardProvider>
        <PromptsPage />
      </EvalWizardProvider>
    </MemoryRouter>
  );
}

describe('PromptsPage', () => {
  it('renders Prompt A and B columns', () => {
    renderPromptsPage();
    expect(screen.getAllByText(/Prompt A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Prompt B/).length).toBeGreaterThan(0);
  });

  it('renders Models section', () => {
    renderPromptsPage();
    expect(screen.getByText('Models')).toBeInTheDocument();
  });

  it('renders Next button (disabled without content)', () => {
    renderPromptsPage();
    const btn = screen.getByText('Next: Configure Evaluation');
    expect(btn).toBeInTheDocument();
    expect(btn.closest('button')).toBeDisabled();
  });
});
