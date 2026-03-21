import type {
  LmapiServerStatus,
  LmapiChatCompletionRequest,
  LmapiChatCompletionResponse,
} from '../../src/types/lmapi';

const LMAPI_BASE = process.env.LMAPI_BASE_URL ?? 'http://localhost:3111';
const DEFAULT_TIMEOUT = 120_000; // 2 minutes

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const LmapiClient = {
  async getServers(): Promise<LmapiServerStatus[]> {
    const res = await fetchWithTimeout(`${LMAPI_BASE}/api/servers`);
    if (!res.ok) throw new Error(`LMApi servers fetch failed: ${res.statusText}`);
    return res.json() as Promise<LmapiServerStatus[]>;
  },

  async getModels(): Promise<Array<{ serverName: string; models: string[] }>> {
    const servers = await this.getServers();
    return servers
      .filter(s => s.isOnline)
      .map(s => ({ serverName: s.config.name, models: s.models }));
  },

  async chatCompletion(
    req: LmapiChatCompletionRequest
  ): Promise<LmapiChatCompletionResponse> {
    const res = await fetchWithTimeout(
      `${LMAPI_BASE}/api/chat/completions/any`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(err.error ?? res.statusText);
    }
    return res.json() as Promise<LmapiChatCompletionResponse>;
  },
};
