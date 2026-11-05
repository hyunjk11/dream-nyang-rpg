/**
 * How each hold aims. The cone is a half-angle in radians (horizontal yaw, vertical pitch).
 * Bloom opens it from min toward max with the same curve as Gun.spread (bloom²).
 *
 * Sheet DPS does not change: a fan splits ONE rolled hit across its rays, so a foe who
 * catches every ray takes the same damage as a single pistol shot. A wide cone just
 * lets those rays land on different bodies.
 *
 * Resting horizontal half-angle, narrow → wide (each min is past the previous max):
 *   저격 sniper   0.0005–0.003   one ray, pinpoint
 *   소총 rifle    0.010–0.020    one ray, tight burst
 *   권총 pistol   0.024–0.046    one ray, medium (GUN.spread)
 *   쌍권총 dual   0.058–0.088 × 0.016–0.032 tall   3 rays sharing the hit
 *   샷건 shotgun  0.098–0.135    round, profile pellets (each a full droplet)
 *
 * How far that cone still hurts is `engage` on the gun profile (data/guns.ts):
 * dual 6–12 m, shotgun 7–15 m, pistol 14–26 m, rifle 20–36 m, sniper 28–48 m.
 * `engageFor(kind, paired)` is the shared read for shooting and for hunt.
 */
import { GUN } from './gunfeel'
import { holdFor, type HoldType } from '../actors/holds'
import type { WeaponKind } from '../sim/types'

export interface AimCone {
  hold: HoldType
  /** Horizontal half-angle at bloom 0 and at bloom 1 (rad). */
  yawMin: number
  yawMax: number
  /** Vertical half-angle at bloom 0 and at bloom 1 (rad). */
  pitchMin: number
  pitchMax: number
  /**
   * Rays that share one damage roll. 1 = the whole droplet on one ray.
   * A gun whose profile already fires several pellets (the shotgun) ignores this
   * and rolls each pellet on its own.
   */
  fan: number
  /** Short Korean read for the bag line and the tooltip. */
  label: string
}

export const AIM_CONES: Record<HoldType, AimCone> = {
  sniper: { hold: 'sniper', yawMin: 0.0005, yawMax: 0.003, pitchMin: 0.0005, pitchMax: 0.003, fan: 1, label: '한 점' },
  rifle: { hold: 'rifle', yawMin: 0.01, yawMax: 0.02, pitchMin: 0.008, pitchMax: 0.016, fan: 1, label: '좁음' },
  pistol: { hold: 'pistol', yawMin: GUN.spreadMin, yawMax: GUN.spreadMax, pitchMin: 0.018, pitchMax: 0.036, fan: 1, label: '보통' },
  dual: { hold: 'dual', yawMin: 0.058, yawMax: 0.088, pitchMin: 0.016, pitchMax: 0.032, fan: 3, label: '넓게 퍼짐' },
  shotgun: { hold: 'shotgun', yawMin: 0.098, yawMax: 0.135, pitchMin: 0.098, pitchMax: 0.135, fan: 1, label: '가장 넓음' },
}

/** Bloom 0..1 opens a cone from min to max (same bloom² curve as Gun.spread). */
export function bloomed(min: number, max: number, bloom: number): number {
  const b = Math.min(1, Math.max(0, bloom))
  return min + (max - min) * b * b
}

/** The cone for this hold at the gun's current bloom. */
export function shotCone(hold: HoldType, bloom: number): { yaw: number; pitch: number; fan: number } {
  const c = AIM_CONES[hold]
  return { yaw: bloomed(c.yawMin, c.yawMax, bloom), pitch: bloomed(c.pitchMin, c.pitchMax, bloom), fan: c.fan }
}

/** Cone for a gun base. `paired` is a second one-handed gun (쌍권총). */
export function aimFor(kind: WeaponKind, paired = false): AimCone {
  return AIM_CONES[holdFor(kind, paired).type]
}

/**
 * Split one rolled hit across `parts` rays. The pieces sum to `amount`.
 * A 1-damage hit stays one ray (splitting it would round each piece up to 1).
 */
export function splitDamage(amount: number, parts: number): number[] {
  const total = Math.max(0, Math.round(amount))
  const n = Math.max(1, Math.floor(parts))
  if (n <= 1 || total <= 1) return [Math.max(1, total)]
  const base = Math.floor(total / n)
  let rem = total - base * n
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    const v = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem -= 1
    if (v > 0) out.push(v)
  }
  return out.length > 0 ? out : [total]
}

/** Crosshair gap (px) for a half-angle, from the vertical FOV. Clamped so a pin stays a dot and a blast stays on screen. */
export const RETICLE = { min: 2.5, max: 220 }

export function reticlePx(halfRad: number, fovDeg: number, viewPx: number): number {
  const fov = fovDeg > 1 ? fovDeg : 68
  const span = viewPx > 0 ? viewPx : 720
  const px = (Math.tan(Math.max(0, halfRad)) / Math.tan((fov * Math.PI) / 360)) * (span / 2)
  return Math.min(RETICLE.max, Math.max(RETICLE.min, px))
}
