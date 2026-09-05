# A4/A5 Ground-Truth Fields and Built-In Benchmark Suites

**Date:** 2026-09-04

**Status:** Ready for implementation

**Applies to:** LMEval Track A4 and A5

## Goal

Complete LMEval's grounding-field and built-in benchmark work without waiting for a future MemoryApi exporter. LMEval will gather source material from the existing MemoryApi repository, curate the missing coverage itself, record exactly where every artifact came from, and produce reproducible 64/72/36-case benchmark suites.

MemoryApi remains authoritative for its current prompts, category and tag vocabularies, transport, and production behavior. LMEval owns the benchmark artifacts and their curation process. Human review of newly authored or re-adjudicated ground truth is an acceptance gate within this workflow, not a future MemoryApi deliverable.

## Documentation and Ownership Corrections

- Update `docs/TASK.md` to remove the claim that A5 is blocked on a MemoryApi schema or export.
- Make LMEval responsible for harvesting, augmenting, reviewing, hashing, and maintaining the built-in suites.
- Track engineering/data assembly separately from the human-review acceptance gate.
- Reframe A10 as later interoperability/export work rather than an A5 prerequisite.
- Update `docs/SPECIFICATION.md` and `docs/plans/2026-09-03-professional-memory-evaluations.md` to use this ownership model consistently.
- Preserve the separate MemoryApi transport handoff as the authority for message shape, inference parameters, prompt identities, and runtime-parity checks.

## Public Interfaces and Data Contracts

### Test cases

Extend `TestCase` with:

```ts
expectedLabels?: string[];
caseTags?: string[];
requiredFacts?: string[];
```

Existing `referenceAnswer`, `forbiddenClaims`, and `protectedTokens` remain the summarization grounding fields.

Treat legacy `tags` only as an import alias for `expectedLabels`:

- `expectedLabels` wins when both fields exist.
- Compare the two as order-insensitive sets and emit an import warning when they differ.
- New JSON and CSV exports emit `expectedLabels`, never `tags`.
- Migrate classification starter-case `tags` to `caseTags` and tagging starter-case `tags` to `expectedLabels`.
- JSON uses arrays for all new fields. CSV uses semicolon-delimited values for `expectedLabels`, `caseTags`, `requiredFacts`, `forbiddenClaims`, and `protectedTokens`.
- Preserve every unrelated `TestCase` field during import/export round trips.

### Test suites and provenance

Extend `TestSuite` with:

```ts
builtIn: boolean;
purposeCategory?: 'classification' | 'tagging' | 'summarization' | 'custom';
version: string;
provenance?: {
  source: string;
  sourceRevision: string;
  sourceFiles: Array<{ path: string; sha256: string }>;
  taxonomySha256?: string;
  datasetSha256: string;
  curatedAt: string;
  reviewStatus: 'pending-human-review' | 'approved';
};
```

Add `defaultTestSuiteId?: string` to `EvalPurposeTemplate`.

Custom-suite requests cannot set `builtIn` or built-in provenance. Existing legacy suites normalize as custom without being rewritten automatically. A built-in suite must have a version and complete provenance.

Keep existing API response bodies. Import warnings continue through `ParseResult`. `PUT` and `DELETE` against a built-in suite return HTTP `403` with error code `BUILT_IN_SUITE_IMMUTABLE`.

## Canonical Corpus and Reproducible Generation

Add a checked-in `memory-benchmark-source.v1` curation artifact as the single source from which the three built-in suites are projected. It records stable case IDs, raw content, task annotations, source references, slice tags, and adjudication notes so the suite files cannot drift independently.

Add a deterministic development-only curation script that:

- Accepts the MemoryApi repository root explicitly; it never depends on a machine-specific absolute path.
- Reads `src/samples/allCategories.json`, `allTags.json`, `seedMemories.json`, `sampleMemories.json`, and the three ingestion prompts.
- Records MemoryApi revision `c7ecb9e292947f88199c16548b88dc4fc8557a60` and exact SHA-256 hashes of the consumed files.
- Uses the current 74 unique labeled memories as source material. They cover all eight categories but only 51 of 61 tags, with category counts Preference 23, Reminder 5, Snippet 7, Event 4, Note 18, Prompt 6, Idea 7, and History 4.
- Adds reviewed cases where the source pool lacks category balance, tag support, boundary coverage, realistic noise, or adversarial pressure.
- Generates byte-stable JSON with stable IDs. Rerunning it against unchanged inputs produces no diff.
- Computes the dataset hash from canonical suite content while excluding the hash field itself.
- Never reads a production database, writes into MemoryApi, or runs during normal LMEval startup.

The generated suites are checked in and sufficient at runtime. There is no live synchronization with MemoryApi.

## Benchmark Construction

### Classification: `memory-classification-v1`

- Produce exactly 64 cases: eight for each canonical category.
- Assign a stratified 48-case calibration split and 16-case regression split.
- For every category include clear positives, competing-intent boundary cases, noisy or abbreviated input, and prompt-injection or output-format pressure.
- Cover Event/History, Note/Snippet, Prompt/Idea, Reminder/Note, and the observed Preference/History boundary.
- Store the canonical label in `expectedOutput`; do not use keyword matching as ground truth.

### Tagging: `memory-tagging-v1`

- Produce exactly 72 cases, split into 54 calibration and 18 regression cases.
- Give every one of the 61 canonical tags at least two positive examples.
- Fill the ten currently uncovered tags and every tag that currently has only one example.
- Include sparse one-label cases, ordinary two-to-four-label cases, dense cases, near-neighbor distinctions, irrelevant-label traps, realistic noise, and at least eight injection or output-format attacks.
- Store truth in `expectedLabels`. Label order is irrelevant, but spelling and casing must be canonical.

### Summarization: `memory-summarization-v1`

- Produce exactly 36 cases: 12 short, 12 medium, and 12 long memories.
- Assign 27 calibration and nine regression cases.
- Give every case a reviewed `referenceAnswer` and `requiredFacts`.
- Add `forbiddenClaims` and `protectedTokens` wherever the source creates hallucination, entity, date, quantity, negation, identifier, or temporal-state risks.
- Include noisy inputs, embedded instructions, entity/number preservation, negation, current-versus-superseded facts, technical notes, preferences, reminders, decisions, events/history, and mixed-content memories.
- Derive the purpose template's compression range from the 10th and 90th percentiles of finalized reference-summary ratios rather than retaining guessed bounds.

### Production-shape and leakage rules

- Every benchmark `userMessage` uses the exact production form `<memory>\n...\n</memory>`.
- Escape every case-insensitive closing delimiter matching `</memory` plus optional whitespace before `>` as the literal `&lt;/memory&gt;`.
- Extract examples from both MemoryApi prompts and LMEval's built-in seed prompts.
- Reject normalized exact matches from benchmark data.
- Report high-similarity cases for explicit review instead of silently accepting them.
- Assign regression membership before any prompt evaluation and never expose that split to prompt iteration or automated refinement.

## Annotation and Review

Create an annotation guide covering:

- Category definitions and boundary tie-breakers.
- Tag relevance, completeness, specificity, and near-neighbor distinctions.
- Summary style, required fact selection, forbidden-claim construction, protected tokens, negation, and temporal state.
- Ambiguity handling and adjudication recording.

Create a review ledger that maps every case to its MemoryApi source or LMEval-authored origin and records relabeling, rewritten summaries, ambiguity, and rationale.

Existing source labels are inputs rather than unquestioned truth. Explicitly adjudicate known conflicts such as Preference/History and Event/History. Newly authored, transformed, or relabeled cases remain `pending-human-review` until the review ledger is approved. Dataset construction and infrastructure can be completed before that approval, but the suites cannot be represented as promotion-capable until provenance changes to `approved`.

## Validation

Add a dataset linter using existing project dependencies. It rejects:

- Duplicate case IDs or normalized duplicate inputs.
- Incorrect suite counts, category balance, length-band balance, or split ratios.
- Missing split tags, multiple split tags, or malformed `namespace:value` case tags.
- Unknown, duplicate, or non-canonical ground-truth categories/tags.
- Category coverage or two-positive-per-tag support shortfalls.
- Missing summarization references or grounding annotations.
- Malformed production wrappers or incorrectly escaped closing delimiters.
- Normalized exact prompt-example leakage.
- Source, taxonomy, or canonical dataset hash mismatches.
- `approved` provenance without a complete review ledger.

Run the full linter in tests and when regenerating built-ins. Runtime service loading performs structural and provenance validation so a corrupt built-in is never silently offered to users.

## Storage and Service Behavior

Use three suite sources:

- Repository-owned built-ins: `data/evals/test-suites/built-in/`.
- Data-root-owned custom suites: `data/evals/test-suites/custom/`.
- Legacy JSON files directly under the existing test-suite directory, read as custom compatibility records.

Add built-in and custom test-suite paths to `FileService.configurePaths()` so standalone and HomeBase-hosted modes use repository assets for built-ins and the injected host data root for writable suites.

`TestSuiteService` merges all three sources. It fails loudly on duplicate IDs rather than selecting a precedence winner. Creation uses an explicit allowlist and always creates a custom suite. Update and delete resolve the suite's ownership before writing and reject built-ins. Legacy suites remain readable and writable in their existing locations until explicitly re-saved; no automatic move or deletion occurs.

## Purpose-Template and Prepare-Page Behavior

- Link each built-in purpose template to its corresponding suite through `defaultTestSuiteId`.
- Keep starter cases as small, editable smoke tests rather than replacing them with the full benchmark.
- Show the recommended benchmark separately on the Prepare page with its version and review status.
- “Use benchmark suite” clears inline starter cases and selects the linked suite.
- “Use starter cases” clears the suite selection and restores a fresh editable copy of the template's starter cases.
- Never submit both `testSuiteId` and `inlineTestCases` for the same run.
- Make the editor task-aware:
  - Classification exposes expected output and case slices.
  - Tagging exposes expected labels and case slices.
  - Summarization exposes reference answer, required facts, forbidden claims, protected tokens, and case slices.

## Verification

### Automated checks

- Unit tests for new-field JSON/CSV parsing, serialization, legacy `tags` precedence, warnings, and unrelated-field preservation.
- Unit tests for stable IDs, canonical hashing, deterministic regeneration, and every dataset-linter rejection.
- Service/API tests proving built-in/custom/legacy merging, collision failure, immutable built-ins, writable custom/legacy suites, and hosted-path separation.
- Purpose-template and component tests for benchmark linkage, version/review labeling, starter/benchmark switching, and mutually exclusive suite/inline state.
- Dataset assertions for exact 64/72/36 counts, split ratios, eight-category balance, all-61-tag support, summary length bands, wrapper correctness, complete provenance, and zero exact prompt leakage.
- Run `npm run test`, `npm run build`, `npm run build:hosted`, `npm run build:host`, and `npm run lint`; report unrelated pre-existing failures separately.

### Manual and runtime acceptance

- Review the generated curation ledger before changing suite provenance to `approved`.
- Walk through purpose template to starter cases to benchmark suite in a running browser.
- Run each built-in suite against at least one live LMApi model when available.
- Keep automated, browser, and model-backed evidence separate. Dataset linting or unit tests never count as live-model verification.

## Non-Goals and Safety

- Do not modify MemoryApi code, prompts, taxonomies, samples, databases, or Git state.
- Do not add a runtime dependency on the MemoryApi checkout.
- Do not require `memory-eval-snapshot.v1` or a MemoryApi exporter for A4/A5.
- Do not implement A9 model selection, A10 interchange schemas, A11 reporting, or prompt refinement in this work.
- Do not silently repair model responses during scoring.
- Do not optimize against the regression split.
- Do not claim human approval, live-model verification, or promotion readiness until each corresponding gate has actually passed.

## Definition of Done

- `TestCase`, `TestSuite`, and `EvalPurposeTemplate` expose the new contracts with backward-compatible parsing.
- Three deterministic, versioned built-in suites exist with complete provenance and pass the dataset linter.
- Built-ins work identically in standalone and hosted modes and cannot be mutated through service or API paths.
- Purpose templates clearly separate starter smoke cases from linked benchmarks.
- The review ledger identifies every sourced, authored, transformed, and re-adjudicated case.
- `docs/TASK.md`, `docs/SPECIFICATION.md`, and the professional-evaluations plan describe LMEval-owned curation and no longer wait for nonexistent MemoryApi deliverables.
- Automated checks pass or any unrelated baseline failures are recorded accurately.
- Promotion-capable status is withheld until the review ledger is approved and live verification is reported separately.
