import { useCallback, useRef, useState } from 'react';

interface UseResizableOptions {
  initialSizes?: number[];
  minSize?: number;
}

interface UseResizableResult {
  sizes: number[];
  onDragStart: (index: number) => (e: React.MouseEvent) => void;
}

export function useResizable(
  count: number,
  { initialSizes, minSize = 80 }: UseResizableOptions = {}
): UseResizableResult {
  const defaultSizes = initialSizes ?? Array(count).fill(100 / count);
  const [sizes, setSizes] = useState<number[]>(defaultSizes);
  const dragRef = useRef<{ index: number; startX: number; startSizes: number[] } | null>(null);

  const onDragStart = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { index, startX: e.clientX, startSizes: [...sizes] };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const { index: idx, startX, startSizes } = dragRef.current;
        const totalWidth = document.documentElement.clientWidth;
        const deltaPct = ((ev.clientX - startX) / totalWidth) * 100;
        const minSizePct = (minSize / totalWidth) * 100;

        const transfer = Math.max(
          -startSizes[idx] + minSizePct,
          Math.min(startSizes[idx + 1] - minSizePct, deltaPct)
        );
        const next = [...startSizes];
        next[idx] = startSizes[idx] + transfer;
        next[idx + 1] = startSizes[idx + 1] - transfer;
        setSizes(next);
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [sizes, minSize]
  );

  return { sizes, onDragStart };
}
