/**
 * One-time (and safely re-runnable) backfill of the InsightsIndexService
 * SQLite index from every already-completed evaluation on disk. No
 * evaluation is re-run — config.json + summary.json already carry everything
 * the schema needs. See docs/plans/2026-09-06-evaluation-dashboard-and-sqlite-schema.md
 * ("Backfill, not re-run").
 *
 * Usage: npm run insights:backfill
 */
import { join } from 'path';
import {
  readJson, listDir, EVALUATIONS_DIR, BUILT_IN_TEST_SUITES_DIR, CUSTOM_TEST_SUITES_DIR,
} from '../server/services/FileService';
import { recordEvaluation, PRE_V1_GATE_THRESHOLD_VERSION } from '../server/services/InsightsIndexService';
import type { EvaluationConfig, EvaluationSummary, TestSuite } from '../src/types/eval';

/**
 * Older evaluations don't carry `benchmarkProvenance` on their config/summary
 * at all (it was added later), so groundTruthReviewStatus can't be read off
 * the evaluation record directly for them. Fall back to reading the review
 * status straight off the referenced test suite's own provenance, which is
 * still readable today for every built-in/custom suite on disk.
 */
function reviewStatusForTestSuite(testSuiteId: string | undefined): string | null {
  if (!testSuiteId) return null;
  for (const dir of [BUILT_IN_TEST_SUITES_DIR, CUSTOM_TEST_SUITES_DIR]) {
    for (const file of listDir(dir)) {
      if (!file.endsWith('.json')) continue;
      const suite = readJson<TestSuite>(join(dir, file));
      if (suite?.id === testSuiteId) return suite.provenance?.reviewStatus ?? null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const evalIds = listDir(EVALUATIONS_DIR);
  let indexed = 0;
  let skipped = 0;

  for (const evalId of evalIds) {
    const evalDir = join(EVALUATIONS_DIR, evalId);
    const config = readJson<EvaluationConfig>(join(evalDir, 'config.json'));
    const summary = readJson<EvaluationSummary>(join(evalDir, 'summary.json'));

    if (!config || !summary || config.status !== 'completed') {
      skipped++;
      continue;
    }
    if (!summary.taskMetrics && !summary.perModelTaskMetrics) {
      // No built-in purpose template / assertion strategy — nothing this
      // schema can index (it's scoped to classification/tagging/summarization).
      skipped++;
      continue;
    }

    const groundTruthReviewStatusOverride = summary.benchmarkProvenance?.reviewStatus
      ?? config.benchmarkProvenance?.reviewStatus
      ?? reviewStatusForTestSuite(config.testSuiteId);

    recordEvaluation(evalId, config, summary, {
      gateThresholdVersionOverride: PRE_V1_GATE_THRESHOLD_VERSION,
      groundTruthReviewStatusOverride,
      // concurrency intentionally omitted — not recoverable for historical runs.
    });
    indexed++;
    console.log(`  indexed: ${evalId}`);
  }

  console.log(`\nBackfill complete: ${indexed} indexed, ${skipped} skipped (no completed run or no task metrics).`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
