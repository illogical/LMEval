import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PromptVersionSelector } from '../../components/prompt/PromptVersionSelector';
import { listPrompts, getPromptContent } from '../../api/eval';

vi.mock('../../api/eval', () => ({
  listPrompts: vi.fn(),
  getPromptContent: vi.fn(),
}));

const mockManifest = {
  id: 'prm_1',
  slug: 'test-prompt',
  name: 'Test Prompt',
  versions: [
    { version: 1, createdAt: '2024-01-01T00:00:00Z', tokensEstimate: 10 },
    { version: 2, createdAt: '2024-01-02T00:00:00Z', tokensEstimate: 12 },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

describe('PromptVersionSelector', () => {
  beforeEach(() => {
    vi.mocked(listPrompts).mockResolvedValue([mockManifest]);
    vi.mocked(getPromptContent).mockResolvedValue({ content: 'loaded prompt content' });
  });

  it('renders Load button disabled when no prompt is selected', () => {
    render(<PromptVersionSelector onLoad={vi.fn()} />);
    expect(screen.getByRole('button', { name: /load/i })).toBeDisabled();
  });

  it('shows prompts in dropdown after loading', async () => {
    render(<PromptVersionSelector onLoad={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Test Prompt' })).toBeInTheDocument();
    });
  });

  it('enables Load button after a prompt is selected', async () => {
    render(<PromptVersionSelector onLoad={vi.fn()} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    expect(screen.getByRole('button', { name: /load/i })).not.toBeDisabled();
  });

  it('shows version selector after a prompt is selected', async () => {
    render(<PromptVersionSelector onLoad={vi.fn()} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    expect(screen.getByLabelText('Select version')).toBeInTheDocument();
  });

  it('calls onLoad with manifest, content, and latest version when Load is clicked', async () => {
    const onLoad = vi.fn();
    render(<PromptVersionSelector onLoad={onLoad} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledWith(mockManifest, 'loaded prompt content', 2);
    });
    expect(vi.mocked(getPromptContent)).toHaveBeenCalledWith('prm_1', 2);
  });

  it('calls onLoad with selected version when user changes version', async () => {
    const onLoad = vi.fn();
    render(<PromptVersionSelector onLoad={onLoad} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    fireEvent.change(screen.getByLabelText('Select version'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => {
      expect(vi.mocked(getPromptContent)).toHaveBeenCalledWith('prm_1', 1);
    });
  });

  it('shows error message when getPromptContent fails', async () => {
    vi.mocked(getPromptContent).mockRejectedValue(new Error('Server error'));
    render(<PromptVersionSelector onLoad={vi.fn()} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('does not call onLoad when getPromptContent fails', async () => {
    vi.mocked(getPromptContent).mockRejectedValue(new Error('Server error'));
    const onLoad = vi.fn();
    render(<PromptVersionSelector onLoad={onLoad} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => screen.getByText('Server error'));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('shows success indicator briefly after successful load', async () => {
    render(<PromptVersionSelector onLoad={vi.fn()} />);
    await waitFor(() => screen.getByRole('option', { name: 'Test Prompt' }));

    fireEvent.change(screen.getByLabelText('Select prompt'), { target: { value: 'prm_1' } });
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /loaded/i })).toBeInTheDocument();
    });
  });
});
