/** Where Byeolha holds a gun, and where the camera should look. Pure math, no Phaser. */

export const BYEOLHA_SCALE = 168 / 400
export const BYEOLHA_ORIGIN_Y = 0.99
export const MOCHI_SCALE = 108 / 260
export const MOCHI_ORIGIN_Y = 0.985
/** Hands sit this many pixels above the feet on the displayed sprite. */
export const HAND_LIFT = 64
export const AIM_LEAD = 30

export interface GunSpec {
  originX: number
  originY: number
  /** Muzzle offset from the grip, in texture pixels. +x is the barrel, +y is down. */
  muzzleX: number
  muzzleY: number
  scale: number
}

export const GUNS: Record<string, GunSpec> = {
  gun_water: { originX: 100 / 384, originY: 248 / 384, muzzleX: 248, muzzleY: -74, scale: 0.2 },
  gun_bubble: { originX: 90 / 384, originY: 250 / 384, muzzleX: 258, muzzleY: -95, scale: 0.19 },
  gun_dart: { originX: 90 / 384, originY: 220 / 384, muzzleX: 258, muzzleY: -74, scale: 0.2 },
}

export function gunSpec(key: string): GunSpec {
  return GUNS[key] ?? GUNS.gun_water
}

export type Facing = 'side' | 'front' | 'back'

export function facingFromAim(aim: number): Facing {
  const dx = Math.cos(aim)
  const dy = Math.sin(aim)
  if (dy > 0.5 && Math.abs(dy) >= Math.abs(dx)) return 'front'
  if (dy < -0.5 && Math.abs(dy) >= Math.abs(dx)) return 'back'
  return 'side'
}

export function gripPoint(px: number, py: number, aim: number, recoil = 0): { x: number; y: number } {
  const reach = 18 - recoil
  return {
    x: px + Math.cos(aim) * reach,
    y: py - HAND_LIFT + Math.sin(aim) * 12,
  }
}

export function muzzlePoint(px: number, py: number, aim: number, key: string, recoil = 0): { x: number; y: number } {
  const grip = gripPoint(px, py, aim, recoil)
  const spec = gunSpec(key)
  const flip = Math.cos(aim) < 0
  const lx = spec.muzzleX * spec.scale
  let ly = spec.muzzleY * spec.scale
  if (flip) ly = -ly
  const c = Math.cos(aim)
  const s = Math.sin(aim)
  return { x: grip.x + lx * c - ly * s, y: grip.y + lx * s + ly * c }
}

/** Aiming upward tucks the gun behind the body. */
export function gunInFront(aim: number): boolean {
  return Math.sin(aim) >= -0.35
}

/** Camera anchor on Byeolha's torso, with a short lead along the aim. Never the cat. */
export function cameraFocus(px: number, py: number, aim: number, displayHeight: number): { x: number; y: number } {
  return {
    x: px + Math.cos(aim) * AIM_LEAD,
    y: py - displayHeight * 0.42 + Math.sin(aim) * (AIM_LEAD * 0.65),
  }
}
