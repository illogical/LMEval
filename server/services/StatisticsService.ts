import type { ConfidenceInterval, McNemarResult } from '../../src/types/eval';

/**
 * A7: statistics that match the data's resolution. Pure functions — no I/O, no
 * framework dependency — so they're testable independent of the pre-existing
 * vitest environment breakage (TASK.md §3).
 */

// Deterministic LCG so bootstrap results are reproducible across runs of the
// same data (a real PRNG, not crypto-grade — this is resampling, not security).
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xFFFFFFFF;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Percentile bootstrap 95% CI over `values` (e.g. per-case 0/1 exact-match, or
 * per-case Jaccard/rubric scores). Returns a degenerate CI (lower === upper ===
 * point) when there's nothing to resample.
 */
export function bootstrapCI(values: number[], iterations = 2000, seed = 42): ConfidenceInterval {
  const n = values.length;
  const point = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;
  if (n < 2) return { point, lower: point, upper: point };

  const rng = makeRng(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += values[Math.floor(rng() * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    point,
    lower: percentile(means, 0.025),
    upper: percentile(means, 0.975),
  };
}

/**
 * Paired McNemar test (with continuity correction) over per-case pass/fail
 * booleans for a baseline and a candidate, same case order. Tests whether the
 * candidate's disagreements with the baseline are asymmetric (a real change),
 * not just noise.
 */
export function mcNemarTest(baselinePassFail: boolean[], candidatePassFail: boolean[]): McNemarResult {
  const n = Math.min(baselinePassFail.length, candidatePassFail.length);
  let discordantBaselineOnly = 0; // baseline pass, candidate fail
  let discordantCandidateOnly = 0; // candidate pass, baseline fail
  for (let i = 0; i < n; i++) {
    const b = baselinePassFail[i];
    const c = candidatePassFail[i];
    if (b && !c) discordantBaselineOnly++;
    else if (!b && c) discordantCandidateOnly++;
  }

  const totalDiscordant = discordantBaselineOnly + discordantCandidateOnly;
  if (totalDiscordant === 0) {
    return { discordantBaselineOnly, discordantCandidateOnly, pValue: 1, significant: false };
  }

  const chiSquare = ((Math.abs(discordantBaselineOnly - discordantCandidateOnly) - 1) ** 2) / totalDiscordant;
  // p-value from chi-square(df=1) via the complementary error function approximation
  // for the standard normal (chiSquare = z^2 for df=1).
  const z = Math.sqrt(Math.max(0, chiSquare));
  const pValue = 2 * (1 - normalCdf(z));

  return { discordantBaselineOnly, discordantCandidateOnly, pValue, significant: pValue < 0.05 };
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 approximation of the error function.
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

export type GateVerdict = 'pass' | 'fail' | 'inconclusive';

/**
 * A gate passes only when the *entire* CI clears the threshold; when the
 * interval straddles it, the honest answer is "inconclusive", not a coin-flip
 * pass — with a rough estimate of how many more cases would resolve it.
 */
export function caseCountGate(
  ci: ConfidenceInterval,
  threshold: number,
  caseCount: number,
  direction: 'gte' | 'lte' = 'gte'
): { verdict: GateVerdict; neededCases?: number } {
  const clears = direction === 'gte' ? ci.lower >= threshold : ci.upper <= threshold;
  const fails = direction === 'gte' ? ci.upper < threshold : ci.lower > threshold;
  if (clears) return { verdict: 'pass' };
  if (fails) return { verdict: 'fail' };

  // CI half-width shrinks roughly with 1/sqrt(n); estimate the case count that
  // would halve the current straddle past the threshold. Coarse by design —
  // a planning number, not a statistical guarantee.
  const halfWidth = (ci.upper - ci.lower) / 2;
  const gap = Math.abs(ci.point - threshold);
  const targetHalfWidth = Math.max(gap, halfWidth / 4);
  const scaleFactor = halfWidth > 0 ? (halfWidth / targetHalfWidth) ** 2 : 1;
  const neededCases = Math.max(1, Math.ceil(caseCount * scaleFactor) - caseCount);
  return { verdict: 'inconclusive', neededCases };
}
