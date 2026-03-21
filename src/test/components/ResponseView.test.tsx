import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResponseView } from '../../components/prompt/ResponseView';

describe('ResponseView', () => {
  it('shows idle hint when status is idle', () => {
    render(<ResponseView content={null} status="idle" />);
    expect(screen.getByText(/response will appear here/i)).toBeInTheDocument();
  });

  it('shows skeleton lines when loading', () => {
    const { container } = render(<ResponseView content={null} status="loading" />);
    const skeletons = container.querySelectorAll('.skeleton-line');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error message on error status', () => {
    render(<ResponseView content={null} status="error" error="Something went wrong" />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders highlighted content when done', () => {
    const { container } = render(<ResponseView content='{"key": "value"}' status="done" />);
    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();
    const code = container.querySelector('code.hljs');
    expect(code).toBeInTheDocument();
  });
});
