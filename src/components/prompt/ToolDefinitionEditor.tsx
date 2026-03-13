import { useState } from 'react';
import type { ToolDefinition } from '../../types/eval';

interface ToolDefinitionEditorProps {
  tools: ToolDefinition[];
  onChange: (tools: ToolDefinition[]) => void;
}

export function ToolDefinitionEditor({ tools, onChange }: ToolDefinitionEditorProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(tools, null, 2));
  const [errors, setErrors] = useState<string[]>([]);

  const validate = () => {
    setErrors([]);
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setErrors(['Must be a JSON array of tool definitions']);
        return;
      }
      const errs: string[] = [];
      parsed.forEach((t: unknown, i: number) => {
        if (typeof t !== 'object' || t === null) { errs.push(`Item ${i}: not an object`); return; }
        const tool = t as Record<string, unknown>;
        if (tool.type !== 'function') errs.push(`Item ${i}: type must be "function"`);
        if (!tool.function || typeof tool.function !== 'object') errs.push(`Item ${i}: missing function definition`);
      });
      if (errs.length > 0) {
        setErrors(errs);
      } else {
        onChange(parsed as ToolDefinition[]);
        setErrors([]);
      }
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };

  return (
    <div className="border-t" style={{ borderColor: 'var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs transition-colors"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}
        aria-expanded={open}
        aria-label="Toggle tool definitions"
      >
        <span className="font-medium">Tool Definitions {tools.length > 0 && `(${tools.length})`}</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-3 flex flex-col gap-2" style={{ background: 'var(--bg-base)' }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            className="w-full text-xs font-mono rounded border p-2 resize-y focus:outline-none"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: errors.length ? 'var(--error)' : 'var(--border)',
              color: 'var(--text-primary)',
            }}
            placeholder='[{"type": "function", "function": {"name": "...", "description": "...", "parameters": {}}}]'
            spellCheck={false}
            aria-label="Tool definitions JSON"
          />
          {errors.length > 0 && (
            <div className="text-xs rounded p-2" style={{ background: '#4c0519', color: 'var(--error)' }}>
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          <button
            onClick={validate}
            className="self-start px-3 py-1.5 text-xs rounded font-medium transition-colors"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            aria-label="Validate tool definitions"
          >
            Validate & Apply
          </button>
        </div>
      )}
    </div>
  );
}
