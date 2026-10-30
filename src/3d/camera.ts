/**
 * Low-angle camera rules: how the rig changes as the view drops toward a behind-her angle,
 * the wheel that couples zoom with pitch, pulling the camera in front of landmarks, and a
 * ground aim that stays finite when the cursor sits near (or above) the horizon. No Three.js.
 */
import { CAMERA_DISTANCE_MAX, CAMERA_DISTANCE_MIN, CAMERA_PITCH_DEG } from './feel'
import type { Place } from './places'

/** Lowest view: about 12° above the horizon, just behind and above her shoulder. */
export const CAMERA_PITCH_MIN = 12
export const CAMERA_PITCH_MAX = 62
/** Above this pitch the rig is the classic top-down one, unchanged. */
export const LOW_VIEW_FROM = 40
/** At the lowest pitch: share of the zoom distance kept, and how much the look point rises. */
export const LOW_VIEW = { distanceScale: 0.6, lift: 0.42 }
/** Never closer than this to her chest after a pull-in, and never this near the grass. */
export const CAMERA_MIN_PULL = 1.3
export const CAMERA_GROUND_CLEARANCE = 0.45
/** Decor (crystals, mushrooms) closer than this to the lens dithers away (m). */
export const CAMERA_FADE_NEAR = 1.7
/** Farthest the mouse aim may reach from her on the ground (m). */
export const AIM_REACH_MAX = 10
/** Wheel: metres per notch, and degrees of pitch per notch once fully zoomed in. */
export const WHEEL = { distance: 0.28, pitch: 5 }

export function clampPitch(deg: number): number {
  return Math.max(CAMERA_PITCH_MIN, Math.min(CAMERA_PITCH_MAX, deg))
}

/** 0 at the classic angles, 1 at the lowest one, eased so the change never kinks. */
export function lowViewAmount(pitchDeg: number): number {
  const t = Math.max(0, Math.min(1, (LOW_VIEW_FROM - pitchDeg) / (LOW_VIEW_FROM - CAMERA_PITCH_MIN)))
  return t * t * (3 - 2 * t)
}

/** Camera distance and look-point height for this pitch and wheel zoom. */
export function cameraRig(pitchDeg: number, zoom: number): { distance: number; lookY: number } {
  const t = lowViewAmount(pitchDeg)
  return { distance: zoom * (1 - (1 - LOW_VIEW.distanceScale) * t), lookY: 1.05 + LOW_VIEW.lift * t }
}

/**
 * One wheel notch (dir > 0 = away from her). Zooming in past the closest distance keeps
 * lowering the view toward the shoulder angle; zooming out first lifts a lowered view back to
 * the default angle, then backs the camera off. A right-dragged high angle is left alone.
 */
export function wheelStep(state: { zoom: number; pitch: number }, dir: number): { zoom: number; pitch: number } {
  const { zoom, pitch } = state
  if (dir < 0) {
    if (zoom > CAMERA_DISTANCE_MIN + 1e-6) return { zoom: Math.max(CAMERA_DISTANCE_MIN, zoom - WHEEL.distance), pitch }
    return { zoom, pitch: clampPitch(Math.min(pitch, CAMERA_PITCH_DEG) - WHEEL.pitch) }
  }
  if (dir > 0) {
    if (pitch < CAMERA_PITCH_DEG - 1e-6) return { zoom, pitch: Math.min(CAMERA_PITCH_DEG, pitch + WHEEL.pitch) }
    return { zoom: Math.min(CAMERA_DISTANCE_MAX, zoom + WHEEL.distance), pitch }
  }
  return { zoom, pitch }
}

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

/**
 * How far the camera may sit from the look point along its boom (0..length): the first
 * collider the boom enters, less a small pad, and never below the grass. A collider the look
 * point is already inside (her walking through the portal) is ignored.
 */
export function boomLength(
  fx: number, fy: number, fz: number,
  cx: number, cy: number, cz: number,
  colliders: readonly CameraCollider[], pad = 0.3,
): number {
  const dx = cx - fx
  const dy = cy - fy
  const dz = cz - fz
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-6) return 0
  let t = 1
  for (const c of colliders) {
    const r = c.r + pad
    const ox = fx - c.x
    const oz = fz - c.z
    const a = dx * dx + dz * dz
    const cc = ox * ox + oz * oz - r * r
    if (cc <= 0 || a < 1e-9) continue
    const b = 2 * (ox * dx + oz * dz)
    const disc = b * b - 4 * a * cc
    if (disc < 0) continue
    const enter = (-b - Math.sqrt(disc)) / (2 * a)
    if (enter < 0 || enter >= t) continue
    const exit = (-b + Math.sqrt(disc)) / (2 * a)
    // Inside the circle for s in [enter, exit]; it only blocks if the boom is in the height band there.
    const ya = fy + dy * enter
    const yb = fy + dy * Math.min(1, exit)
    if (Math.max(ya, yb) < c.y0 - pad || Math.min(ya, yb) > c.y1 + pad) continue
    t = enter
  }
  // The grass: keep the lens a little above it.
  if (cy < CAMERA_GROUND_CLEARANCE && fy > CAMERA_GROUND_CLEARANCE) t = Math.min(t, (fy - CAMERA_GROUND_CLEARANCE) / (fy - cy))
  return Math.max(Math.min(CAMERA_MIN_PULL, length), t * length)
}

/**
 * Where the mouse ray meets the ground, reined in to AIM_REACH_MAX from her. Near the
 * horizon the hit runs off toward infinity, and above it there is none; both fall back to
 * the ray's own heading from her, so the aim keeps pointing where the cursor points.
 */
export function groundAim(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  hx: number, hz: number,
  planeY = 0.05, reach = AIM_REACH_MAX,
): { x: number; z: number; clamped: boolean } {
  if (dy < -1e-4) {
    const t = (planeY - oy) / dy
    if (t > 0) {
      const gx = ox + dx * t
      const gz = oz + dz * t
      const fx = gx - hx
      const fz = gz - hz
      const d = Math.hypot(fx, fz)
      if (d <= reach) return { x: gx, z: gz, clamped: false }
      return { x: hx + (fx / d) * reach, z: hz + (fz / d) * reach, clamped: true }
    }
  }
  const flat = Math.hypot(dx, dz) || 1
  return { x: hx + (dx / flat) * reach, z: hz + (dz / flat) * reach, clamped: true }
}
