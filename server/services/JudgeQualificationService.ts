import { join } from 'path';
import { createHash } from 'crypto';
import { readJson, writeJson, ensureDir, listDir, generateId, DATA_DIR, JUDGE_QUALIFICATIONS_DIR, CALIBRATION_DIR } from './FileService';
import { LmapiClient } from './LmapiClient';
import type { JudgeQualification, JudgeQualificationRun, JudgeQualificationStatus } from '../../src/types/eval';

const DIMENSIONS = ['faithfulness', 'salientCoverage', 'retrievalUtility', 'concision', 'overall'] as const;
type Dimension = typeof DIMENSIONS[number];

interface CalibrationCase {
  id: string;
  sourceText: string;
  candidateSummary: string;
  humanScores: Record<Dimension, number>;
}

interface CalibrationSet {
  id: string;
  cases: CalibrationCase[];
}

const QUALIFY_PASSES = 3; // self-consistency, mirrors A6's 3-pass judge convention

function buildQualificationPrompt(c: CalibrationCase): string {
  return `Rate the following summary of a source text on 5 dimensions, each on a 1-5 scale (5 is best):
- faithfulness: no facts/claims introduced beyond the source
- salientCoverage: retains the source's key points
- retrievalUtility: would surface this memory for a plausible natural-language query
- concision: appropriately brief, no padding
- overall: your holistic 1-5 quality score

Source:
${c.sourceText}

Summary:
${c.candidateSummary}

Respond with ONLY a JSON object, no other text: {"faithfulness": <1-5>, "salientCoverage": <1-5>, "retrievalUtility": <1-5>, "concision": <1-5>, "overall": <1-5>}`;
}

function parseJudgeScores(raw: string): Partial<Record<Dimension, number>> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    const out: Partial<Record<Dimension, number>> = {};
    for (const dim of DIMENSIONS) {
      const v = parsed[dim];
      if (typeof v === 'number' && v >= 1 && v <= 5) out[dim] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const rank = (values: number[]): number[] => {
    const sorted = values.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && sorted[j + 1].v === sorted[i].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rank(a);
  const rb = rank(b);
  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA, db = rb[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

function loadCalibrationSet(calibrationSetId: string): CalibrationSet {
  if (!/^[\w-]+$/.test(calibrationSetId)) throw new Error('Invalid calibration set ID');
  const set = readJson<CalibrationSet>(join(CALIBRATION_DIR, `${calibrationSetId}.json`));
  if (!set) throw new Error(`Calibration set not found: ${calibrationSetId}`);
  return set;
}

function hashCalibrationSet(set: CalibrationSet): string {
  return createHash('sha256').update(JSON.stringify(set)).digest('hex');
}

const runPath = (id: string) => join(DATA_DIR, 'judge-qualification-runs', `${id}.json`);
const active = (run: JudgeQualificationRun) => run.status === 'pending' || run.status === 'running';
function saveRun(run: JudgeQualificationRun) { run.updatedAt = new Date().toISOString(); writeJson(runPath(run.id), run); }
function runs(): JudgeQualificationRun[] {
  return listDir(join(DATA_DIR, 'judge-qualification-runs')).filter(f => f.endsWith('.json'))
    .map(f => readJson<JudgeQualificationRun>(join(DATA_DIR, 'judge-qualification-runs', f))!).filter(Boolean);
}

export const JudgeQualificationService = {
  getRun(id: string): JudgeQualificationRun | null {
    return /^[\w-]+$/.test(id) ? readJson<JudgeQualificationRun>(runPath(id)) : null;
  },
  status(modelId: string): JudgeQualificationStatus {
    const record = this.get(modelId);
    const modelRuns = runs().filter(r => r.judgeModelId === modelId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const run = modelRuns[0];
    const recordRun = modelRuns.find(candidate => candidate.result?.calibrationSetHash === record?.calibrationSetHash);
    let current = false;
    try { current = record?.calibrationSetHash === hashCalibrationSet(loadCalibrationSet(recordRun?.calibrationSetId ?? 'summarization-v0')); } catch { /* missing calibration is not current */ }
    const state = run && active(run) ? 'running'
      : run && ['failed', 'cancelled', 'interrupted'].includes(run.status) ? run.status as 'failed' | 'cancelled' | 'interrupted'
      : record ? !current ? 'stale' : record.qualified ? 'qualified' : 'unqualified' : 'missing';
    return { state, record, current, run };
  },
  isQualified(modelId: string): boolean { const s = this.status(modelId); return s.current && s.record?.qualified === true; },
  interruptRuns(): void {
    for (const run of runs().filter(active)) { run.status = 'interrupted'; run.error = 'Host restarted before completion. Retry explicitly.'; saveRun(run); }
  },
  cancelRun(id: string): JudgeQualificationRun {
    const run = this.getRun(id);
    if (!run) throw Object.assign(new Error('Qualification run not found'), { status: 404 });
    if (!active(run)) throw Object.assign(new Error('Qualification run is terminal'), { status: 409 });
    run.cancelRequestedAt = new Date().toISOString(); saveRun(run); return run;
  },
  startRun(judgeModelId: string, calibrationSetId = 'summarization-v0'): JudgeQualificationRun {
    if (!/^.+::.+$/.test(judgeModelId)) throw new Error('Use a server::model judge ID');
    const set = loadCalibrationSet(calibrationSetId);
    if (set.cases.length < 20) throw new Error('Qualification requires at least 20 calibration cases');
    const hash = hashCalibrationSet(set);
    // The final record is keyed by model, so two calibration sets for one model
    // must not race to overwrite it even when their hashes differ.
    const existing = runs().find(r => r.judgeModelId === judgeModelId && active(r));
    if (existing) throw Object.assign(new Error('A qualification is already active for this judge'), { status: 409, runId: existing.id });
    const now = new Date().toISOString();
    const run: JudgeQualificationRun = { id: generateId('qualification'), judgeModelId, calibrationSetId, calibrationSetHash: hash,
      status: 'pending', completedCalls: 0, totalCalls: set.cases.length * QUALIFY_PASSES, createdAt: now, updatedAt: now };
    saveRun(run);
    setTimeout(() => { void this.executeRun(run.id); }, 0);
    return run;
  },
  async executeRun(id: string): Promise<void> {
    const run = this.getRun(id)!;
    const cancelled = () => !!this.getRun(id)?.cancelRequestedAt;
    try {
      run.status = 'running'; saveRun(run);
      const result = await this.qualify(run.judgeModelId, run.calibrationSetId, {
        cancelled,
        progress: () => { run.completedCalls++; run.cancelRequestedAt = this.getRun(id)?.cancelRequestedAt; saveRun(run); },
      });
      run.result = result; run.status = 'completed';
    } catch (error) {
      run.status = cancelled() ? 'cancelled' : 'failed'; run.error = (error as Error).message;
    }
    run.cancelRequestedAt = this.getRun(id)?.cancelRequestedAt; saveRun(run);
  },
  get(judgeModelId: string): JudgeQualification | null {
    const safe = judgeModelId.replace(/[/:]/g, '_');
    return readJson<JudgeQualification>(join(JUDGE_QUALIFICATIONS_DIR, `${safe}.json`));
  },

  async qualify(judgeModelId: string, calibrationSetId = 'summarization-v0', hooks?: { cancelled: () => boolean; progress: () => void }): Promise<JudgeQualification> {
    const set = loadCalibrationSet(calibrationSetId);
    if (set.cases.length < 20) {
      throw new Error(`Calibration set ${calibrationSetId} has ${set.cases.length} cases, fewer than the required 20`);
    }

    // 3 self-consistency passes per case, at t=0 (mirrors the summarization
    // judge's own grading temperature) so MAD measures true judge variance,
    // not sampling noise from an unrelated setting.
    const perCaseRuns: Array<Record<Dimension, number[]>> = [];
    for (const c of set.cases) {
      const runs: Record<Dimension, number[]> = { faithfulness: [], salientCoverage: [], retrievalUtility: [], concision: [], overall: [] };
      for (let pass = 0; pass < QUALIFY_PASSES; pass++) {
        if (hooks?.cancelled()) throw new Error('Qualification cancelled');
        const response = await LmapiClient.chatCompletion({
          model: judgeModelId,
          messages: [{ role: 'user', content: buildQualificationPrompt(c) }],
          stream: false,
          groupId: `judge-qualify-${judgeModelId}`,
          temperature: 0,
        });
        const scores = parseJudgeScores(response.choices[0]?.message.content ?? '');
        if (DIMENSIONS.some(dim => scores[dim] == null)) throw new Error('Judge returned incomplete or invalid qualification scores');
        hooks?.progress();
        if (hooks?.cancelled()) throw new Error('Qualification cancelled');
        for (const dim of DIMENSIONS) {
          if (scores[dim] != null) runs[dim].push(scores[dim]!);
        }
      }
      perCaseRuns.push(runs);
    }

    const meanOf = (values: number[]): number => values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    const judgeOverall = set.cases.map((_, i) => meanOf(perCaseRuns[i].overall));
    const humanOverall = set.cases.map(c => c.humanScores.overall);
    const spearmanCorr = spearman(judgeOverall, humanOverall);

    const judgeFaithfulness = set.cases.map((_, i) => meanOf(perCaseRuns[i].faithfulness));
    const humanFaithfulness = set.cases.map(c => c.humanScores.faithfulness);
    const within1 = judgeFaithfulness.filter((v, i) => Math.abs(v - humanFaithfulness[i]) <= 1).length;
    const faithfulnessWithin1Pct = within1 / set.cases.length;

    const inflationByCase = judgeOverall.map((v, i) => v - humanOverall[i]);
    const meanInflation = meanOf(inflationByCase);

    const selfConsistencyMAD: Record<string, number> = {};
    for (const dim of DIMENSIONS) {
      const mads = perCaseRuns.map(runs => {
        const values = runs[dim];
        if (values.length < 2) return 0;
        const mean = meanOf(values);
        return meanOf(values.map(v => Math.abs(v - mean)));
      });
      selfConsistencyMAD[dim] = meanOf(mads);
    }
    const maxMAD = Math.max(...Object.values(selfConsistencyMAD));

    const qualified = spearmanCorr >= 0.6
      && faithfulnessWithin1Pct >= 0.8
      && Math.abs(meanInflation) <= 0.5
      && maxMAD <= 0.5;

    const record: JudgeQualification = {
      judgeModelId,
      calibrationSetHash: hashCalibrationSet(set),
      qualifiedAt: new Date().toISOString(),
      spearman: spearmanCorr,
      faithfulnessWithin1Pct,
      meanInflation,
      selfConsistencyMAD,
      qualified,
    };

    ensureDir(JUDGE_QUALIFICATIONS_DIR);
    const safe = judgeModelId.replace(/[/:]/g, '_');
    writeJson(join(JUDGE_QUALIFICATIONS_DIR, `${safe}.json`), record);
    return record;
  },
};
