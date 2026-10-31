/**
 * Landmark shapes the shoulder camera and the aim ray treat as solid in town (houses, trees,
 * the portal pillars). No Three.js.
 */
import type { Place } from '../world/town/places'

/** Decor (crystals, mushrooms) closer than this to the lens dithers away (m). */
export const CAMERA_FADE_NEAR = 1.7

/** A vertical cylinder the camera must stay out of: centre, radius, and its height band. */
export interface CameraCollider {
  x: number
  z: number
  r: number
  y0: number
  y1: number
}

/** Rough camera shapes per landmark, measured from the loaded models (bounding boxes). */
export function cameraColliders(places: readonly Place[]): CameraCollider[] {
  const out: CameraCollider[] = []
  const add = (x: number, z: number, r: number, y0: number, y1: number) => out.push({ x, z, r, y0, y1 })
  for (const p of places) {
    switch (p.kind) {
      case 'house':
        add(p.x, p.z, 1.85, 0, p.height)
        break
      case 'workshop':
        add(p.x, p.z, 1.6, 0, p.height)
        break
      case 'tree':
        add(p.x, p.z, 0.6, 0, 1.8)
        add(p.x, p.z, 2.5, 1.8, p.height)
        break
      case 'portal': {
        // Two pillars and the arch; the opening stays clear so she can walk through.
        const cx = Math.cos(p.turn) * 1.15
        const cz = -Math.sin(p.turn) * 1.15
        add(p.x + cx, p.z + cz, 0.45, 0, p.height)
        add(p.x - cx, p.z - cz, 0.45, 0, p.height)
        add(p.x, p.z, 1.5, p.height - 0.9, p.height)
        break
      }
      case 'fountain':
        add(p.x, p.z, 1.05, 0, p.height)
        break
      case 'well':
        add(p.x, p.z, 1.2, 0, p.height)
        break
      case 'board':
        add(p.x, p.z, 0.6, 0, p.height)
        break
      case 'lantern':
        add(p.x, p.z, 0.3, 0, 1.3)
        break
      default:
        add(p.x, p.z, 0.45, 0, p.height)
    }
  }
  return out
}
