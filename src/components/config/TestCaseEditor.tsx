import { useState, useEffect } from 'react';
import { listTestSuites } from '../../api/eval';
import type { TestCase, TestSuite } from '../../types/eval';
import './TestCaseEditor.css';

interface TestCaseEditorProps {
  userMessage: string;
  onUserMessageChange: (msg: string) => void;
  testSuiteId: string | null;
  onTestSuiteChange: (id: string | null) => void;
  inlineTestCases: TestCase[];
  onInlineTestCasesChange: (cases: TestCase[]) => void;
}

function newCase(): TestCase {
  return { id: crypto.randomUUID(), userMessage: '', description: '' };
}

export function TestCaseEditor({
  userMessage, onUserMessageChange,
  testSuiteId, onTestSuiteChange,
  inlineTestCases, onInlineTestCasesChange,
}: TestCaseEditorProps) {
  const [mode, setMode] = useState<'quick' | 'suite'>('quick');
  const [suites, setSuites] = useState<TestSuite[]>([]);

  useEffect(() => {
    listTestSuites().then(setSuites).catch(() => {});
  }, []);

  function addRow() {
    onInlineTestCasesChange([...inlineTestCases, newCase()]);
  }

  function removeRow(id: string) {
    onInlineTestCasesChange(inlineTestCases.filter(c => c.id !== id));
  }

  function updateRow(id: string, field: keyof TestCase, value: string) {
    onInlineTestCasesChange(inlineTestCases.map(c => c.id === id ? { ...c, [field]: value } : c));
  }

  return (
    <div className="tce">
      <div className="tce-tabs">
        <button className={`tce-tab${mode === 'quick' ? ' tce-tab-active' : ''}`} onClick={() => setMode('quick')}>Quick</button>
        <button className={`tce-tab${mode === 'suite' ? ' tce-tab-active' : ''}`} onClick={() => setMode('suite')}>Suite</button>
      </div>

      {mode === 'quick' && (
        <div className="tce-quick">
          <textarea
            className="tce-textarea"
            value={userMessage}
            onChange={e => onUserMessageChange(e.target.value)}
            placeholder="Enter the user message to use for all test runs…"
            rows={3}
          />
        </div>
      )}

      {mode === 'suite' && (
        <div className="tce-suite">
          <div className="tce-suite-header">
            <select
              className="tce-suite-select"
              value={testSuiteId ?? ''}
              onChange={e => onTestSuiteChange(e.target.value || null)}
            >
              <option value="">Custom test cases</option>
              {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {!testSuiteId && (
            <>
              <table className="tce-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th>User Message</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {inlineTestCases.map((tc, idx) => (
                    <tr key={tc.id}>
                      <td className="tce-num">{idx + 1}</td>
                      <td>
                        <input
                          className="tce-input"
                          value={tc.description ?? ''}
                          onChange={e => updateRow(tc.id, 'description', e.target.value)}
                          placeholder="Description"
                        />
                      </td>
                      <td>
                        <input
                          className="tce-input"
                          value={tc.userMessage}
                          onChange={e => updateRow(tc.id, 'userMessage', e.target.value)}
                          placeholder="User message"
                        />
                      </td>
                      <td>
                        <button className="tce-remove" onClick={() => removeRow(tc.id)} title="Remove">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="tce-add-btn" onClick={addRow}>+ Add Test Case</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
