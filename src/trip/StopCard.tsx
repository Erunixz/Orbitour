import type { CSSProperties } from 'react'
import { directionsUrl } from '../lib/mapsLink'
import type { Leg, Stop } from '../lib/types'
import { dayColor } from './dayColors'
import { formatDistance, formatMinutes, kindLabels, modeLabels, transitLines } from './format'

type Props = {
  stop: Stop
  day: number
  index: number
  total: number
  previous: Stop | null
  next: Stop | null
  /** Leg from the previous stop to this one. */
  incomingLeg: Leg | null
  /** Leg from this stop to the next one. */
  nextLeg: Leg | null
}

export function StopCard({ stop, day, index, total, previous, next, incomingLeg, nextLeg }: Props) {
  return (
    <article
      className="stop-card"
      style={{ '--day-color': dayColor(day) } as CSSProperties}
      aria-label={`Day ${day + 1}, stop ${index + 1} of ${total}`}
    >
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
          Day {day + 1} · Stop {index + 1} of {total} · {kindLabels[stop.kind]}
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

        {next ? <NextLeg next={next} leg={nextLeg} /> : <p className="stop-next">Last stop of the day.</p>}

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

function NextLeg({ next, leg }: { next: Stop; leg: Leg | null }) {
  if (!leg) return <p className="stop-next">Next: {next.name}. Travel time unavailable.</p>
  const lines = transitLines(leg)
  return (
    <p className="stop-next">
      Next: {modeLabels[leg.mode]} {formatMinutes(leg.minutes)}, {formatDistance(leg.meters)} to {next.name}
      {lines.length > 0 && <> via {lines.join(', ')}</>}
      {leg.estimated && <EstimatedBadge />}
    </p>
  )
}

export function EstimatedBadge() {
  return (
    <span className="badge badge-muted" title="Routing was not available, so this is a straight-line estimate.">
      Estimated
    </span>
  )
}
