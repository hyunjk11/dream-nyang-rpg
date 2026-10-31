/** Aim-hold poses, angle helpers and the default volume. No Three.js, so tests stay light. */

export const MASTER_DEFAULT = 0.35

export function wrapAngle(angle: number): number {
  let value = angle
  while (value > Math.PI) value -= Math.PI * 2
  while (value < -Math.PI) value += Math.PI * 2
  return value
}

export function damp(current: number, target: number, dt: number, lambda = 12): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/**
 * Upper-body hold per locomotion state. Byeolha's right hand is solved with two-bone IK
 * every frame, so the water gun stays in front of her chest in every clip.
 * reach: hand target from the chest bone in the aim frame (m). fwd = toward aim, right = her right.
 * palm: grip offset from the RightHand bone, in hand space (m). x = thumb side, y = along the fingers, z = palm normal.
 * pitch: barrel pitch in degrees (negative = slightly down, never at the floor).
 * twist: share of the aim yaw the spine takes (the rest is the arm).
 */
export interface HoldPose {
  reach: { fwd: number; right: number; up: number }
  palm: { x: number; y: number; z: number }
  pitch: number
  twist: number
}

export type HoldState = 'idle' | 'walk' | 'run' | 'shoot' | 'shootMove' | 'runShoot' | 'dash' | 'hit'

export const HOLD_POSES: Record<HoldState, HoldPose> = {
  idle: { reach: { fwd: 0.3, right: 0.1, up: -0.1 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: -8, twist: 0.7 },
  walk: { reach: { fwd: 0.3, right: 0.11, up: -0.09 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: -7, twist: 0.6 },
  run: { reach: { fwd: 0.27, right: 0.1, up: -0.06 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: -4, twist: 0.5 },
  shoot: { reach: { fwd: 0.42, right: 0.06, up: 0.0 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: 0, twist: 0.75 },
  shootMove: { reach: { fwd: 0.41, right: 0.06, up: 0.0 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: 0, twist: 0.65 },
  runShoot: { reach: { fwd: 0.38, right: 0.07, up: 0.01 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: 0, twist: 0.55 },
  dash: { reach: { fwd: 0.24, right: 0.1, up: -0.04 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: -3, twist: 0.3 },
  hit: { reach: { fwd: 0.25, right: 0.13, up: -0.05 }, palm: { x: 0, y: 0.07, z: 0.025 }, pitch: 4, twist: 0.4 },
}

export const AIM_PITCH_MIN = -12
export const AIM_PITCH_MAX = 14
export const UPPER_TWIST_LIMIT = (65 * Math.PI) / 180

/** Barrel pitch from the gun toward the aim point, clamped so it never dives at the floor. */
export function aimPitchDeg(dy: number, flat: number, bias = 0): number {
  const raw = (Math.atan2(dy, Math.max(0.6, flat)) * 180) / Math.PI
  return Math.max(AIM_PITCH_MIN, Math.min(AIM_PITCH_MAX, raw * 0.5 + bias))
}

/** How far the upper body turns toward the aim, limited so the gun never crosses her back. */
export function upperTwist(aimYaw: number, bodyYaw: number, share: number): number {
  const delta = wrapAngle(aimYaw - bodyYaw)
  return Math.max(-UPPER_TWIST_LIMIT, Math.min(UPPER_TWIST_LIMIT, delta * share))
}
