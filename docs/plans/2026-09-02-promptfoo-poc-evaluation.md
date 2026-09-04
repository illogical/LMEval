# Promptfoo POC — Standalone Evaluation Spike

## Context

LMEval's `docs/features/eval-wizard/` already contains two documents that assume Promptfoo as the eval engine (`PROMPTFOO_CONFIG_WIZARD_MOCKUP_BRIEF.md` and `PREPARE_WIZARD_FUTURE_ITERATIONS.md`), but those were written from Promptfoo's documentation only — nobody has actually run it against a real local workload yet. Before LMEval takes on Promptfoo as a long-term dependency, it needs hands-on validation: does it actually make classification/tagging/summarization evals easier to build than hand-rolling them, does it play well with local Ollama + LMApi, and can it feed real-time progress into a UI the way LMEval's Run Dashboard needs?

This plan sets up a **separate, throwaway-quality POC project** (not inside the LMEval repo) that answers those questions using MemoryAPI's real classification/tagging prompts as the test subject, since that's a concrete use case the user already needs solved.

**Relevant finding from research:** OpenAI announced (Mar 2026) it is acquiring Promptfoo. Per OpenAI's and Promptfoo's own announcements, it stays open source under its current (MIT) license and existing customers continue to be supported, with the roadmap folding into OpenAI Frontier's agentic security/eval tooling. Not a blocker, but worth weighing in the final "is this worth the dependency" writeup — a lone-maintainer-turned-acquired-startup project can still have license/roadmap risk later.

**Real seed material found in `C:\LocalDev\Projects\MemoryAPI\src\`** (used directly instead of asking the user to paste anything):
- `prompts/categorization.txt` — single-label classification prompt with `{{categories}}` and `{{user_input}}` vars, few-shot examples baked in
- `samples/allCategories.json` — the finite 8-category label set: Preference, Reminder, Snippet, Event, Note, Prompt, Idea, History
- `prompts/tagging.txt` — multi-label tagging prompt, selects from `{{tags}}` (a fixed list) as a comma-separated list
- `samples/allTags.json` — ~60 tags across 4 groups (Context/Purpose, Cognitive/Intent, Domain/Subject, Technical/Usage)
- `prompts/memory_summary.txt` — simple summarization prompt (stretch scenario, deferred)
- `services/promptTemplateService.ts` — shows exactly how `{{categories}}`/`{{tags}}` get rendered, so the POC's Nunjucks templates can mirror MemoryAPI's real placeholder behavior

## Goal

Prove out, cheaply, whether Promptfoo is worth adopting inside LMEval by exercising the two evaluation axes the user cares about:
1. **Prompt-variant evaluation** — same model, compare two versions of the classification prompt
2. **Model-comparison evaluation** — same prompt, compare multiple local models

...and do it first against a bare localhost Ollama server, then swap to LMApi via HomeBase (`http://localhost:17110/lmapi/v1`, OpenAI-compatible) via **config change only**, to test whether Promptfoo genuinely decouples "which backend serves the model" from the eval definition.

**LMApi endpoint detail (confirmed against the repos, not assumed):** LMEval's own docs reference LMApi's older standalone port 3111, but LMApi now runs hosted under HomeBase's Docker deployment. HomeBase's committed defaults (`config/homebase.json`, `docker-compose.yml`, `.env.example`) all show port `17106`, but the actual running instance uses `HOMEBASE_PORT=17110`, set in a host-level `.env.docker` that lives outside the repo (confirmed via `LMApi/docs/plans/2026-08-27-open-webui-integration.md:47-49`, which explicitly calls out this exact discrepancy). LMApi is mounted at the `/lmapi` sub-path, and its OpenAI-compatible chat completions route is `/lmapi/v1/chat/completions` — so the **base URL** to give Promptfoo's `openai` provider is `http://localhost:17110/lmapi/v1` (Promptfoo appends `/chat/completions` itself). Use **http**, not https — the direct Docker port publish has no TLS; https only exists via Tailscale Serve on the tailnet hostname (`https://home.<tailnet>.ts.net/lmapi/v1`), which isn't needed for this same-machine POC.

Along the way, capture a running list of exactly which config knobs and UI affordances Promptfoo needs from a driving application (this becomes the validated input for the two existing LMEval docs, superseding their docs-only assumptions).

## New project

**Location:** `C:\LocalDev\Projects\promptfoo-poc\` — new sibling repo, own `git init`, no shared dependencies with LMEval.

```
promptfoo-poc/
  package.json                      # promptfoo as a devDependency, node ≥22.22
  promptfooconfig.classify.yaml     # Scenario A: prompt-variant comparison
  promptfooconfig.models.yaml       # Scenario B: model comparison
  prompts/
    classification-v1.txt           # ported verbatim from MemoryAPI's categorization.txt
    classification-v2.txt           # one deliberate tweak, for prompt-variant comparison
    tagging-v1.txt                  # stretch scenario, ported from tagging.txt
  tests/
    classification-cases.yaml       # ~20 cases covering all 8 categories + edge cases
    tagging-cases.yaml              # stretch: multi-label expected-tag-set cases
  scripts/
    progress-harness.ts             # Node API call using evaluate() + progressCallback
  README.md                         # running decision log (see "Decision log" below)
```

## Implementation steps

1. **Scaffold.** `npm init`, `npm install promptfoo` (currently 0.122.x). Confirm local Ollama is reachable and pull 2–3 comparably-sized models to compare (e.g. `llama3.2`, `qwen2.5:7b`, `mistral`).

2. **Port the classification prompt.** Copy `categorization.txt`'s structure into `prompts/classification-v1.txt`, rendering `{{categories}}` from the real 8-category list (static in the POC, unlike MemoryAPI's file-driven load) and `{{user_input}}` as the Promptfoo test variable. Write `classification-v2.txt` as one intentional variant (e.g. reordered examples, or an added disambiguation rule) — this is the pair Scenario A compares.

3. **Build the test dataset.** Write ~20 `tests/classification-cases.yaml` cases spanning all 8 categories (reuse/extend the few-shot examples already in `categorization.txt` as a starting point, add a few ambiguous edge cases). Each case sets `vars.user_input` and asserts the expected category.
   - **Important nuance to get right:** use `assert: type: icontains` or `type: equals` (or a small custom `javascript` assertion normalizing whitespace/case) against the expected category string — **not** Promptfoo's `classifier` assertion type, which invokes an external HuggingFace classification model (sentiment/toxicity/etc.) and is the wrong tool for verifying "did the model pick the right label from our own list."

4. **Scenario A — prompt-variant eval** (`promptfooconfig.classify.yaml`): one Ollama provider, `prompts: [classification-v1.txt, classification-v2.txt]`, the shared test file. Run `npx promptfoo eval -c promptfooconfig.classify.yaml`.

5. **Scenario B — model-comparison eval** (`promptfooconfig.models.yaml`): one prompt (`classification-v1.txt`), `providers: [ollama:chat:llama3.2, ollama:chat:qwen2.5:7b, ollama:chat:mistral]`, same test file. Run and compare pass rates/latency across models.

6. **Inspect the built-in results UI.** Run `npx promptfoo view` and evaluate its local SQLite-backed results browser against what LMEval's Step 4 (Results) and Step 5 (Summary) already do — note overlaps and gaps in the decision log rather than reimplementing anything.

7. **Real-time progress harness** (`scripts/progress-harness.ts`). Call Promptfoo's Node API directly:
   ```ts
   import { evaluate } from 'promptfoo';
   await evaluate(testSuite, {
     progressCallback: (completed, total, index, evalStep, metrics) => {
       console.log(`${completed}/${total}`, evalStep.provider?.id, metrics);
     },
   });
   ```
   This is the concrete answer to "can LMEval's `ExecutionService` invoke Promptfoo as a library and forward progress over its existing WebSocket, instead of shelling out to the CLI and scraping stdout." Confirm it fires per-cell during a real run.

8. **Swap to LMApi.** Change *only* the `providers` block in `promptfooconfig.models.yaml` from `ollama:chat:<model>` entries to:
   ```yaml
   providers:
     - id: openai:chat:<model-name>
       config:
         apiBaseUrl: http://localhost:17110/lmapi/v1
   ```
   Re-run the identical eval/test files with zero other changes. This validates (or disproves) the premise that swapping backends is a pure config edit — the whole point of routing through LMApi. (Confirm HomeBase + LMApi are actually running under Docker with `HOMEBASE_PORT=17110` before this step — `docker ps` or hitting `http://localhost:17110/lmapi/health` is enough.)

9. **Stretch: tagging scenario.** Port `tagging.txt` and the ~60-tag list into `tagging-v1.txt` / `tagging-cases.yaml`, where each case has an expected *set* of tags (multi-label). Use a custom `javascript` assertion that parses the comma-separated model output and scores overlap (precision/recall or Jaccard) against the expected set — this is a good test of Promptfoo's assertion flexibility beyond exact match, and it's the second real MemoryAPI use case, not a synthetic one.

10. **Summarization** (memory_summary.txt) is explicitly **out of scope** for this POC — it needs rubric/LLM-judge scoring which is a different (subjective) evaluation mode; note it as the logical "next POC" in the README rather than building it now.

## Decision log (`README.md` in the new repo)

Capture answers to these questions as the POC runs, in plain language — this is the artifact that determines whether LMEval adopts Promptfoo:

- Was writing the classification/tagging assertions actually less work than hand-rolling equivalent checks in `MetricsService.ts`-style code?
- Did the Ollama → LMApi provider swap require touching anything besides the `providers` block?
- Does `progressCallback` give enough granularity (per-cell, with provider/prompt identity) to drive a live Run Dashboard feed?
- Is the local SQLite eval store (`promptfoo view`) worth reusing, or does LMEval's existing file-based storage remain simpler?
- Where did Promptfoo's config model fight against MemoryAPI's actual prompt/label shape (e.g. dynamic category lists, multi-label tagging)?
- Given the OpenAI acquisition, any reason for caution beyond "stays open source, MIT license, existing customers supported"?

**Follow-up (not part of this plan):** once the decision log has real answers, use it to revise `docs/features/eval-wizard/PROMPTFOO_CONFIG_WIZARD_MOCKUP_BRIEF.md` and `PREPARE_WIZARD_FUTURE_ITERATIONS.md` in the LMEval repo, replacing their docs-only assumptions with validated findings.

## Explicitly out of scope for this POC

- Any LMEval UI/frontend work
- Tool-call / API-contract / trace verification (Step 2 Card 4 concepts in the mockup brief) — later phase, only relevant once agent workflows are in scope
- RAG source evaluation (SQL/Graph/Vector result analysis) — the most complex future use case per the user, deliberately deferred
- Promptfoo's red-teaming/security-scanning features — irrelevant to this use case

## Verification

- `npx promptfoo eval -c promptfooconfig.classify.yaml` runs against local Ollama and reports pass/fail per test case, with both prompt variants scored
- `npx promptfoo eval -c promptfooconfig.models.yaml` runs the same test set across 2–3 local models and shows a comparable score/latency table
- `npx promptfoo view` opens a working local results browser
- `scripts/progress-harness.ts` prints incrementing `completed/total` output during a live run, proving the Node API progress hook works
- Editing only the `providers` block to point at `http://localhost:17110/lmapi/v1` (LMApi via HomeBase) reproduces successful completions with no other file changes
- `README.md` contains a filled-out decision log answering the six questions above
