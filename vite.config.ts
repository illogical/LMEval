import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api/eval': 'http://localhost:3200',
      '/ws/eval': {
        target: 'ws://localhost:3200',
        ws: true
      }
    }
  }
})
