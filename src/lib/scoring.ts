/** Returns a CSS color from teal → amber → rose heatmap gradient based on score position */
export function scoreToColor(score: number, min: number, max: number): string {
  if (max === min) return '#14b8a6';
  const t = Math.max(0, Math.min(1, (score - min) / (max - min)));
  if (t >= 0.5) {
    // teal to amber
    const u = (t - 0.5) * 2;
    const r = Math.round(20 + u * (245 - 20));
    const g = Math.round(184 + u * (158 - 184));
    const b = Math.round(166 + u * (11 - 166));
    return `rgb(${r},${g},${b})`;
  } else {
    // rose to amber
    const u = t * 2;
    const r = Math.round(244 + u * (245 - 244));
    const g = Math.round(63 + u * (158 - 63));
    const b = Math.round(94 + u * (11 - 94));
    return `rgb(${r},${g},${b})`;
  }
}

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
