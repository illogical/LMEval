# Model Selector Feature

## Overview

The model selector replaces the simple `<select>` dropdown with a multi-model combobox that allows selecting any number of models for a comparison run. Results are paged rather than shown as additional columns, keeping the A/B comparison layout clean regardless of model count.

## Why

- **VRAM efficiency**: Ollama loads one model at a time. Sending multiple requests to the same server back-to-back is fine; sending them in parallel forces the server to juggle two loaded models simultaneously, wasting VRAM and slowing both requests.
- **Multiple model comparison**: Running the same prompts against several models is the primary use case for LMEval. The original single-model selector made this workflow impossible.
- **Usability**: With dozens of models across multiple servers, a grouped and filterable autocomplete is far more practical than a long flat `<select>`.

---

## Component Breakdown

### `ModelSelector` (`src/components/model/ModelSelector.tsx`)

A custom combobox. The trigger area (always visible in the header) shows selected model chips and a `+` button. Clicking anywhere on the trigger opens a fixed-position dropdown.

**Trigger:**
- Chips for each selected model (with `×` to remove)
- `+` button to open the dropdown
- Status dot on each chip reflecting that model's last-run status

**Dropdown:**
- Autofocused search input at the top
- Models grouped by server name (server = non-interactive section header)
- Each model row shows: checkmark (selected), model name, status dot (post-run state)
- Filtering: server name match → show all models in that server; model name match → show matching models across servers; empty → show all
- Multi-select: dropdown stays open until Escape or click-outside
- **Dual function after a run**: clicking a model that has response data (`done`/`error`) immediately navigates the response panels to show that model, in addition to toggling selection

### `ModelNav` (`src/components/model/ModelNav.tsx`)

Appears only when `selectedModels.length > 1`. A horizontal tab bar positioned between the user-message bar and the response area.

```
← [llama:latest ✓] [mistral ⏳] [qwen] →    2 / 3
```

- Tab pills show model name + status badge
- Active tab highlighted with accent color
- `←` / `→` arrow buttons wrap around
- Keyboard: `←` / `→` keys navigate when focus is not inside a textarea or input

### `PromptPanel` model tag

When `modelTag` prop is provided (only in multi-model mode), the panel label shows the active model name as a muted monospace tag: `Prompt A · llama:latest`.

---

## Execution Strategy

### Same server → sequential

If multiple selected models belong to the same server, they run one at a time. This prevents loading two models into VRAM simultaneously and avoids the swap penalty.

### Different servers → parallel

Models on different servers run concurrently. Each server handles exactly one model at a time, so VRAM on each machine is always occupied by exactly one model.

### Algorithm

```
groupByServer(selectedModels) →
  { alpha: [llama, mistral], beta: [qwen] }

Promise.all([
  runSequential([llama, mistral])   ← alpha: llama completes → mistral starts
  runSequential([qwen])             ← beta: runs in parallel with alpha
])
```

Within each model, Prompt A and Prompt B are sent in parallel (they share the same model and server, and LMApi handles the concurrency).

### Keep-alive

Ollama keeps a model in VRAM for a configurable duration after the last request. The default is 5 minutes. Configure via `OLLAMA_KEEP_ALIVE` in `.env`. Set to `0` to unload immediately (useful for sequential runs where you want the next model to load fresh), or `-1` to keep the model loaded indefinitely.

---

## Keyboard Interactions

| Context | Key | Action |
|---------|-----|--------|
| Trigger | Enter / Space | Open dropdown |
| Dropdown search | ↑ / ↓ | Navigate model list |
| Dropdown search | Enter | Toggle focused model |
| Dropdown search | Escape | Close dropdown |
| Dropdown search | typing | Filter models |
| App (not in input) | ← / → | Navigate ModelNav tabs |

---

## UX Decisions

**Paging over columns**: Adding a column per model causes horizontal overflow and makes comparisons harder as model count grows. The nav bar + paging approach keeps the side-by-side A/B comparison at full width for any model count.

**Dropdown stays open on selection**: Multi-select requires the dropdown to remain open so the user can add several models in one interaction. ESC or clicking outside closes it explicitly.

**Dropdown as result navigator**: After a run, the same dropdown that was used to select models doubles as a quick result switcher. Status dots on each row show which models have completed, and clicking a `done`/`error` model immediately jumps to its results.

**Auto-advance**: When the first model completes, the view automatically advances to show its results, so the UI feels responsive while other models are still running.

---

## Future Ideas

- **Diff mode**: Toggle that highlights text differences between the currently viewed model's response and a baseline model's response, for the same prompt.
- **Auto-cycle**: A "slideshow" mode that automatically advances through model results on a timer.
- **Pin a model**: Mark one model as the baseline; always show its response alongside whichever model you're currently viewing.
