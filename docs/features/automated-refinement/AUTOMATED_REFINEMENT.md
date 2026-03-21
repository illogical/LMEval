# Automated Refinement Loop

> **Phase**: 8 — long-term goal; implement after Phases 2–7 are complete
>
> **Purpose**: Close the feedback loop between evaluation results and prompt improvement. The system analyzes eval failures and low-scoring cells, generates concrete suggestions for improving the prompt (and optionally the eval definitions), and either presents them for human review or applies them automatically in a configurable loop.

---

## Phases of Implementation

### Phase 8a — Human-in-the-Loop (initial)
The system suggests improvements. A human reviews, selects which to apply, and approves each iteration. Each approval creates a new session version and triggers a new eval run.

### Phase 8b — Automated Loop (long-term)
The system runs suggest → apply → eval in a loop overnight. It commits improvements and reverts regressions automatically. A human reviews the final state.

### Phase 8c — Eval Definition Improvement (lower priority)
Separately from prompt improvement, the system can suggest refinements to the eval definitions themselves (new test cases, adjusted weights, refined perspective descriptions). Implemented after Phase 8a is stable.

---

## Core Concept: Why Failure Feedback Matters

When a model fails an eval, there are two possible explanations:
1. The **prompt** didn't guide the model clearly enough
2. The **eval** was testing the wrong thing (or testing it poorly)

The refinement loop must surface enough context to distinguish between these cases:
- Full raw model response (even malformed output)
- What the model was *attempting* (partial tool calls, truncated reasoning, refusal text)
- Which specific eval criteria failed and why
- The judge model's raw reasoning before its score was parsed

This data is already captured in `EvalMatrixCell` and `JudgeResult` (see `SESSION_MANAGEMENT.md` for the `retryAttempts` and `rawJudgeResponse` field additions). The refinement loop consumes this to construct high-quality feedback prompts.

---

## New Types

**Additions to `src/types/session.ts`**

```typescript
export interface ImprovementSuggestion {
  id: string;                    // "sug-{timestamp}-{random}"
  targetSlot: 'A' | 'B';        // which prompt this suggestion applies to
  currentContent: string;        // the current prompt content (for diff display)
  revisedContent: string;        // the proposed new prompt content
  rationale: string;             // why this change is suggested
  estimatedImpact?: string;      // e.g. "Should address 3 of 5 failures on test case 2"
  appliedAt?: string;            // ISO timestamp if this suggestion was applied
  rejectedAt?: string;           // ISO timestamp if this suggestion was rejected
}

export interface RefinementLoopConfig {
  maxIterations: number;         // stop after N iterations regardless of result
  targetScoreDelta: number;      // stop when score improves by this amount (e.g. 0.5)
  autoCommit: boolean;           // automatically git-commit each improvement
  autoRevertOnRegression: boolean;
  feedbackModel: string;         // model to use for improvement suggestions
  judgeModel: string;            // model to use for eval scoring
  delayBetweenIterationsMs: number;  // breathing room between iterations
}
```

---

## Backend: RefinementService

**File: `server/services/RefinementService.ts`**

```typescript
const RefinementService = {
  /**
   * Build the LLM prompt that asks for improvement suggestions.
   * Includes: the current prompt content, all failed/low-scoring cells with
   * their full context (raw response, error type, judge reasoning, retry history),
   * the eval template being used (perspectives + weights), and scoring summary.
   */
  buildImprovementPrompt(
    session: SessionManifest,
    activeVersion: SessionVersion,
    promptContent: string,
    evalResults: EvaluationResults,
    template: EvalTemplate
  ): string,

  /**
   * Parse the LLM response into structured suggestions.
   * Uses the same 4-step fallback chain as JudgeService (direct parse →
   * strip markdown → regex extract → return null with logged raw text).
   */
  parseSuggestions(rawResponse: string): ImprovementSuggestion[] | null,

  /**
   * Apply a single suggestion: create a new prompt version via PromptService,
   * then create a new session version via SessionService with the updated slot.
   */
  async applySuggestion(
    sessionId: string,
    suggestion: ImprovementSuggestion,
    description?: string
  ): Promise<{ promptManifest: PromptManifest; sessionVersion: SessionVersion }>,

  /**
   * Build the prompt for eval definition improvement suggestions.
   * Lower priority — Phase 8c.
   */
  buildEvalImprovementPrompt(
    session: SessionManifest,
    evalResults: EvaluationResults,
    template: EvalTemplate
  ): string,

  /**
   * Parse suggested eval improvements.
   * Returns proposed changes to test cases, perspective weights, etc.
   */
  parseEvalSuggestions(rawResponse: string): Partial<EvalTemplate> | null,
};
```

### Improvement Prompt Structure

The prompt sent to the feedback model includes these sections in order:

1. **Context block**: What LMEval is doing and what's expected of the model
2. **Eval template**: The scoring perspectives with weights and criteria
3. **Current prompt content**: The full system prompt being evaluated
4. **Failure summary**: Which cells failed, their test cases, and deterministic check results
5. **Failed cell details** (for top N failures, sorted by lowest score):
   - User message sent
   - Full raw model response
   - What the model was attempting (partial tool calls if any)
   - Judge's raw reasoning (from `rawJudgeResponse`)
   - Which perspective scores were lowest and why
6. **Instructions**: Ask for 1-3 concrete, specific rewrites of the problematic prompt sections. Output format: JSON array of `ImprovementSuggestion`

---

## REST API Routes

### Phase 8a Routes

```
POST /api/eval/sessions/:id/suggest-improvements
     Body: {
       evalRunId: string,          // which eval run to analyze
       targetSlot?: 'A' | 'B',    // which prompt to improve (default: lower scorer)
       feedbackModel?: string      // override REFINEMENT_MODEL env var
     }
     Loads the eval run's results.json + the session's eval template
     Calls RefinementService.buildImprovementPrompt() + LmapiClient.chatCompletion()
     Calls RefinementService.parseSuggestions()
     → ImprovementSuggestion[]

POST /api/eval/sessions/:id/apply-suggestion
     Body: { suggestion: ImprovementSuggestion, description?: string }
     Calls RefinementService.applySuggestion()
     → { promptManifest: PromptManifest, sessionVersion: SessionVersion }

POST /api/eval/sessions/:id/suggest-eval-improvements
     Body: { evalRunId: string, feedbackModel?: string }
     Phase 8c — lower priority
     → Partial<EvalTemplate> with proposed changes

GET  /api/eval/sessions/:id/suggestions
     Returns previously generated suggestions for this session (stored in session dir)
     → ImprovementSuggestion[]
```

### Phase 8b Route (deferred)

```
POST /api/eval/sessions/:id/refine-loop
     Body: RefinementLoopConfig
     Starts an automated refinement loop (background process)
     Streams progress via WebSocket (/ws/eval)
     WebSocket events: refine:iteration-started, refine:suggestion-applied,
                       refine:eval-completed, refine:committed, refine:reverted,
                       refine:loop-completed, refine:loop-failed
     → 202 { loopId: string }

DELETE /api/eval/sessions/:id/refine-loop/:loopId
     Cancel a running refinement loop
     → 200 { cancelled: true }
```

---

## Environment Configuration

**File: `.example.env`**

```env
# Model used for improvement suggestions (should be a high-quality model)
# Examples: qwen3:32b, llama3.1:70b, deepseek-r1:32b
REFINEMENT_MODEL=qwen3:32b
```

If `REFINEMENT_MODEL` is not set, the suggestion endpoint returns a 400 with:
```json
{ "error": "REFINEMENT_MODEL not configured. Set it in .env to use this feature." }
```

This prevents silent failures — the user must explicitly choose a capable model.

---

## Frontend: Phase 8a UI

### "Suggest Improvements" Button

Shown in the results panel after an eval run completes. Only active if `REFINEMENT_MODEL` is configured (the server exposes this via `GET /api/eval/health`).

Clicking the button:
1. Shows a loading state: "Analyzing failures…"
2. Calls `POST /api/eval/sessions/:id/suggest-improvements`
3. Displays suggestion cards when results arrive

### Suggestion Card

Each `ImprovementSuggestion` renders as a card:

```
┌────────────────────────────────────────────────────────┐
│ Suggestion for Prompt B                                │
│                                                        │
│ Rationale: The model struggled with tool selection     │
│ when multiple tools had overlapping descriptions.      │
│                                                        │
│ Estimated impact: Addresses 3/5 tool-calling failures  │
│                                                        │
│ [Show diff]  [Apply]  [Reject]                        │
└────────────────────────────────────────────────────────┘
```

"Show diff" expands a side-by-side diff view (uses `diff` npm package, same as `PromptDiff` component).

"Apply" calls `POST /api/eval/sessions/:id/apply-suggestion`. On success:
- Session gains a new version
- Prompt panel updates with new content
- Toast: "New session version created — run eval to compare"
- The button turns to "Applied ✓"

"Reject" marks the suggestion as rejected (local state only, no backend call needed unless you want to persist rejection rationale).

### Phase 8b: Loop Progress UI (deferred)

When an automated loop is running:
- The ProgressDashboard switches to "Refinement Loop" mode
- Shows iteration counter: "Iteration 3 of 10"
- Shows current action: "Running eval…" / "Generating suggestions…" / "Applying suggestion…"
- Shows score trajectory chart (live-updating line chart)
- "Cancel Loop" button stops the process after the current iteration completes

---

## Stop Conditions for the Automated Loop

The loop terminates when any of the following are met:
1. `maxIterations` reached
2. Score delta ≥ `targetScoreDelta` (goal achieved)
3. No improvement in 3 consecutive iterations (plateau detected)
4. Model returns no parseable suggestions
5. User cancels via DELETE endpoint
6. Any non-retryable error in LMApi

When the loop ends, a summary is written to the session run record:
```typescript
{
  loopSummary: {
    iterations: number,
    finalScoreDelta: number,
    stoppedReason: 'target_reached' | 'max_iterations' | 'plateau' | 'no_suggestions' | 'cancelled' | 'error',
    committedVersions: number,
    revertedVersions: number,
  }
}
```

---

## Git Integration in the Automated Loop

For each iteration:
- After eval completes: compare `scoreSummary.scoreDelta` to the previous iteration
- If improved: `GitService.commit('feat(prompt): improve {session.name} (+{delta} score)')`
  - Sets `EvalRun.committedAt` and `commitHash`
- If regressed: `GitService.revert(previousCommitHash)`
  - Restores previous prompt content
  - Session version reverts to the previous version pointer

This creates a clean git history where every commit represents a proven improvement.

---

## Failure Feedback for Diagnostic Context

The improvement prompt includes detailed failure context specifically to help the feedback model understand *what the model was trying to do* when it failed. This is key for:

1. **Prompt improvements**: Did the model misunderstand the instructions? Which part was unclear?
2. **Eval improvements**: Was the test case ambiguous or the expected behavior under-specified?

The failure context pipeline:
1. `EvalMatrixCell.response.content` — the full raw text response
2. `EvalMatrixCell.toolCalls` — what tool calls were attempted (even partial/malformed)
3. `JudgeResult.rawJudgeResponse` — the judge model's unprocessed reasoning
4. `EvalMatrixCell.deterministicMetrics` — which specific checks failed
5. `EvalMatrixCell.retryAttempts` — what happened on each retry attempt

This context is fed wholesale into the improvement prompt, giving the feedback model maximum information to generate targeted, specific suggestions rather than generic advice.

---

## Verification

### Phase 8a
1. `GET /api/eval/health` returns `{ refinementModel: 'qwen3:32b' }` when env var is set
2. Complete an eval with some failures → `POST /api/eval/sessions/:id/suggest-improvements` returns 1-3 suggestions with non-empty `rationale` and `revisedContent`
3. Click "Apply" on a suggestion → new session version created → prompt panel updates → run eval again → scores should show improvement trend
4. Click "Reject" → suggestion card shows rejected state; no backend call made

### Phase 8b (when implemented)
5. `POST /api/eval/sessions/:id/refine-loop` with `maxIterations: 3` → loop runs 3 iterations → WebSocket events arrive in correct order → loop summary written to session
6. Score improves: git log shows `feat(prompt):` commit; score regresses: git log shows `fix(prompt): revert` commit
7. DELETE loop endpoint → loop cancels after current iteration; final state is consistent
