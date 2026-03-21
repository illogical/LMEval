import hljs from '../../lib/highlight';

interface ResponseViewProps {
  content: string | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
}

export function ResponseView({ content, status, error }: ResponseViewProps) {
  if (status === 'idle') {
    return (
      <div className="response-view">
        <span className="response-hint">Response will appear here…</span>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="response-view">
        <div className="skeleton-line" style={{ width: '90%' }} />
        <div className="skeleton-line" style={{ width: '75%' }} />
        <div className="skeleton-line" style={{ width: '85%' }} />
        <div className="skeleton-line" style={{ width: '60%' }} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="response-view">
        <span className="response-error">⚠ {error ?? 'An error occurred'}</span>
      </div>
    );
  }

  const highlighted = hljs.highlightAuto(content ?? '', ['markdown', 'json', 'xml', 'yaml']).value;

  return (
    <div className="response-view">
      <pre>
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
