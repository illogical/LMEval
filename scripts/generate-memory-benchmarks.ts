import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { TestCase, TestSuite, TestSuiteProvenance } from '../src/types/eval';
import { computeSuiteHash, validateBuiltInSuite } from '../server/services/MemoryBenchmarkService';
import {
  normalizeGeneratedText,
  renderClassificationPrompt,
  sha256,
  wrapMemoryContent,
} from './lib/memoryApiPromptContract';

interface SourceCase {
  id: string;
  content: string;
  source: { kind: 'memoryapi' | 'lmeval-authored'; path?: string; index?: number; treatment: 'verbatim-generic' | 'sanitized' | 'authored'; rationale: string };
  caseTags: string[];
  classification?: { expectedOutput: string };
  tagging?: { expectedLabels: string[] };
  summarization?: { referenceAnswer: string; requiredFacts: string[]; forbiddenClaims?: string[]; protectedTokens?: string[] };
}

interface SourceArtifact {
  schemaVersion: 'memory-benchmark-source.v1';
  sourceRevision: string;
  curatedAt: string;
  reviewStatus: 'pending-human-review' | 'approved';
  derivedCompressionRange: [number, number];
  cases: SourceCase[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(repoRoot, 'data', 'evals', 'benchmarks', 'memory-benchmark-source.v1.json');
const ledgerPath = join(repoRoot, 'data', 'evals', 'benchmarks', 'memory-benchmark-review.v1.json');
const outputDir = join(repoRoot, 'data', 'evals', 'test-suites', 'built-in');
const expectedRevision = process.argv.find(arg => arg.startsWith('--expected-revision='))?.split('=')[1]
  ?? 'c7ecb9e292947f88199c16548b88dc4fc8557a60';
const memoryApiRootArg = process.argv.find(arg => arg.startsWith('--memory-api-root='))?.split('=')[1];
const checkOnly = process.argv.includes('--check');

if (!memoryApiRootArg) throw new Error('Usage: npm run benchmarks:generate -- --memory-api-root=<path> [--expected-revision=<sha>]');
const memoryApiRoot = resolve(memoryApiRootArg);
const consumed = [
  'src/samples/allCategories.json', 'src/samples/allTags.json', 'src/samples/seedMemories.json', 'src/samples/sampleMemories.json',
  'src/prompts/categorization.txt', 'src/prompts/tagging.txt', 'src/prompts/memory_summary.txt', 'src/services/promptTemplateService.ts',
];
const gitArgs = ['-c', `safe.directory=${memoryApiRoot}`, '-C', memoryApiRoot];
const revision = execFileSync('git', [...gitArgs, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== expectedRevision) throw new Error(`MemoryApi revision ${revision} does not match expected ${expectedRevision}`);
const dirty = execFileSync('git', [...gitArgs, 'status', '--short', '--', ...consumed], { encoding: 'utf8' }).trim();
if (dirty) throw new Error(`Consumed MemoryApi files must be clean:\n${dirty}`);

const sourceFiles = consumed.map(path => ({
  path,
  sha256: sha256(readFileSync(join(memoryApiRoot, path))),
}));
const categoriesJson = JSON.parse(readFileSync(join(memoryApiRoot, consumed[0]), 'utf8')) as { Categories: string[] };
const tagsJson = JSON.parse(readFileSync(join(memoryApiRoot, consumed[1]), 'utf8')) as { TagGroups: Array<{ Tags: string[] }> };
const tagVocabulary = tagsJson.TagGroups.flatMap(group => group.Tags);
const seedMemories = JSON.parse(readFileSync(join(memoryApiRoot, consumed[2]), 'utf8')) as { memories: Array<{ content: string }> };
const sampleMemories = JSON.parse(readFileSync(join(memoryApiRoot, consumed[3]), 'utf8')) as { memories: Array<{ content: string }> };
const sourcePool = [...seedMemories.memories, ...sampleMemories.memories];
const uniqueSourceInputs = new Set(sourcePool.map(entry => entry.content.replace(/\s+/g, ' ').trim().toLowerCase()));
if (seedMemories.memories.length !== 26 || sampleMemories.memories.length !== 48 || uniqueSourceInputs.size !== 74) {
  throw new Error('MemoryApi source pool no longer matches the reviewed 26/48/74 v1 corpus');
}
const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as SourceArtifact;
if (source.sourceRevision !== revision) throw new Error('Source artifact revision does not match MemoryApi HEAD');

const classificationTemplate = readFileSync(join(memoryApiRoot, 'src/prompts/categorization.txt'), 'utf8');
const taggingTemplate = readFileSync(join(memoryApiRoot, 'src/prompts/tagging.txt'), 'utf8');
const summaryTemplate = readFileSync(join(memoryApiRoot, 'src/prompts/memory_summary.txt'), 'utf8');
const rendererSource = readFileSync(join(memoryApiRoot, 'src/services/promptTemplateService.ts'), 'utf8');
if ((classificationTemplate.match(/{{categories}}/g) ?? []).length !== 1 || (taggingTemplate.match(/{{tags}}/g) ?? []).length !== 1) {
  throw new Error('MemoryApi taxonomy placeholders no longer match the v1 rendering contract');
}
const renderedClassificationPrompt = renderClassificationPrompt(classificationTemplate, categoriesJson.Categories);
if (/{{(?:categories|tags)}}/.test(summaryTemplate)) throw new Error('Summary prompt unexpectedly injects a taxonomy');
for (const contract of [
  'content.replace(/<\\/memory\\s*>/gi',
  '`<memory>\\n${escapedContent}\\n</memory>`',
  'template.replace(/{{categories}}/g, formattedCategories)',
  'template.replace(/{{tags}}/g, formattedTags)',
]) {
  if (!rendererSource.includes(contract)) throw new Error(`MemoryApi renderer contract changed: ${contract}`);
}
for (const entry of source.cases) {
  if (entry.source.kind === 'memoryapi') {
    if (!entry.source.path || entry.source.index == null) throw new Error(`${entry.id}: MemoryApi source path and index are required`);
    const collection = entry.source.path.endsWith('seedMemories.json') ? seedMemories.memories
      : entry.source.path.endsWith('sampleMemories.json') ? sampleMemories.memories : null;
    if (!collection?.[entry.source.index]) throw new Error(`${entry.id}: MemoryApi source reference is invalid`);
    if (entry.source.treatment === 'authored') throw new Error(`${entry.id}: MemoryApi source cannot be marked authored`);
  } else if (entry.source.treatment !== 'authored' || entry.source.path || entry.source.index != null) {
    throw new Error(`${entry.id}: LMEval-authored source provenance is inconsistent`);
  }
}

const promptTexts = consumed.slice(4, 7).map(path => readFileSync(join(memoryApiRoot, path), 'utf8'));
const purposePrompts = ['classification', 'tagging', 'summarization'].map(name => {
  if (name === 'classification') return renderedClassificationPrompt;
  const template = JSON.parse(readFileSync(join(repoRoot, 'data', 'evals', 'purpose-templates', `${name}.json`), 'utf8')) as { seedPromptContent?: string };
  return template.seedPromptContent ?? '';
});
const examplePattern = /(?:Input|Memory):\s*["“]([^"”]+)["”]/g;
const examples = [...promptTexts, ...purposePrompts].flatMap(text => [...text.matchAll(examplePattern)].map(match => match[1]));
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const tokenSet = (value: string) => new Set(normalize(value).split(/[^a-z0-9+#.-]+/).filter(Boolean));
const similarity = (left: string, right: string) => {
  const a = tokenSet(left); const b = tokenSet(right);
  const intersection = [...a].filter(token => b.has(token)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
};
for (const entry of source.cases) {
  if (examples.some(example => normalize(example) === normalize(entry.content))) throw new Error(`${entry.id}: exact prompt-example leakage`);
  const close = examples.map(example => ({ example, score: similarity(example, entry.content) })).filter(match => match.score >= 0.85);
  if (close.length) console.warn(`${entry.id}: high prompt-example similarity ${close.map(match => match.score.toFixed(2)).join(', ')}`);
}

function project(task: 'classification' | 'tagging' | 'summarization'): TestCase[] {
  return source.cases.filter(entry => entry[task]).map(entry => {
    const common = { id: entry.id, userMessage: wrapMemoryContent(entry.content), caseTags: entry.caseTags };
    if (task === 'classification') return { ...common, expectedOutput: entry.classification!.expectedOutput };
    if (task === 'tagging') return { ...common, expectedLabels: entry.tagging!.expectedLabels };
    return { ...common, ...entry.summarization };
  });
}
const summaryCases = project('summarization');
const ratios = summaryCases.map(testCase => testCase.referenceAnswer!.length / testCase.userMessage.length).sort((a, b) => a - b);
const derivedRange: [number, number] = [
  Number(ratios[Math.floor((ratios.length - 1) * 0.1)].toFixed(2)),
  Number(ratios[Math.ceil((ratios.length - 1) * 0.9)].toFixed(2)),
];
if (derivedRange[0] !== source.derivedCompressionRange[0] || derivedRange[1] !== source.derivedCompressionRange[1]) {
  throw new Error(`Derived compression range ${derivedRange.join('/')} does not match the source artifact`);
}
function suite(task: 'classification' | 'tagging' | 'summarization', testCases: TestCase[]): TestSuite {
  const id = `memory-${task}-v1`;
  const now = '2026-09-04T00:00:00.000Z';
  const taxonomySha256 = sha256(JSON.stringify({ categories: categoriesJson.Categories, tags: tagVocabulary }));
  const provenance: TestSuiteProvenance = {
    source: 'MemoryApi seeds and samples plus LMEval-authored reviewed-draft cases', sourceRevision: revision, sourceFiles,
    taxonomySha256, datasetSha256: '', curatedAt: source.curatedAt, reviewStatus: source.reviewStatus,
  };
  const result: TestSuite = {
    id, slug: id, name: `Memory ${task[0].toUpperCase()}${task.slice(1)} v1`,
    description: `MemoryApi-shaped ${task} benchmark. Ground truth is ${source.reviewStatus}.`,
    testCases, builtIn: true, purposeCategory: task, version: '1.0.0', provenance, createdAt: now, updatedAt: now,
  };
  result.provenance!.datasetSha256 = computeSuiteHash(result);
  return result;
}

const generatedFiles = new Map<string, string>();
for (const task of ['classification', 'tagging', 'summarization'] as const) {
  const result = suite(task, project(task));
  const errors = validateBuiltInSuite(result, task === 'tagging' ? tagVocabulary : undefined);
  if (errors.length) throw new Error(errors.join('\n'));
  generatedFiles.set(join(outputDir, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
}

const classificationPurposePath = join(repoRoot, 'data', 'evals', 'purpose-templates', 'classification.json');
const classificationPurpose = JSON.parse(readFileSync(classificationPurposePath, 'utf8')) as {
  seedPromptContent?: string;
  updatedAt: string;
};
classificationPurpose.seedPromptContent = renderedClassificationPrompt;
classificationPurpose.updatedAt = source.curatedAt;
generatedFiles.set(classificationPurposePath, `${JSON.stringify(classificationPurpose, null, 2)}\n`);

if (checkOnly) {
  const drift = [...generatedFiles].filter(([path, expected]) =>
    normalizeGeneratedText(readFileSync(path, 'utf8')) !== normalizeGeneratedText(expected));
  if (drift.length) throw new Error(`Generated MemoryApi inputs have drifted:\n${drift.map(([path]) => path).join('\n')}`);
} else {
  mkdirSync(outputDir, { recursive: true });
  for (const [path, content] of generatedFiles) writeFileSync(path, content, 'utf8');
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { reviewStatus: string; cases: Array<{ caseId: string }> };
const sourceIds = new Set(source.cases.map(entry => entry.id));
if (ledger.reviewStatus !== source.reviewStatus || ledger.cases.length !== source.cases.length || ledger.cases.some(entry => !sourceIds.has(entry.caseId))) {
  throw new Error('Review ledger is incomplete or inconsistent with the source artifact');
}
console.log(`${checkOnly ? 'Verified' : 'Generated'} classification=${project('classification').length}, tagging=${project('tagging').length}, summarization=${project('summarization').length}`);
