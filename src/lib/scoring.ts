/**
 * Scoring utilities for eval results
 */

/** Interpolate between two hex colors */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const LOW_COLOR = hexToRgb('#f43f5e');   // --heatmap-low
const MID_COLOR = hexToRgb('#f59e0b');   // --heatmap-mid
const HIGH_COLOR = hexToRgb('#2ea043');  // --heatmap-high

/**
 * Returns a CSS hex color interpolated from heatmap-low → heatmap-mid → heatmap-high
 * based on score (min=1, max=5, mid=3)
 */
export function scoreToColor(score: number, min = 1, max = 5): string {
  const mid = (min + max) / 2;
  const clamped = Math.max(min, Math.min(max, score));

  if (clamped <= mid) {
    const t = (clamped - min) / (mid - min);
    return rgbToHex(
      lerp(LOW_COLOR[0], MID_COLOR[0], t),
      lerp(LOW_COLOR[1], MID_COLOR[1], t),
      lerp(LOW_COLOR[2], MID_COLOR[2], t),
    );
  } else {
    const t = (clamped - mid) / (max - mid);
    return rgbToHex(
      lerp(MID_COLOR[0], HIGH_COLOR[0], t),
      lerp(MID_COLOR[1], HIGH_COLOR[1], t),
      lerp(MID_COLOR[2], HIGH_COLOR[2], t),
    );
  }
}

/** Round score to 1 decimal place */
export function formatScore(score: number): string {
  return score.toFixed(1);
}

/** Format latency in human-readable form */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
