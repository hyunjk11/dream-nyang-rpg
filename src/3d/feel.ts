/** Camera, aim, and volume rules for the 3D slice. No Three.js, so tests stay light. */

export const MASTER_DEFAULT = 0.35
export const CAMERA_YAW = 0.62
export const CAMERA_PITCH_DEG = 50
export const CAMERA_FOV = 42
export const CAMERA_DISTANCE = 6.2
export const CAMERA_DISTANCE_MIN = 5.2
export const CAMERA_DISTANCE_MAX = 7.4
export const AIM_LEAD = 0.9

export function wrapAngle(angle: number): number {
  let value = angle
  while (value > Math.PI) value -= Math.PI * 2
  while (value < -Math.PI) value += Math.PI * 2
  return value
}

export function damp(current: number, target: number, dt: number, lambda = 12): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function clampCameraDistance(distance: number): number {
  return Math.max(CAMERA_DISTANCE_MIN, Math.min(CAMERA_DISTANCE_MAX, distance))
}

/**
 * Share of the vertical screen Byeolha's silhouette covers when the camera looks at her chest
 * (1.05 m). Pinhole projection of a 1.62 m figure with a ~0.26 m footprint (hair, toes), which
 * matches the skinned bounding box measured in the browser to within a few percent.
 */
export function characterScreenFraction(distance: number, pitchDeg = CAMERA_PITCH_DEG, fovDeg = CAMERA_FOV, height = 1.62, depth = 0.26): number {
  const pitch = (pitchDeg * Math.PI) / 180
  const half = Math.tan((fovDeg * Math.PI) / 360)
  // Camera space: forward looks down by pitch. A point at vertical offset dy from the focus:
  // dy: height above the focus, hz: horizontal distance away from the camera.
  const project = (dy: number, hz: number) => {
    const ahead = distance - dy * Math.sin(pitch) + hz * Math.cos(pitch)
    const up = dy * Math.cos(pitch) + hz * Math.sin(pitch)
    return up / ahead / half
  }
  return (project(height - 1.05, depth / 2) - project(-1.05, -depth / 2)) / 2
}

export function cameraOffset(yaw = CAMERA_YAW, pitchDeg = CAMERA_PITCH_DEG, distance = CAMERA_DISTANCE): { x: number; y: number; z: number } {
  const pitch = (pitchDeg * Math.PI) / 180
  const back = Math.cos(pitch) * distance
  const height = Math.sin(pitch) * distance
  return { x: Math.sin(yaw) * back, y: height, z: Math.cos(yaw) * back }
}

/** Look point on Byeolha, nudged a little toward the aim. The cat is not an input. */
export function focusPoint(px: number, py: number, pz: number, aimX: number, aimZ: number, lead = AIM_LEAD): { x: number; y: number; z: number } {
  const len = Math.hypot(aimX, aimZ)
  const nx = len > 0.001 ? aimX / len : 0
  const nz = len > 0.001 ? aimZ / len : 1
  // Aiming close to her barely moves the camera; aiming far leads by the full amount.
  const reach = lead * Math.min(1, len / 3.5)
  return { x: px + nx * reach, y: py + 1.05, z: pz + nz * reach }
}

export function cameraRelativeWish(axisX: number, axisY: number, yaw = CAMERA_YAW): { x: number; z: number } {
  const back = cameraOffset(yaw, CAMERA_PITCH_DEG, 1)
  const fx = -back.x
  const fz = -back.z
  const fl = Math.hypot(fx, fz) || 1
  const forwardX = fx / fl
  const forwardZ = fz / fl
  // Screen right = forward x up (Three.js is right-handed, Y up). The old (fz, -fx) pointed
  // to screen left, which swapped A/D and the arrow keys.
  const rightX = -forwardZ
  const rightZ = forwardX
  return {
    x: rightX * axisX + forwardX * axisY,
    z: rightZ * axisX + forwardZ * axisY,
  }
}

export function sliceTimes(times: number[], values: number[], size: number, t0: number, t1: number): { times: number[]; values: number[] } {
  const outT: number[] = []
  const outV: number[] = []
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i]
    if (t < t0 || t > t1) continue
    outT.push(t - t0)
    for (let k = 0; k < size; k += 1) outV.push(values[i * size + k])
  }
  return { times: outT, values: outV }
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
