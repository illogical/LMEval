import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/lmapi': {
        target: 'http://localhost:3111',
        changeOrigin: true,
      },
      '/api/eval': {
        target: 'http://localhost:3200',
        changeOrigin: true,
      },
      '/ws/eval': {
        target: 'ws://localhost:3200',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
