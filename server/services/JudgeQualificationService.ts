import { join } from 'path';
import { readJson, writeJson, ensureDir, JUDGE_QUALIFICATIONS_DIR, CALIBRATION_DIR } from './FileService';
import { LmapiClient } from './LmapiClient';
import type { JudgeQualification } from '../../src/types/eval';

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
  const set = readJson<CalibrationSet>(join(CALIBRATION_DIR, `${calibrationSetId}.json`));
  if (!set) throw new Error(`Calibration set not found: ${calibrationSetId}`);
  return set;
}

function hashCalibrationSet(set: CalibrationSet): string {
  // Cheap content fingerprint (not cryptographic) — enough to detect "the
  // calibration set changed" and trigger re-qualification per A8.
  const content = JSON.stringify(set.cases.map(c => c.id));
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (Math.imul(31, hash) + content.charCodeAt(i)) | 0;
  }
  return `${set.id}:${(hash >>> 0).toString(16)}`;
}

export const JudgeQualificationService = {
  get(judgeModelId: string): JudgeQualification | null {
    const safe = judgeModelId.replace(/[/:]/g, '_');
    return readJson<JudgeQualification>(join(JUDGE_QUALIFICATIONS_DIR, `${safe}.json`));
  },

  async qualify(judgeModelId: string, calibrationSetId = 'summarization-v0'): Promise<JudgeQualification> {
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
        const response = await LmapiClient.chatCompletion({
          model: judgeModelId,
          messages: [{ role: 'user', content: buildQualificationPrompt(c) }],
          stream: false,
          groupId: `judge-qualify-${judgeModelId}`,
          temperature: 0,
        });
        const scores = parseJudgeScores(response.choices[0]?.message.content ?? '');
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
