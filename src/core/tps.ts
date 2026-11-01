/**
 * The one chase camera for the whole game: straight behind her and a little above, so she
 * stands centred just below the crosshair and her shots fly up the middle of the screen. The
 * island town and the dream sewer share it, so turning, moving and aiming feel identical. The
 * mouse turns the view; the crosshair is the screen centre; the boom pulls in when something
 * solid is behind her. Yaw follows the hero convention: forward = (sin yaw, 0, cos yaw).
 */
export const TPS = {
  /** Head height the boom hangs from (m); the chibi is 1.45 m. */
  height: 1.38,
  /** Boom length behind the pivot above her head. */
  back: 3.0,
  /** Sideways offset: 0 = centred (she used to stand off to the left of a right-shoulder lens). */
  right: 0,
  /** Pivot lift above her head: the crosshair ray clears her hair, so she sits under it. */
  up: 0.62,
  fov: 68,
  /** Pitch limits (rad, + looks down). */
  minPitch: -0.62,
  maxPitch: 0.82,
  /** Mouse radians per pixel at sensitivity 1 (was 0.0024: too twitchy); touch drags are faster. */
  mouse: 0.0017,
  touch: 0.0048,
  /** Gap kept to a wall, and the shortest boom. */
  margin: 0.3,
  /** Recoil recovery rate (1/s). */
  recover: 11,
} as const

/** Aim assist: mild magnetism and a little look friction near a foe. */
export const ASSIST = {
  /** Extra slack (m) around a foe's radius that still counts as "on" it. */
  slack: 0.35,
  /** Hard cap on the magnet cone (rad, ~4.6°). */
  maxCone: 0.08,
  /** Look speed while the crosshair is over / next to a foe. */
  friction: 0.62,
  /** Touch only: rad/s the view drifts toward a foe in the cone. */
  touchPull: 0.9,
  /** Furthest foe the assist cares about (m). */
  reach: 34,
} as const

/**
 * Auto-aim (⚙ 자동 조준, 편의성): a much wider cone, so the shot snaps onto the foe nearest the
 * crosshair (≈12.6°). Off = only the mild ASSIST magnetism above.
 */
export const AUTO_AIM = { slack: 1.2, maxCone: 0.22 } as const

/** Sensitivity multiplier on TPS.mouse / TPS.touch (saved, set from the settings slider). */
export const SENS = { min: 0.3, max: 2.5, key: 'dnr3d.sens', value: 1 }

export function loadSens(): number {
  try {
    const raw = Number(globalThis.localStorage?.getItem(SENS.key))
    if (Number.isFinite(raw) && raw > 0) SENS.value = clampSens(raw)
  } catch {
    // storage blocked: keep the default
  }
  return SENS.value
}

export function setSens(v: number): number {
  SENS.value = clampSens(v)
  try {
    globalThis.localStorage?.setItem(SENS.key, String(SENS.value))
  } catch {
    // ignore
  }
  return SENS.value
}

export function clampSens(v: number): number {
  return Math.max(SENS.min, Math.min(SENS.max, Math.round(v * 100) / 100))
}

export interface TpsView {
  yaw: number
  pitch: number
  /** Recoil kick: added up-pitch and sideways yaw, both recover to 0. */
  kickPitch: number
  kickYaw: number
  /** Smoothed boom fraction 0..1 (1 = full length). */
  boom: number
  /** Longest boom allowed right now (0..1; narrow corridors pull the camera in). */
  reach?: number
}

export function createView(yaw = 0, pitch = 0.12): TpsView {
  return { yaw, pitch, kickPitch: 0, kickYaw: 0, boom: 1 }
}

/** Turn by a pixel delta. Raw (no acceleration, no smoothing): the view goes exactly where the hand goes. */
export function look(view: TpsView, dx: number, dy: number, perPx: number = TPS.mouse): void {
  view.yaw -= dx * perPx
  view.pitch = Math.max(TPS.minPitch, Math.min(TPS.maxPitch, view.pitch + dy * perPx))
}

/** Radians per pixel for a mouse or finger at the saved sensitivity, slowed by aim friction. */
export function perPixel(touch: boolean, friction = 1, sens = SENS.value): number {
  return (touch ? TPS.touch : TPS.mouse) * sens * friction
}

/** Recoil: a little climb and a random sideways nudge, both springing back. */
export function kick(view: TpsView, up: number, side: number): void {
  view.kickPitch = Math.min(0.12, view.kickPitch + up)
  view.kickYaw = Math.max(-0.03, Math.min(0.03, view.kickYaw + side))
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

/** Distance along a ray (direction need not be unit) to the first solid thing, or `max`. */
export type RayFn = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => number

/**
 * Camera pose for her position. The boom runs from her head to the over-shoulder point; if a
 * wall is in the way it shortens (fast in, slow out, so it doesn't pump). No follow lag: the
 * camera is locked to her, so the crosshair never drifts while she walks.
 */
export function pose(view: TpsView, ray: RayFn | null, px: number, py: number, pz: number, dt: number): TpsPose {
  const yaw = view.yaw + view.kickYaw
  const pitch = view.pitch - view.kickPitch
  const f = forwardOf(yaw, pitch)
  const r = rightOf(yaw)
  const hx = px
  const hy = py + TPS.height
  const hz = pz
  // Two legs, so a wall behind her slides the camera in toward the pivot, never into her head:
  // first up (and sideways, if an offset is set) to the pivot, clamped by anything in the way,
  // then back along the view.
  let sx = r.x * TPS.right
  let sz = r.z * TPS.right
  let sy = TPS.up
  const leg = Math.hypot(sx, sy, sz)
  if (ray && leg > 1e-6) {
    const side = ray(hx, hy, hz, sx / leg, sy / leg, sz / leg, leg + TPS.margin)
    const k = Math.max(0, Math.min(1, (side - TPS.margin) / leg))
    sx *= k
    sy *= k
    sz *= k
  }
  const ox = hx + sx
  const oy = hy + sy
  const oz = hz + sz
  const bx = -f.x * TPS.back
  const by = -f.y * TPS.back
  const bz = -f.z * TPS.back
  let allowed = 1
  if (ray) {
    const hit = ray(ox, oy, oz, bx, by, bz, TPS.back + TPS.margin)
    allowed = Math.max(0, Math.min(1, (hit - TPS.margin) / TPS.back))
  }
  allowed = Math.min(allowed, view.reach ?? 1)
  const rate = allowed < view.boom ? 40 : 3.5
  view.boom += (allowed - view.boom) * (1 - Math.exp(-rate * dt))
  view.boom = Math.min(view.boom, allowed)
  return { x: ox + bx * view.boom, y: oy + by * view.boom, z: oz + bz * view.boom, fx: f.x, fy: f.y, fz: f.z }
}

/** Something the crosshair can land on: a vertical capsule (centre x/z, y from y0 to y1, radius r). */
export interface AimTarget {
  x: number
  z: number
  y0: number
  y1: number
  r: number
}

/**
 * First hit of a ray on a vertical capsule (approximated as a cylinder with its band), or -1.
 * `d` must be unit length. Shared by the town foes and the sewer horde so both hit the same way.
 */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: AimTarget, max: number): number {
  const cx = ox - t.x
  const cz = oz - t.z
  const a = dx * dx + dz * dz
  const c = cx * cx + cz * cz - t.r * t.r
  if (a < 1e-9) {
    if (c > 0) return -1
    const s = dy > 0 ? (t.y0 - oy) / dy : (t.y1 - oy) / dy
    return s >= 0 && s <= max ? s : -1
  }
  const b = 2 * (cx * dx + cz * dz)
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const sq = Math.sqrt(disc)
  let s0 = (-b - sq) / (2 * a)
  let s1 = (-b + sq) / (2 * a)
  if (s1 < 0 || s0 > max) return -1
  // Clip to the height band.
  if (Math.abs(dy) > 1e-9) {
    let y0 = (t.y0 - oy) / dy
    let y1 = (t.y1 - oy) / dy
    if (y0 > y1) [y0, y1] = [y1, y0]
    s0 = Math.max(s0, y0)
    s1 = Math.min(s1, y1)
  } else if (oy < t.y0 || oy > t.y1) return -1
  if (s0 > s1 || s1 < 0) return -1
  const s = Math.max(0, s0)
  return s <= max ? s : -1
}

export interface AssistPick {
  index: number
  /** Angle (rad) between the view ray and the target centre. */
  angle: number
  /** Distance to the target centre. */
  dist: number
  /** Target centre (aim point if the magnet takes over). */
  x: number
  y: number
  z: number
}

/**
 * The target nearest the crosshair inside its assist cone, if any and not hidden behind a wall
 * (`solid` is the distance the view ray travels before a wall). The cone is the target's own
 * angular size plus a little slack, capped, so far foes get the same gentle help as near ones.
 */
export function assistPick(
  ox: number, oy: number, oz: number,
  fx: number, fy: number, fz: number,
  targets: readonly AimTarget[], solid: number,
  slack: number = ASSIST.slack, maxCone: number = ASSIST.maxCone, reach: number = ASSIST.reach,
): AssistPick | null {
  let best: AssistPick | null = null
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i]
    const cx = t.x
    const cy = Math.max(t.y0, Math.min(t.y1, oy + fy * Math.hypot(t.x - ox, t.z - oz)))
    const cz = t.z
    const vx = cx - ox
    const vy = cy - oy
    const vz = cz - oz
    const dist = Math.hypot(vx, vy, vz)
    if (dist < 0.5 || dist > reach) continue
    const along = (vx * fx + vy * fy + vz * fz) / dist
    if (along <= 0) continue
    // Only foes in front of the wall the crosshair hits (a little leeway past it).
    if (dist * along > solid + t.r + 0.4) continue
    const angle = Math.acos(Math.min(1, along))
    const cone = Math.min(maxCone, Math.atan((t.r + slack) / dist))
    if (angle > cone) continue
    if (!best || angle < best.angle) best = { index: i, angle, dist, x: cx, y: (t.y0 + t.y1) / 2, z: cz }
  }
  return best
}

/** Yaw/pitch that look from (ox,oy,oz) at (x,y,z). */
export function anglesTo(ox: number, oy: number, oz: number, x: number, y: number, z: number): { yaw: number; pitch: number } {
  const dx = x - ox
  const dy = y - oy
  const dz = z - oz
  return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) }
}

/**
 * How much she is in the way of the crosshair: 1 when the view ray passes through her body
 * (looking down past her head), 0 when it clears her. Drives the see-through fade.
 */
export function overlapsHer(cx: number, cy: number, cz: number, fx: number, fy: number, fz: number, px: number, py: number, pz: number): number {
  const h = fx * fx + fz * fz
  if (h < 1e-6) return 1
  const t = ((px - cx) * fx + (pz - cz) * fz) / h
  if (t <= 0) return 0
  const miss = Math.hypot(cx + fx * t - px, cz + fz * t - pz)
  const y = cy + fy * t - py
  const top = 1.62
  if (miss > 0.55 || y < -0.2) return 0
  return Math.max(0, Math.min(1, (top - y) / 0.25))
}
