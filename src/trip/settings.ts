import { useCallback, useState } from 'react'

// Small per-device view settings, kept in localStorage.

const KEY = 'view.followRoute.v1'

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function useFollowRoute(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(read)
  const update = useCallback((next: boolean) => {
    setValue(next)
    try {
      window.localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // Not saved; the setting still applies for this visit.
    }
  }, [])
  return [value, update]
}
