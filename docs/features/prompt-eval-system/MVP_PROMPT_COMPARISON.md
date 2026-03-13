# LMEval MVP — Prompt Comparison UI

## Overview

Side-by-side prompt comparison tool. Load two system prompts (A and B — "before and after"), select a model, send both to LMApi in parallel with a shared user message, view responses side by side with syntax highlighting.

This is the MVP foundation. The UI is designed to extend naturally into multi-model evaluation, eval configuration, and results analysis (see `docs/prompt-eval-system/IMPLEMENTATION_PLAN.md` for the full roadmap).

---

## Color Palette

Match [vaultpad.css](../../../vaultpad.css) aesthetic — CSS custom properties, **no Tailwind for MVP**:

```css
:root {
  --bg:              #15232D;
  --surface:         #15232D;
  --surface-preview: #1A3549;  /* response panels */
  --text:            #d4d4d4;
  --muted:           #9da3ad;
  --accent:          #4fc1ff;
  --border:          #2d2d30;
  --ok:              #2ea043;
  --error:           #f43f5e;
  --font-ui:         'Inter', system-ui, sans-serif;
  --font-mono:       'JetBrains Mono', ui-monospace, monospace;
}
```

Fonts loaded via Google Fonts in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

---

## Syntax Highlighting

Use **highlight.js** with the `atom-one-dark` theme (same approach as [SplitDiff](https://github.com/illogical/SplitDiff)).

- Install: `bun add highlight.js`
- Import CSS in `ResponseView.tsx`: `import 'highlight.js/styles/atom-one-dark.css'`
- Register languages: `markdown`, `json`, `xml`, `yaml`
- Use `hljs.highlightAuto(content, ['markdown', 'json', 'xml', 'yaml'])` for auto-detection
- Render via `dangerouslySetInnerHTML` inside `<pre><code class="hljs">`

Supported formats for prompt and response content: Markdown, JSON, XML, YAML, plain text.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ Header: LMEval logo | Model selector ▼ | Run Both ▶      │
├────────────────────────────┬─────────────────────────────┤
│ PROMPT A                   │ PROMPT B                    │
│ [monospace textarea]       │ [monospace textarea]        │
├────────────────────────────┴─────────────────────────────┤
│ User Message [textarea, spans full width]                │
├────────────────────────────┬─────────────────────────────┤
│ RESPONSE A                 │ RESPONSE B                  │
│ [syntax highlighted]       │ [syntax highlighted]        │
└────────────────────────────┴─────────────────────────────┘
```

CSS Grid layout on `.app-layout`:
```css
.app-layout {
  display: grid;
  grid-template-rows: auto 1fr auto 1fr;
  height: 100vh;
  overflow: hidden;
}
```

`.main-area` (prompt editors row) and `.response-area` (response row) each use `grid-template-columns: 1fr 1fr` with a border divider between columns.

---

## Dependency

```bash
bun add highlight.js
```

No backend server needed for MVP. LMApi is called directly from the frontend via a Vite dev proxy.

---

## LMApi Integration

**Vite proxy** (add to `vite.config.ts`):
```ts
server: {
  proxy: {
    '/lmapi': {
      target: 'http://localhost:3111',
      changeOrigin: true,
    },
  },
},
```

**Endpoints used:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/lmapi/api/servers` | Fetch all servers and their model lists |
| `POST` | `/lmapi/api/chat/completions/any` | Send a chat completion (non-streaming) |

Note: `GET /lmapi/api/servers` returns an **array directly** (not `{ servers: [...] }`). Each element shape:
```json
{
  "config": { "name": "alpha", "baseUrl": "http://..." },
  "isOnline": true,
  "models": ["llama3.1:latest", "qwen2.5:7b"]
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `vite.config.ts` | Modify | Add `/lmapi` proxy block |
| `index.html` | Modify | Title → "LMEval", add Google Fonts `<link>` tags |
| `src/index.css` | Replace | Vaultpad-inspired CSS custom properties + base reset + full-height body/root |
| `src/App.css` | Replace | Layout CSS for all class names used in App and components |
| `src/types/lmapi.ts` | Create | `LmapiServerStatus`, `LmapiChatCompletionRequest`, `LmapiChatCompletionResponse` |
| `src/api/lmapi.ts` | Create | `getServers()`, `chatCompletion()` fetch wrappers |
| `src/hooks/useModels.ts` | Create | Fetches servers, flattens to `ModelOption[]` grouped by server |
| `src/components/layout/Header.tsx` | Create | Logo + model `<select>` + Run Both button + status |
| `src/components/prompt/ResponseView.tsx` | Create | highlight.js rendering, loading/error/idle states |
| `src/components/prompt/PromptPanel.tsx` | Create | Label + textarea (shared for prompt and response sections) |
| `src/App.tsx` | Replace | Root layout, all state, `handleRun` orchestration |

---

## TypeScript Types (`src/types/lmapi.ts`)

```ts
export interface LmapiServerStatus {
  config: { name: string; baseUrl: string };
  isOnline: boolean;
  models: string[];
  runningModels: string[];
  activeModels: string[];
  activeRequests: number;
  lastChecked: number;
}

export interface LmapiChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream: false;
  groupId?: string;
}

export interface LmapiChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  lmapi?: {
    server_name: string;
    duration_ms: number;
    group_id?: string;
  };
}
```

---

## API Client (`src/api/lmapi.ts`)

```ts
import type { LmapiServerStatus, LmapiChatCompletionRequest, LmapiChatCompletionResponse } from '../types/lmapi';

export async function getServers(): Promise<LmapiServerStatus[]> {
  const res = await fetch('/lmapi/api/servers');
  if (!res.ok) throw new Error(`Failed to fetch servers: ${res.statusText}`);
  return res.json();
}

export async function chatCompletion(
  req: LmapiChatCompletionRequest
): Promise<LmapiChatCompletionResponse> {
  const res = await fetch('/lmapi/api/chat/completions/any', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}
```

---

## `useModels` Hook (`src/hooks/useModels.ts`)

```ts
export interface ModelOption {
  value: string;       // model id, e.g. "llama3.1:latest"
  label: string;       // display label
  serverName: string;  // for <optgroup> grouping
}

// Returns { models, loading, error }
// On mount: calls getServers(), filters isOnline, flattens models[]
// Auto-selects first model when models load
```

---

## Components

### `Header.tsx`

Props:
```ts
interface HeaderProps {
  models: ModelOption[];
  modelsLoading: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onRun: () => void;
  runDisabled: boolean;
  runStatus: 'idle' | 'loading' | 'done' | 'error';
}
```

Structure (flex row, `justify-content: space-between`):
1. **Left**: `<span class="logo">LMEval</span>` — accent color, JetBrains Mono, bold
2. **Center**: `<select>` with one `<optgroup label={serverName}>` per server, each `<option value={model.value}>`
3. **Right**: `<button disabled={runDisabled}>Run Both ▶</button>` + status indicator (spinner while loading, "Done in Xs" after, error dot on failure)

### `ResponseView.tsx`

```tsx
import 'highlight.js/styles/atom-one-dark.css';
import hljs from 'highlight.js/lib/core';
import markdown from 'highlight.js/lib/languages/markdown';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
[markdown, json, xml, yaml].forEach((lang, i) =>
  hljs.registerLanguage(['markdown','json','xml','yaml'][i], lang)
);

// Props: { content: string | null, status, error?, durationMs? }
// - 'idle': muted hint "Response will appear here"
// - 'loading': pulsing skeleton lines (CSS animation)
// - 'error': error message in var(--error) color
// - 'done': hljs.highlightAuto(content, [...]).value via dangerouslySetInnerHTML
//   in <pre><code class="hljs">
```

Override atom-one-dark background to match `--surface-preview`:
```css
.response-view .hljs { background: transparent; }
```

### `PromptPanel.tsx`

Props:
```ts
interface PromptPanelProps {
  label: string;       // "A" or "B"
  content: string;
  onChange: (val: string) => void;
  response: string | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  durationMs?: number;
}
```

Used for **both** the prompt editor row and the response row. When `isEditor=true`, renders a `<textarea>`; when `isEditor=false`, renders `<ResponseView>`. The App places two instances at each row.

---

## App State (`src/App.tsx`)

```ts
interface PromptState {
  content: string;
  response: string | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  durationMs?: number;
}

const [prompts, setPrompts] = useState<[PromptState, PromptState]>([
  { content: '', response: null, status: 'idle' },
  { content: '', response: null, status: 'idle' },
]);
const [userMessage, setUserMessage] = useState('');
const [selectedModel, setSelectedModel] = useState('');
const { models, modelsLoading } = useModels();

// Auto-select first model when models load
useEffect(() => {
  if (models.length > 0 && !selectedModel) setSelectedModel(models[0].value);
}, [models]);
```

**`handleRun`**:
```ts
async function handleRun() {
  // 1. Set both to loading
  setPrompts([
    { ...prompts[0], status: 'loading', response: null },
    { ...prompts[1], status: 'loading', response: null },
  ]);

  // 2. Dispatch both in parallel
  const makeReq = (i: number): LmapiChatCompletionRequest => ({
    model: selectedModel,
    messages: [
      { role: 'system', content: prompts[i].content },
      { role: 'user', content: userMessage },
    ],
    stream: false,
  });

  const [resultA, resultB] = await Promise.allSettled([
    chatCompletion(makeReq(0)),
    chatCompletion(makeReq(1)),
  ]);

  // 3. Update each independently
  const resolve = (result: PromiseSettledResult<LmapiChatCompletionResponse>): Partial<PromptState> =>
    result.status === 'fulfilled'
      ? { response: result.value.choices[0].message.content, status: 'done', durationMs: result.value.lmapi?.duration_ms }
      : { status: 'error', error: (result.reason as Error).message };

  setPrompts([
    { ...prompts[0], ...resolve(resultA) },
    { ...prompts[1], ...resolve(resultB) },
  ]);
}
```

**JSX structure**:
```tsx
<div className="app-layout">
  <Header ... />
  <div className="main-area">
    <PromptPanel label="A" isEditor content={prompts[0].content} onChange={...} />
    <PromptPanel label="B" isEditor content={prompts[1].content} onChange={...} />
  </div>
  <div className="user-message-bar">
    <label className="panel-label">User Message</label>
    <textarea value={userMessage} onChange={e => setUserMessage(e.target.value)} rows={3} />
  </div>
  <div className="response-area">
    <PromptPanel label="A" response={prompts[0].response} status={prompts[0].status} ... />
    <PromptPanel label="B" response={prompts[1].response} status={prompts[1].status} ... />
  </div>
</div>
```

---

## CSS (`src/App.css`)

Key classes needed:

```css
.app-layout { display: grid; grid-template-rows: auto 1fr auto 1fr; height: 100vh; overflow: hidden; }

.main-area,
.response-area { display: grid; grid-template-columns: 1fr 1fr; overflow: hidden; min-height: 0; }

.prompt-panel { display: flex; flex-direction: column; overflow: hidden; min-height: 0; background: var(--surface); border-right: 1px solid var(--border); }
.prompt-panel:last-child { border-right: 0; }

.panel-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 6px 12px; border-bottom: 1px solid var(--border); }

.prompt-textarea { flex: 1; width: 100%; background: var(--surface); color: var(--text); font-family: var(--font-mono); font-size: 13px; line-height: 1.6; padding: 12px; border: 0; outline: none; resize: none; min-height: 0; }

.response-view { flex: 1; overflow-y: auto; background: var(--surface-preview); padding: 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; min-height: 0; }
.response-view .hljs { background: transparent; }
.response-view pre { margin: 0; white-space: pre-wrap; word-break: break-word; }

.user-message-bar { display: flex; flex-direction: column; background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.user-message-bar textarea { flex: 1; width: 100%; background: var(--surface); color: var(--text); font-family: var(--font-ui); font-size: 13px; padding: 8px 12px; border: 0; outline: none; resize: none; }

/* Header */
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
.logo { font-family: var(--font-mono); font-weight: 700; color: var(--accent); font-size: 15px; }
header select { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-family: var(--font-ui); font-size: 13px; }
header button { background: var(--surface); color: var(--accent); border: 1px solid var(--accent); border-radius: 6px; padding: 6px 14px; font-family: var(--font-ui); font-size: 13px; cursor: pointer; }
header button:hover { background: var(--accent); color: var(--bg); }
header button:disabled { opacity: 0.45; cursor: not-allowed; }

/* Loading skeleton */
.skeleton-line { height: 12px; border-radius: 4px; background: var(--border); margin-bottom: 8px; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }

/* Error */
.response-error { color: var(--error); font-size: 13px; padding: 8px 0; }

/* Hint */
.response-hint { color: var(--muted); font-size: 13px; font-style: italic; }
```

---

## Notes for Implementer

1. **`GET /lmapi/api/servers` returns an array directly** — not `{ servers: [] }`. Destructure accordingly in `getServers()`.
2. **`lmapi.duration_ms`** in the chat completion response gives accurate server-side timing. Use `result.value.lmapi?.duration_ms` for `durationMs` rather than a `Date.now()` delta.
3. **`dangerouslySetInnerHTML`** is acceptable for MVP (local LMApi only). Add DOMPurify before any production/shared deployment.
4. **`src/App.css`** must fully replace the existing file — the Vite default sets `max-width: 1280px; margin: 0 auto` which breaks the full-viewport grid layout.
5. **`src/index.css`** must remove the default `body { display: flex; place-items: center; }` — it conflicts with a full-height layout.
6. **highlight.js CSS import** goes in `ResponseView.tsx` only — do not also import it in `index.css`.
7. Keep `src/assets/` untouched.

---

## Future Extension Points (Post-MVP)

These are **not** part of MVP but should be kept in mind during implementation so that extending to them is straightforward:

- **Tab bar** for 3+ prompts (PROMPT C, D...) above the prompt editors
- **Multiple model selection** — evolves to a grid of N prompts × M models
- **Evaluation config panel** — center panel from the full implementation plan
- **Results/scoring panel** — right panel with heatmap, leaderboard, export
- **Backend server** (`server/` with Hono) for persistent storage of prompts, test suites, and evaluation runs
- **User message test cases** — multiple user messages (test suite) rather than a single shared message

---

## Verification

```bash
bun run dev
# Navigate to http://localhost:5173
# ✓ Both prompt editors visible side by side with vaultpad-style dark theme
# ✓ Model selector populated from LMApi (/lmapi/api/servers)
# ✓ Enter two different system prompts + a user message
# ✓ Click "Run Both ▶" — both completions dispatch in parallel
# ✓ Responses appear with syntax highlighting (atom-one-dark theme)
# ✓ Each response panel shows duration from lmapi.duration_ms
# ✓ Error state shown if a completion fails
```
