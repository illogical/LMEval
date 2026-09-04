import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ErrorBoundary } from '../../components/common/ErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('cells is not defined');
  return <p>panel content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary label="Results">
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });

  it('renders a labeled fallback instead of unmounting when a child throws', () => {
    render(
      <ErrorBoundary label="Results">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong in Results/)).toBeInTheDocument();
    expect(screen.getByText('cells is not defined')).toBeInTheDocument();
  });

  it('clears the error when "Try again" is clicked and the child recovers', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button onClick={() => setBroken(false)}>fix</button>
          <ErrorBoundary label="Results">
            <Boom shouldThrow={broken} />
          </ErrorBoundary>
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByText('fix'));
    await user.click(screen.getByText('Try again'));

    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resets when resetKey changes (e.g. navigating to another step)', () => {
    const { rerender } = render(
      <ErrorBoundary label="Results" resetKey="/eval/results/1">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary label="Prepare" resetKey="/eval/config">
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });
});
