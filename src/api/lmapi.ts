import type { LmapiLoadedModelsResponse, LmapiChatCompletionRequest, LmapiChatCompletionResponse } from '../types/lmapi';

export async function getLoadedModels(): Promise<string[]> {
  const res = await fetch('/lmapi/api/models/loaded');
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
  const data: LmapiLoadedModelsResponse = await res.json();
  return data.models;
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
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

export async function chatCompletionOnServer(
  req: LmapiChatCompletionRequest,
  serverName: string
): Promise<LmapiChatCompletionResponse> {
  const res = await fetch('/lmapi/api/chat/completions/server', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, serverName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}
