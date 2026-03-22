import { useMemo, useState } from 'react';
import { diffLines, diffWords } from 'diff';
import hljs from '../../lib/highlight';
import './PromptDiffView.css';

interface PromptDiffViewProps {
  contentA: string;
  contentB: string;
  editableB?: boolean;
  draftB?: string;
  onChangeB?: (value: string) => void;
}

function highlightLines(content: string): string[] {
  if (!content) return [];
  return content.split('\n').map(line =>
    line.trim() ? hljs.highlight(line, { language: 'markdown' }).value : line
  );
}

export function PromptDiffView({ contentA, contentB, editableB, draftB, onChangeB }: PromptDiffViewProps) {
  const lines = useMemo(() => diffLines(contentA, contentB), [contentA, contentB]);
  const hlA = useMemo(() => highlightLines(contentA), [contentA]);
  const hlB = useMemo(() => highlightLines(contentB), [contentB]);
  const [isEditing, setIsEditing] = useState(false);

  if (!contentA && !contentB) {
    return (
      <div className="diff-empty">
        Load prompts above to see the diff
      </div>
    );
  }

  return (
    <div className="diff-view" aria-label="Diff view">
      <div className="diff-header">
        <span className="diff-col-label diff-a-label">Prompt A</span>
        <span className="diff-gutter" />
        <span className="diff-col-label diff-b-label">
          Prompt B
          {editableB && (
            <button
              className={`diff-edit-toggle${isEditing ? ' diff-edit-toggle--active' : ''}`}
              onClick={() => setIsEditing(prev => !prev)}
              aria-pressed={isEditing}
            >
              {isEditing ? 'Done' : 'Edit'}
            </button>
          )}
        </span>
      </div>

      {editableB && isEditing ? (
        // Edit mode: left shows A with diff colors, right is an editable textarea
        <div className="diff-edit-layout">
          <div className="diff-a-panel">
            {buildEditLeftColumn(lines, hlA)}
          </div>
          <div className="diff-gutter-panel" />
          <textarea
            className="diff-b-editor"
            value={draftB ?? ''}
            onChange={e => onChangeB?.(e.target.value)}
            spellCheck={false}
            aria-label="Edit Prompt B"
          />
        </div>
      ) : (
        // Compare mode: full side-by-side diff
        <div className="diff-body">
          {buildDiffRows(lines, hlA, hlB)}
        </div>
      )}
    </div>
  );
}

// Renders only A's lines with appropriate diff coloring for edit mode.
// Unchanged lines = normal; lines removed from A (not in B) = red.
// Added lines (only in B) are skipped — they're visible in the textarea.
function buildEditLeftColumn(
  changes: ReturnType<typeof diffLines>,
  hlA: string[],
) {
  const rows: React.ReactNode[] = [];
  let lineA = 1;

  for (const part of changes) {
    if (part.added) continue; // only in B, not shown in A column

    const className = part.removed ? 'diff-cell diff-removed' : 'diff-cell diff-unchanged';
    for (const line of splitLines(part.value)) {
      const hlLine = hlA[lineA - 1] ?? line;
      rows.push(
        <div key={`a-${lineA}`} className={className}>
          <span className="diff-ln">{lineA++}</span>
          <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLine }} />
        </div>
      );
    }
  }

  return rows;
}

function buildDiffRows(
  changes: ReturnType<typeof diffLines>,
  hlA: string[],
  hlB: string[],
) {
  const rows: React.ReactNode[] = [];
  let i = 0;
  let lineA = 1;
  let lineB = 1;

  while (i < changes.length) {
    const part = changes[i];

    if (!part.added && !part.removed) {
      // unchanged
      const partLines = (part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value).split('\n');
      for (const line of partLines) {
        const hlLineA = hlA[lineA - 1] ?? line;
        const hlLineB = hlB[lineB - 1] ?? line;
        rows.push(
          <div key={`u-${lineA}-${lineB}`} className="diff-row">
            <div className="diff-cell diff-unchanged">
              <span className="diff-ln">{lineA++}</span>
              <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLineA }} />
            </div>
            <div className="diff-gutter-cell" />
            <div className="diff-cell diff-unchanged">
              <span className="diff-ln">{lineB++}</span>
              <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLineB }} />
            </div>
          </div>
        );
      }
      i++;
    } else if (part.removed) {
      // Look ahead for a corresponding added part
      const nextPart = changes[i + 1];
      if (nextPart?.added) {
        // Changed: show word-level diff (no hljs here — marks provide visual distinction)
        const removedLines = splitLines(part.value);
        const addedLines = splitLines(nextPart.value);
        const maxLen = Math.max(removedLines.length, addedLines.length);

        for (let j = 0; j < maxLen; j++) {
          const remLine = removedLines[j] ?? '';
          const addLine = addedLines[j] ?? '';

          if (remLine && addLine) {
            const wordDiff = diffWords(remLine, addLine);
            rows.push(
              <div key={`c-${lineA}-${lineB}-${j}`} className="diff-row">
                <div className="diff-cell diff-removed">
                  <span className="diff-ln">{lineA++}</span>
                  <span className="diff-text">{wordDiff.map((w, k) =>
                    w.removed ? <mark key={`r-${k}-${w.value.slice(0,8)}`} className="diff-word-removed">{w.value}</mark> :
                    w.added ? null :
                    <span key={`n-${k}-${w.value.slice(0,8)}`}>{w.value}</span>
                  )}</span>
                </div>
                <div className="diff-gutter-cell">↔</div>
                <div className="diff-cell diff-added">
                  <span className="diff-ln">{lineB++}</span>
                  <span className="diff-text">{wordDiff.map((w, k) =>
                    w.added ? <mark key={`a-${k}-${w.value.slice(0,8)}`} className="diff-word-added">{w.value}</mark> :
                    w.removed ? null :
                    <span key={`n-${k}-${w.value.slice(0,8)}`}>{w.value}</span>
                  )}</span>
                </div>
              </div>
            );
          } else if (remLine) {
            const hlLine = hlA[lineA - 1] ?? remLine;
            rows.push(
              <div key={`r-${lineA}-${j}`} className="diff-row">
                <div className="diff-cell diff-removed">
                  <span className="diff-ln">{lineA++}</span>
                  <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLine }} />
                </div>
                <div className="diff-gutter-cell">−</div>
                <div className="diff-cell diff-empty-cell" />
              </div>
            );
          } else {
            const hlLine = hlB[lineB - 1] ?? addLine;
            rows.push(
              <div key={`a-${lineB}-${j}`} className="diff-row">
                <div className="diff-cell diff-empty-cell" />
                <div className="diff-gutter-cell">+</div>
                <div className="diff-cell diff-added">
                  <span className="diff-ln">{lineB++}</span>
                  <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLine }} />
                </div>
              </div>
            );
          }
        }
        i += 2;
      } else {
        // Pure removal
        for (const line of splitLines(part.value)) {
          const hlLine = hlA[lineA - 1] ?? line;
          rows.push(
            <div key={`rem-${lineA}`} className="diff-row">
              <div className="diff-cell diff-removed">
                <span className="diff-ln">{lineA++}</span>
                <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLine }} />
              </div>
              <div className="diff-gutter-cell">−</div>
              <div className="diff-cell diff-empty-cell" />
            </div>
          );
        }
        i++;
      }
    } else if (part.added) {
      // Pure addition (no preceding removed)
      for (const line of splitLines(part.value)) {
        const hlLine = hlB[lineB - 1] ?? line;
        rows.push(
          <div key={`add-${lineB}`} className="diff-row">
            <div className="diff-cell diff-empty-cell" />
            <div className="diff-gutter-cell">+</div>
            <div className="diff-cell diff-added">
              <span className="diff-ln">{lineB++}</span>
              <span className="diff-text" dangerouslySetInnerHTML={{ __html: hlLine }} />
            </div>
          </div>
        );
      }
      i++;
    } else {
      i++;
    }
  }

  return rows;
}

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
