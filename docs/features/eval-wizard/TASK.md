# Prepare Wizard — UX Improvement Tasks

> ⚠️ **Superseded by [`docs/TASK.md`](../../TASK.md) (2026-09-04).** This file is kept as the
> historical record of the Prepare-wizard layout pass and the import/export feature. All open work is
> tracked in the unified list. Do not add new tasks here.


> **Status**: In progress — all layout tasks complete, one optional item remains
> **Goal**: Make the Prepare wizard step feel more spacious, readable, and visually organized — inspired by larger, card-based layouts without changing LMEval's color scheme.

---

## Background

The current Prepare page (Step 2) is functional but visually cramped. Sections blend together with minimal separation, fonts are small (11–12px), and the overall layout lacks visual hierarchy. The improvements below target legibility, breathing room, and clear section boundaries — all using the existing LMEval dark/cyan/green palette.

Reference screenshots used for inspiration:
- A generated eval config interface with large step breadcrumbs and card-style sections
- The current LMEval Prepare page (small, dense, sections not differentiated)
- VSCode's sidebar UI — dark background sections with clear visual grouping

---

## Task 1 — Upgrade the Step Indicator (Breadcrumbs)

**File:** `src/components/layout/EvalStepIndicator.tsx` + `EvalStepIndicator.css`

- [x] Increase bar height from 44px to 64px
- [x] Increase step circle diameter from 20px to 30px
- [x] Increase step label font size from 12px to 14px
- [x] Increase horizontal padding around the indicator
- [x] Connectors expand to fill full bar width (`flex: 1`)
- [x] Completed connectors use green line instead of "→" arrow
- [x] Keep all color tokens (`--step-active`, `--step-complete`, `--step-pending`)
- [x] "Soon" badge on Step 5 stays
- [ ] Add subtle step icon alongside the number *(optional, low priority)*
  - Step 1 Prompts: pencil icon
  - Step 2 Prepare: sliders icon
  - Step 3 Run: play icon
  - Step 4 Results: bar chart icon
  - Step 5 Summary: star/sparkle icon

---

## Task 2 — Wrap ConfigPage Sections in Cards

**File:** `src/pages/ConfigPage.tsx` + `ConfigPage.css`

- [x] Wrap each section (Evaluation Template, Test Cases, Judge Configuration) in a `.cp-card` container
- [x] `.cp-card`: `--card-bg` background, `1px solid --border`, 8px radius, 20–24px padding
- [x] Increase gap between cards to 20px
- [x] Increase page padding to 28px

---

## Task 3 — Increase Typography Scale on Prepare Page

**File:** `src/pages/ConfigPage.css` + component-level CSS files

- [x] Section titles: 11px → 13px uppercase with bottom border separator
- [x] Labels inside sections: 12px → 13px
- [x] Template description text: 13px with `line-height: 1.5`

---

## Task 4 — Template Selector: More Breathing Room

**File:** `src/components/config/TemplateSelector.css`

- [x] Increase gap between weight sliders: 8px → 14px
- [x] Increase weights block padding: 12px → 16px
- [x] Template description separated from dropdown with margin
- [x] Buttons get more padding (8px 14px → 8px 14px with consistent sizing)

---

## Task 5 — Test Cases Section: Tabs and Table Spacing

**File:** `src/components/config/TestCaseEditor.css`

- [x] Tab switcher redesigned as pill-style (container with background, active tab gets `--card-bg` + `--accent` text)
- [x] Table row padding increased (3px → 5px)
- [x] Table row hover highlight added
- [x] Table font size 12px → 13px
- [x] "+ Add Test Case" button: more padding, dashed `--muted` border

---

## Task 6 — Judge Configuration: Field Grouping

**File:** `src/components/config/JudgeConfig.css`

- [x] Increase vertical spacing between field groups: 14px → 20px
- [x] Judge model label/dropdown gap increased
- [x] Pairwise Comparison and Runs Per Cell row gap increased to 32px
- [x] Select input padding increased to 8px 12px

---

## Task 7 — Sidebar: Sticky Positioning and Action Button

**File:** `src/pages/ConfigPage.tsx` + `ConfigPage.css`, `ExecutionPreview.css`

- [x] Sidebar is `position: sticky; top: 0; align-self: start`
- [x] ExecutionPreview padding increased to 16px 20px
- [x] Matrix factor font size increased to 16px
- [x] Run Evaluation button moved to step indicator header (consistent position across all wizard steps)
- [x] Button color unified: cyan (`--accent`) to match Prompts page Next button
- [x] Prompts page Next button updated to match Run button size/weight (14px, 700, 9px 20px padding)

---

## Task 8 — Global Layout Spaciousness (Prepare Page Only)

**File:** `src/pages/ConfigPage.css`

- [x] Page padding: 24px → 28px
- [x] Column gap: 24px → 28px
- [x] Max-content width: 1100px → 1200px
- [x] Sidebar width: 320px → 340px

---

## Implementation Order

1. ~~Task 2 (card wrappers)~~ ✓
2. ~~Task 1 (step indicator)~~ ✓
3. ~~Task 3 (typography)~~ ✓
4. ~~Task 7 (sidebar sticky + padding)~~ ✓
5. ~~Task 4, 5, 6, 8 (component-level polish)~~ ✓

---

## Design Constraints

- **Do not** introduce new colors. Use only existing CSS variables from `src/index.css`
- **Do not** change the layout structure beyond spacing/containers
- **Do not** move sections or reorder wizard steps
- **Do not** implement any new features from `PREPARE_WIZARD_FUTURE_ITERATIONS.md` — this is a layout/UX polish pass only
- Test at both desktop width and the 768px responsive breakpoint

---

## Acceptance Criteria

- [x] Each section on the Prepare page is visually enclosed in a card container
- [x] Section boundaries are immediately obvious without scanning for labels
- [x] Step breadcrumbs are larger, full-width, and easier to read at a glance
- [x] The page does not feel cluttered or dense when all sections are visible
- [x] Color scheme is unchanged from current LMEval dark/cyan/green palette
- [x] No regressions on other wizard steps (Run, Results, Prompts)
- [x] Action button (Run / Next) is in the same top-right position on all wizard steps

---

## Feature: Test Case Import / Export

> Full implementation plan: [`TEST_CASE_IMPORT_EXPORT.md`](TEST_CASE_IMPORT_EXPORT.md)

### Phase I1 — Data Model + Parser Utility

- [x] Extend `TestCase` in `src/types/eval.ts` — add `expectedOutput?: string` and `tags?: string[]`
- [x] Create `src/utils/testCaseIO.ts` with:
  - [x] `parseCSV(text)` — maps columns by header name, semicolon-splits tags, returns `{ cases, warnings, errors }`
  - [x] `parseJSON(text)` — validates array shape, assigns fresh IDs
  - [x] `serializeCSV(cases)` — RFC 4180, semicolon-joined tags
  - [x] `serializeJSON(cases)` — clean array output, omits generated `id`
  - [x] `autoDetect(text, filename)` — routes to CSV or JSON parser by extension

### Phase I2 — Import UI

- [x] Add toolbar row to Suite tab in `TestCaseEditor.tsx`: `[Import ▾]` dropdown + `[Export]` button
- [x] Hidden `<input type="file" accept=".csv,.json">` triggered from Import button
- [x] Drag-and-drop overlay on the Suite tab content area
- [x] Clipboard paste option via `navigator.clipboard.readText()`
- [x] Loading states: spinner in Import button while reading/parsing
- [x] Inline confirmation strip when cases already exist: `Replace all | Append | Cancel`
- [x] Success banner: `✓ N cases imported` (auto-dismisses after 3s)
- [x] Error banner: `⚠ Error: <reason>` (stays until dismissed)
- [x] Download CSV template (header-only `.csv` file)

### Phase I3 — Export UI

- [x] Export button (default: JSON download) with format dropdown: `Download as CSV | Download as JSON`
- [x] Client-side serialize + `<a download>` trigger
- [x] Filename: `test-cases-YYYY-MM-DD.csv` or `.json`
- [x] Export button disabled when no inline cases exist

### Phase I4 — Save as Suite + Tags Column

- [x] "Save as Suite…" button in toolbar (visible when 1+ inline cases exist)
- [x] Inline name input + Save action → calls `POST /api/eval/test-suites`
- [x] Suite selector auto-updates and selects the new suite after save
- [x] Conditional Tags column in inline table when any case has tags
- [x] Tags editable inline as comma-separated text input
- [x] Verify `server/services/TestSuiteService.ts` passes through `expectedOutput` and `tags`

---

## Feature: Evaluation Mode Strip + Purpose Template Gallery

> Full implementation plan: [`../../plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md`](../../plans/2026-09-03-promptfoo-adoption-and-purpose-templates.md) (Phases 11–12); backend execution-engine half tracked in [`../../prompt-eval-system/TASK.md`](../../prompt-eval-system/TASK.md) Phase 10.

**Evaluation Mode strip (Step 1):**
- [x] `EvaluationModeStrip` component in `PromptsPage.tsx` — three cards (Model Comparison / Prompt Comparison / Full Matrix), radio-style selection, above the prompt selector bars
- [x] Model Comparison mode swaps the A/B diff view for a single full-height textarea editor and hides the Prompt B selector bar entirely
- [x] Mode-aware "Next" validation: Model Comparison hard-blocks below 2 models; Prompt Comparison allows 1 with a non-blocking cyan nudge line ("add another model to see if this holds up across models too")
- [ ] Optional: N-prompt-slot UI for Full Matrix mode (currently behaves like Prompt Comparison's 2 slots — deferred as lowest priority per the source plan)

**Purpose Template Gallery (pre-Step 1 entry point):**
- [x] `TemplateGalleryPage.tsx` at `/eval/templates` — card grid (Classification / Tagging / Summarization / any custom templates / Start Blank), styled after `SessionHubPage`'s session-card grid
- [x] Session Hub's "New Evaluation" button now routes to `/eval/templates` instead of directly to `/eval/prompts`
- [x] Selecting a card pre-fills prompt content, comparison mode, inline test cases, and (for the Summarization template) the judge template — via `applyPurposeTemplateToStorage()` in `src/contexts/purposeTemplateStorage.ts`, since the gallery page renders outside `EvalWizardProvider`'s tree and can't dispatch directly
- [x] Provenance badge ("from template: X") shown on Step 1 when arrived via a template
- [x] Judge Configuration card on Step 2 shows a "Required for this template" badge when the loaded purpose template's assertion strategy is `llm-rubric` (soft indicator, not a hard block on Run)
- [x] "Save as Template" button on Step 2, alongside "Save as Preset"
- [ ] **Verification**: full browser walkthrough (blocked on none of the above being tested against a running dev server in this pass — `npm run build`, `tsc -b`, and `vitest` all pass, and the purpose-templates API was smoke-tested via a locally started server, but the actual gallery → wizard click-through hasn't been driven in a browser yet)
