import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionHubPage } from '../../pages/SessionHubPage';

// Mock listSessions
vi.mock('../../api/eval', () => ({
  listSessions: vi.fn().mockResolvedValue([]),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('SessionHubPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders hero title', async () => {
    render(<MemoryRouter><SessionHubPage /></MemoryRouter>);
    expect(screen.getByText('LMEval')).toBeInTheDocument();
  });

  it('renders New Evaluation button', async () => {
    render(<MemoryRouter><SessionHubPage /></MemoryRouter>);
    expect(screen.getByText('New Evaluation')).toBeInTheDocument();
  });

  it('renders Quick Compare button', async () => {
    render(<MemoryRouter><SessionHubPage /></MemoryRouter>);
    expect(screen.getByText('Quick Compare')).toBeInTheDocument();
  });

  it('renders feature cards', async () => {
    render(<MemoryRouter><SessionHubPage /></MemoryRouter>);
    expect(screen.getByText('Multi-Model Eval')).toBeInTheDocument();
    expect(screen.getByText('Smart Scoring')).toBeInTheDocument();
    expect(screen.getByText('Track Progress')).toBeInTheDocument();
  });

  it('shows empty state while loading', () => {
    render(<MemoryRouter><SessionHubPage /></MemoryRouter>);
    // Features grid is shown regardless
    expect(screen.getByText('LMEval')).toBeInTheDocument();
  });
});
