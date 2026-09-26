import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { TilesAttributionOverlay, TilesPlugin, TilesRenderer } from '3d-tiles-renderer/r3f'
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins'
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { toRad } from '../lib/geo'
import type { LatLon } from '../lib/types'
import type { Quality } from './quality'

type Args<T extends abstract new (...args: never[]) => unknown> = ConstructorParameters<T>

const DRACO_DECODER_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

type Props = {
  apiKey: string
  center: LatLon
  quality: Quality
  /** False while the tab is hidden. Stops tile updates. */
  enabled: boolean
  onTiles: (tiles: TilesRendererImpl | null) => void
  onRootError: () => void
}

/**
 * Google Photorealistic 3D Tiles, reoriented so the trip center is the scene origin
 * with +Y up. Every plugin argument is memoized: a new object on each render would
 * tear the plugin down and reload the tileset.
 */
export function GoogleTiles({ apiKey, center, quality, enabled, onTiles, onRootError }: Props) {
  // Each args value is the plugin's constructor argument list.
  const authArgs = useMemo<Args<typeof GoogleCloudAuthPlugin>>(
    () => [{ apiToken: apiKey, autoRefreshToken: true, useRecommendedSettings: false }],
    [apiKey],
  )
  const reorientArgs = useMemo<Args<typeof ReorientationPlugin>>(
    () => [{ lat: toRad(center.lat), lon: toRad(center.lon), recenter: true }],
    [center.lat, center.lon],
  )
  const dracoLoader = useMemo(() => new DRACOLoader().setDecoderPath(DRACO_DECODER_URL), [])
  useEffect(() => {
    return () => {
      dracoLoader.dispose()
    }
  }, [dracoLoader])
  const gltfArgs = useMemo<Args<typeof GLTFExtensionsPlugin>>(() => [{ dracoLoader }], [dracoLoader])
  const compressionArgs = useMemo<Args<typeof TileCompressionPlugin>>(() => [{}], [])
  const fadeArgs = useMemo<Args<typeof TilesFadePlugin>>(() => [{ fadeDuration: 250 }], [])

  // Only a failed root tileset means the whole city failed. Single tile errors are ignored.
  const handleLoadError = useCallback(
    (event: { tile: unknown }) => {
      if (event.tile === null) onRootError()
    },
    [onRootError],
  )

  // Renderer settings are set once from props when they change, never per frame.
  const cacheOptions = {
    'lruCache-minBytesSize': quality.minCacheBytes,
    'lruCache-maxBytesSize': quality.maxCacheBytes,
  }

  return (
    <TilesRenderer
      ref={onTiles}
      enabled={enabled}
      errorTarget={quality.errorTarget}
      onLoadError={handleLoadError}
      {...cacheOptions}
    >
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
      <TilesPlugin plugin={ReorientationPlugin} args={reorientArgs} />
      <TilesPlugin plugin={GLTFExtensionsPlugin} args={gltfArgs} />
      <TilesPlugin plugin={TileCompressionPlugin} args={compressionArgs} />
      <TilesPlugin plugin={TilesFadePlugin} args={fadeArgs} />
      <TilesAttributionOverlay style={attributionStyle} generateAttributions={renderAttributions} />
    </TilesRenderer>
  )
}

const attributionStyle = {
  left: 0,
  right: 0,
  bottom: 0,
  padding: '4px 8px',
  fontSize: '11px',
  color: 'rgba(255, 255, 255, 0.9)',
  pointerEvents: 'none',
  zIndex: 1,
} as const

type Attribution = { type: 'string' | 'html' | 'image'; value: unknown }

/** Google logo plus the combined data credits for the tiles on screen. */
function renderAttributions(attributions: Attribution[]): ReactNode {
  const text = attributions
    .filter((a) => a.type === 'string' && typeof a.value === 'string' && a.value.length > 0)
    .map((a) => a.value as string)
    .join('; ')
  return (
    <div className="tiles-credit">
      <span className="google-mark" aria-label="Google">
        Google
      </span>
      {text && <span className="tiles-credit-text">{text}</span>}
    </div>
  )
}
