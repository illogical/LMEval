# Promptfoo Config Wizard Mockup Brief

## Purpose

Create mockups for a future LMEval wizard that configures evaluations on top of Promptfoo while preserving LMEval's current guided flow:

1. Prompts
2. Prepare
3. Run
4. Results
5. Summary

This document is for a design assistant. It should help produce high-fidelity interface mockups that feel like an evolution of the current LMEval product rather than a different app.

---

## Product Context To Preserve

Base the mockups on the current LMEval interface patterns already present in the codebase and docs:

- Full-screen app shell with a compact top nav and a persistent horizontal step indicator
- Dark interface using the existing LMEval palette
  - Background: deep blue-gray
  - Cards: slightly lighter blue-gray
  - Primary action: cyan
  - Success: green
  - Errors/regressions: rose/red
- Step pages own the full viewport below the header
- Step 2 already uses a spacious two-column layout with card sections and a sticky right sidebar
- Step 1 already centers on prompt comparison and model selection
- Step 3 already uses a run dashboard with prompt cards, live feed, websocket status, and error panel
- Step 4 already uses tabbed results views: Scoreboard, Compare, Detail, Metrics, Timeline
- Typography should stay practical and engineering-focused
  - UI font for controls and labels
  - monospaced font for counts, traces, prompts, payloads, and config previews

Do not design a light theme, purple theme, or marketing-style landing experience for this wizard. This should look like a serious operator tool for prompt engineers and applied AI teams.

---

## Promptfoo Assumptions That Should Shape The UX

These mockups should assume the underlying eval engine is Promptfoo:

- Promptfoo supports automated evaluations, prompt/model comparison, and CI-style workflows.
- Promptfoo can hit HTTP endpoints directly and lets a config specify URL, method, headers, body, query params, request transforms, and response transforms.
- Promptfoo supports custom Javascript assertions that can inspect `output`, `providerResponse`, and `context.trace`.
- Promptfoo tracing exposes request and response bodies and span metadata for debugging complex provider behavior.
- Promptfoo supports MCP-enabled providers and a dedicated MCP provider for tool-oriented or agentic systems.

Important product implication:

- It is reasonable to design first-class UI for API verification, tool verification, and trace-aware assertions.
- It does not appear that Promptfoo offers a polished native GUI concept for "expected route/query/body selectors" as a first-class product surface.
- Therefore LMEval should differentiate by providing an opinionated API verification layer that compiles down to Promptfoo provider config, custom assertions, and tracing checks.

This last point is an inference from Promptfoo's docs, not an explicit Promptfoo feature claim.

---

## Mockup Deliverables

Design the following screens:

1. Step 1 desktop mockup
2. Step 2 desktop mockup for a general LLM task
3. Step 2 desktop mockup for an agent skill or API workflow
4. Step 3 run dashboard mockup
5. Step 4 results mockup
6. Step 5 summary mockup
7. One mobile-responsive treatment for Step 2

If time is limited, prioritize Step 2 because that is the core configuration surface.

---

## Core UX Idea

The wizard should still feel like LMEval's current "guided flow with free navigation," but Step 2 becomes much more opinionated and Promptfoo-aware.

The flow should answer these questions in order:

1. What are we refining?
2. What target system is being evaluated?
3. What test data will be run?
4. How will success be measured?
5. Are there tool or API contracts that must hold?
6. How large and repeatable is this experiment?

The visual tone should be "evaluation control room," not generic form builder.

---

## Global Shell

Keep these elements persistent across all mockups:

- 48px app header with `LMEval` wordmark on the left and compact nav on the right
- 64px step indicator below it
- right-aligned context action in the step bar
  - Step 1: `Next: Prepare`
  - Step 2: `Run Evaluation`
  - Step 3: `View Results`
  - Step 4: `Summary & Suggestions`
- clear active/completed/pending styling for steps
- Step 5 can still carry a "Soon" or "Intelligence" flavor, but the mockup should look intentionally reserved, not unfinished

---

## Step 1: Prompts

### Goal

Let the user choose or draft the prompt variants and select the models/providers that will be part of the Promptfoo matrix.

### Layout

- Keep the current structure:
  - selector bars at top for Prompt A and Prompt B
  - central side-by-side diff/editor area
  - model/provider selector tray at the bottom
- Preserve the current JetBrains-style diff feeling
- Keep Prompt B editable inline

### What To Add

Add one slim, high-value strip between the step indicator and the diff area:

- `Evaluation profile` segmented control or chip row
  - Agent skill / MCP / API workflow
  - Summarization
  - Categorization
  - Tagging
  - LLM judge
  - Repeatable experiment
  - Software engineering agent

This profile does not replace Step 2. It simply establishes defaults and changes the language used in Step 2.

### Mockup Notes

- Show model chips grouped by server/provider as today
- Show prompt provenance if available
  - saved prompt
  - draft
  - version number
- If the selected profile is `Agent skill / MCP / API workflow`, show a subtle badge on the prompt diff view indicating that downstream verification will include tools and API contracts

---

## Step 2: Prepare

### Primary Goal

This is the main design problem. The page should help users configure a Promptfoo eval without exposing raw YAML as the main experience.

The page should still feel like the current LMEval Step 2:

- spacious card layout
- left main column for form sections
- sticky right sidebar for preview and execution summary

### Desktop Layout

- Left column: 65% to 70% width
- Right sidebar: 30% to 35% width
- Section cards with visible boundaries and comfortable spacing
- Sidebar stays sticky during scroll

### Section Order

The mockup should use this order:

1. Evaluation Profile
2. Test Cases / Dataset
3. Success Criteria
4. Tool + API Verification
5. Judge + Experiment Controls
6. Right Sidebar: Execution Preview, Presets, Generated Config

This order maps well to the current LMEval Step 2 structure while making Promptfoo concepts easier to understand.

---

## Step 2 Card 1: Evaluation Profile

### Purpose

Let the user say what kind of prompt or workflow they are refining so the wizard can reveal the right controls.

### UI

- Large selectable profile cards or chips
- Each profile has:
  - icon
  - short label
  - one-sentence explanation
  - "best for" examples

### Required Profiles

- Agent skill / MCP workflow
- API-backed agent workflow
- Summarization
- Categorization
- Tagging
- LLM-as-judge prompt
- Repeatable experiment / regression suite
- Software engineering agent
- Custom

### Behavior

Selecting a profile changes labels and defaults below.

Examples:

- Summarization defaults toward reference answers, rubric scoring, length/citation checks
- Categorization defaults toward exact-label or multi-label assertions
- Tagging defaults toward set overlap and required-tag checks
- Agent skill / API workflow defaults toward tool-call, trace, and contract verification
- Repeatable experiment emphasizes presets, baselines, and regression thresholds

---

## Step 2 Card 2: Test Cases / Dataset

### Purpose

This is the Promptfoo `tests` surface, but presented as a practical dataset builder.

### Layout

Keep LMEval's current Quick vs Suite mental model, but make the Suite mode richer.

#### Quick Mode

- One compact textarea or structured input for rapid smoke tests
- Best for first-pass evaluation

#### Suite Mode

- Table/grid editor with import/export affordances
- Rows should feel like reusable datasets, not just messages

### Required Fields In The Mockup

Always show:

- description
- input or user message
- tags/slices

Conditionally show based on profile:

- reference answer
- expected category
- expected tags
- expected JSON schema
- expected tool call
- expected API route
- expected API method
- expected query params
- expected request body fragments
- expected response body fragments

### Important Design Direction

For agent or API workflows, do not force all verification into a single freeform text area. Show structured columns or expandable row details.

Each test case row should support:

- input variables
- expected behavior
- optional hard gates
- optional notes

### Import/Export

Reflect the existing LMEval plan:

- import from CSV or JSON
- paste from clipboard
- export current inline dataset
- save inline cases as a named suite

### Nice-To-Have In The Mockup

- slice/tag chips visible in-row
- a row drawer that expands for advanced expectations
- a small dataset summary above the table
  - total cases
  - slices
  - cases with reference answers
  - cases with API checks

---

## Step 2 Card 3: Success Criteria

### Purpose

This is the heart of the Promptfoo mapping. Show how outputs will be judged.

### UX Structure

Split this card into two visible bands:

1. Hard gates
2. Soft scores

That distinction should be visually obvious.

### Hard Gates

These determine whether a candidate is eligible, regardless of rubric score.

Examples to show:

- required keyword or phrase
- forbidden phrase
- exact match
- regex
- JSON validity
- JSON schema validity
- tool call required
- API contract passed
- max latency

### Soft Scores

These contribute weighted scores rather than binary gating.

Examples to show:

- rubric dimensions
- model-graded evaluation
- pairwise preference
- similarity to reference
- reasoning quality
- completeness
- brevity or conciseness

### Visual Pattern

Do not mock this as one long checkbox list.

Use modular rule blocks with:

- type
- weight or threshold
- on/off state
- short natural-language summary
- advanced edit affordance

### Promptfoo Mapping

The UI should imply that these rules map to Promptfoo assertions and metrics, but the mockup should not force users to think in YAML terms first.

---

## Step 2 Card 4: Tool + API Verification

### Purpose

This is the main LMEval differentiator for agent skills, MCP tools, curl-based skills, and API workflows.

### When Visible

- fully visible for `Agent skill / MCP workflow`
- fully visible for `API-backed agent workflow`
- collapsed but available for `Software engineering agent`
- hidden by default for simpler tasks like summarization unless explicitly enabled

### What The Mockup Must Show

#### A. Verification Mode Selector

- No tool/API verification
- Verify tool usage
- Verify API calls
- Verify tool usage and API calls

#### B. Tool Verification Rules

- expected tool name
- allowed tools
- forbidden tools
- expected argument keys
- argument value matchers
- tool call count
- required order or sequence

#### C. API Verification Rules

- expected route or endpoint pattern
- expected HTTP method
- expected query string keys or values
- expected request body fragments
- forbidden request body fragments
- expected response status family
- expected response body fields
- forbidden response body fields

#### D. Trace Verification

- no error spans
- max external call count
- max duration per tool or endpoint
- required step order
- required span name presence

### Visual Direction

This should feel more like a test-contract builder than a generic settings form.

Good visual patterns:

- rule groups with small code-like tokens
- path chips such as `/tickets/:id`
- method pills like `GET`, `POST`
- selector-like rows such as `body.customer.id exists`
- pass/fail preview badges

### Advanced Mode

Include a secondary affordance:

- `Open raw Promptfoo assertion`

This should expose the idea that advanced users can drop down to Javascript assertions or trace-aware checks, but it should not be the primary mode.

---

## Step 2 Card 5: Judge + Experiment Controls

### Purpose

Preserve the current LMEval judge configuration, but make it more obviously connected to repeatable experiments.

### Sections To Show

- Judge model
- Pairwise mode
- Runs per cell
- Optional randomness controls
  - temperature
  - top_p
  - seed
- Baseline comparison toggle
- Save as preset
- Regression gate toggle

### Prompt Type Specific Expectations

For `LLM-as-judge prompt`, the mockup should feel slightly meta:

- show that the thing being evaluated is itself an evaluator
- expose judge prompt version or rubric version
- emphasize agreement, consistency, and calibration more than response beauty

For `Repeatable experiment`, highlight:

- preset name
- baseline target
- experiment notes
- scheduling or CI readiness as a future-facing concept

---

## Step 2 Right Sidebar

The sidebar should remain sticky and should be visually dense but readable.

### Required Sidebar Modules

#### 1. Execution Preview

Show the matrix clearly:

- prompts x providers x tests x runs
- estimated wall time
- estimated token volume
- warning state for large runs

#### 2. Active Gates Summary

Show a compact summary:

- hard gates enabled
- soft scoring dimensions
- tool/API verification enabled or not

#### 3. Presets

Show:

- load preset
- save current setup
- recent presets

#### 4. Generated Config Preview

This is important.

Show a compact, read-only preview panel that makes it obvious the wizard is producing Promptfoo-compatible config.

The preview should look like:

- YAML or structured config snippet
- syntax-highlighted
- scrollable
- copy or expand affordance

Do not make raw config editing the dominant interaction, but show enough of it to build trust with technical users.

---

## Step 2 Variant Mockups

Create two different Step 2 mockups.

### Variant A: General LLM Task

Use `Summarization` or `Categorization` as the example.

Emphasize:

- clean dataset editing
- rubric scoring
- expected outputs
- judge model
- matrix preview

De-emphasize:

- trace details
- API verification

### Variant B: Agent Skill / API Workflow

Use an example like:

- an agent skill that calls MCP tools
- a curl-based workflow that hits REST endpoints
- a software engineering agent that must call specific APIs or tools in the right order

Emphasize:

- tool and API contract builder
- trace-aware validation
- request and response schema selectors
- advanced assertion preview

This should be the most differentiated mockup.

---

## Step 3: Run Dashboard

### Goal

Show the evaluation actively running with special visibility into tool and API verification, not just text completions.

### Keep From Current LMEval

- title row
- elapsed timer
- websocket status
- eval summary bar
- prompt cards
- live feed
- error panel

### Add For Promptfoo-Oriented Runs

- assertion counters
  - passed
  - failed
  - pending
- live tool/API event badges in the feed
- a compact "trace health" strip
  - no errors
  - 2 contract failures
  - 1 timeout
- ability to click a running or completed cell and open a side drawer with:
  - prompt
  - output
  - tool calls
  - API request/response summary
  - failed rule list

### Visual Direction

This should feel like a live test run, not a static analytics page.

---

## Step 4: Results

### Goal

Translate Promptfoo results into an LMEval-native analysis surface.

### Preserve The Existing Tab Model

- Scoreboard
- Compare
- Detail
- Metrics
- Timeline

### What The Mockup Must Add

#### Scoreboard

- matrix cells should communicate both score and gate status
- cells with failed API or tool contracts should be visibly disqualified
- allow slice or tag filtering

#### Compare

- show response text side-by-side
- also show tool calls or API calls side-by-side
- show which assertions passed and failed for each side

#### Detail

- raw output
- rule-by-rule outcome
- request and response trace
- tool calls
- failed contract clauses

#### Metrics

- latency
- tokens
- pass rate by assertion type
- hard-gate failure breakdown
- consistency when runs per cell > 1

#### Timeline

- how a prompt or provider changed over time
- baseline versus current
- regression markers

### Important Interaction

A result cell should answer:

- Did it score well?
- Did it pass hard gates?
- Did it use the right tools or endpoints?
- If not, exactly what failed?

---

## Step 5: Summary

### Goal

Present a decision surface, not a vague AI narrative.

### Modules To Mock

- Ship recommendation
- Best candidate card
- Why it won
- Where it still fails
- Best model/provider by objective
  - highest quality
  - fastest acceptable
  - safest contract compliance
- Suggested next action
  - refine prompt
  - tighten API contract
  - add missing test slices
  - promote as baseline

### For Agent/API Workflows

Include a dedicated summary card:

- `Contract reliability`

This should summarize:

- endpoint correctness
- argument correctness
- response contract adherence
- failure hotspots by route or tool

---

## Responsive Treatment

Create one mobile or narrow-width mockup for Step 2.

Expect these adaptations:

- cards stack vertically
- sticky sidebar becomes collapsible bottom sheet or inline accordion
- generated config preview becomes a drawer
- large rule builders collapse into summary rows with expandable details

Do not try to preserve the desktop two-column arrangement at small widths.

---

## Interaction Style And Visual Language

### Tone

- technical
- grounded
- trustworthy
- operator-oriented

### Avoid

- generic SaaS gradients
- oversized empty hero treatments
- consumer-app pill overload
- decorative AI imagery
- vague labels like `Smart settings`

### Prefer

- precise labels
- compact but readable cards
- monospaced previews for payloads and config
- clear status badges
- obvious hard-gate versus soft-score distinction
- structured expectation builders instead of giant textareas

---

## Example Task Scenarios The Mockups Should Imply

The design should clearly support these workflows:

### Summarization

- compare prompt variants
- evaluate against references and rubric
- enforce concise output or citation rules

### Categorization

- exact or fuzzy label checks
- confusion visible in results
- repeatable slices by label family

### Tagging

- multi-label expectations
- required and forbidden tags
- overlap-oriented evaluation

### LLM Eval Judge

- refine an evaluator prompt itself
- inspect judge consistency and calibration

### Repeatable Experiments

- save as preset
- compare to baseline
- rerun stable suites

### AI Agent Team Members / Software Engineering Agents

- verify tool usage
- verify API calls
- inspect traces
- detect contract violations and failure sequences

---

## Notes For The Design Assistant

- Keep the existing LMEval five-step wizard structure.
- Treat Step 2 as the flagship screen.
- Show one highly practical agent/API configuration variant, because that is where LMEval can stand apart from generic prompt eval tools.
- Preserve the current visual DNA from the implemented frontend instead of introducing a new design system.
- Make sure the mockups feel credible for engineers who will expect to understand how the UI maps to real Promptfoo execution.

---

## Source Links

These sources informed the product assumptions above:

- [Promptfoo README](https://github.com/promptfoo/promptfoo/blob/main/README.md)
- [Promptfoo Assertions and Metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/)
- [Promptfoo Javascript Assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/)
- [Promptfoo HTTP Provider](https://www.promptfoo.dev/docs/providers/http/)
- [Promptfoo Tracing](https://www.promptfoo.dev/docs/tracing/)
- [Promptfoo MCP Integration](https://www.promptfoo.dev/docs/integrations/mcp/)
- [Promptfoo MCP Provider](https://www.promptfoo.dev/docs/providers/mcp/)
