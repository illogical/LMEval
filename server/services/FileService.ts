import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readText(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeText(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, 'utf-8');
}

export function deleteFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export function deleteDir(dirPath: string): boolean {
  if (!existsSync(dirPath)) return false;
  rmSync(dirPath, { recursive: true, force: true });
  return true;
}

export function listDir(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath);
}

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// All `let` (not `const`), repointed together by configurePaths() below via
// ES modules' live-binding semantics: `import { EVALUATIONS_DIR }` elsewhere
// always reads the *current* value of this binding, not an import-time
// snapshot — no call-site changes needed anywhere else in the codebase.
//
// Two independent roots, both defaulting to today's standalone layout
// (repoRoot === cwd, dataRoot === cwd/data) so standalone paths are
// byte-for-byte unchanged:
//   - dataRoot: user-writable runtime data (prompts, test suites, eval
//     results, sessions, custom templates, presets). Hosted mode points this
//     at `options.dataPath` (HomeBase-provisioned, per-app).
//   - repoRoot: read-only, repo-committed seed content (built-in eval
//     templates, the HTML report template, judge system-prompt templates).
//     Hosted mode points this at `options.repositoryRoot` — this content
//     ships with the checked-out repo, not with HomeBase's per-app data dir.
export let DATA_ROOT = join(process.cwd(), 'data');
export let DATA_DIR = join(DATA_ROOT, 'evals');
export let CUSTOM_TEMPLATES_DIR = join(DATA_DIR, 'templates', 'custom');
export let CUSTOM_PURPOSE_TEMPLATES_DIR = join(DATA_DIR, 'purpose-templates', 'custom');
export let PROMPTS_DIR = join(DATA_DIR, 'prompts');
export let TEST_SUITES_DIR = join(DATA_DIR, 'test-suites');
export let CUSTOM_TEST_SUITES_DIR = join(TEST_SUITES_DIR, 'custom');
export let EVALUATIONS_DIR = join(DATA_DIR, 'evaluations');
export let BASELINES_DIR = join(DATA_DIR, 'baselines');
export let PRESETS_DIR = join(DATA_DIR, 'presets');
export let SESSIONS_DIR = join(DATA_ROOT, 'sessions');
export let JUDGE_QUALIFICATIONS_DIR = join(DATA_DIR, 'judge-qualifications');

export let REPO_ROOT = process.cwd();
export let BUILT_IN_TEMPLATES_DIR = join(REPO_ROOT, 'data', 'evals', 'templates');
export let BUILT_IN_PURPOSE_TEMPLATES_DIR = join(REPO_ROOT, 'data', 'evals', 'purpose-templates');
export let BUILT_IN_TEST_SUITES_DIR = join(REPO_ROOT, 'data', 'evals', 'test-suites', 'built-in');
export let REPORT_TEMPLATE_PATH = join(REPO_ROOT, 'data', 'evals', 'templates', 'report-template.html');
export let JUDGE_PROMPTS_DIR = join(REPO_ROOT, 'data', 'prompts', 'judge');
// A8: temporary in-repo calibration fixture until MemoryApi's reviewed v1
// dataset lands (A5) — must never claim MemoryApi provenance, same pattern
// as A5's temporary fixtures.
export let CALIBRATION_DIR = join(REPO_ROOT, 'data', 'evals', 'calibration');

/**
 * Repoints every path constant above at the given roots. Must run before any
 * route/service reads these paths — called once by the standalone guard
 * (server/index.ts) or the hosted adapter's initialize() (server/host/adapter.ts).
 */
export function configurePaths(options: { dataRoot: string; repoRoot: string }): void {
  DATA_ROOT = options.dataRoot;
  DATA_DIR = join(DATA_ROOT, 'evals');
  CUSTOM_TEMPLATES_DIR = join(DATA_DIR, 'templates', 'custom');
  CUSTOM_PURPOSE_TEMPLATES_DIR = join(DATA_DIR, 'purpose-templates', 'custom');
  PROMPTS_DIR = join(DATA_DIR, 'prompts');
  TEST_SUITES_DIR = join(DATA_DIR, 'test-suites');
  CUSTOM_TEST_SUITES_DIR = join(TEST_SUITES_DIR, 'custom');
  EVALUATIONS_DIR = join(DATA_DIR, 'evaluations');
  BASELINES_DIR = join(DATA_DIR, 'baselines');
  PRESETS_DIR = join(DATA_DIR, 'presets');
  SESSIONS_DIR = join(DATA_ROOT, 'sessions');
  JUDGE_QUALIFICATIONS_DIR = join(DATA_DIR, 'judge-qualifications');

  REPO_ROOT = options.repoRoot;
  BUILT_IN_TEMPLATES_DIR = join(REPO_ROOT, 'data', 'evals', 'templates');
  BUILT_IN_PURPOSE_TEMPLATES_DIR = join(REPO_ROOT, 'data', 'evals', 'purpose-templates');
  BUILT_IN_TEST_SUITES_DIR = join(REPO_ROOT, 'data', 'evals', 'test-suites', 'built-in');
  REPORT_TEMPLATE_PATH = join(REPO_ROOT, 'data', 'evals', 'templates', 'report-template.html');
  JUDGE_PROMPTS_DIR = join(REPO_ROOT, 'data', 'prompts', 'judge');
  CALIBRATION_DIR = join(REPO_ROOT, 'data', 'evals', 'calibration');
}
