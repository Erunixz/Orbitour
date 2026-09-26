import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatLon, Stop } from '../lib/types'
import { MapView, type Focus } from '../map/MapView'
import { dayColor } from './dayColors'
import { useFollowRoute } from './settings'
import { StopCard } from './StopCard'
import { useLegs } from './useLegs'

type Props = {
  title: string
  center: LatLon
  stops: Stop[]
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** "#stop=3" opens on the third stop. */
function focusFromHash(stopCount: number): Focus {
  const match = /(?:^|[#&])stop=(\d+)/.exec(window.location.hash)
  const n = match ? Number(match[1]) : 0
  return n >= 1 && n <= stopCount ? { kind: 'stop', index: n - 1 } : { kind: 'overview' }
}

export function TripScreen({ title, center, stops }: Props) {
  const [focus, setFocus] = useState<Focus>(() => focusFromHash(stops.length))
  const [followRoute, setFollowRoute] = useFollowRoute()
  const { state: legsState, retry: retryLegs } = useLegs(stops, 'auto', 'modest')
  const legs = legsState.kind === 'ready' ? legsState.legs : []
  const current = focus.kind === 'stop' ? focus.index : -1
  const last = stops.length - 1

  const next = useCallback(() => {
    setFocus((f) => {
      const i = f.kind === 'stop' ? f.index : -1
      return i < last ? { kind: 'stop', index: i + 1 } : f
    })
  }, [last])

  const back = useCallback(() => {
    setFocus((f) => {
      if (f.kind !== 'stop') return f
      return f.index === 0 ? { kind: 'overview' } : { kind: 'stop', index: f.index - 1 }
    })
  }, [])

  const overview = useCallback(() => setFocus({ kind: 'overview' }), [])
  const select = useCallback((index: number) => setFocus({ kind: 'stop', index }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') back()
      else if (event.key === 'Escape') overview()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, overview])

  // Keep the camera framing clear of the bottom panel.
  const bottomRef = useRef<HTMLDivElement>(null)
  const [bottomInset, setBottomInset] = useState(0)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const measure = () => setBottomInset(Math.round(window.innerHeight - el.getBoundingClientRect().top))
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const stop = stops[current]

  return (
    <div className="trip-screen">
      <MapView
        center={center}
        stops={stops}
        legs={legs}
        followRoute={followRoute}
        color={dayColor(0)}
        focus={focus}
        onSelectStop={select}
        bottomInsetPx={bottomInset}
      />

      <header className="trip-header">
        <h1>{title}</h1>
        <p className="muted">{stops.length} stops</p>
        <label className="toggle">
          <input type="checkbox" checked={followRoute} onChange={(e) => setFollowRoute(e.target.checked)} />
          Fly along routes
        </label>
      </header>

      <div className="trip-bottom" ref={bottomRef}>
        {stop ? (
          <StopCard
            key={stop.id}
            stop={stop}
            index={current}
            total={stops.length}
            previous={stops[current - 1] ?? null}
            next={stops[current + 1] ?? null}
            incomingLeg={legs[current - 1] ?? null}
            nextLeg={legs[current] ?? null}
            legsStatus={legsState.kind}
          />
        ) : (
          <article className="stop-card overview-card">
            <div className="stop-body">
              <h2>Overview</h2>
              <p>Press Next or click a pin to fly to the first stop. Use the arrow keys to move and Escape to come back here.</p>
              {legsState.kind === 'error' && (
                <p className="error-inline">
                  {legsState.message}{' '}
                  <button type="button" className="link-button" onClick={retryLegs}>
                    Try again
                  </button>
                </p>
              )}
            </div>
          </article>
        )}

        <nav className="trip-controls" aria-label="Stop navigation">
          <button type="button" onClick={back} disabled={focus.kind === 'overview'}>
            Back
          </button>
          <button type="button" className="secondary" onClick={overview} disabled={focus.kind === 'overview'}>
            Overview
          </button>
          <button type="button" onClick={next} disabled={current >= last}>
            Next
          </button>
        </nav>
      </div>
    </div>
  )
}
