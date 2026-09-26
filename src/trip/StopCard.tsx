import { directionsUrl } from '../lib/mapsLink'
import type { Leg, Stop, StopKind, TravelMode } from '../lib/types'

const kindLabels: Record<StopKind, string> = {
  sight: 'Sight',
  museum: 'Museum',
  park: 'Park',
  viewpoint: 'Viewpoint',
  market: 'Market',
  food: 'Food',
  lodging: 'Lodging',
  other: 'Place',
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`
}

const modeVerbs: Record<TravelMode, string> = {
  walk: 'Walk',
  transit: 'Transit',
  drive: 'Drive',
  cycle: 'Cycle',
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

type Props = {
  stop: Stop
  index: number
  total: number
  previous: Stop | null
  next: Stop | null
  /** Leg from the previous stop to this one. */
  incomingLeg: Leg | null
  /** Leg from this stop to the next one. */
  nextLeg: Leg | null
  legsStatus: 'loading' | 'ready' | 'error'
}

export function StopCard({ stop, index, total, previous, next, incomingLeg, nextLeg, legsStatus }: Props) {
  return (
    <article className="stop-card" aria-label={`Stop ${index + 1} of ${total}`}>
      <div className="stop-photo">
        {stop.photo ? (
          <figure>
            <img src={stop.photo.url} alt={stop.name} />
            <figcaption>
              <a href={stop.photo.pageUrl} target="_blank" rel="noreferrer">
                {stop.photo.credit}
              </a>
            </figcaption>
          </figure>
        ) : (
          <div className="stop-photo-empty" aria-hidden="true">
            {index + 1}
          </div>
        )}
      </div>

      <div className="stop-body">
        <p className="stop-meta">
          Stop {index + 1} of {total} · {kindLabels[stop.kind]}
          {stop.mustSee && <span className="badge">Must see</span>}
        </p>
        <h2>{stop.name}</h2>
        <p className="stop-time">
          {stop.arrive} to {stop.depart} · {formatMinutes(stop.visitMin)} here
        </p>
        <p>{stop.summary}</p>
        <p className="stop-reason">
          <strong>Why it fits:</strong> {stop.reason}
        </p>

        {next && <NextLeg next={next} leg={nextLeg} status={legsStatus} />}

        <p className="stop-links">
          <a
            href={directionsUrl(stop, previous ?? undefined, incomingLeg?.mode ?? 'walk')}
            target="_blank"
            rel="noreferrer"
          >
            Directions in Google Maps
          </a>
          {stop.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          ))}
        </p>
      </div>
    </article>
  )
}

function NextLeg({ next, leg, status }: { next: Stop; leg: Leg | null; status: Props['legsStatus'] }) {
  if (!leg) {
    return (
      <p className="stop-next">
        Next: {next.name}. {status === 'loading' ? 'Working out travel time...' : 'Travel time unavailable.'}
      </p>
    )
  }
  const transitLines = leg.steps?.flatMap((s) => (s.mode === 'transit' && s.line ? [s.line] : [])) ?? []
  return (
    <p className="stop-next">
      Next: {modeVerbs[leg.mode]} {formatMinutes(leg.minutes)}, {formatDistance(leg.meters)} to {next.name}
      {transitLines.length > 0 && <> via {transitLines.join(', ')}</>}
      {leg.estimated && (
        <span className="badge badge-muted" title="Routing was not available, so this is a straight-line estimate.">
          Estimated
        </span>
      )}
    </p>
  )
}
