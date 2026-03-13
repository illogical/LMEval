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
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}
