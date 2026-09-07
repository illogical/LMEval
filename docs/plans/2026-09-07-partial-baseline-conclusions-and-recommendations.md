# Partial baseline conclusions and recommendations

Snapshot: 2026-09-07, approximately 01:46–01:48 EDT (05:46–05:48 UTC).
Status: provisional analysis of live API evidence; no production promotion recommended.

## Decision

**Use `Tiny-Tower::granite4.1:8b` as the reference candidate for the next classification and tagging experiments.** It outperformed `granite3.3:8b` on both completed pilots, with better classification contract adherence and substantially better tagging recall. This supports prioritizing it for further work, not declaring it the best of the four viable candidates or deploying it on the strength of these runs.

Keep `ministral-3:8b` and `nemotron-mini:4b` in contention: the unfinished sweeps do not yet expose canonical results sufficient to rank them. Keep Granite 3.3 as a comparison/control if useful, but give it lower priority than Granite 4.1. There is no defensible summarization winner yet.

## Evidence available at the snapshot

Read live configurations, feedback, results, and summaries from `http://localhost:17110/lmeval/api/eval/evaluations`. The hosted service is authoritative for this assessment; these run IDs are not present in this checkout's `data/evals/evaluations` directory.

| Evaluation | ID | Observed state | Usable evidence |
|---|---|---|---|
| Classification pilot | `eval-mtqn260d-12ab9a` | Completed; 96 successful cells, 0 execution failures | 48 cases per model; canonical results and summary |
| Tagging pilot | `eval-mtqn3ctk-9s9oy6` | Completed; 108 successful cells, 0 execution failures | 54 cases per model; canonical results and summary |
| Classification full sweep | `eval-mtqng5ib-3e7fah` | Running; 258/288 completed, 0 reported failures | Progress only; results and summary endpoints returned 404 |
| Tagging full sweep | `eval-mtqng603-05dmtz` | Running; 253/324 completed, 0 reported failures | Progress only; results and summary endpoints returned 404 |
| Original summarization pilot | `eval-mtqn3d4k-2cwxj2` | Completed; 54 successful cells | No valid judge-based comparison: missing scoring template |
| Summarization v2 | `eval-mtqnbyng-3pyjnj` | Cancelled; feedback reports 32 completed, 0 failures of 54 | Incomplete, selected subset; unsuitable for a winner claim |
| Summarization v3 | `eval-mtqo0x9t-pvxrig` | Completed; **0 successful cells, 54 failures** | Every candidate call timed out after 120,000 ms |

The API actually marks **two** evaluations running. Their last reported progress timestamps were 05:42:54 UTC (classification) and 05:42:39 UTC (tagging). A running label and a single progress snapshot do not prove that work is still advancing or establish a stall. These counters also do not mean that completed calls passed their assertions.

The comparisons fix prompt version 1 and vary models, with `runsPerCell: 1`, temperature 0.3, and token caps of 50/100/150 for classification/tagging/summarization. Prompt IDs are `prm-mtqn1clk-51cizi`, `prm-mtqn1cmh-qu2607`, and `prm-mtqn1cne-szwdk8`, respectively. The suites are `memory-classification-v1`, `memory-tagging-v1`, and `memory-summarization-v1`, version 1.0.0, using the calibration split. All carry `pending-human-review` provenance.

## Classification: promising reference model, identifiable quality gaps

| Pilot metric | Granite 3.3 8B | Granite 4.1 8B |
|---|---:|---:|
| Correct cases | 33/48 | 41/48 |
| Accuracy | 68.8% | 85.4% |
| Macro-F1 | 0.695 | 0.847 |
| Reported 95% accuracy CI | 56.3–81.3% | 75.0–93.8% |
| Invalid labels | 3/48 | 0/48 |
| Per-model gate | Fail | Fail |

Granite 4.1 gains eight correct answers, or 16.7 percentage points, on the same 48 cases. This is a useful directional result. It is not a demonstrated statistically significant advantage here; no paired significance test was performed for this report, and repetitions are absent.

Its remaining errors are actionable. Note recall is **3/6**, with one Note classified as each of Prompt, Idea, and Event. History recall is **4/6**, with one classified as Event and one as Preference. The other misses are Prompt→Snippet and Idea→Prompt. Preference, Reminder, Snippet, and Event each have 6/6 recall, but six examples per category is weak evidence of robustness.

Recommendation: review the calibration labels for these disagreements, then compare the current prompt with one targeted clarification on a fixed Granite 4.1 model. Clarify Note versus a request/idea/event, and historical background versus an event or preference. Preserve the one-word contract and untrusted-memory boundary. Do not add regression examples to the prompt or change ground truth merely to agree with the model.

Granite 4.1's gate is **fail**, not merely inconclusive: its accuracy CI crosses 0.90, but two class recalls also fail the 0.80 floor. More cases can resolve uncertainty; they do not themselves repair observed category mistakes. The reported CI field is `accuracyCI`, not a macro-F1 bootstrap CI, despite the gate message referring to macro-F1. Do not present it as an F1 interval. The overall evaluation verdict is advisory because the benchmark is unreviewed.

## Tagging: Granite 4.1 retrieves more expected tags, but precision remains weak

| Pilot metric | Granite 3.3 8B | Granite 4.1 8B |
|---|---:|---:|
| Micro recall | 67.0% | 87.7% |
| Micro precision | 25.4% | 35.0% |
| Micro-F1 | 0.368 | 0.500 |
| Macro label-F1 | 0.224 | 0.377 |
| Exact set match | 1/54 (1.9%) | 8/54 (14.8%) |
| Mean Jaccard | 0.278 | 0.457 |
| Reported 95% Jaccard CI | 0.225–0.332 | 0.382–0.537 |
| Unknown-tag token rate | 36.6% | 37.8% |

Granite 4.1's recall advantage is 20.8 percentage points. That makes it the stronger next candidate under the documented MemoryApi behavior of dropping off-vocabulary tags. However, filtering unknown tags does not remove incorrect **in-vocabulary** tags, and it cannot recover missing expected tags. Raw precision is low for both models; a recall-oriented consumer still needs to measure the precision of the tags it actually stores.

The older baseline/follow-up wording needs care: `unknownTagRate` is unknown emitted tag tokens divided by total emitted tag tokens, **not the percentage of cases containing an unknown tag**. This follows `SummaryService.computeTaggingMetrics()`. Do not interpret 37% as an input-level failure rate.

Raw pilot outputs already show more than one failure form. Granite 3.3 emits `Work, Project, Atlas` on `mem-tag-001`, adding a project name outside the fixed vocabulary. On `mem-tag-010`, it emits `<tags>Plan, Customize, Workflow, Resource, Productivity</tags>`, contaminating otherwise recognizable tags with wrapper text. These examples establish off-list generation and formatting drift; they do not establish how frequently each cause occurs or prove a parser defect.

Recommendation: audit unknown strings and missing expected labels separately, then compare raw output with the exact downstream filtering behavior. Retain both views. Do not silently repair raw responses in the benchmark. Prioritize failures that change stored tags over harmless discarded extras, while retaining extra-tag frequencies as diagnostics.

The checked-in `penalizeExtraTags: false` implementation removes the unknown-tag hard gate and changes the CI-backed primary gate statistic to per-case recall. **It does not remove macro label-F1 or exact-set-match gates**, which both pilot models miss badly. The saved pilot summaries still show the older unknown-tag failure and Jaccard intervals; they are historical scoring artifacts, not proof of the new mode's behavior. Do not relabel their intervals as recall CIs, or pool old and new gate verdicts as one stable trend. The `jaccardCI` compatibility field still carries the interval in both modes, but new summaries now persist `gateMetric: 'jaccardMean' | 'microRecall'`; campaign, feedback, and insights consumers use that discriminator rather than mislabelling a recall interval as Jaccard.

## Summarization: repair the experiment before selecting a model

The v3 run's all-zero rubric summary comes from **zero successful candidate responses**, not measured poor summarization. Its `completed` status means execution ended, not that evaluation succeeded. The earlier unjudged pilot and cancelled 128B-judge attempt cannot fill that evidence gap.

Recommendation: after the active server workload clears, verify a small candidate-plus-judge path with an explicit `summarization-quality` template. Qualify `Tiny-Tower::qwen3.6:35b-a3b-q8_0` against reviewed human anchors before treating its judgments as promotion evidence; the v3 feedback explicitly says the judge is unqualified. A functioning judge is not necessarily an accurate judge. Select the summarization candidate set separately; classification/tagging performance does not establish summarization quality.

The baseline record attributes the timeout episode to GPU contention. The API confirms the timeouts; this assessment did not independently prove their infrastructure root cause. Avoid overlapping heavy judge work with candidate matrices on the same server, as the existing operational guidance recommends.

## Recommended next steps, in order

1. **Resolve and preserve the current sweeps.** Monitor whether progress advances and collect terminal per-model results. If they are stalled, investigate runtime activity before deciding on cancellation/retry. Do not treat missing results as zero scores or pool an uneven completed subset into a winner ranking.
2. **Respect the four-model candidate set.** Compare Granite 4.1, Granite 3.3, Ministral 3, and Nemotron Mini when comparable results exist. Exclude `granite4.2:8b` and `lfm2.5:8b` from recommendations and new runs until their documented LMApi response problems are independently resolved. Their presence in the old sweep is not evidence of admissibility.
3. **Review the benchmark and target observed errors.** Human review of calibration ground truth takes priority over increasing matrix size. Use the classification confusions and tagging missing/extra-label audit to choose one focused prompt experiment per task. Keep model comparison and prompt comparison separate.
4. **Confirm the shortlist under a fixed scoring policy.** Pin prompts, suite hash, inference settings, and tagging policy. Use repetitions to measure output variability, plus additional independent reviewed cases to improve coverage and CIs. Three repetitions of 48 cases are not 144 independent memories. Keep sealed regression cases for confirmation after choices are frozen.
5. **Recover and qualify summarization scoring before a broad sweep.** Start with a bounded mechanics check, then qualification and a reviewed candidate comparison. Do not extrapolate from timeout-generated zeros.
6. **Measure deployment costs separately.** The mixed Tiny-Tower/M5 Max hardware and concurrent workload make these durations unsuitable for model-speed rankings. After quality is established, benchmark latency on controlled hardware/workload and have MemoryApi measure end-to-end ingestion and model-switching costs before adopting task-specific models.

Promotion remains blocked by unreviewed ground truth, incomplete candidate comparisons, observed quality failures, and (for summarization) missing valid qualified-judge evidence. The useful decision today is where to spend the next evaluation effort: Granite 4.1 first, focused classification boundaries and tagging precision/recall diagnosis, then a clean summarization experiment.

## Source links and scope

- [Classification pilot results](http://localhost:17110/lmeval/eval/results/eval-mtqn260d-12ab9a)
- [Tagging pilot results](http://localhost:17110/lmeval/eval/results/eval-mtqn3ctk-9s9oy6)
- [Classification sweep](http://localhost:17110/lmeval/eval/run/eval-mtqng5ib-3e7fah)
- [Tagging sweep](http://localhost:17110/lmeval/eval/run/eval-mtqng603-05dmtz)
- [Summarization v3 results](http://localhost:17110/lmeval/eval/results/eval-mtqo0x9t-pvxrig)
- [Baseline record](2026-09-06-baseline-model-evaluation.md), [candidate exclusions and handoff](2026-09-07-model-candidate-status-and-handoff.md), and [follow-ups](2026-09-06-baseline-evaluation-followups.md)
- [Current specification](../SPECIFICATION.md) and [scoring implementation](../../server/services/SummaryService.ts)

This assessment used read-only API requests and existing artifacts. It did not start, stop, retry, rescore, or promote evaluations, change prompts or datasets, or modify MemoryApi. The recommendations are proposed follow-up work, not newly completed implementation tasks.

## Later terminal-state update

A read-only follow-up at approximately 02:38 EDT (06:38 UTC) found that both formerly running sweeps
had reached `completed`, but most candidate calls had failed:

| Evaluation | Terminal progress | Interpretation |
|---|---:|---|
| Classification full sweep `eval-mtqng5ib-3e7fah` | 106 successful, 182 failed of 288 | Partial evidence; do not infer a winner from the surviving subset |
| Tagging full sweep `eval-mtqng603-05dmtz` | 115 successful, 209 failed of 324 | Partial evidence; do not infer a winner from the surviving subset |

Both feedback records label their available verdict `advisory`. The terminal `completed` lifecycle means
the execution loop ended; it does not turn transport failures into measured quality. These outcomes
strengthen the recommendation to show successful and failed calls separately, retain partial evidence,
and require complete successful campaign phases before selecting or confirming a winner.
