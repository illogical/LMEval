---
name: lmeval-evaluation-workflow
description: "Configure, validate, review, run, monitor, or interpret real LMEval evaluations through its agent API and browser handoff. Use for prompt comparisons, model comparisons, evaluation matrices, MemoryApi classification/tagging/summarization checks, or requests to verify LMEval against live models. Do not use for generic model advice or for modifying LMEval implementation code."
---

# Run a LMEval Evaluation

Use LMEval's checked-in API contract and existing typed client to produce a reproducible evaluation with visible evidence. Prefer a saved draft and browser review before starting.

## Required sequence

1. Read `references/workflow.md` before making API calls.
2. Discover current servers/models, prompts, purpose templates, suites, sessions, and relevant prior evaluations before creating resources.
3. State the question and vary exactly one experimental axis:
   - prompt comparison: one model and at least two prompts;
   - model comparison: one promoted/pinned prompt and at least two models;
   - matrix: only when interactions between both axes are the actual question.
4. Use reviewed ground truth. Start with calibration cases; never expose or tune against sealed regression cases. Preserve production wrappers, delimiter escaping, taxonomy, inference, and output contracts.
5. Disclose the selected servers/models, prompt versions, inference settings, repetitions, case count, and estimated candidate and judge call counts.
6. Call validation. Stop on validation or LMApi discovery errors; do not reinterpret unavailable discovery as invalid model IDs.
7. Create a draft, report its direct `browserPaths.config` link, and invite review. Start immediately only when the user explicitly requested an unattended run or already approved the exact configuration.
8. Start once, poll feedback to a terminal state, then inspect canonical results and summary endpoints. Explain raw failures, confidence intervals, gates, slices, advisory reasons, and the smallest useful next experiment.

## Quality and safety rules

- Treat ground truth as human-reviewed input, never as something inferred from the candidate output.
- Include representative, boundary, noise, adversarial, and format-compliance cases when the goal is more than a mechanics smoke. Preserve `caseTags` for slice analysis and include sparse-label cases for tagging.
- Small smoke runs prove mechanics only. A point estimate without adequate cases is not a stable verdict; a confidence interval crossing a gate is inconclusive.
- Summarization is advisory when the judge is missing, unqualified, or self-judging. Use a non-self judge and report its qualification state.
- Stop and report the precise blocker on validation, LMApi, execution, or judge failure. Never silently repair outputs or substitute models/cases.
- Never infer permission to delete resources, commit prompt history, promote a result, modify MemoryApi, or write outside LMEval.
- Do not auto-commit the nested `data/` repository.

## Maintained sources

- Wire contract: `docs/openapi/lmeval-eval-api.v1.json`
- Product and scoring behavior: `docs/SPECIFICATION.md`
- Executable draft-first example: `npm run test:agent-workflow -- --model=server::model --judge=server::judge`

Do not duplicate the OpenAPI schema in this skill. When fields or endpoints disagree, the checked-in OpenAPI artifact and specification win.
