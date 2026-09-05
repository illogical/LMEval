const defaults = {
  port: 3200,
  lmapiBaseUrl: 'http://localhost:3111',
};

export const config = {
  port: Number(process.env.PORT ?? defaults.port),
  lmapiBaseUrl: process.env.LMAPI_BASE_URL ?? defaults.lmapiBaseUrl,
  // Mirrors Ollama's default keep-alive; set to 0 to unload immediately after each request
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE ?? '5m',
  // B3's Summary-page AI suggestions and Track C's refinement loop both gate
  // on this being set — shared here so both read one source of truth.
  refinementModel: process.env.REFINEMENT_MODEL || undefined,
};

/**
 * Repoints `config.lmapiBaseUrl` at LMApi's loopback address once co-hosted
 * under HomeBase (docs/plans/2026-08-23-homebase-integration.md §"the one
 * open question"). `LmapiClient` reads `config.lmapiBaseUrl` fresh on every
 * call, so mutating this shared object here — before any request comes in —
 * is enough; no other module needs to re-import anything.
 */
export function reconfigureLmapiBaseUrl(lmapiBaseUrl: string): void {
  config.lmapiBaseUrl = lmapiBaseUrl;
}
