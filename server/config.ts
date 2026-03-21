const defaults = {
  port: 3200,
  lmapiBaseUrl: 'http://localhost:3111',
};

export const config = {
  port: Number(process.env.PORT ?? defaults.port),
  lmapiBaseUrl: process.env.LMAPI_BASE_URL ?? defaults.lmapiBaseUrl,
};
