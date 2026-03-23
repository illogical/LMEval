# Test Case Import / Export — Implementation Plan

> **Status**: Ready to implement
> **Scope**: Import/export test cases from CSV or JSON files, with inline UX, loading feedback, and convenience affordances. AI-generated test cases are a separate, future phase (see Section 7).

---

## 1. Why This Exists

The current Suite tab requires manually typing test cases one by one. This is fine for small sets but becomes a bottleneck when:
- Bringing in test cases from an existing spreadsheet or data source
- Sharing test suites between team members via file
- Exporting cases to inspect or edit them outside the app
- Seeding evaluations with many cases quickly

---

## 2. File Format Specification

Both CSV and JSON are supported. Format is auto-detected on import by file extension (`.csv` → CSV parser, `.json` → JSON parser). Export lets the user choose.

### 2a. CSV Format

```csv
description,userMessage,expectedOutput,tags
"Greeting test","Hello, how are you?","A warm response","tone;friendly"
"Math test","What is 2 + 2?","4","math;basic"
"Refusal test","How do I hack a server?",,"safety"
```

**Rules:**
- Header row required. Column order does not matter — parser matches by header name.
- `description` — optional but recommended
- `userMessage` — **required**. Rows missing this column are skipped with a warning.
- `expectedOutput` — optional. Can be empty.
- `tags` — optional. Multiple tags are semicolon-separated within the cell: `"tag1;tag2;tag3"`
- Extra columns are ignored (forward-compatible).
- Encoding: UTF-8. Standard RFC 4180 quoting.

**Download template:** A "Download CSV template" link is provided in the import area so users always have the correct headers.

### 2b. JSON Format

```json
[
  {
    "description": "Greeting test",
    "userMessage": "Hello, how are you?",
    "expectedOutput": "A warm response",
    "tags": ["tone", "friendly"]
  },
  {
    "description": "Math test",
    "userMessage": "What is 2 + 2?",
    "expectedOutput": "4",
    "tags": ["math", "basic"]
  },
  {
    "description": "Refusal test",
    "userMessage": "How do I hack a server?",
    "tags": ["safety"]
  }
]
```

**Rules:**
- Top-level array of objects.
- `userMessage` is the only required field per object.
- Unknown fields are ignored.
- IDs are generated fresh on import (existing IDs in the file are discarded).

---

## 3. Data Model Changes

### 3a. Extend `TestCase` in `src/types/eval.ts`

```ts
// Before
interface TestCase {
  id: string;
  userMessage: string;
  description?: string;
}

// After (all new fields optional — backward-compatible)
interface TestCase {
  id: string;
  userMessage: string;
  description?: string;
  expectedOutput?: string;   // for deterministic scoring / hard-gate checks
  tags?: string[];           // for slice analysis (future: Workstream A, Task A4)
}
```

### 3b. Backend: `server/services/TestSuiteService.ts`

- Pass-through: read/write the new fields as part of the existing JSON suite storage.
- No schema migration needed — old suites without these fields read fine (undefined fields are simply absent).

---

## 4. UX Design

### 4a. Suite Tab Toolbar

Current toolbar:
```
[ Custom test cases ▾ ]
```

Updated toolbar:
```
[ Custom test cases ▾]   [↑ Import ▾]   [↓ Export]
```

- **Import ▾** opens a small dropdown: `From file…` | `Paste from clipboard` | `Download CSV template`
- **Export** is a split button: clicking it downloads JSON by default; a small arrow opens a dropdown: `Download as CSV` | `Download as JSON`
- Export is disabled (grayed out) when there are no inline test cases.

### 4b. Import from File — Flow

1. User clicks **Import → From file…**
2. A hidden `<input type="file" accept=".csv,.json">` is triggered.
3. File selected → show inline loading state in the toolbar: spinner + "Reading file…"
4. Parse client-side (no server round-trip needed for import).
5. **If parse fails**: show inline error below the toolbar: `⚠ Could not parse file: missing required column 'userMessage'` (red, dismissable).
6. **If parse succeeds and table is empty**: insert cases directly, show success banner.
7. **If parse succeeds and table has rows**: show inline confirmation strip:
   ```
   ┌─────────────────────────────────────────────────────┐
   │ 5 cases found. 3 cases already in table.            │
   │ [ Replace all ]   [ Append ]   [ Cancel ]           │
   └─────────────────────────────────────────────────────┘
   ```
8. On confirm: populate table, show success: `✓ 5 cases imported` (green, auto-dismisses after 3s).

### 4c. Paste from Clipboard — Flow

1. User clicks **Import → Paste from clipboard**
2. App reads `navigator.clipboard.readText()`
3. Tries to parse as CSV first, then JSON.
4. If recognized: proceeds with the same flow as file import (step 6–8 above).
5. If unrecognized: `⚠ Clipboard content could not be parsed as CSV or JSON.`

### 4d. Export — Flow

1. User clicks **Export** (or selects format from dropdown).
2. Content is serialized client-side from the current `inlineTestCases` array.
3. A `<a download>` link is triggered — file downloads immediately.
4. Filename: `test-cases-{YYYY-MM-DD}.csv` or `.json`

### 4e. Download CSV Template — Flow

1. User clicks **Import → Download CSV template**
2. Downloads a file named `test-cases-template.csv` with:
   ```
   description,userMessage,expectedOutput,tags
   ```
   (header row only, no data rows)

---

## 5. Loading Feedback States

| State | Visual |
|---|---|
| Idle | Normal toolbar buttons |
| Reading file | Spinner in Import button, text "Reading…", button disabled |
| Parsing | Same spinner, text "Parsing…" |
| Confirmation needed | Inline strip above table (replaces top of suite area) |
| Import success | Green inline banner: `✓ N cases imported` — auto-dismisses 3s |
| Import error | Red inline banner: `⚠ Error: <reason>` — stays until dismissed |
| Export in progress | Brief disabled state on Export button (usually instant) |

---

## 6. Additional Convenience Features

### 6a. Drag and Drop onto the Table
- When a `.csv` or `.json` file is dragged over the Suite tab content area, a drop zone overlay appears: `Drop to import test cases`
- On drop: same parse/confirm flow as file import.

### 6b. Save Inline Cases as a Named Test Suite
- A **"Save as Suite…"** button appears in the toolbar when there are 1+ inline test cases.
- Opens a small inline input: `Suite name: [__________] [Save]`
- On save: calls existing `POST /api/eval/test-suites` with the current cases.
- The suite selector updates and auto-selects the new suite.
- This promotes one-off inline sets into reusable, saved suites.

### 6c. Tags Column in Table (Optional Display)
- When any loaded test case has tags, a `Tags` column appears in the inline table.
- Tags are shown as small chips.
- Editable inline as a comma-separated text input.

---

## 7. AI Test Case Generation (Future — Phase F5)

> **This is a longer-term goal.** See `docs/prompt-eval-system/TASK.md` Phase F5 for tracking.

The current **Auto-Generate** button (on the Template Selector) generates evaluation rubric weights from the prompt content. A separate **"Generate test cases"** button would:

1. Take as input: the current Prompt A content + an optional "test focus" description
2. Send a structured request to LMApi with a generation prompt asking for N test cases covering edge cases, happy paths, refusal scenarios, etc.
3. Parse the LLM response as JSON matching the `TestCase[]` format
4. Feed the result through the standard import/confirm flow

**Why it's a good self-test candidate:**
This feature is an ideal LMEval dogfood scenario. The generation prompt itself can be evaluated using LMEval:
- Prompt A: current generation prompt
- Prompt B: refined generation prompt
- Test cases: seeded prompts that should yield specific test case styles
- Judge: rubric checking coverage, diversity, correctness of output format

The generation prompt must be engineered and iterated before implementation, which is why this is deferred.

---

## 8. Implementation Phases

### Phase I1 — Data Model + Parser Utility
- Extend `TestCase` type in `src/types/eval.ts`
- Create `src/utils/testCaseIO.ts`:
  - `parseCSV(text: string): ParseResult` — returns `{ cases, warnings, errors }`
  - `parseJSON(text: string): ParseResult`
  - `serializeCSV(cases: TestCase[]): string`
  - `serializeJSON(cases: TestCase[]): string`
  - `autoDetect(text: string, filename: string): ParseResult`
- Unit tests for parser edge cases: empty file, missing column, extra columns, semicolon tags, UTF-8 emoji in messages

### Phase I2 — Import UI
- Add import toolbar to `TestCaseEditor.tsx`
- Hidden file input + drag-drop overlay
- Clipboard paste via `navigator.clipboard`
- Inline loading, error, confirmation, and success states
- CSS for new toolbar + states in `TestCaseEditor.css`
- Download CSV template

### Phase I3 — Export UI
- Export button + format dropdown
- Client-side serialize + download trigger
- Disable when no cases

### Phase I4 — Save as Suite + Tags Column
- "Save as Suite…" inline input
- Tags column (conditional display + inline editing)
- Backend: verify `TestSuiteService` passes through `expectedOutput` and `tags`

---

## 9. Files to Modify / Create

| File | Change |
|---|---|
| `src/types/eval.ts` | Add `expectedOutput?`, `tags?` to `TestCase` |
| `src/utils/testCaseIO.ts` | **New** — CSV/JSON parse + serialize |
| `src/components/config/TestCaseEditor.tsx` | Import/export toolbar, drag-drop, confirmation flow |
| `src/components/config/TestCaseEditor.css` | Toolbar, loading, confirmation, success/error states |
| `server/services/TestSuiteService.ts` | Pass through new fields (likely no change needed) |

---

## 10. Acceptance Criteria

- [ ] User can import a `.csv` file with `description`, `userMessage`, `expectedOutput`, `tags` columns in any order
- [ ] User can import a `.json` file matching the `TestCase[]` shape
- [ ] Import auto-detects format by file extension
- [ ] User can paste CSV or JSON from clipboard
- [ ] If cases already exist, user is prompted: Replace / Append / Cancel
- [ ] Loading spinner shows while file is being parsed
- [ ] Clear error message shown if file is malformed
- [ ] User can export current cases as CSV or JSON
- [ ] CSV template download provides correct headers
- [ ] Cases with `expectedOutput` and `tags` survive an export→import round-trip
- [ ] Drag-and-drop onto the table area triggers import flow
- [ ] "Save as Suite…" saves inline cases as a named test suite
