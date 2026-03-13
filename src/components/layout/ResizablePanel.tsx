import React from 'react';
import { useResizable } from '../../hooks/useResizable';

interface ResizablePanelProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

export function ResizablePanel({ left, center, right }: ResizablePanelProps) {
  const { sizes, onDragStart } = useResizable(3, { initialSizes: [28, 38, 34], minSize: 200 });

  return (
    <div
      style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}
      className="max-lg:flex-col max-lg:overflow-auto"
    >
      {/* Left panel */}
      <div
        style={{ width: `${sizes[0]}%`, minWidth: 200, flexShrink: 0, overflow: 'hidden' }}
        className="flex flex-col max-lg:w-full max-lg:min-h-64"
      >
        {left}
      </div>

      {/* Drag handle 1 */}
      <div
        className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)] transition-colors shrink-0 max-lg:hidden"
        onMouseDown={onDragStart(0)}
        aria-label="Resize panel"
        role="separator"
        aria-orientation="vertical"
      />

      {/* Center panel */}
      <div
        style={{ width: `${sizes[1]}%`, minWidth: 200, flexShrink: 0, overflow: 'hidden' }}
        className="flex flex-col max-lg:w-full max-lg:min-h-64"
      >
        {center}
      </div>

      {/* Drag handle 2 */}
      <div
        className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)] transition-colors shrink-0 max-lg:hidden"
        onMouseDown={onDragStart(1)}
        aria-label="Resize panel"
        role="separator"
        aria-orientation="vertical"
      />

      {/* Right panel */}
      <div
        style={{ flex: 1, minWidth: 200, overflow: 'hidden' }}
        className="flex flex-col max-lg:w-full max-lg:min-h-64"
      >
        {right}
      </div>
    </div>
  );
}
