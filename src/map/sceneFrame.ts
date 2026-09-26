import { Matrix4, Vector3 } from 'three'
import { WGS84_ELLIPSOID } from '3d-tiles-renderer/three'
import { toRad } from '../lib/geo'
import type { LatLon } from '../lib/types'

/**
 * Local scene frame centred on the trip. Matches how the tiles are reoriented:
 * origin at `center` on the ellipsoid, +Y up, +Z north, +X west, units in metres.
 */
export class SceneFrame {
  private readonly toLocal = new Matrix4()

  constructor(readonly center: LatLon) {
    // Default frame argument gives "+Y up, +Z forward (north)", the same frame the
    // reorientation plugin inverts to place the tiles.
    WGS84_ELLIPSOID.getObjectFrame(toRad(center.lat), toRad(center.lon), 0, 0, 0, 0, this.toLocal)
    this.toLocal.invert()
  }

  /** Scene position of a point `heightM` above the ellipsoid. */
  toScene(point: LatLon, heightM = 0, target = new Vector3()): Vector3 {
    WGS84_ELLIPSOID.getCartographicToPosition(toRad(point.lat), toRad(point.lon), heightM, target)
    return target.applyMatrix4(this.toLocal)
  }
}
