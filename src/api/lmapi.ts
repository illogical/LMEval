import type { LmapiServerStatus } from '../types/lmapi';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const lmapiApi = {
  listServers: () => request<LmapiServerStatus[]>('/servers'),
  listModels: () => request<string[]>('/models'),
};
