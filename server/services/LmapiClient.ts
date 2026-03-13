import type { LmapiChatCompletionRequest, LmapiChatCompletionResponse, LmapiServerStatus, LmapiBatchResponse } from '../../src/types/lmapi.ts';

const LMAPI_BASE_URL = process.env.LMAPI_BASE_URL || 'http://localhost:3111';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.LMAPI_TIMEOUT_MS ?? '120000', 10);

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class LmapiClient {
  static async getServers(): Promise<LmapiServerStatus[]> {
    try {
      const res = await fetchWithTimeout(`${LMAPI_BASE_URL}/api/servers`, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`LMApi /api/servers returned ${res.status}`);
      return res.json() as Promise<LmapiServerStatus[]>;
    } catch (e) {
      throw new Error(`LmapiClient.getServers failed: ${e}`);
    }
  }

  static async getModels(): Promise<string[]> {
    try {
      const res = await fetchWithTimeout(`${LMAPI_BASE_URL}/api/models`, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`LMApi /api/models returned ${res.status}`);
      const data = await res.json() as { models: string[] };
      return data.models ?? [];
    } catch (e) {
      throw new Error(`LmapiClient.getModels failed: ${e}`);
    }
  }

  static async chatCompletion(request: LmapiChatCompletionRequest): Promise<LmapiChatCompletionResponse> {
    try {
      const res = await fetchWithTimeout(
        `${LMAPI_BASE_URL}/api/chat/completions/any`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, stream: false })
        },
        DEFAULT_TIMEOUT_MS
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`LMApi chat completion returned ${res.status}: ${errBody}`);
      }
      return res.json() as Promise<LmapiChatCompletionResponse>;
    } catch (e) {
      throw new Error(`LmapiClient.chatCompletion failed: ${e}`);
    }
  }

  static async batchCompletion(
    messages: LmapiChatCompletionRequest['messages'],
    models: string[],
    options?: Partial<LmapiChatCompletionRequest>
  ): Promise<LmapiBatchResponse> {
    try {
      const res = await fetchWithTimeout(
        `${LMAPI_BASE_URL}/api/chat/completions/batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, models, ...options, stream: false })
        },
        DEFAULT_TIMEOUT_MS * 2
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`LMApi batch completion returned ${res.status}: ${errBody}`);
      }
      return res.json() as Promise<LmapiBatchResponse>;
    } catch (e) {
      throw new Error(`LmapiClient.batchCompletion failed: ${e}`);
    }
  }
}
