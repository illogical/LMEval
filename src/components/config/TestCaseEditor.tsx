import { useState, useEffect, useRef } from 'react';
import { listTestSuites, createTestSuite } from '../../api/eval';
import type { TestCase, TestSuite } from '../../types/eval';
import {
  autoDetect, serializeCSV, serializeJSON,
  downloadFile, todayString, CSV_TEMPLATE,
} from '../../utils/testCaseIO';
import './TestCaseEditor.css';

interface TestCaseEditorProps {
  userMessage: string;
  onUserMessageChange: (msg: string) => void;
  testSuiteId: string | null;
  onTestSuiteChange: (id: string | null) => void;
  inlineTestCases: TestCase[];
  onInlineTestCasesChange: (cases: TestCase[]) => void;
}

type ImportStatus =
  | { type: 'idle' }
  | { type: 'loading'; label: string }
  | { type: 'confirm'; incoming: Omit<TestCase, 'id'>[]; existingCount: number }
  | { type: 'success'; count: number }
  | { type: 'error'; message: string };

function newCase(): TestCase {
  return { id: crypto.randomUUID(), userMessage: '', description: '' };
}

function assignIds(cases: Omit<TestCase, 'id'>[]): TestCase[] {
  return cases.map(c => ({ ...c, id: crypto.randomUUID() }));
}

export function TestCaseEditor({
  userMessage, onUserMessageChange,
  testSuiteId, onTestSuiteChange,
  inlineTestCases, onInlineTestCasesChange,
}: TestCaseEditorProps) {
  const [mode, setMode] = useState<'quick' | 'suite'>('quick');
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [importStatus, setImportStatus] = useState<ImportStatus>({ type: 'idle' });
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [saveInput, setSaveInput] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listTestSuites().then(setSuites).catch(() => {});
  }, []);

  // Auto-dismiss success banner
  useEffect(() => {
    if (importStatus.type === 'success') {
      const t = setTimeout(() => setImportStatus({ type: 'idle' }), 3000);
      return () => clearTimeout(t);
    }
  }, [importStatus]);

  // Close dropdowns on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // ── Row operations ────────────────────────────────────────────────────

  function addRow() {
    onInlineTestCasesChange([...inlineTestCases, newCase()]);
  }

  function removeRow(id: string) {
    onInlineTestCasesChange(inlineTestCases.filter(c => c.id !== id));
  }

  function updateRow(id: string, field: keyof TestCase, value: string) {
    onInlineTestCasesChange(inlineTestCases.map(c => {
      if (c.id !== id) return c;
      if (field === 'tags') {
        return { ...c, tags: value.split(',').map(t => t.trim()).filter(Boolean) };
      }
      return { ...c, [field]: value };
    }));
  }

  // ── Import flow ───────────────────────────────────────────────────────

  async function processText(text: string, filename: string) {
    setImportStatus({ type: 'loading', label: 'Parsing…' });
    setShowImportMenu(false);
    await new Promise(r => setTimeout(r, 0)); // yield to render spinner

    const result = autoDetect(text, filename);
    if (result.errors.length > 0) {
      setImportStatus({ type: 'error', message: result.errors[0] });
      return;
    }
    if (result.cases.length === 0) {
      setImportStatus({ type: 'error', message: 'No valid test cases found in file.' });
      return;
    }

    if (inlineTestCases.length === 0) {
      onInlineTestCasesChange(assignIds(result.cases));
      setImportStatus({ type: 'success', count: result.cases.length });
    } else {
      setImportStatus({ type: 'confirm', incoming: result.cases, existingCount: inlineTestCases.length });
    }
  }

  async function handleFileSelected(file: File) {
    setImportStatus({ type: 'loading', label: 'Reading…' });
    const text = await file.text();
    await processText(text, file.name);
  }

  async function handleClipboardPaste() {
    setShowImportMenu(false);
    try {
      const text = await navigator.clipboard.readText();
      await processText(text, '_.csv'); // try CSV first (no extension hint)
    } catch {
      setImportStatus({ type: 'error', message: 'Could not read clipboard. Make sure the browser has clipboard permission.' });
    }
  }

  function confirmReplace(incoming: Omit<TestCase, 'id'>[]) {
    onInlineTestCasesChange(assignIds(incoming));
    setImportStatus({ type: 'success', count: incoming.length });
  }

  function confirmAppend(incoming: Omit<TestCase, 'id'>[]) {
    onInlineTestCasesChange([...inlineTestCases, ...assignIds(incoming)]);
    setImportStatus({ type: 'success', count: incoming.length });
  }

  // ── Export ────────────────────────────────────────────────────────────

  function exportAs(format: 'csv' | 'json') {
    setShowExportMenu(false);
    const date = todayString();
    if (format === 'csv') {
      downloadFile(serializeCSV(inlineTestCases), `test-cases-${date}.csv`, 'text/csv');
    } else {
      downloadFile(serializeJSON(inlineTestCases), `test-cases-${date}.json`, 'application/json');
    }
  }

  // ── Save as Suite ─────────────────────────────────────────────────────

  async function handleSaveAsSuite() {
    if (!saveInput.trim()) return;
    setSaving(true);
    try {
      const suite = await createTestSuite({
        name: saveInput.trim(),
        testCases: inlineTestCases.map(({ id: _id, ...rest }) => rest),
      });
      const updated = await listTestSuites();
      setSuites(updated);
      onTestSuiteChange(suite.id);
      setShowSaveInput(false);
      setSaveInput('');
    } catch {
      // keep form open on error
    } finally {
      setSaving(false);
    }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function onDragLeave() {
    setIsDragOver(false);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFileSelected(file);
  }

  // ── Derived ───────────────────────────────────────────────────────────

  const hasInlineCases = inlineTestCases.length > 0;
  const hasTags = inlineTestCases.some(tc => tc.tags && tc.tags.length > 0);
  const isLoading = importStatus.type === 'loading';

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
        <div
          className={`tce-suite${isDragOver ? ' tce-drag-over' : ''}`}
          onDragOver={!testSuiteId ? onDragOver : undefined}
          onDragLeave={!testSuiteId ? onDragLeave : undefined}
          onDrop={!testSuiteId ? onDrop : undefined}
        >
          {isDragOver && (
            <div className="tce-drop-overlay">
              <span>Drop to import test cases</span>
            </div>
          )}

          {/* ── Toolbar ── */}
          <div className="tce-toolbar">
            <select
              className="tce-suite-select"
              value={testSuiteId ?? ''}
              onChange={e => onTestSuiteChange(e.target.value || null)}
            >
              <option value="">Custom test cases</option>
              {suites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            {!testSuiteId && (
              <div className="tce-toolbar-actions">
                {/* Import */}
                <div className="tce-menu-wrap" ref={importMenuRef}>
                  <button
                    className="tce-btn"
                    disabled={isLoading}
                    onClick={() => setShowImportMenu(v => !v)}
                  >
                    {isLoading
                      ? <><span className="tce-spinner" /> {(importStatus as { type: 'loading'; label: string }).label}</>
                      : '↓ Import'
                    }
                  </button>
                  {showImportMenu && (
                    <div className="tce-menu">
                      <button className="tce-menu-item" onClick={() => { setShowImportMenu(false); fileInputRef.current?.click(); }}>From file…</button>
                      <button className="tce-menu-item" onClick={handleClipboardPaste}>Paste from clipboard</button>
                      <div className="tce-menu-divider" />
                      <button className="tce-menu-item" onClick={() => { setShowImportMenu(false); downloadFile(CSV_TEMPLATE, 'test-cases-template.csv', 'text/csv'); }}>Download CSV template</button>
                    </div>
                  )}
                </div>

                {/* Export */}
                <div className="tce-menu-wrap" ref={exportMenuRef}>
                  <button
                    className="tce-btn"
                    disabled={!hasInlineCases}
                    onClick={() => setShowExportMenu(v => !v)}
                  >
                    ↑ Export
                  </button>
                  {showExportMenu && (
                    <div className="tce-menu">
                      <button className="tce-menu-item" onClick={() => exportAs('json')}>Download as JSON</button>
                      <button className="tce-menu-item" onClick={() => exportAs('csv')}>Download as CSV</button>
                    </div>
                  )}
                </div>

                {/* Save as Suite */}
                {hasInlineCases && !showSaveInput && (
                  <button className="tce-btn tce-btn-save" onClick={() => setShowSaveInput(true)}>
                    Save as Suite…
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Save as Suite inline input ── */}
          {showSaveInput && (
            <div className="tce-save-strip">
              <span className="tce-save-label">Suite name:</span>
              <input
                className="tce-save-input"
                value={saveInput}
                onChange={e => setSaveInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveAsSuite(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveInput(''); } }}
                placeholder="My test suite"
                autoFocus
              />
              <button className="tce-btn" disabled={saving || !saveInput.trim()} onClick={handleSaveAsSuite}>
                {saving ? <span className="tce-spinner" /> : 'Save'}
              </button>
              <button className="tce-btn tce-btn-ghost" onClick={() => { setShowSaveInput(false); setSaveInput(''); }}>Cancel</button>
            </div>
          )}

          {/* ── Status banners ── */}
          {importStatus.type === 'error' && (
            <div className="tce-banner tce-banner-error">
              <span>⚠ {importStatus.message}</span>
              <button className="tce-banner-dismiss" onClick={() => setImportStatus({ type: 'idle' })}>×</button>
            </div>
          )}
          {importStatus.type === 'success' && (
            <div className="tce-banner tce-banner-success">
              ✓ {importStatus.count} {importStatus.count === 1 ? 'case' : 'cases'} imported
            </div>
          )}
          {importStatus.type === 'confirm' && (
            <div className="tce-confirm-strip">
              <span>
                {importStatus.incoming.length} {importStatus.incoming.length === 1 ? 'case' : 'cases'} found.&nbsp;
                {importStatus.existingCount} already in table.
              </span>
              <div className="tce-confirm-actions">
                <button className="tce-btn" onClick={() => confirmReplace(importStatus.incoming)}>Replace all</button>
                <button className="tce-btn" onClick={() => confirmAppend(importStatus.incoming)}>Append</button>
                <button className="tce-btn tce-btn-ghost" onClick={() => setImportStatus({ type: 'idle' })}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── Inline test case table ── */}
          {!testSuiteId && (
            <>
              <table className="tce-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th>User Message</th>
                    {hasTags && <th>Tags</th>}
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
                      {hasTags && (
                        <td>
                          <input
                            className="tce-input"
                            value={tc.tags?.join(', ') ?? ''}
                            onChange={e => updateRow(tc.id, 'tags', e.target.value)}
                            placeholder="tag1, tag2"
                          />
                        </td>
                      )}
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

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
