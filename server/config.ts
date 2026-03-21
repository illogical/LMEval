const defaults = {
  port: 3200,
  lmapiBaseUrl: 'http://localhost:3111',
};

export const config = {
  port: Number(process.env.PORT ?? defaults.port),
  lmapiBaseUrl: process.env.LMAPI_BASE_URL ?? defaults.lmapiBaseUrl,
  // Mirrors Ollama's default keep-alive; set to 0 to unload immediately after each request
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE ?? '5m',
};
