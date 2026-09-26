// Render quality presets. Chosen once at startup and never changed per frame.

export type Quality = {
  name: 'desktop' | 'mobile'
  /** Device pixel ratio range for the canvas. */
  dpr: [number, number]
  /** Screen-space error target for tiles. Higher means fewer, coarser tiles. */
  errorTarget: number
  /** Tile cache limits in bytes. */
  minCacheBytes: number
  maxCacheBytes: number
}

const MB = 1024 * 1024

export const desktopQuality: Quality = {
  name: 'desktop',
  dpr: [1, 2],
  errorTarget: 16,
  minCacheBytes: 300 * MB,
  maxCacheBytes: 450 * MB,
}

export const mobileQuality: Quality = {
  name: 'mobile',
  dpr: [1, 1.5],
  errorTarget: 28,
  minCacheBytes: 120 * MB,
  maxCacheBytes: 200 * MB,
}

export function pickQuality(): Quality {
  if (typeof window === 'undefined') return desktopQuality
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const small = Math.min(window.innerWidth, window.innerHeight) < 600
  return coarse || small ? mobileQuality : desktopQuality
}
