import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8091,
    strictPort: true,
    host: true,
    proxy: {
      // Forward /api/* and /health to the audit API server on :8092.
      // This lets the React app avoid CORS and use relative URLs.
      '/api': {
        target: 'http://localhost:8092',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:8092',
        changeOrigin: true
      }
    }
  }
})
