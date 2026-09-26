import { lazy, Suspense, type ComponentProps } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'

// The 3D map pulls in three.js and the tiles renderer, which are large. They load
// only when a map is on screen, so the home page stays quick. A crash in the map
// (for example no WebGL) shows a message while the rest of the page keeps working.

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })))

type Props = ComponentProps<typeof MapView>

export function LazyMapView(props: Props) {
  return (
    <ErrorBoundary
      name="map"
      fallback={(retry) => (
        <div className="map map-failed" role="alert">
          <div className="map-notice">
            <p>The 3D map could not start on this device. Your plan still works in the list and cards.</p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      )}
    >
      <Suspense fallback={<div className="map map-loading" aria-label="Loading the map" />}>
        <MapView {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
