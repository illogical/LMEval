import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PromptsPage } from '../../pages/PromptsPage';
import { EvalWizardProvider } from '../../contexts/EvalWizardContext';
import { EvalHeaderActionProvider, useEvalHeaderAction } from '../../contexts/EvalHeaderActionContext';
import { listPrompts, getPromptContent } from '../../api/eval';

// Mock API and hooks
vi.mock('../../api/eval', () => ({
  listPrompts: vi.fn().mockResolvedValue([]),
  getPromptContent: vi.fn().mockResolvedValue({ content: '' }),
}));

vi.mock('../../hooks/useModelsByServer', () => ({
  useModelsByServer: () => ({ servers: [], loading: false, error: null }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Consumer that renders the header action into the DOM so Next button is accessible
function HeaderSlot() {
  const { headerAction } = useEvalHeaderAction();
  return <div data-testid="header-slot">{headerAction}</div>;
}

function renderPromptsPage() {
  return render(
    <MemoryRouter>
      <EvalHeaderActionProvider>
        <EvalWizardProvider>
          <PromptsPage />
          <HeaderSlot />
        </EvalWizardProvider>
      </EvalHeaderActionProvider>
    </MemoryRouter>
  );
}

const mockManifest = {
  id: 'prm_1',
  slug: 'test-prompt',
  name: 'Test Prompt',
  versions: [{ version: 1, createdAt: '2024-01-01T00:00:00Z', tokensEstimate: 5 }],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('PromptsPage', () => {
  beforeEach(() => {
    vi.mocked(listPrompts).mockResolvedValue([]);
    vi.mocked(getPromptContent).mockResolvedValue({ content: '' });
  });

  it('renders Prompt A and B labels', () => {
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
    const btn = screen.getByText('Next: Prepare');
    expect(btn).toBeInTheDocument();
    expect(btn.closest('button')).toBeDisabled();
  });
});

describe('PromptsPage - loading a saved prompt', () => {
  beforeEach(() => {
    vi.mocked(listPrompts).mockResolvedValue([mockManifest]);
    vi.mocked(getPromptContent).mockResolvedValue({ content: 'Loaded from API' });
  });

  it('shows Prompt A content in diff after clicking Load', async () => {
    renderPromptsPage();

    // Open load controls first (hidden by default)
    fireEvent.click(screen.getByTitle(/load a prompt file/i));

    const selects = await waitFor(() => screen.getAllByLabelText('Select prompt'));
    fireEvent.change(selects[0], { target: { value: 'prm_1' } });

    const loadBtns = screen.getAllByRole('button', { name: /^load$/i });
    fireEvent.click(loadBtns[0]);

    await waitFor(() => {
      expect(screen.queryAllByText(/Loaded from API/).length).toBeGreaterThan(0);
    });
  });

  it('shows Prompt B content in diff after clicking Load on the B selector', async () => {
    renderPromptsPage();

    fireEvent.click(screen.getByTitle(/load a prompt file/i));

    const selects = await waitFor(() => screen.getAllByLabelText('Select prompt'));
    fireEvent.change(selects[1], { target: { value: 'prm_1' } });

    const loadBtns = screen.getAllByRole('button', { name: /^load$/i });
    fireEvent.click(loadBtns[1]);

    await waitFor(() => {
      expect(screen.queryAllByText(/Loaded from API/).length).toBeGreaterThan(0);
    });
  });

  it('loads Prompt A content into the diff view', async () => {
    renderPromptsPage();

    fireEvent.click(screen.getByTitle(/load a prompt file/i));

    const selects = await waitFor(() => screen.getAllByLabelText('Select prompt'));
    fireEvent.change(selects[0], { target: { value: 'prm_1' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^load$/i })[0]);

    await waitFor(() => {
      expect(screen.queryAllByText(/Loaded from API/).length).toBeGreaterThan(0);
    });
  });
});

describe('PromptsPage - file browse', () => {
  beforeEach(() => {
    vi.mocked(listPrompts).mockResolvedValue([]);
  });

  it('shows Prompt A content in diff when a file is selected via browse', async () => {
    renderPromptsPage();

    const fileContent = '# Browsed Prompt';
    const file = new File([fileContent], 'prompt.md', { type: 'text/markdown' });

    const fileInputs = screen.getAllByLabelText(/Upload prompt .* file/i);
    fireEvent.change(fileInputs[0], { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.queryAllByText(/Browsed Prompt/).length).toBeGreaterThan(0);
    });
  });

  it('shows Prompt B content in diff when a file is selected via browse on B panel', async () => {
    renderPromptsPage();

    const fileContent = 'Prompt B Content';
    const file = new File([fileContent], 'prompt-b.md', { type: 'text/markdown' });

    const fileInputs = screen.getAllByLabelText(/Upload prompt .* file/i);
    fireEvent.change(fileInputs[1], { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.queryAllByText(/Prompt B Content/).length).toBeGreaterThan(0);
    });
  });
});
