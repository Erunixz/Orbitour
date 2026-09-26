import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Read PORT only to point the dev proxy at the API server.
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.PORT || '8787'

  return {
    plugins: [react()],
    define: {
      // Cost guard for the browser. A plain number, not a secret.
      __DAILY_TILE_SESSIONS__: JSON.stringify(env.DAILY_TILE_SESSIONS || '50'),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  }
})
