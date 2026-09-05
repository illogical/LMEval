import { describe, it, expect } from 'vitest';
import { bootstrapCI, mcNemarTest, caseCountGate, tieGroupsByOverlappingCI, percentile } from '../StatisticsService';

describe('StatisticsService', () => {
  describe('bootstrapCI', () => {
    it('returns a degenerate CI for fewer than 2 values', () => {
      expect(bootstrapCI([1])).toEqual({ point: 1, lower: 1, upper: 1 });
      expect(bootstrapCI([])).toEqual({ point: 0, lower: 0, upper: 0 });
    });

    it('computes the point estimate as the mean', () => {
      const ci = bootstrapCI([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
      expect(ci.point).toBeCloseTo(0.4, 5);
    });

    it('brackets the point estimate with lower <= point <= upper', () => {
      const values = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
      const ci = bootstrapCI(values, 2000, 7);
      expect(ci.lower).toBeLessThanOrEqual(ci.point + 1e-9);
      expect(ci.upper).toBeGreaterThanOrEqual(ci.point - 1e-9);
    });

    it('produces a narrower CI with more, consistent data', () => {
      const small = bootstrapCI([1, 1, 0, 0], 2000, 1);
      const large = bootstrapCI(Array(200).fill(0).map((_, i) => (i % 2 === 0 ? 1 : 0)), 2000, 1);
      expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
    });

    it('is deterministic for a fixed seed', () => {
      const values = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1];
      const a = bootstrapCI(values, 500, 99);
      const b = bootstrapCI(values, 500, 99);
      expect(a).toEqual(b);
    });
  });

  describe('mcNemarTest', () => {
    it('reports no significance when there is no discordance', () => {
      const result = mcNemarTest([true, true, false, false], [true, true, false, false]);
      expect(result.discordantBaselineOnly).toBe(0);
      expect(result.discordantCandidateOnly).toBe(0);
      expect(result.pValue).toBe(1);
      expect(result.significant).toBe(false);
    });

    it('counts discordant pairs correctly', () => {
      // baseline pass/candidate fail: case 0; candidate pass/baseline fail: case 1, 2
      const baseline = [true, false, false, true];
      const candidate = [false, true, true, true];
      const result = mcNemarTest(baseline, candidate);
      expect(result.discordantBaselineOnly).toBe(1);
      expect(result.discordantCandidateOnly).toBe(2);
    });

    it('flags a large, one-sided asymmetry as significant', () => {
      const n = 40;
      // 20 cases flip candidate-only-pass, 0 flip the other way — strongly asymmetric.
      const baseline = Array(n).fill(false);
      const candidate = Array(n).fill(true);
      const result = mcNemarTest(baseline, candidate);
      expect(result.significant).toBe(true);
      expect(result.pValue).toBeLessThan(0.05);
    });
  });

  describe('caseCountGate', () => {
    it('passes when the whole CI clears the threshold', () => {
      const result = caseCountGate({ point: 0.95, lower: 0.90, upper: 0.99 }, 0.85, 50);
      expect(result.verdict).toBe('pass');
      expect(result.neededCases).toBeUndefined();
    });

    it('fails when the whole CI is below the threshold', () => {
      const result = caseCountGate({ point: 0.5, lower: 0.4, upper: 0.6 }, 0.85, 50);
      expect(result.verdict).toBe('fail');
    });

    it('is inconclusive when the CI straddles the threshold, with a needed-case estimate', () => {
      const result = caseCountGate({ point: 0.87, lower: 0.75, upper: 0.95 }, 0.85, 16);
      expect(result.verdict).toBe('inconclusive');
      expect(result.neededCases).toBeGreaterThan(0);
    });

    it('supports the lte direction for thresholds like invalid-rate ceilings', () => {
      const clears = caseCountGate({ point: 0.01, lower: 0.0, upper: 0.02 }, 0.05, 50, 'lte');
      expect(clears.verdict).toBe('pass');
      const fails = caseCountGate({ point: 0.2, lower: 0.15, upper: 0.25 }, 0.05, 50, 'lte');
      expect(fails.verdict).toBe('fail');
    });
  });

  describe('tieGroupsByOverlappingCI', () => {
    it('returns an empty array for no candidates', () => {
      expect(tieGroupsByOverlappingCI([])).toEqual([]);
    });

    it('puts a single candidate in its own rank-1 group', () => {
      const groups = tieGroupsByOverlappingCI([{ id: 'a', ci: { point: 0.9, lower: 0.85, upper: 0.95 } }]);
      expect(groups).toEqual([{ rank: 1, modelIds: ['a'] }]);
    });

    it('groups two directly-overlapping CIs together', () => {
      const groups = tieGroupsByOverlappingCI([
        { id: 'a', ci: { point: 0.90, lower: 0.85, upper: 0.95 } },
        { id: 'b', ci: { point: 0.88, lower: 0.83, upper: 0.93 } },
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0].modelIds.sort()).toEqual(['a', 'b']);
    });

    it('separates disjoint (non-overlapping) CIs into distinct ranked groups', () => {
      const groups = tieGroupsByOverlappingCI([
        { id: 'a', ci: { point: 0.95, lower: 0.90, upper: 0.99 } },
        { id: 'b', ci: { point: 0.50, lower: 0.40, upper: 0.60 } },
      ]);
      expect(groups).toEqual([
        { rank: 1, modelIds: ['a'] },
        { rank: 2, modelIds: ['b'] },
      ]);
    });

    it('chains transitive overlap: A-B overlap plus B-C overlap merges all three even without a direct A-C overlap', () => {
      // A: [0.80, 0.90], B: [0.70, 0.82], C: [0.60, 0.72] — A/B overlap at 0.80-0.82,
      // B/C overlap at 0.70-0.72, but A [0.80,0.90] and C [0.60,0.72] do not overlap directly.
      const groups = tieGroupsByOverlappingCI([
        { id: 'A', ci: { point: 0.85, lower: 0.80, upper: 0.90 } },
        { id: 'B', ci: { point: 0.76, lower: 0.70, upper: 0.82 } },
        { id: 'C', ci: { point: 0.66, lower: 0.60, upper: 0.72 } },
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0].modelIds.sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('percentile', () => {
    it('returns 0 for an empty array', () => {
      expect(percentile([], 0.95)).toBe(0);
    });

    it('interpolates between the two nearest ranks', () => {
      expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    });
  });
});
