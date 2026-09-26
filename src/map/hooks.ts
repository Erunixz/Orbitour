import { useSyncExternalStore } from 'react'

function mediaQueryStore(query: string) {
  return {
    subscribe(onChange: () => void) {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    get: () => window.matchMedia(query).matches,
  }
}

const reducedMotion = mediaQueryStore('(prefers-reduced-motion: reduce)')

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false)
}

const narrow = mediaQueryStore('(max-width: 760px)')

/** True on phone-sized screens, where the sidebar becomes a bottom sheet. Matches the CSS breakpoint. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(narrow.subscribe, narrow.get, () => false)
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** False while the tab is hidden, so we can stop rendering and loading tiles. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden', () => true)
}
