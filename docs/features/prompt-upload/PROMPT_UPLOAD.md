# Prompt Upload & Version Advancement

> **Phase**: 1.5 — implement before Phase 2 (Evaluation Engine)
>
> **Purpose**: Allow users to load prompt files into the comparison UI via drag-and-drop or file picker, have them automatically persisted to the backend, and support advancing the prompt pair (B becomes A, new B loaded) to represent the next iteration of the comparison session.

---

## Overview

The current UI requires pasting prompt text manually. This feature adds:

1. **Drag-and-drop** on either PromptPanel to load a `.txt` or `.md` file
2. **Browse file button** as an alternative to drag-and-drop
3. **Subtle upload indicator** while the file is being read and saved to the backend
4. **"Use as Prompt A →" button** on the Prompt B panel to advance the session to the next iteration

---

## Drag-and-Drop & File Upload

### Behavior

1. User drags a `.txt` or `.md` file over either PromptPanel editor.
2. The panel highlights (border pulse) while the file is dragged over it.
3. On drop, the file is read via `FileReader.readAsText(file)`.
4. The textarea is **immediately populated** with the file content — no waiting for a network call.
5. In parallel, the content is POSTed to the backend:
   - If no prompt manifest exists for this panel slot: `POST /api/eval/prompts` (creates a new prompt)
   - If a prompt manifest already exists (file was previously loaded): `POST /api/eval/prompts/:id/versions` (adds a new version)
6. A subtle status strip below the textarea shows: `Reading file…` → `Saved` → (clears after 2s) or `Error saving` (persists until dismissed).

### Supported file types

- `.md` — Markdown system prompts
- `.txt` — Plain text prompts
- Unsupported types: show inline error `"Only .md and .txt files are supported"`; do not clear textarea.

### Browse File Button

A small "Browse…" link/button sits below the textarea alongside the drag hint text.
Clicking it triggers a hidden `<input type="file" accept=".txt,.md">`.
Same behavior as drop — reads file, populates textarea, saves to backend.

---

## PromptPanel Component Changes

**File: `src/components/prompt/PromptPanel.tsx`**

### New props

```typescript
interface PromptPanelProps {
  // existing props...
  onFileUpload?: (content: string, fileName: string) => void;
  uploadStatus?: 'idle' | 'reading' | 'saving' | 'saved' | 'error';
  uploadError?: string;
}
```

### New internal state

```typescript
const [isDragOver, setIsDragOver] = useState(false);
```

### New event handlers

```typescript
onDragOver: (e) => { e.preventDefault(); setIsDragOver(true); }
onDragLeave: () => setIsDragOver(false);
onDrop: (e) => {
  e.preventDefault();
  setIsDragOver(false);
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.match(/\.(md|txt)$/i)) { /* show error */ return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target?.result as string;
    onChange?.(content);         // populate textarea immediately
    onFileUpload?.(content, file.name);  // trigger backend save
  };
  reader.readAsText(file);
}
```

### Render additions

Below the textarea (in editor mode):

```tsx
{/* Drag hint + browse button */}
<div className="upload-hint">
  Drop a .md or .txt file here, or{' '}
  <button className="upload-browse" onClick={() => fileInputRef.current?.click()}>
    browse
  </button>
  <input ref={fileInputRef} type="file" accept=".txt,.md" hidden onChange={handleFileSelect} />
</div>

{/* Status strip */}
{uploadStatus && uploadStatus !== 'idle' && (
  <div className={`upload-progress upload-progress--${uploadStatus}`}>
    {uploadStatus === 'reading' && 'Reading file…'}
    {uploadStatus === 'saving' && 'Saving…'}
    {uploadStatus === 'saved' && 'Saved'}
    {uploadStatus === 'error' && (uploadError ?? 'Error saving file')}
  </div>
)}
```

The `.prompt-panel` container gets `className={isDragOver ? 'prompt-panel prompt-panel--dragging' : 'prompt-panel'}`.

---

## App.tsx Changes

**File: `src/App.tsx`**

### New state

```typescript
const [promptManifests, setPromptManifests] = useState<[PromptManifest | null, PromptManifest | null]>([null, null]);
const [uploadStatus, setUploadStatus] = useState<['idle'|'reading'|'saving'|'saved'|'error', 'idle'|'reading'|'saving'|'saved'|'error']>(['idle', 'idle']);
const [activeSessionId, setActiveSessionId] = useState<string | null>(
  () => localStorage.getItem('lmeval_session_id')
);
```

### handleFileUpload(side, content, fileName)

```typescript
async function handleFileUpload(side: 0 | 1, content: string, fileName: string) {
  setUploadStatus(prev => {
    const next = [...prev] as typeof prev;
    next[side] = 'saving';
    return next;
  });
  try {
    const existing = promptManifests[side];
    const name = fileName.replace(/\.(md|txt)$/i, '');
    const manifest = existing
      ? await addPromptVersion(existing.id, content)
      : await createPrompt(name, content);

    setPromptManifests(prev => {
      const next = [...prev] as typeof prev;
      next[side] = manifest;
      return next;
    });
    setUploadStatus(prev => {
      const next = [...prev] as typeof prev;
      next[side] = 'saved';
      return next;
    });
    setTimeout(() => setUploadStatus(prev => {
      const next = [...prev] as typeof prev;
      next[side] = 'idle';
      return next;
    }), 2000);
  } catch (err) {
    setUploadStatus(prev => {
      const next = [...prev] as typeof prev;
      next[side] = 'error';
      return next;
    });
  }
}
```

### Partial src/api/eval.ts (pulled forward from Phase 5)

```typescript
// src/api/eval.ts
const BASE = '/api/eval';

export async function createPrompt(name: string, content: string): Promise<PromptManifest> {
  const res = await fetch(`${BASE}/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!res.ok) throw new Error(`createPrompt failed: ${res.status}`);
  return res.json();
}

export async function addPromptVersion(id: string, content: string, description?: string): Promise<PromptManifest> {
  const res = await fetch(`${BASE}/prompts/${id}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, description }),
  });
  if (!res.ok) throw new Error(`addPromptVersion failed: ${res.status}`);
  return res.json();
}
```

---

## CSS Classes

**File: `src/App.css`**

```css
/* Upload zone */
.prompt-panel--dragging {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
}

.upload-hint {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 4px;
  padding: 0 2px;
}

.upload-browse {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: inherit;
  padding: 0;
  text-decoration: underline;
}

.upload-browse:hover {
  opacity: 0.8;
}

/* Status strip */
.upload-progress {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 3px;
  margin-top: 4px;
}

.upload-progress--reading,
.upload-progress--saving {
  color: var(--muted);
}

.upload-progress--saved {
  color: var(--ok);
}

.upload-progress--error {
  color: var(--error);
}
```

---

## Prompt Version Advancement (B → A)

### Concept

After running an eval, the user determines that Prompt B is better. They want to:
1. Make Prompt B the new Prompt A (baseline)
2. Load a new Prompt B (next candidate)
3. Run evals again

This "advancement" increments the session version.

### UI

A **"Use as Prompt A →"** button appears on the **Prompt B panel** when:
- Prompt B has content (non-empty)
- The user is not currently running an eval

Clicking it:
1. Copies Prompt B content into Prompt A textarea
2. Clears Prompt B textarea
3. Copies `promptManifests[1]` to `promptManifests[0]`, clears `promptManifests[1]`
4. If `activeSessionId` is set, calls `POST /api/eval/sessions/:id/versions` with:
   ```json
   {
     "promptA": { "promptId": "<old B manifest id>", "promptVersion": <latest version> },
     "promptB": { "promptId": null, "promptVersion": null },
     "description": "Advanced B to A"
   }
   ```
   (The new B slot starts empty until the user loads the next prompt)
5. Updates session version indicator in the UI

### PromptPanel prop addition

```typescript
onAdvance?: () => void;   // shown only on side B; undefined on side A
```

The button renders inside the PromptPanel header row (next to the label):

```tsx
{onAdvance && prompts[1].content && (
  <button className="advance-btn" onClick={onAdvance} title="Use this prompt as Prompt A">
    Use as Prompt A →
  </button>
)}
```

---

## Session Persistence of Active Session

`activeSessionId` is stored in `localStorage` so the user can close and reopen the browser without losing their session context.

On app load:
- Read `localStorage.getItem('lmeval_session_id')`
- If found, `GET /api/eval/sessions/:id/active` to restore `promptA`/`promptB` slot references
- Fetch both prompt version contents and restore textarea values

If no session exists yet, the first file upload creates one automatically:
1. After `createPrompt()` succeeds for the first panel
2. If the second panel also has a manifest, create a session: `POST /api/eval/sessions`
3. Store the returned `session.id` in `localStorage`

---

## Verification

1. Drag a `.md` file onto Prompt A panel → textarea populates immediately → status shows "Saving…" then "Saved" → `POST /api/eval/prompts` fired → `promptManifests[0]` set
2. Drag another `.md` file onto Prompt A → `POST /api/eval/prompts/:id/versions` fired (new version added, not new prompt)
3. Click "Browse" on Prompt B → file picker opens → same behavior as drop
4. Drag unsupported file type → inline error shown, textarea unchanged
5. Click "Use as Prompt A →" → B content moves to A, B clears → `promptManifests` swapped → session creates new version if active session exists
6. Refresh page → `localStorage` session ID used to restore prompt content
