/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_TILES_KEY?: string
}

/** Injected by vite.config.ts from DAILY_TILE_SESSIONS. Not a secret. */
declare const __DAILY_TILE_SESSIONS__: string
