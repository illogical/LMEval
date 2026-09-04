import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  /** Shown in the fallback heading, e.g. "Results". Defaults to "this page". */
  label?: string;
  /** Remounts the boundary (clearing the error) whenever this value changes. */
  resetKey?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Wraps a wizard step so one panel crash renders an inline fallback instead of
 * unmounting the whole tree (which is what produced the blank Results page in
 * docs/fixes/2026-09-03-results-page-blank-crash.md).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? 'page', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <h2 className="eb-title">Something went wrong in {this.props.label ?? 'this page'}</h2>
        <p className="eb-message">{error.message || 'An unexpected error occurred.'}</p>
        <div className="eb-actions">
          <button className="eb-retry" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="eb-reload" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
        {error.stack && (
          <details className="eb-details">
            <summary>Technical details</summary>
            <pre className="eb-stack">{error.stack}</pre>
          </details>
        )}
      </div>
    );
  }
}
