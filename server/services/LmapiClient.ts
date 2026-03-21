import type {
  LmapiChatCompletionRequest,
  LmapiChatCompletionResponse,
  LmapiLoadedModelsResponse,
  LmapiServerStatus,
} from '../../src/types/lmapi';
import { config } from '../config';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const RETRY_COUNT = Math.max(0, parseInt(process.env.LMAPI_RETRY_COUNT ?? '3', 10) || 3);
const RETRY_DELAY_MS = Math.max(100, parseInt(process.env.LMAPI_RETRY_DELAY_MS ?? '2000', 10) || 2000);

class LmapiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isTimeout = false
  ) {
    super(message);
    this.name = 'LmapiError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof LmapiError) {
    return [429, 502, 503, 504].includes(err.statusCode) || err.isTimeout;
  }
  if (err instanceof Error && /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(err.message)) {
    return true;
  }
  return false;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = RETRY_COUNT,
  delayMs = RETRY_DELAY_MS,
  context = 'LMApi call',
  onRetry?: (attemptNumber: number, err: Error) => void
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (!isRetryable(err)) throw err;
      if (attempt < retries) {
        const wait = delayMs * (attempt + 1);
        console.warn(`[retry] ${context}: attempt ${attempt + 1} failed (${(err as Error).message}), retrying in ${wait}ms`);
        onRetry?.(attempt + 1, err as Error);
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LmapiError(`Request to ${url} timed out after ${timeoutMs}ms`, 504, true);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const LmapiClient = {
  async getLoadedModels(): Promise<string[]> {
    const res = await fetchWithTimeout(`${config.lmapiBaseUrl}/api/models/loaded`);
    if (!res.ok) throw new LmapiError(`LMApi models fetch failed: ${res.statusText}`, res.status);
    const data = await res.json() as LmapiLoadedModelsResponse;
    return data.models;
  },

  async getServers(): Promise<LmapiServerStatus[]> {
    const res = await fetchWithTimeout(`${config.lmapiBaseUrl}/api/servers`);
    if (!res.ok) throw new LmapiError(`LMApi servers fetch failed: ${res.statusText}`, res.status);
    return res.json() as Promise<LmapiServerStatus[]>;
  },

  async chatCompletion(
    req: LmapiChatCompletionRequest,
    onRetry?: (attemptNumber: number, err: Error) => void
  ): Promise<LmapiChatCompletionResponse> {
    return withRetry(
      async () => {
        const res = await fetchWithTimeout(
          `${config.lmapiBaseUrl}/api/chat/completions/any`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
          }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          throw new LmapiError(errBody.error ?? res.statusText, res.status);
        }
        return res.json() as Promise<LmapiChatCompletionResponse>;
      },
      RETRY_COUNT,
      RETRY_DELAY_MS,
      `chatCompletion(${req.model})`,
      onRetry
    );
  },
};
