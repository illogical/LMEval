# Prepare Wizard — UX Improvement Tasks

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
