import { describe, it, expect } from 'vitest';
import { scoreToColor, formatScore, formatLatency } from '../../lib/scoring';

describe('scoreToColor', () => {
  it('returns a hex color string', () => {
    const color = scoreToColor(3);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('low score (1) returns reddish color', () => {
    const color = scoreToColor(1);
    // Should be close to #f43f5e (heatmap-low)
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    expect(r).toBeGreaterThan(g); // red channel dominates
  });

  it('high score (5) returns greenish color', () => {
    const color = scoreToColor(5);
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    expect(g).toBeGreaterThan(r); // green channel dominates
  });

  it('mid score (3) returns amber-ish color', () => {
    const color = scoreToColor(3);
    // Should be close to #f59e0b
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    expect(r).toBeGreaterThan(100);
    expect(g).toBeGreaterThan(80);
  });

  it('clamps below min', () => {
    expect(scoreToColor(-5)).toEqual(scoreToColor(1));
  });

  it('clamps above max', () => {
    expect(scoreToColor(99)).toEqual(scoreToColor(5));
  });
});

describe('formatScore', () => {
  it('rounds to 1 decimal', () => {
    expect(formatScore(3.567)).toBe('3.6');
    expect(formatScore(4)).toBe('4.0');
    expect(formatScore(1.0)).toBe('1.0');
  });
});

describe('formatLatency', () => {
  it('formats ms under 1s', () => {
    expect(formatLatency(500)).toBe('500ms');
    expect(formatLatency(0)).toBe('0ms');
  });

  it('formats seconds', () => {
    expect(formatLatency(1500)).toBe('1.5s');
    expect(formatLatency(10000)).toBe('10.0s');
  });

  it('formats minutes', () => {
    expect(formatLatency(90000)).toBe('1m 30s');
    expect(formatLatency(3600000)).toBe('60m 0s');
  });
});
