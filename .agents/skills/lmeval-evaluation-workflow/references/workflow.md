# LMEval workflow reference

## Discovery and reuse

Use the typed `scripts/lib/LMEvalClient.ts` where practical. Discover before creating:

- grouped models from `/api/eval/models/by-server`;
- prompts and their version history;
- purpose templates, judge templates, test suites, and sessions;
- earlier evaluations that may already answer the question.

Prefer reuse when an existing artifact has the correct production contract. New prompts are acceptable for an explicit experiment or isolated mechanics smoke. Pin every prompt version in the draft.

## Draft-first orchestration

1. Construct `EvaluationInput` with one test source: built-in suite, inline cases, or `userMessage`.
2. `POST /api/eval/evaluations/validate`.
3. `POST /api/eval/evaluations/drafts` and retain the ID, prompt pins, and returned browser paths.
4. Review or edit at the returned config path. API-only matrices remain fully visible but read-only if the browser wizard cannot safely represent them.
5. `PATCH` only while draft. A prompt-content change creates and pins a new prompt version.
6. `POST /:id/run` exactly once. A `409` means another caller already started it; do not retry as a new run.
7. Poll `GET /:id/feedback`. Use detailed results/summary endpoints for diagnosis.

Legacy `POST /api/eval/evaluations` remains create-and-start, but draft-first is the normal agent path.

## Experiment design

- Calibration precedes regression. Never copy regression cases into prompts or inline examples.
- Inline live smokes may copy a few exact calibration cases to bound cost while keeping production input wrappers and output constraints.
- Use deterministic settings for comparisons unless variance is the subject. Record temperature, max tokens, seed when supported, and repetitions.
- Compute candidate calls as prompts x models x cases x repetitions. Add judge calls separately; grounded summarization currently performs three rubric passes for each of four dimensions per candidate response.

## Interpretation

- Separate execution health from assertion quality. A completed call may fail assertions; an execution failure means the provider call itself failed.
- Report terminal status, completed/failed cell counts, primary metric and CI, gate verdict, case count, assertion failures, and advisory reason.
- Do not claim promotion readiness from a mechanics smoke, pending-human-review data, an unqualified judge, or an inconclusive confidence interval.
- Preserve durable evaluations and prompts. Cleanup is limited to resources explicitly identified as isolated test fixtures and authorized for deletion.
