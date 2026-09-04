# Professional Memory-Metadata Evaluations

**Status:** Proposed

**Applies to:** LMEval built-in purpose templates, test suites, scoring, reports, standalone mode, and HomeBase-hosted mode

**Production counterpart:** `C:\LocalDev\Projects\MemoryApi\docs\plans\2026-09-03-ingestion-prompt-refinement.md`

## Goal

Turn the built-in Classification, Tagging, and Summarization configurations into professional evaluation baselines for the real MemoryApi ingestion tasks. MemoryApi remains the source of truth for its taxonomy and application-specific benchmark corpus. LMEval imports explicit, versioned snapshots for experimentation; it never writes prompt changes back to MemoryApi automatically.

LMEval answers two questions for each ingestion task, not one:

1. **Which prompt wording is best?** Rank prompt variants on a fixed model.
2. **Which local model is best for this task?** Rank the available local models on a fixed, promoted prompt, subject to a quality gate and an ingestion latency budget.

MemoryApi currently runs classification, tagging, and summarization on one shared `LLM_MODEL`. The second question only produces value if MemoryApi can act on a per-task answer, so this plan's model-selection output is written against the per-task model configuration described in the production counterpart. Until that configuration exists, LMEval still reports per-task model rankings, but MemoryApi can only adopt a single compromise winner.

Success means that a prompt or model can be ranked by task-appropriate quality metrics, failures can be diagnosed by label and scenario, an approved baseline can prevent regressions, and a per-task model recommendation can be exported in a form MemoryApi consumes directly. Latency and token use remain visible; they do not substitute for task quality, but they do act as a hard budget filter during model selection.

## Current-State Findings

- `exact-label` is declared as a purpose strategy, but `PromptfooAdapter` does not build an assertion for it. `TestCase.expectedOutput` is also ignored. The Classification starter cases therefore do not receive strict correctness grading; their current `expectedKeywords` checks would accept explanatory text containing the label.
- Tagging is graded by one Jaccard assertion with a `0.5` threshold. It does not separately reject unknown tags, duplicate tags, non-canonical spelling, or wrapper text, and it does not expose precision, recall, F1, exact-set accuracy, or rare-tag performance.
- Summarization has five starter cases and a general three-dimension judge template. Cases have no reference summaries, required facts, forbidden claims, protected tokens, deterministic format checks, judge calibration anchors, or adversarial inputs.
- `data/evals/test-suites/` contains no reusable built-in suites. Purpose templates carry editable starter cases, conflating a quick-start example with a regression benchmark.
- MemoryApi has eight categories and 61 tags. Its 26 production seed memories cover only Preference (17), Note (8), and Event (1). Its 48 sample memories cover all eight categories. Across both files, ten tags remain uncovered: Family, Plan, Summary, To Do, Watch Later, Test, Improve, Design, Shopping, and Video Game.
- MemoryApi output filtering and fallback can make the stored result look valid even when the raw model response violated the prompt contract. LMEval must measure the raw response; MemoryApi separately measures the complete production pipeline.
- LMEval sends no inference parameters. `buildLmapiProvider` in `server/services/PromptfooAdapter.ts` posts only `model`, `messages`, `stream`, and `groupId`, so every cell runs at the provider default temperature. MemoryApi runs these tasks at explicit temperatures and output-token ceilings. Until LMEval can set and record `temperature` and `maxTokens` per evaluation, a result cannot be claimed to measure the production configuration, and this plan's promise to persist inference parameters is unsatisfiable.
- LMEval and MemoryApi do not call LMApi the same way. LMEval posts `messages: [system, user]` to `/api/chat/completions/any`; MemoryApi's `LMApiClient` joins the messages into one `ROLE: content` string and posts it as `prompt` to `/api/generate/any`. A prompt that wins in LMEval is therefore not the prompt MemoryApi executes. Transport parity is a precondition for this workflow, not a detail.
- The shipped built-ins already use different config keys than this plan's union. `data/evals/purpose-templates/classification.json` uses `config.categories`; `tagging.json` uses `config.tagVocabulary` and `config.threshold`. Migration must accept these as aliases rather than assume a clean field set.
- `EvaluationConfig.comparisonMode` already distinguishes `model`, `prompt`, and `matrix`, but nothing downstream produces a model-selection verdict. Model ranking today means reading an average composite score off the leaderboard, which is the wrong statistic for these three tasks.

## Data Model and Storage

### Task-specific assertion strategies

Replace the open-ended `AssertionStrategy.config: Record<string, unknown>` with a discriminated union. Validate persisted JSON at the service boundary and return a clear `400` response for invalid custom templates.

```ts
type AssertionStrategy =
  | {
      type: 'exact-label';
      config: {
        labels: string[];
        caseSensitive: true;
        trimOuterWhitespace: true;
      };
    }
  | {
      type: 'label-overlap';
      config: {
        vocabulary: string[];
        separator: ',';
        minimumCaseF1: 0.8;
        rejectUnknown: true;
        rejectDuplicates: true;
        requireCanonicalCase: true;
      };
    }
  | {
      type: 'grounded-summary';
      config: {
        templateId: 'summarization-quality';
        minimumCompressionRatio: number;
        maximumCompressionRatio: number;
        judgeRepeats: 3;
      };
    }
  | { type: 'custom'; config: Record<string, unknown> };
```

The built-in summaries use `grounded-summary`; accept legacy `llm-rubric` records during deserialization and normalize them to the new form. Existing custom strategies continue through the `custom` branch.

Normalization must also cover the keys the shipped built-ins actually use today, not just the type names:

| Legacy key (on disk now) | Normalized key |
|---|---|
| `exact-label.config.categories` | `labels` |
| `label-overlap.config.tagVocabulary` | `vocabulary` |
| `label-overlap.config.threshold` | `minimumCaseF1` |
| `llm-rubric` + `config.dimensions` | `grounded-summary` + `templateId` |

Read accepts either spelling and prefers the normalized key when both appear; write emits only the normalized key. Rewrite the three files under `data/evals/purpose-templates/` in the same change so the repository and the type stay in agreement.

### Test cases

Extend `TestCase` with the following fields:

```ts
expectedLabels?: string[];
caseTags?: string[];
requiredFacts?: string[];
forbiddenClaims?: string[];
protectedTokens?: string[];
```

- `expectedOutput` remains the classification ground truth and `referenceAnswer` remains the preferred summary.
- `expectedLabels` is the canonical multi-label ground truth.
- `caseTags` contains analysis dimensions such as `split:regression`, `boundary:event-history`, `length:long`, and `risk:prompt-injection`.
- Continue accepting the current `tags` field as a deprecated import alias for `expectedLabels`. On read/import, use `expectedLabels` when both are present and emit a warning when their values differ. New exports write only `expectedLabels` and `caseTags`.

Update JSON/CSV parsing, serialization, the suite editor, and API types together. CSV uses semicolon-delimited arrays in the columns `expectedLabels`, `caseTags`, `requiredFacts`, `forbiddenClaims`, and `protectedTokens`.

### Built-in suites

Extend `TestSuite` with:

```ts
builtIn: boolean;
purposeCategory?: 'classification' | 'tagging' | 'summarization' | 'custom';
version: string;
provenance?: {
  source: string;
  sourceRevision: string;
  taxonomySha256: string;
  datasetSha256: string;
  importedAt: string;
};
```

Add `defaultTestSuiteId?: string` to `EvalPurposeTemplate`. Selecting a purpose template still copies its starter cases for a smoke run, while the configuration page recommends and can load its linked benchmark suite.

Use separate locations:

- Version-controlled built-ins: `<repoRoot>/data/evals/test-suites/built-in/*.json`
- Writable suites: `<dataRoot>/evals/test-suites/custom/*.json`
- Legacy suites directly under `<dataRoot>/evals/test-suites/`: read and list as custom until explicitly re-saved; do not migrate or delete them automatically.

`TestSuiteService.list()` merges the three sources and rejects updates or deletes when `builtIn` is true. Configure both paths through `FileService.configurePaths()` so standalone and hosted modes resolve the same built-ins while keeping host-owned custom data under the injected data root.

## Execution Fidelity

A benchmark result is only transferable if LMEval executes the task the way MemoryApi executes it. Three things must match, and today none of them do.

### Inference parameters

Add optional inference parameters to `EvaluationConfig` and thread them through `PromptfooAdapter.buildLmapiProvider` into the LMApi request body:

```ts
inference?: {
  temperature: number;
  maxTokens: number;
  seed?: number;
};
```

Resolution order is per-run config, then the purpose template's declared defaults, then LMApi's default. Built-in purpose templates declare the values MemoryApi uses in production: classification `temperature 0` / `maxTokens 50`, tagging `temperature 0` / `maxTokens 100`, summarization `temperature 0.1` / `maxTokens 150`. Persist the resolved values on every result, and mark any result that ran without explicit parameters as `inferenceParametersUnspecified` so it cannot be used as a baseline or a promotion input.

The output-token ceiling is itself a measured variable, not a constant: record `finishReason` per cell and report a truncation rate. A summarization model that scores well only because it was cut off at 150 tokens has not passed.

### Transport parity

LMEval's `LmapiClient` posts structured chat messages; MemoryApi's `LMApiClient` flattens them into one prompt string. Whichever call shape the two projects settle on, they must settle on the same one, and this plan assumes MemoryApi moves to structured chat messages against the chat-completions endpoint, because that is what preserves the instruction/content separation both plans depend on.

Record the LMApi endpoint path and message shape in each evaluation's provenance. If a MemoryApi snapshot declares a transport LMEval did not use, report stale provenance and refuse to treat the run as a promotion input rather than silently comparing across transports.

### Prompt shape

MemoryApi will send a stable system instruction plus a user message containing only `<memory>`-delimited content. LMEval's provider already sends `prompt` as the system message and `vars.userMessage` as the user message, which matches. Imported snapshots must therefore carry the delimiter wrapper inside `userMessage` exactly as production will send it, including the escaping rule for a literal closing delimiter. A benchmark whose cases omit the wrapper measures a prompt that is never run.

## Benchmark Suites

Build the corpus from MemoryApi's versioned evaluation datasets, not directly from operational production stores. Cases derived from real corrections must be sanitized and human-reviewed before import. Prompt few-shot examples cannot appear verbatim in a benchmark.

Every suite marks 25% of cases with `split:regression`. Reports always show calibration and regression slices separately. The regression slice is run for promotion and baseline checks, not used to choose prompt wording during ordinary tuning.

### `memory-classification-v1` — 64 cases

- Exactly eight cases for each of Preference, Reminder, Snippet, Event, Note, Prompt, Idea, and History.
- Per category: at least three clear positives, three boundary/competing-intent cases, one noisy or abbreviated case, and one embedded-instruction or format-pressure case. A case may satisfy more than one slice.
- Include explicit boundaries for Event/History, Note/Snippet, Prompt/Idea, and Reminder/Note.
- Store the canonical label in `expectedOutput`; do not add `expectedKeywords` as a substitute.

### `memory-tagging-v1` — 72 cases

- Cover all 61 tags from MemoryApi `allTags.json` at least twice as positive labels.
- Include all ten tags absent from the current seed-plus-sample corpus.
- Include at least 12 near-neighbor cases, including Test/Testing, Prompt/Prompt Engineering, Notes/Summary, Reminder/Action Required, Project/Plan, and Software/Utility.
- Include sparse one-label cases, realistic two-to-four-label cases, intentionally dense content, irrelevant-label traps, noisy text, and at least eight embedded-instruction or output-format attacks.
- Store truth in `expectedLabels`; treat array order as irrelevant while requiring canonical spelling in raw output.

### `memory-summarization-v1` — 36 cases

- Twelve short, twelve medium, and twelve long source memories.
- Balance preferences, decisions, reminders, technical notes, project state, events/history, and mixed-content notes.
- Each case has `referenceAnswer`, `requiredFacts`, `forbiddenClaims`, and `protectedTokens` where the source contains names, dates, quantities, tools, or project identifiers.
- Include at least six noisy-input cases, six embedded-instruction cases, six entity/number preservation cases, and cases with both current and superseded details.

Before committing a built-in suite, run a dataset linter that rejects duplicate IDs, labels outside the taxonomy, missing category coverage, tag support below two, malformed slice tags, missing summarization annotations, prompt-example leakage, and provenance hashes that do not match the imported snapshot.

## Scoring and Promotion Gates

### Classification

For each raw response, record:

- `exactOutput`: trimmed output exactly equals the canonical, case-sensitive label.
- `normalizedCorrect`: case-insensitive trimmed output maps to the expected label.
- `formatCompliant`: the response contains only one canonical label, with no prefix, suffix, punctuation, quote, or explanation.
- `validLabel`: normalized output belongs to the configured label set.

Aggregate accuracy, macro-F1, per-class precision/recall/F1, invalid-label rate, format-compliance rate, confusion matrix, run-to-run agreement, latency, and token use. Promotion requires macro-F1 at least `0.90`, recall of at least `0.80` for every class, zero invalid labels, and 100% format compliance.

### Tagging

Parse the raw comma-separated output without silently repairing it. Compare case-insensitively for semantic scoring but report casing, unknown labels, duplicates, empty items, and wrapper text as contract violations.

For each case, record TP/FP/FN, precision, recall, F1, Jaccard, exact-set match, unknown tags, duplicate tags, and format compliance. A case passes only when it has no unknown labels, no duplicates, canonical format, and F1 at least `0.80`.

Aggregate micro and macro precision/recall/F1, mean Jaccard, exact-set accuracy, invalid-output rate, per-tag support/recall, run-to-run agreement, latency, and token use. Promotion requires micro-F1 at least `0.85`, macro label-F1 at least `0.70`, exact-set accuracy at least `0.60`, and zero invalid labels.

### Summarization

Run deterministic checks before model grading:

- Non-empty, plain summary with no preamble, heading, fence, or explanation.
- Configured compression-ratio range, measured consistently by Unicode word count.
- Exact preservation of required protected tokens unless a case explicitly permits a normalized variant.
- Absence of literal forbidden claims. Semantic unsupported claims are handled by the judge.

Revise `summarization-quality` to use Faithfulness `0.40`, Salient Coverage `0.30`, Retrieval Utility `0.20`, and Concision `0.10`. The judge receives the source, candidate summary, reference answer, required facts, forbidden claims, and protected tokens. It scores each dimension from 1–5 with dimension-specific anchors and identifies unsupported claims in structured output.

Use three independent judge passes at temperature 0 and aggregate each dimension by median. The candidate model cannot judge itself. Promotion requires a median weighted score of at least `4.2`, median Faithfulness of at least `4.5`, no critical unsupported claim, and 100% deterministic output-contract compliance.

#### Judge qualification

A local judge model is an instrument, and an uncalibrated instrument makes the `4.2` gate meaningless. Before a model may be used as a judge, qualify it once against a fixed calibration set of at least 20 summaries that carry human dimension scores, drawn from the MemoryApi snapshot's adjudicated records:

- Spearman correlation with the human overall score of at least `0.6`.
- Faithfulness agreement within one point on at least 80% of the calibration summaries.
- No systematic inflation: mean judge overall minus mean human overall within `0.5`.
- Self-consistency across its three passes: median absolute deviation at or below `0.5` per dimension.

Store the qualification as a `JudgeQualification` record with the judge model id, calibration-set hash, date, and measured statistics. Re-qualify when the judge model or the calibration set changes. Report the judge's qualification alongside every summarization verdict, and label a summarization result advisory rather than promotable when the judge is unqualified. Compression bounds for `grounded-summary` are derived from the same reviewed data rather than guessed: set them from the 10th and 90th percentile compression ratios of the v1 reference summaries and record the derivation in the suite's provenance.

### Shared regression rule

Persist task metrics in a discriminated `EvaluationSummary.taskMetrics` union rather than manufacturing rubric composite scores for classification and tagging.

A candidate fails promotion when a primary metric regresses against the approved baseline by more than the larger of two percentage points and the dataset's own resolution. That second term matters: a 16-case regression slice moves in 6.25-point steps, so a bare "2 pp" rule reduces to "any single case flipped" and will fail candidates on noise. Compute and report, per primary metric:

- The point estimate, the number of cases behind it, and one case's worth of movement in percentage points.
- A 95% bootstrap confidence interval over cases, and for paired baseline-versus-candidate comparison a McNemar test on the discordant cases.

Express gates against the confidence interval, not the point estimate. A candidate is a regression when the paired comparison is significant and the point drop exceeds the threshold; a candidate is a genuine improvement only when its interval's lower bound clears the floor. When the interval is too wide to decide, report `inconclusive` and say how many additional cases would be needed rather than issuing a pass. Regression slices smaller than the resolution a gate implies must either grow or have their gate restated in cases (for example, "no more than one regression-slice case may flip"), and this is the honest reading of the v1 slice sizes: the classification and tagging regression slices support case-count rules, not two-point rules.

Default classification and tagging runs use temperature 0 and at least three runs per prompt/model/case to reveal instability. Summarization uses at least two candidate runs and three judge passes per response. Persist prompt, taxonomy, dataset, model, provider, inference parameters, and judge identity with every result.

## Per-Task Model Selection

Prompt refinement and model selection are different experiments and must not be run as one undifferentiated matrix. Interleaving them produces a winner that cannot be attributed to either variable.

### Two-phase protocol

1. **Prompt phase** — fix one reference model per task and vary the prompt. The reference model is the current production `LLM_MODEL`, so results stay comparable to the deployed system. Use `comparisonMode: 'prompt'`, the calibration split only, and the gates above.
2. **Model phase** — fix the prompt promoted in phase 1 and vary the model across the candidate slate. Use `comparisonMode: 'model'` and run both splits.

Re-run a short confirmation of phase 1 on the phase-2 winner before recommending it. A prompt tuned on one model does not automatically transfer, and the confirmation run is what detects that. When the winner's confirmation fails, record it and recommend the runner-up rather than shipping an unconfirmed pairing.

### Candidate slate

The slate is declared per evaluation, not hardcoded, and is recorded in the result. Choose it to answer a real deployment question rather than to enumerate everything installed: for each task include the incumbent production model, at least one smaller/faster model, at least one larger model that fits the host's VRAM, and any instruction-tuned model already resident on the LMApi pool. Record for each candidate its LMApi server, parameter size, quantization, and context length, because a recommendation is only actionable together with the hardware it was measured on.

### Selection rule

Rank strictly, in this order, and record the rule with the verdict:

1. **Gate** — discard any model failing the task's absolute quality gate or emitting any invalid output. A fast model that violates the output contract is not a candidate at any latency.
2. **Quality** — rank survivors by the task's primary metric (classification macro-F1, tagging micro-F1, summarization median weighted judge score) using confidence intervals. Models whose intervals overlap are a tie group, not a ranking.
3. **Budget** — within a tie group, rank by p95 latency per memory. Ingestion runs three tasks per memory, so the per-task budget is a share of a whole-ingestion target, and the plan records that target rather than a per-call number invented in isolation.
4. **Stability** — break remaining ties by run-to-run agreement across the repeated runs, then by output-token efficiency.

Report the full ordering, the tie groups, and the discarded-by-gate list. A recommendation that names only a winner hides the fact that second place was statistically indistinguishable and half the latency.

### Model-swap cost

A per-task recommendation of three different models is not free. If MemoryApi runs all three tasks per ingestion, three distinct models mean either three resident models or a swap per memory. LMEval measures per-call latency and cannot see this, so the report states the swap question explicitly rather than implying the three winners compose:

- Report the winner per task **and** the best single model across all three tasks, with the quality delta between them.
- Flag when the per-task winners span more than one LMApi server or exceed a declared total VRAM budget.

The single-model option is the honest default when the aggregate quality gain from per-task models is inside the confidence intervals. MemoryApi owns the residency and swap-cost measurement, and its result decides.

### Recommendation record

Emit one `ModelRecommendation` per task as a first-class artifact, not prose in a report:

```ts
interface ModelRecommendation {
  task: 'classification' | 'tagging' | 'summarization';
  recommendedModelId: string;
  runnerUpModelIds: string[];
  discardedByGate: Array<{ modelId: string; reason: string }>;
  primaryMetric: { name: string; value: number; ci95: [number, number] };
  p95LatencyMs: number;
  inference: { temperature: number; maxTokens: number };
  promptId: string;
  promptVersion: number;
  suiteId: string;
  suiteVersion: string;
  provenance: { taxonomySha256: string; datasetSha256: string; sourceRevision: string };
  evaluationId: string;
  judgeQualificationId?: string;
  singleModelAlternative?: { modelId: string; qualityDelta: Record<string, number> };
  generatedAt: string;
}
```

This is the unit MemoryApi consumes. It is advisory: LMEval writes it to its own export directory and never into the MemoryApi repository.

## Results and Reporting

- Add task-specific summary panels: confusion/per-class metrics for classification, micro/macro and per-tag metrics for tagging, and judge dimensions plus unsupported-claim findings for summarization.
- Add slice tables for calibration/regression, boundary pairs, input length, ambiguity, and prompt-injection cases.
- Display invalid outputs and run stability separately from semantic correctness.
- Keep latency, tokens, and throughput in the performance area; do not blend them into the quality score.
- Add a model-selection view for `comparisonMode: 'model'` runs: gate pass/fail per model, primary metric with confidence intervals and tie groups, p95 latency, truncation rate, run-to-run agreement, and the resulting recommendation.
- Show quality and latency together on one axis pair so a tie group's cheapest member is visible, rather than ranking on a single blended number.
- Include benchmark version, provenance hashes, resolved inference parameters, transport, and judge qualification in HTML/Markdown exports and baseline comparisons.

## Interchange Contract

Both plans describe the same two artifacts in prose, from opposite ends. Prose on both sides drifts. Define them once, as JSON Schema, in MemoryApi under `docs/evaluation/schemas/`, versioned as `memory-eval-snapshot.v1.schema.json` and `prompt-promotion-record.v1.schema.json`. LMEval vendors a copy under `data/evals/schemas/` and validates on import; a schema-version mismatch is a hard import failure with a clear message, never a best-effort parse.

**Snapshot — MemoryApi to LMEval.** Taxonomy (categories, tag groups with descriptions), the three datasets with per-case grounding fields and split/slice tags, the production prompt text and version for each task, the declared inference parameters and transport, and the provenance hashes. LMEval treats every field as reviewed input and re-verifies the hashes on import.

**Promotion record — LMEval to MemoryApi.** The evaluated prompt and model, resolved inference parameters, task metrics with confidence intervals, slice breakdowns, gate verdicts, judge qualification, the `ModelRecommendation` set, and the snapshot hashes the run consumed. MemoryApi validates that the record's hashes match its current taxonomy and datasets before a human considers it.

Direction is asymmetric by design. MemoryApi owns truth and receives advice; LMEval owns measurement and receives data. Neither writes into the other's repository, and neither calls the other at runtime. Both artifacts move by human review and commit.

### What each project gains

- **MemoryApi gains from LMEval:** task-appropriate metrics instead of a single accuracy number, slice-level failure diagnosis, repeated-run stability, a calibrated summarization judge, per-task model recommendations it cannot produce from its own single-model evaluators, and regression gates against an approved baseline.
- **LMEval gains from MemoryApi:** a real taxonomy with adjudicated ground truth, a reviewed benchmark corpus with grounding annotations, an annotation guide that makes label disputes resolvable, the raw-versus-pipeline distinction that keeps LMEval honest about what it is measuring, and a production consumer that turns eval features into decisions rather than dashboards.
- **Both gain:** the built-in suites, the strategy union, the model-selection protocol, and the statistics work are all task-generic. Any future fixed-vocabulary classification, multi-label tagging, or grounded summarization task in either project reuses them unchanged.

### Relationship to the automated refinement loop

The refinement loop in `docs/features/automated-refinement/AUTOMATED_REFINEMENT.md` is the intended engine for iterating on these prompts, and these suites are what make it safe to run. Two constraints apply when it targets a MemoryApi prompt:

- It may read and optimize against the calibration split only. Exposing the regression split to an automated optimizer converts the promotion gate into a training objective and destroys its value.
- Its output is a candidate prompt for human review in MemoryApi, never a cross-repository write. Phase 8b's auto-commit applies to LMEval's own data directory, not to MemoryApi's prompt files.

## Implementation Sequence

1. Add inference-parameter support and provenance for transport and resolved parameters. This is first because every later measurement is untrustworthy without it.
2. Add typed strategies with legacy key normalization, and backward-compatible test-case parsing.
3. Add built-in suite storage, immutability, purpose-template links, and hosted-path coverage.
4. Implement exact classification and strict multi-label assertions with unit tests.
5. Implement grounded-summary deterministic checks and repeated-judge aggregation.
6. Add task-level aggregation, confidence intervals, paired comparison, gates, slice reporting, and baseline comparison.
7. Vendor the interchange schemas and implement validated snapshot import; import the reviewed MemoryApi v1 datasets and wire the three built-in purpose templates to them.
8. Add judge qualification and the calibration-set workflow.
9. Add the two-phase model-selection protocol, the `ModelRecommendation` export, and the promotion-record export.
10. Add UI and export coverage, then run model-backed baselines through LMApi.

## Verification

Automated checks:

- Unit tests for exact-label wiring, expected-output handling, canonical tag parsing, duplicates/unknowns, F1/Jaccard, summarization checks, median judge aggregation, task metrics, gates, and legacy `tags` imports.
- Tests proving inference parameters reach the LMApi request body, resolve in the documented precedence order, persist on results, and that a run without explicit parameters is marked unusable as a baseline.
- Tests for legacy assertion-config key normalization (`categories`, `tagVocabulary`, `threshold`, `llm-rubric`) in both read and write directions.
- Statistics tests for bootstrap intervals, McNemar paired comparison, per-case resolution reporting, and the `inconclusive` verdict.
- Schema-validation tests for snapshot import, including hash mismatch, transport mismatch, and schema-version mismatch failures.
- Tests for judge qualification thresholds and for downgrading an unqualified judge's summarization verdict to advisory.
- Model-selection tests covering gate exclusion, tie grouping from overlapping intervals, latency tie-breaking, and `ModelRecommendation` construction.
- Service/API tests proving built-ins list correctly and cannot be updated/deleted, while custom and legacy suites remain writable.
- Dataset-lint tests proving all eight categories and all 61 current tags meet coverage rules.
- Hosted adapter tests proving built-ins resolve from the repository root and custom suites from the injected data root.
- UI/E2E tests for selecting a purpose template, loading its recommended suite, running an evaluation, filtering slices, and rendering task metrics.
- `npm run lint`, `npm run test`, production build, hosted frontend build, and host adapter build.

Runtime acceptance:

- Run each suite against at least one baseline and one candidate through LMApi.
- Run one full two-phase model-selection cycle per task over a declared candidate slate and confirm the recommendation, tie groups, and single-model alternative are produced and exported.
- Confirm the raw responses, repeated runs, judge identity and qualification, provenance, resolved inference parameters, transport, task metrics, confidence intervals, and promotion verdict persist and export correctly.
- Confirm a prompt that wins in LMEval reproduces its measured behavior when MemoryApi runs it against the same model and parameters. A divergence here is a transport or parameter-parity defect and blocks promotion.
- Report model-backed verification separately from automated checks; do not claim it from unit tests alone.

## Non-Goals and Safety

- No automatic synchronization or promotion into MemoryApi. Model recommendations and promotion records are advisory exports that a human reviews and copies.
- No reading from or writing to production MemoryApi stores.
- No use of operational seed files as the only benchmark.
- No optimizing against the regression split, by hand or by the automated refinement loop.
- LMEval does not measure end-to-end ingestion latency or model residency cost. It times single calls against a warm pool; MemoryApi owns the pipeline measurement, and a recommendation is not actionable until MemoryApi has made it.
- Open-ended tag suggestion and post-search aggregation evaluation are follow-on work.
