import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig(({ mode }) => {
  // Load .env variables (no VITE_ prefix restriction needed for server config)
  const env = loadEnv(mode, process.cwd(), '')

  // LMApi is an external dependency — configure its base URL via LMAPI_BASE_URL in .env
  const lmapiBaseUrl = env.LMAPI_BASE_URL ?? 'http://localhost:3111'

  // Eval backend — configure its port via PORT in .env
  const evalPort = env.PORT ?? '3200'
  const evalBaseUrl = `http://localhost:${evalPort}`
  const evalWsUrl = `ws://localhost:${evalPort}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Proxy to LMApi (external model routing service — see LMAPI_BASE_URL in .env)
        '/lmapi': {
          target: lmapiBaseUrl,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/lmapi/, ''),
        },
        // Proxy to the local eval backend
        '/api/eval': {
          target: evalBaseUrl,
          changeOrigin: true,
        },
        '/ws/eval': {
          target: evalWsUrl,
          ws: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
