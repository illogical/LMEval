import type {
  LmapiChatCompletionRequest,
  LmapiChatCompletionResponse,
  LmapiLoadedModelsResponse,
  LmapiServerStatus,
} from '../../src/types/lmapi';
import { config } from '../config';

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
  async getLoadedModels(): Promise<string[]> {
    const res = await fetchWithTimeout(`${config.lmapiBaseUrl}/api/models/loaded`);
    if (!res.ok) throw new Error(`LMApi models fetch failed: ${res.statusText}`);
    const data = await res.json() as LmapiLoadedModelsResponse;
    return data.models;
  },

  async getServers(): Promise<LmapiServerStatus[]> {
    const res = await fetchWithTimeout(`${config.lmapiBaseUrl}/api/servers`);
    if (!res.ok) throw new Error(`LMApi servers fetch failed: ${res.statusText}`);
    return res.json() as Promise<LmapiServerStatus[]>;
  },

  async chatCompletion(
    req: LmapiChatCompletionRequest
  ): Promise<LmapiChatCompletionResponse> {
    const res = await fetchWithTimeout(
      `${config.lmapiBaseUrl}/api/chat/completions/any`,
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
