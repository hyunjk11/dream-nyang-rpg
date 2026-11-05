/**
 * Toy gun bases: how each kind actually fires. The water gun is the original "두두두" feel
 * (exactly the GUN numbers), the others trade cadence for pellets, bursts or pierce.
 * No Three.js here (colours are plain numbers), so the feel tests stay fast.
 */
import { AIM_CONES } from '../combat/aim'
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
  /** Shove per droplet (× the foe's usual push): the shotgun bowls foes over, the 연사 gun barely nudges. */
  knock: number
  /** Extra freeze (s) when a shot lands: the sniper's 탕! stops the world for a beat. */
  stop: number
  /** Camera shake and FOV punch per shot. */
  fireShake: number
  fovKick: number
  /** Tracer streak width scale and life scale (1 = the water gun's thin streak). */
  tracerW: number
  tracerLife: number
  /**
   * Engagement band (m). Full damage out to `sweet`, then down to `min`× at `far`,
   * and the shot stops connecting past `far`. Hunt and the shooter both read this.
   * 쌍권총 is not its own base: see `DUAL_ENGAGE` / `engageFor(kind, true)`.
   */
  engage: Engage
  /** Camera shoved back along the view per shot (m): the 탕! you feel in your shoulder. */
  punch: number
  /** Seconds a foe it hits stops in its tracks (heavy guns stagger). */
  stagger: number
  /** What flies out of the gun: water droplets, star shells, fat bubble shells, or one long star shell. */
  casing: 'drop' | 'star' | 'shell' | 'long'
  /** Muzzle light pop strength (0..1 of the capped flash light). */
  light: number
  /** Sound voice: 두두두 spray, 펑 boom, 탕탕탕 burst, or the sniper's 탕! crack. */
  voice: 'spray' | 'boom' | 'burst' | 'crack'
  /** Damage numbers: the sniper's are huge (탕! 1234). */
  bigNumbers: boolean
  /** One-line identity for tooltips. */
  blurb: string
  /** Look: body / tank / barrel colours, tracer colour, barrel length and gun size. */
  look: { body: number; tank: number; barrel: number; tracer: number; barrelLen: number; size: number }
}

/** Preferred band: full damage to `sweet` m, tailing to `min`× by `far` m (the shot's reach). */
export interface Engage {
  sweet: number
  far: number
  min: number
}

/**
 * 쌍권총: closer than one pistol. Full inside a room's width, gone a few tiles out.
 * A hunt targeter should prefer foes inside `sweet` and ignore ones past `far`.
 */
export const DUAL_ENGAGE: Engage = { sweet: 6, far: 12, min: 0.4 }

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
    knock: 0.35,
    stop: 0,
    fireShake: 0.004,
    fovKick: 0.22,
    tracerW: 0.75,
    tracerLife: 0.8,
    engage: { sweet: 14, far: 26, min: 0.5 },
    punch: 0.012, stagger: 0, casing: 'drop', light: 0.35,
    voice: 'spray',
    bigNumbers: false,
    blurb: '두두두 연사 · 한 발은 가볍게, 조준은 보통 (쌍권총이면 넓게 퍼짐)',
    look: { body: 0xffa9cd, tank: 0x8fd0ff, barrel: 0x7ec8ff, tracer: 0xbfeaff, barrelLen: 1, size: 1 },
  },
  /** 방울 샷건: a slow pump of nine fat bubbles, brutal up close, falls off at range, bowls foes over. */
  bubble: {
    kind: 'bubble',
    gap: 0.85,
    burst: 0,
    burstRest: 0,
    pellets: 9,
    damage: 13,
    spreadMin: AIM_CONES.shotgun.yawMin,
    spreadMax: AIM_CONES.shotgun.yawMax,
    bloomPerShot: 0.35,
    heatPerShot: 0.09,
    kickUp: 0.055,
    kickSide: 0.012,
    critChance: 0.08,
    critMul: 1.7,
    pierce: 0,
    knock: 0.75,
    stop: 0.035,
    fireShake: 0.05,
    fovKick: 2.2,
    tracerW: 1.5,
    tracerLife: 1.1,
    engage: { sweet: 7, far: 15, min: 0.35 },
    punch: 0.11, stagger: 0.22, casing: 'shell', light: 0.9,
    voice: 'boom',
    bigNumbers: false,
    blurb: '펑! 근거리 산탄 · 가까울수록 아프고 괴물을 밀쳐 냄',
    look: { body: 0x9fe8d8, tank: 0xd8f6ff, barrel: 0x6fd3c0, tracer: 0xd6fff4, barrelLen: 0.7, size: 1.15 },
  },
  /** 별빛 점사 소총: three-round star bursts, tight and crit-happy, pierces one. */
  star: {
    kind: 'star',
    gap: 0.07,
    burst: 3,
    burstRest: 0.3,
    pellets: 1,
    /** Was 17: with the star proc and burst crits it out-damaged the water gun 2:1. */
    damage: 21,
    spreadMin: AIM_CONES.rifle.yawMin,
    spreadMax: AIM_CONES.rifle.yawMax,
    bloomPerShot: 0.12,
    heatPerShot: 0.016,
    kickUp: 0.009,
    kickSide: 0.003,
    critChance: 0.2,
    critMul: 1.9,
    pierce: 1,
    knock: 0.6,
    stop: 0,
    fireShake: 0.012,
    fovKick: 0.5,
    tracerW: 1,
    tracerLife: 1,
    engage: { sweet: 20, far: 36, min: 0.6 },
    punch: 0.035, stagger: 0.07, casing: 'star', light: 0.55,
    voice: 'burst',
    bigNumbers: false,
    blurb: '탕탕탕 3점사 · 정확하고 중거리까지, 치명타가 잘 터짐',
    look: { body: 0xffe08a, tank: 0xfff3c4, barrel: 0xffc14d, tracer: 0xfff0a0, barrelLen: 1.45, size: 1.05 },
  },
  /** 꿈다트 저격총: one huge 탕! dart a second, skewers a whole line, the world freezes on the hit. */
  dart: {
    kind: 'dart',
    gap: 1.25,
    burst: 0,
    burstRest: 0,
    pellets: 1,
    damage: 130,
    spreadMin: AIM_CONES.sniper.yawMin,
    spreadMax: AIM_CONES.sniper.yawMax,
    bloomPerShot: 0.6,
    heatPerShot: 0.12,
    kickUp: 0.085,
    kickSide: 0.006,
    critChance: 0.3,
    critMul: 2.4,
    pierce: 4,
    knock: 2.2,
    stop: 0.075,
    fireShake: 0.07,
    fovKick: 3.2,
    tracerW: 3,
    tracerLife: 4,
    engage: { sweet: 28, far: 48, min: 0.85 },
    punch: 0.16, stagger: 0.38, casing: 'long', light: 1,
    voice: 'crack',
    bigNumbers: true,
    blurb: '탕! 한 방 저격 · 멀리까지 세고 줄줄이 꿰뚫음',
    look: { body: 0xc8b6ff, tank: 0xeee4ff, barrel: 0x9b86ff, tracer: 0xe2d6ff, barrelLen: 1.9, size: 1.1 },
  },
}

export const GUN_KO: Record<WeaponKind, string> = {
  water: '연사 물총',
  bubble: '방울 샷건',
  star: '점사 소총',
  dart: '저격 다트총',
}

/** Shots per second at full fire (bursts averaged in). */
export function gunRate(p: Pick<GunProfile, 'gap' | 'burst' | 'burstRest'>, fireRate = 1): number {
  const gap = p.gap / fireRate
  return p.burst > 0 ? p.burst / (p.burst * gap + p.burstRest / fireRate) : 1 / gap
}

/**
 * The band this shot uses. `paired` is a second one-handed gun in the off hand (쌍권총),
 * which shoots shorter than the same pistol alone. Hunt and the shooter share this.
 */
export function engageFor(kind: WeaponKind, paired = false): Engage {
  if (paired && kind === 'water') return DUAL_ENGAGE
  return GUN_PROFILES[kind].engage
}

/** Damage multiplier for a droplet that flew `dist` m. Full to `sweet`, `min` at and past `far`. */
export function falloffAt(p: { engage: Engage }, dist: number): number {
  const f = p.engage
  if (dist <= f.sweet) return 1
  if (dist >= f.far) return f.min
  return 1 - ((dist - f.sweet) / (f.far - f.sweet)) * (1 - f.min)
}

/** Korean read of a band: 가까움 / 보통 / 김 / 아주 김, from the full-damage reach. */
export function rangeLabel(e: Engage): string {
  if (e.sweet <= 7) return '가까움'
  if (e.sweet <= 16) return '보통'
  if (e.sweet <= 24) return '김'
  return '아주 김'
}

/** Expected damage per second with crits (sustained single target, no procs), for balance. */
export function gunDpsCrit(p: GunProfile, damageMul = 1, fireRate = 1): number {
  return gunDps(p, damageMul, fireRate) * (1 + p.critChance * (p.critMul - 1))
}

/** The tooltip stat line: 초당 N발 · 한 발 D(×pellets) · 탄퍼짐 · 사거리 · 반동. */
export function gunStatLine(p: GunProfile, damage = p.damage, fireRate = 1, paired = false): string {
  const rate = gunRate(p, fireRate)
  const shot = p.pellets > 1 ? `${Math.round(damage)}×${p.pellets}알` : `${Math.round(damage)}`
  const spreadMax = paired && p.kind === 'water' ? AIM_CONES.dual.yawMax : p.spreadMax
  const spread = spreadMax <= 0.004 ? '한 점' : spreadMax >= 0.08 ? '넓음' : spreadMax >= 0.03 ? '보통' : '좁음'
  const kick = p.kickUp >= 0.05 ? '큼' : p.kickUp >= 0.012 ? '보통' : '작음'
  const band = engageFor(p.kind, paired)
  const reach = `사거리 ${rangeLabel(band)} ${band.sweet}~${band.far}m`
  return `초당 ${rate >= 3 ? Math.round(rate) : rate.toFixed(1)}발 · 한 발 ${shot} · 탄퍼짐 ${spread} · ${reach} · 반동 ${kick}${p.pierce > 0 ? ` · 관통 ${p.pierce}` : ''}`
}

/** Damage per second at full fire (no crits), for tooltips and tests. */
export function gunDps(p: Pick<GunProfile, 'gap' | 'burst' | 'burstRest' | 'pellets' | 'damage'>, damageMul = 1, fireRate = 1): number {
  const gap = p.gap / fireRate
  const cycle = p.burst > 0 ? p.burst * gap + p.burstRest / fireRate : gap
  const shots = p.burst > 0 ? p.burst : 1
  return (shots * p.pellets * p.damage * damageMul) / cycle
}
