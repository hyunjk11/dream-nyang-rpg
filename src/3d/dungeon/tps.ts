import { rayHit } from './walls'
import type { Maze } from './maze'

/**
 * Fixed behind-the-right-shoulder camera for the sewer (Hellgate: London style). The mouse turns
 * the view; the crosshair is the screen centre; the boom pulls in when a tunnel wall is behind her.
 * Yaw follows the hero convention: forward = (sin yaw, 0, cos yaw).
 */
export const TPS = {
  /** Head height the boom hangs from (m); the chibi is 1.45 m. */
  height: 1.38,
  back: 2.6,
  right: 0.66,
  up: 0.22,
  fov: 64,
  /** Pitch limits (rad, + looks down). */
  minPitch: -0.62,
  maxPitch: 0.82,
  /** Mouse radians per pixel; touch drags are a bit faster. */
  mouse: 0.0024,
  touch: 0.0052,
  /** Gap kept to a wall, and the shortest boom. */
  margin: 0.3,
  /** Recoil recovery rate (1/s). */
  recover: 9,
} as const

export interface TpsView {
  yaw: number
  pitch: number
  /** Recoil kick: added up-pitch and sideways yaw, both recover to 0. */
  kickPitch: number
  kickYaw: number
  /** Smoothed boom fraction 0..1 (1 = full length). */
  boom: number
}

export function createView(yaw = 0, pitch = 0.12): TpsView {
  return { yaw, pitch, kickPitch: 0, kickYaw: 0, boom: 1 }
}

export function look(view: TpsView, dx: number, dy: number, perPx: number = TPS.mouse): void {
  view.yaw -= dx * perPx
  view.pitch = Math.max(TPS.minPitch, Math.min(TPS.maxPitch, view.pitch + dy * perPx))
}

/** Recoil: a little climb and a random sideways nudge, both springing back. */
export function kick(view: TpsView, up: number, side: number): void {
  view.kickPitch = Math.min(0.16, view.kickPitch + up)
  view.kickYaw = Math.max(-0.05, Math.min(0.05, view.kickYaw + side))
}

export function recover(view: TpsView, dt: number): void {
  const k = Math.exp(-TPS.recover * dt)
  view.kickPitch *= k
  view.kickYaw *= k
}

/** Unit view direction for yaw/pitch (pitch + looks down). */
export function forwardOf(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch)
  return { x: Math.sin(yaw) * c, y: -Math.sin(pitch), z: Math.cos(yaw) * c }
}

/** Screen-right on the ground for a yaw (Three.js right-handed, Y up). */
export function rightOf(yaw: number): { x: number; z: number } {
  return { x: -Math.cos(yaw), z: Math.sin(yaw) }
}

/** Move wish on the ground from a stick/WASD axis, relative to the view yaw. */
export function wishFrom(axisX: number, axisY: number, yaw: number): { x: number; z: number } {
  const r = rightOf(yaw)
  return { x: Math.sin(yaw) * axisY + r.x * axisX, z: Math.cos(yaw) * axisY + r.z * axisX }
}

export interface TpsPose {
  x: number
  y: number
  z: number
  /** View direction including recoil. */
  fx: number
  fy: number
  fz: number
}

/**
 * Camera pose for her position. The boom runs from her head to the over-shoulder point; if a
 * wall is in the way it shortens (fast in, slow out, so it doesn't pump).
 */
export function pose(view: TpsView, maze: Maze | null, px: number, py: number, pz: number, dt: number): TpsPose {
  const yaw = view.yaw + view.kickYaw
  const pitch = view.pitch - view.kickPitch
  const f = forwardOf(yaw, pitch)
  const r = rightOf(yaw)
  const hx = px
  const hy = py + TPS.height
  const hz = pz
  // Two legs, so a wall behind her slides the camera in over the shoulder, never into her head:
  // first out to the right shoulder (clamped by a side wall), then back along the view.
  let sx = r.x * TPS.right
  let sz = r.z * TPS.right
  const sy = TPS.up
  if (maze) {
    const side = rayHit(maze, hx, hy, hz, sx, sy, sz, TPS.right + TPS.margin)
    const k = Math.max(0, Math.min(1, (side - TPS.margin) / TPS.right))
    sx *= k
    sz *= k
  }
  const ox = hx + sx
  const oy = hy + sy
  const oz = hz + sz
  const bx = -f.x * TPS.back
  const by = -f.y * TPS.back
  const bz = -f.z * TPS.back
  let allowed = 1
  if (maze) {
    const hit = rayHit(maze, ox, oy, oz, bx, by, bz, TPS.back + TPS.margin)
    allowed = Math.max(0, Math.min(1, (hit - TPS.margin) / TPS.back))
  }
  const rate = allowed < view.boom ? 40 : 3.5
  view.boom += (allowed - view.boom) * (1 - Math.exp(-rate * dt))
  view.boom = Math.min(view.boom, allowed)
  return { x: ox + bx * view.boom, y: oy + by * view.boom, z: oz + bz * view.boom, fx: f.x, fy: f.y, fz: f.z }
}
