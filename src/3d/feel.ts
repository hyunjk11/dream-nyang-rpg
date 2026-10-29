/** Camera, aim, and volume rules for the 3D slice. No Three.js, so tests stay light. */

export const MASTER_DEFAULT = 0.35
export const CAMERA_YAW = 0.62
export const CAMERA_PITCH_DEG = 50
export const CAMERA_DISTANCE = 5.5
export const CAMERA_DISTANCE_MIN = 4.85
export const CAMERA_DISTANCE_MAX = 6.55
export const AIM_LEAD = 0.55

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

/** Rough share of the vertical screen a 1.62 m figure occupies at this distance. */
export function characterScreenFraction(distance: number, pitchDeg = CAMERA_PITCH_DEG, fovDeg = 42): number {
  const pitch = (pitchDeg * Math.PI) / 180
  const fov = (fovDeg * Math.PI) / 180
  const foreshortened = Math.sin(Math.PI / 2 - pitch) * 1.62
  return foreshortened / distance / fov
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
  return { x: px + nx * lead, y: py + 1.05, z: pz + nz * lead }
}

export function cameraRelativeWish(axisX: number, axisY: number, yaw = CAMERA_YAW): { x: number; z: number } {
  const back = cameraOffset(yaw, CAMERA_PITCH_DEG, 1)
  const fx = -back.x
  const fz = -back.z
  const fl = Math.hypot(fx, fz) || 1
  const forwardX = fx / fl
  const forwardZ = fz / fl
  const rightX = forwardZ
  const rightZ = -forwardX
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
