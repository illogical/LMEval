import type { PromptManifest } from '../types/eval';
import type { SessionManifest, SessionSlot } from '../types/session';

const BASE = '/api/eval';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function createPrompt(name: string, content: string): Promise<PromptManifest> {
  return apiFetch('/prompts', {
    method: 'POST',
    body: JSON.stringify({ name, content }),
  });
}

export async function addPromptVersion(id: string, content: string, description?: string): Promise<PromptManifest> {
  return apiFetch(`/prompts/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ content, description }),
  });
}

export async function createSession(data: {
  name: string;
  description?: string;
  promptA: SessionSlot;
  promptB: SessionSlot;
}): Promise<SessionManifest> {
  return apiFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function addSessionVersion(
  sessionId: string,
  data: { description?: string; promptA: SessionSlot; promptB: SessionSlot }
): Promise<SessionManifest> {
  return apiFetch(`/sessions/${sessionId}/versions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
