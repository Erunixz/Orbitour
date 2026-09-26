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
    build: {
      // The 3D map (three.js and the tiles renderer, about 1.2 MB) is its own chunk,
      // loaded only when a map is on screen (see src/map/LazyMapView.tsx). The rest
      // of the app stays small. Splitting three.js further gains nothing.
      chunkSizeWarningLimit: 1300,
    },
    server: {
      port: 5173,
      // The Tiles key allows only this address. Moving to 5174 would break the 3D map,
      // so fail loudly instead (see the README for freeing the port).
      strictPort: true,
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
