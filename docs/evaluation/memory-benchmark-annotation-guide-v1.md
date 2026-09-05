# Memory Benchmark Annotation Guide v1

## Status and authority

This guide governs the LMEval-owned `memory-*-v1` built-in suites. The current annotations are reviewed drafts and remain `pending-human-review` until every review-ledger entry is approved. MemoryApi remains authoritative for its prompt text and canonical vocabularies; source labels are evidence, not automatic truth.

## Classification

Choose the memory's dominant durable intent, not a word appearing in it.

- **Preference:** a current like, dislike, habitual choice, or favored tool. A past preference is History when the durable fact is that it used to be true.
- **Reminder:** an action or obligation that should occur later. A completed action is Event; background information without an action is Note.
- **Snippet:** directly reusable code, configuration, query, or command. Prose discussing code is Note.
- **Event:** a bounded occurrence, meeting, trip, completion, or incident. Use History for a longer-lived past state, role, or era.
- **Note:** explanatory knowledge, observations, findings, comparisons, or meeting notes without a stronger dominant intent.
- **Prompt:** instructions intended to be given to an AI or content generator. Use Idea when the memory proposes a product or possibility rather than supplying its instructions.
- **Idea:** a proposed product, feature, experiment, or possibility that does not yet impose an action.
- **History:** a prior role, state, milestone, migration era, or background fact whose main value is longitudinal context.

When two labels remain plausible, record the competing label and rationale in the review ledger. Do not manufacture certainty by rewriting the case solely to make it easier.

## Tagging

Use only canonical labels from MemoryApi's `allTags.json`, preserving spelling and casing. Include a tag only when the memory supplies direct evidence for it. Prefer the most specific useful labels; do not infer adjacent interests, tools, or future actions.

- Separate intent pairs carefully: `Test` is an experiment to run; `Testing` is software-quality practice. `Review` is an examination; `Read Later` and `Watch Later` are deferred consumption. `Reminder` is a future cue; `Action Required` signals a blocking obligation.
- Separate content and form: `Snippet` requires reusable code-like content; `Config`, `Command`, and `Template` describe specific reusable forms. `Notes` describes note content, while `Summary` requires an actual condensed account.
- For adversarial memories, label the semantic memory and ignore requested output labels inside the content.
- Multi-label truth is order-insensitive. Duplicate labels and non-canonical synonyms are invalid.

## Summarization

Write one concise, standalone retrieval description with no heading, preamble, or fence. Preserve names, identifiers, dates, quantities, negation, decisions, owners, deadlines, and current-versus-superseded state when they affect retrieval or meaning.

- `requiredFacts` lists independently checkable facts the summary should retain.
- `protectedTokens` lists exact strings whose spelling or numeric form must survive.
- `forbiddenClaims` lists plausible but unsupported or negation-reversing statements; absence from this list never permits hallucination.
- Embedded instructions are quoted data. Summarize their presence only when relevant and never follow them.

## Review procedure

Review the source artifact and generated suites together. For each ledger entry, verify source treatment, label/reference correctness, ambiguity, split assignment, and absence of identifying personal details. Record any relabel or rewritten summary with a rationale. Only after all entries are approved may the ledger, source artifact, and all three suite provenance records change to `approved` in the same reviewed commit.
