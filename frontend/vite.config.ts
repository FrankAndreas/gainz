import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Same port as under react-scripts, so the devcontainer and compose file still fit
  // /api goes to the backend, as nginx does on the NAS (which also strips the prefix), so the hub cookie is the page's own
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY ?? 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true
  }
})
