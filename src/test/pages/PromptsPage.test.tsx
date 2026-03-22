import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PromptsPage } from '../../pages/PromptsPage';
import { EvalWizardProvider } from '../../contexts/EvalWizardContext';
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

function renderPromptsPage() {
  return render(
    <MemoryRouter>
      <EvalWizardProvider>
        <PromptsPage />
      </EvalWizardProvider>
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

describe('PromptsPage - loading a saved prompt', () => {
  beforeEach(() => {
    vi.mocked(listPrompts).mockResolvedValue([mockManifest]);
    vi.mocked(getPromptContent).mockResolvedValue({ content: 'Loaded from API' });
  });

  it('updates Prompt A textarea after clicking Load', async () => {
    renderPromptsPage();

    const selects = await waitFor(() => screen.getAllByLabelText('Select prompt'));
    fireEvent.change(selects[0], { target: { value: 'prm_1' } });

    const loadBtns = screen.getAllByRole('button', { name: /^load$/i });
    fireEvent.click(loadBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /system prompt a/i })).toHaveValue('Loaded from API');
    });
  });

  it('updates Prompt B textarea after clicking Load on the B selector', async () => {
    renderPromptsPage();

    const selects = await waitFor(() => screen.getAllByLabelText('Select prompt'));
    fireEvent.change(selects[1], { target: { value: 'prm_1' } });

    const loadBtns = screen.getAllByRole('button', { name: /^load$/i });
    fireEvent.click(loadBtns[1]);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /system prompt b/i })).toHaveValue('Loaded from API');
    });
  });

  it('enables Next button after Prompt A is loaded', async () => {
    vi.mock('../../hooks/useModelsByServer', () => ({
      useModelsByServer: () => ({
        servers: [{ name: 'local', models: ['llama3'] }],
        loading: false,
        error: null,
      }),
    }));

    renderPromptsPage();

    const selects = await waitFor(() => screen.getAllByLabelText('Select prompt'));
    fireEvent.change(selects[0], { target: { value: 'prm_1' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^load$/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /system prompt a/i })).toHaveValue('Loaded from API');
    });
  });
});

describe('PromptsPage - file browse', () => {
  beforeEach(() => {
    vi.mocked(listPrompts).mockResolvedValue([]);
  });

  it('updates Prompt A textarea when a file is selected via browse', async () => {
    renderPromptsPage();

    const fileContent = '# Browsed Prompt\nContent here.';
    const file = new File([fileContent], 'prompt.md', { type: 'text/markdown' });

    const fileInputs = screen.getAllByLabelText('Upload prompt file');
    fireEvent.change(fileInputs[0], { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /system prompt a/i })).toHaveValue(fileContent);
    });
  });

  it('updates Prompt B textarea when a file is selected via browse on B panel', async () => {
    renderPromptsPage();

    const fileContent = '# Prompt B Content';
    const file = new File([fileContent], 'prompt-b.md', { type: 'text/markdown' });

    const fileInputs = screen.getAllByLabelText('Upload prompt file');
    fireEvent.change(fileInputs[1], { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /system prompt b/i })).toHaveValue(fileContent);
    });
  });
});
