import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import type { TestSuite } from '../src/types/eval';
import { validateBuiltInSuite } from '../server/services/MemoryBenchmarkService';

const repoRoot = resolve(process.cwd());
const benchmarkDir = join(repoRoot, 'data', 'evals', 'benchmarks');
const suiteDir = join(repoRoot, 'data', 'evals', 'test-suites', 'built-in');
const source = JSON.parse(readFileSync(join(benchmarkDir, 'memory-benchmark-source.v1.json'), 'utf8')) as {
  sourceRevision: string; reviewStatus: string;
  cases: Array<{ id: string; source: { kind: string; path?: string; index?: number; treatment: string; rationale?: string } }>;
};
const ledger = JSON.parse(readFileSync(join(benchmarkDir, 'memory-benchmark-review.v1.json'), 'utf8')) as {
  reviewStatus: string; approvedAt: string | null; cases: Array<{ caseId: string; status: string }>;
};
const tagTemplate = JSON.parse(readFileSync(join(repoRoot, 'data', 'evals', 'purpose-templates', 'tagging.json'), 'utf8')) as {
  assertionStrategy: { config: { vocabulary: string[] } };
};
const classificationTemplate = JSON.parse(readFileSync(join(repoRoot, 'data', 'evals', 'purpose-templates', 'classification.json'), 'utf8')) as {
  assertionStrategy: { config: { labels: string[] } };
};
const suites = ['classification', 'tagging', 'summarization'].map(task =>
  JSON.parse(readFileSync(join(suiteDir, `memory-${task}-v1.json`), 'utf8')) as TestSuite
);

const errors = suites.flatMap(suite => validateBuiltInSuite(
  suite,
  suite.purposeCategory === 'tagging' ? tagTemplate.assertionStrategy.config.vocabulary : undefined,
));
const sourceIds = new Set(source.cases.map(entry => entry.id));
const ledgerIds = new Set(ledger.cases.map(entry => entry.caseId));
if (sourceIds.size !== source.cases.length) errors.push('Canonical source has duplicate case ids');
if (ledgerIds.size !== ledger.cases.length || sourceIds.size !== ledgerIds.size || [...sourceIds].some(id => !ledgerIds.has(id))) {
  errors.push('Review ledger does not cover every canonical source case exactly once');
}
for (const entry of source.cases) {
  if (!entry.source?.rationale?.trim()) errors.push(`${entry.id}: source rationale is required`);
  if (entry.source?.kind === 'memoryapi' && (!entry.source.path || entry.source.index == null || entry.source.treatment === 'authored')) {
    errors.push(`${entry.id}: MemoryApi source provenance is incomplete`);
  }
  if (entry.source?.kind === 'lmeval-authored' && (entry.source.path || entry.source.index != null || entry.source.treatment !== 'authored')) {
    errors.push(`${entry.id}: authored source provenance is inconsistent`);
  }
}
const taxonomySha256 = createHash('sha256').update(JSON.stringify({
  categories: classificationTemplate.assertionStrategy.config.labels,
  tags: tagTemplate.assertionStrategy.config.vocabulary,
})).digest('hex');
for (const suite of suites) {
  if (suite.provenance?.reviewStatus !== source.reviewStatus) errors.push(`${suite.id}: review status differs from canonical source`);
  if (suite.provenance?.sourceRevision !== source.sourceRevision) errors.push(`${suite.id}: source revision differs from canonical source`);
  if (suite.provenance?.taxonomySha256 !== taxonomySha256) errors.push(`${suite.id}: taxonomySha256 mismatch`);
  if (suite.provenance?.sourceFiles.length !== 8 || suite.provenance.sourceFiles.some(file => !/^[a-f0-9]{64}$/.test(file.sha256))) {
    errors.push(`${suite.id}: consumed source hashes are incomplete`);
  }
}
if (source.reviewStatus === 'approved') {
  if (ledger.reviewStatus !== 'approved' || !ledger.approvedAt || ledger.cases.some(entry => entry.status !== 'approved')) {
    errors.push('Approved source requires a complete approved review ledger');
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Benchmark lint passed: source=${source.cases.length}, suites=${suites.map(s => s.testCases.length).join('/')}, review=${source.reviewStatus}`);
}
