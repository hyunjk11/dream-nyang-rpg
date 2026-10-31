/**
 * Toy gun bases: how each kind actually fires. The water gun is the original "두두두" feel
 * (exactly the GUN numbers), the others trade cadence for pellets, bursts or pierce.
 * No Three.js here (colours are plain numbers), so the feel tests stay fast.
 */
import { GUN } from '../combat/gunfeel'
import type { WeaponKind } from '../sim/types'

export interface GunProfile {
  kind: WeaponKind
  /** Seconds between shots (inside a burst for burst guns). */
  gap: number
  /** Shots per trigger burst (0 = plain full auto). */
  burst: number
  /** Pause after a burst. */
  burstRest: number
  /** Droplets per shot (shotgun > 1). */
  pellets: number
  /** Damage per droplet before level, gear and crits. */
  damage: number
  spreadMin: number
  spreadMax: number
  bloomPerShot: number
  heatPerShot: number
  kickUp: number
  kickSide: number
  critChance: number
  critMul: number
  /** Foes a droplet passes through after the first. */
  pierce: number
  /** Look: body / tank / barrel colours, tracer colour, barrel length and gun size. */
  look: { body: number; tank: number; barrel: number; tracer: number; barrelLen: number; size: number }
}

export const GUN_PROFILES: Record<WeaponKind, GunProfile> = {
  water: {
    kind: 'water',
    gap: GUN.gap,
    burst: 0,
    burstRest: 0,
    pellets: 1,
    damage: GUN.damage,
    spreadMin: GUN.spreadMin,
    spreadMax: GUN.spreadMax,
    bloomPerShot: GUN.bloomPerShot,
    heatPerShot: GUN.heatPerShot,
    kickUp: GUN.kickUp,
    kickSide: GUN.kickSide,
    critChance: GUN.critChance,
    critMul: GUN.critMul,
    pierce: 0,
    look: { body: 0xffa9cd, tank: 0x8fd0ff, barrel: 0x7ec8ff, tracer: 0xbfeaff, barrelLen: 1, size: 1 },
  },
  /** 방울 샷건: a slow pump of six fat bubbles, brutal up close. */
  bubble: {
    kind: 'bubble',
    gap: 0.48,
    burst: 0,
    burstRest: 0,
    pellets: 6,
    damage: 10,
    spreadMin: 0.045,
    spreadMax: 0.07,
    bloomPerShot: 0.35,
    heatPerShot: 0.07,
    kickUp: 0.03,
    kickSide: 0.008,
    critChance: 0.08,
    critMul: 1.7,
    pierce: 0,
    look: { body: 0x9fe8d8, tank: 0xd8f6ff, barrel: 0x6fd3c0, tracer: 0xd6fff4, barrelLen: 0.7, size: 1.15 },
  },
  /** 별빛 점사 소총: three-round star bursts, tight and crit-happy, pierces one. */
  star: {
    kind: 'star',
    gap: 0.07,
    burst: 3,
    burstRest: 0.3,
    pellets: 1,
    damage: 17,
    spreadMin: 0.002,
    spreadMax: 0.014,
    bloomPerShot: 0.12,
    heatPerShot: 0.016,
    kickUp: 0.009,
    kickSide: 0.003,
    critChance: 0.2,
    critMul: 1.9,
    pierce: 1,
    look: { body: 0xffe08a, tank: 0xfff3c4, barrel: 0xffc14d, tracer: 0xfff0a0, barrelLen: 1.45, size: 1.05 },
  },
  /** 꿈다트 저격총: one heavy dart that skewers a whole line. */
  dart: {
    kind: 'dart',
    gap: 0.55,
    burst: 0,
    burstRest: 0,
    pellets: 1,
    damage: 58,
    spreadMin: 0.0008,
    spreadMax: 0.004,
    bloomPerShot: 0.5,
    heatPerShot: 0.08,
    kickUp: 0.028,
    kickSide: 0.002,
    critChance: 0.25,
    critMul: 2.2,
    pierce: 3,
    look: { body: 0xc8b6ff, tank: 0xeee4ff, barrel: 0x9b86ff, tracer: 0xe2d6ff, barrelLen: 1.9, size: 1.1 },
  },
}

export const GUN_KO: Record<WeaponKind, string> = {
  water: '연사 물총',
  bubble: '방울 샷건',
  star: '점사 소총',
  dart: '저격 다트총',
}

/** Damage per second at full fire (no crits), for tooltips and tests. */
export function gunDps(p: Pick<GunProfile, 'gap' | 'burst' | 'burstRest' | 'pellets' | 'damage'>, damageMul = 1, fireRate = 1): number {
  const gap = p.gap / fireRate
  const cycle = p.burst > 0 ? p.burst * gap + p.burstRest / fireRate : gap
  const shots = p.burst > 0 ? p.burst : 1
  return (shots * p.pellets * p.damage * damageMul) / cycle
}
