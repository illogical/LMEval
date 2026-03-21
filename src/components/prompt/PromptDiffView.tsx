import { useMemo } from 'react';
import { diffLines, diffWords } from 'diff';
import './PromptDiffView.css';

interface PromptDiffViewProps {
  contentA: string;
  contentB: string;
}

export function PromptDiffView({ contentA, contentB }: PromptDiffViewProps) {
  const lines = useMemo(() => diffLines(contentA, contentB), [contentA, contentB]);

  if (!contentA && !contentB) {
    return <div className="diff-empty">Enter text in both editors to see differences</div>;
  }

  return (
    <div className="diff-view" aria-label="Diff view">
      <div className="diff-header">
        <span className="diff-col-label diff-a-label">Prompt A</span>
        <span className="diff-gutter" />
        <span className="diff-col-label diff-b-label">Prompt B</span>
      </div>
      <div className="diff-body">
        {buildDiffRows(lines)}
      </div>
    </div>
  );
}

function buildDiffRows(changes: ReturnType<typeof diffLines>) {
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
        rows.push(
          <div key={`u-${lineA}-${lineB}`} className="diff-row">
            <div className="diff-cell diff-unchanged">
              <span className="diff-ln">{lineA++}</span>
              <span className="diff-text">{line}</span>
            </div>
            <div className="diff-gutter-cell" />
            <div className="diff-cell diff-unchanged">
              <span className="diff-ln">{lineB++}</span>
              <span className="diff-text">{line}</span>
            </div>
          </div>
        );
      }
      i++;
    } else if (part.removed) {
      // Look ahead for a corresponding added part
      const nextPart = changes[i + 1];
      if (nextPart?.added) {
        // Changed: show word-level diff
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
                    w.removed ? <mark key={k} className="diff-word-removed">{w.value}</mark> :
                    w.added ? null :
                    <span key={k}>{w.value}</span>
                  )}</span>
                </div>
                <div className="diff-gutter-cell">↔</div>
                <div className="diff-cell diff-added">
                  <span className="diff-ln">{lineB++}</span>
                  <span className="diff-text">{wordDiff.map((w, k) =>
                    w.added ? <mark key={k} className="diff-word-added">{w.value}</mark> :
                    w.removed ? null :
                    <span key={k}>{w.value}</span>
                  )}</span>
                </div>
              </div>
            );
          } else if (remLine) {
            rows.push(
              <div key={`r-${lineA}-${j}`} className="diff-row">
                <div className="diff-cell diff-removed">
                  <span className="diff-ln">{lineA++}</span>
                  <span className="diff-text">{remLine}</span>
                </div>
                <div className="diff-gutter-cell">−</div>
                <div className="diff-cell diff-empty-cell" />
              </div>
            );
          } else {
            rows.push(
              <div key={`a-${lineB}-${j}`} className="diff-row">
                <div className="diff-cell diff-empty-cell" />
                <div className="diff-gutter-cell">+</div>
                <div className="diff-cell diff-added">
                  <span className="diff-ln">{lineB++}</span>
                  <span className="diff-text">{addLine}</span>
                </div>
              </div>
            );
          }
        }
        i += 2;
      } else {
        // Pure removal
        for (const line of splitLines(part.value)) {
          rows.push(
            <div key={`rem-${lineA}`} className="diff-row">
              <div className="diff-cell diff-removed">
                <span className="diff-ln">{lineA++}</span>
                <span className="diff-text">{line}</span>
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
        rows.push(
          <div key={`add-${lineB}`} className="diff-row">
            <div className="diff-cell diff-empty-cell" />
            <div className="diff-gutter-cell">+</div>
            <div className="diff-cell diff-added">
              <span className="diff-ln">{lineB++}</span>
              <span className="diff-text">{line}</span>
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
