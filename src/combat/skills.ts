/**
 * Byeolha's active skills (keys 1–4) at runtime: 거품 폭탄 (a lobbed bubble that pops in an
 * area), 과열 폭주 (gun overdrive), 모찌 돌진 (Mochi dashes through the crowd) and 하트 사탕
 * 오라 (healing aura). Works in both the town and the sewer through a tiny SkillWorld adapter.
 */
import { AdditiveBlending, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Object3D } from 'three'
import type { Hero } from '../actors/hero'
import type { Mochi } from '../actors/mochi'
import type { Vfx } from '../core/vfx'
import type { RayFn } from '../core/tps'
import type { GunCue } from '../audio/gunsound'
import type { Shooter } from './shooter'
import { SKILL_BITE, TREE_BY_ID, auraHeal, bombRadius, type ActiveId, type SkillKind } from '../data/tree'

/** Something a skill can hurt (a horde foe, the boss, a nest pipe, a town foe). */
export interface SkillBody {
  /** Stable per body (Mochi's rush hits each one once). */
  id: string
  x: number
  z: number
  r: number
  tone: 'n' | 'elite' | 'boss'
  /** Full health: skills bite a share of it (fix/gun-identity). */
  maxHp: number
  /** Land `amount`, pushed along (dx, dz) × knock; slow for `slow` seconds where supported. */
  hit: (amount: number, dx: number, dz: number, knock: number, slow: number) => boolean
}

export interface SkillWorld {
  bodies: () => SkillBody[]
  solid: RayFn
  /**
   * How tough this world's foes are against the skills' base numbers (fix/boss-floor). #39 raised
   * foe HP about 10× but skills stayed flat, so a bomb tickled. The run passes
   * SKILL_POWER × its floor HP scale (depth, explore floors); the town its own foe HP ratio.
   */
  power?: number
  /**
   * The damage multiplier a player at this depth usually has (fix/gun-identity): skills bite a
   * share of max HP, nudged by her damage multiplier against this (better gear, bigger bite).
   */
  refMul?: number
}

/** Legacy world power (fix/boss-floor); skills now bite a share of max HP instead (SKILL_BITE). */
export const SKILL_POWER = 2.9
/** 과열 폭주's opening shockwave radius (was 3.2: now it clears the ring around her). */
export const OVERDRIVE_WAVE = { radius: 5 }
/** 사탕 오라 pulses every AURA_PULSE s inside this radius. */
export const AURA_BURN = { radius: 3.2 }
export const AURA_PULSE = 0.5
/**
 * Share of the whole aura cast that lands on the first pulse (fix/real-play): split evenly over
 * 12 pulses each number read 2.5% of an elite — smaller than one water-gun drop, "스킬이 총알 한발
 * 수준도 안 돼". Now half lands at once as one big number; the rest stings over the 6 s.
 */
export const AURA_BURST = 0.5
/** Aura pulse share: the burst first, then the rest split over the remaining pulses (sums to 1). */
export function auraShare(first: boolean): number {
  return first ? AURA_BURST : (1 - AURA_BURST) / (AURA_TIME / AURA_PULSE - 1)
}

export type { SkillKind }
/**
 * fix/gun-identity: skills are the big moments. One cast wipes a normal pack (normals take
 * `n` × their max HP: 1+ means dead), takes 30–40% off an elite and 15–25% off the boss at
 * matching gear. `rank` adds per rank above 1 to elites and the boss. 사탕 오라's numbers are the
 * whole cast (split over its pulses); 톡톡 연쇄 is the small chain pop. Cooldowns keep it fair.
 */
export { SKILL_BITE }
/** Gear nudge on elites and the boss: her damage multiplier against the depth's usual, clamped. */
export const SKILL_GEAR = { min: 1, max: 1.15 }
/**
 * Hard ceiling on one cast's share (fix/real-play): the gear nudge used to drop a fresh or average
 * kit to ×0.8 (elite ~26%, boss ~14%: under the 30–40% / 15–25% promise). Now gear only ever
 * helps, and never past these.
 */
export const SKILL_CAP = { elite: 0.4, boss: 0.25 }
export function skillGear(damageMul: number, refMul = 1): number {
  return Math.max(SKILL_GEAR.min, Math.min(SKILL_GEAR.max, damageMul / Math.max(0.1, refMul)))
}
/** Usual damage multiplier by depth (kits from tools/ttk-kit.ts); the town uses depth 0. */
export const SKILL_REF_MUL: Record<number, number> = { 0: 1.1, 1: 1.5, 2: 2.1, 3: 2.4 }

/** One skill hit on a body: a share of its max HP (normals: a pack wipe). `share` splits a cast (aura pulses). */
export function skillBite(b: Pick<SkillBody, 'tone' | 'maxHp'>, kind: SkillKind, rank: number, gear: number, share = 1): number {
  const t = SKILL_BITE[kind]
  if (b.tone === 'n') return Math.ceil(b.maxHp * t.n * share)
  const base = (b.tone === 'elite' ? t.elite : t.boss) + t.rank * Math.max(0, rank - 1)
  const cut = Math.min(SKILL_CAP[b.tone], base * Math.max(SKILL_GEAR.min, gear))
  return Math.max(1, Math.round(b.maxHp * cut * share))
}

export interface SkillHost {
  hero: Hero
  mochi: Mochi
  vfx: Vfx
  shooter: Shooter
  parent: Object3D
  sfx: (cue: 'splash' | 'dash' | 'heal' | 'windup' | 'shoot_bubble' | 'ui', gain?: number) => void
  gun?: (cue: GunCue, gain?: number, pitch?: number) => void
  /** Skill rank in the save (0 = not learned). */
  rank: (id: string) => number
  /** Current damage multiplier and base guard (armour). */
  damageMul: () => number
  /** 모찌 돌진 bonus from gear (1 = none). */
  mochiMul?: () => number
  armor: () => number
  /** Little text when a skill can't fire. */
  say?: (text: string) => void
  /** Hit feel: freeze `stop` seconds and shake the camera by `shake` (fix/boss-floor). */
  feel?: (stop: number, shake: number) => void
}

/** Blast every body within r of (x, z); returns how many it hit. */
export function blast(bodies: SkillBody[], x: number, z: number, r: number, amount: number, knock = 0, slow = 0, numbers?: (amount: number, at: Vector3, tone: SkillBody['tone']) => void): number {
  let n = 0
  for (const b of bodies) {
    const dx = b.x - x
    const dz = b.z - z
    const d = Math.hypot(dx, dz)
    if (d > r + b.r) continue
    const l = d || 1
    b.hit(Math.round(amount), dx / l, dz / l, knock, slow)
    numbers?.(Math.round(amount), new Vector3(b.x, 1.1, b.z), b.tone)
    n += 1
  }
  return n
}

/** A skill's area hit: like blast(), but each body takes its skillBite and it reports skill numbers. Returns hits. */
export function skillBlast(bodies: SkillBody[], x: number, z: number, r: number, bite: { kind: SkillKind; rank: number; gear: number; share?: number }, knock = 0, slow = 0, numbers?: (amount: number, at: Vector3, tone: SkillBody['tone']) => void): number {
  let n = 0
  for (const b of bodies) {
    const dx = b.x - x
    const dz = b.z - z
    const d = Math.hypot(dx, dz)
    if (d > r + b.r) continue
    const l = d || 1
    const amount = skillBite(b, bite.kind, bite.rank, bite.gear, bite.share)
    b.hit(amount, dx / l, dz / l, knock, slow)
    numbers?.(amount, new Vector3(b.x, 1.1, b.z), b.tone)
    n += 1
  }
  return n
}

interface Bomb {
  mesh: Mesh
  from: Vector3
  to: Vector3
  t: number
  dur: number
  r: number
  rank: number
  slow: number
}

interface Rush {
  from: Vector3
  dir: Vector3
  len: number
  t: number
  dur: number
  rank: number
  /** Mochi gear bonus (모찌 돌진 +%): widens the bite on elites and the boss. */
  mul: number
  hit: Set<string>
}

export const SKILL_RANGE = { bomb: 16, rush: 8 }
/** How wide Mochi's rush sweeps (m either side of her path). */
export const RUSH_WIDTH = 1.7

/** Half-angle of the rush's aim-assist cone (radians, about 22°). */
export const RUSH_CONE = 0.38

/** The rush target: the body nearest the aim line within the cone and range (null = none). */
export function rushLock(bodies: SkillBody[], x: number, z: number, dx: number, dz: number, range: number): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null
  let score = Infinity
  for (const b of bodies) {
    const vx = b.x - x
    const vz = b.z - z
    const d = Math.hypot(vx, vz)
    if (d < 0.3 || d > range + b.r) continue
    const ang = Math.acos(Math.max(-1, Math.min(1, (vx * dx + vz * dz) / d)))
    if (ang > RUSH_CONE) continue
    const s = ang * 4 + d * 0.15
    if (s < score) {
      score = s
      best = { x: b.x, z: b.z, d }
    }
  }
  return best
}
export const AURA_TIME = 6

export class SkillRunner {
  readonly cooldown: Record<ActiveId, number> = { bubble_bomb: 0, overdrive: 0, mochi_rush: 0, candy_aura: 0 }
  /** Seconds of candy aura left. */
  aura = 0
  /** Times each skill fired (QA). */
  readonly used: Record<ActiveId, number> = { bubble_bomb: 0, overdrive: 0, mochi_rush: 0, candy_aura: 0 }
  private readonly host: SkillHost
  private readonly bombs: Bomb[] = []
  private rush: Rush | null = null
  private auraRing = 0
  private auraBurn = 0
  private auraFirst = false
  private readonly geo = new SphereGeometry(0.32, 16, 12)
  private readonly mat = new MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })

  constructor(host: SkillHost) {
    this.host = host
  }

  cooldownOf(id: ActiveId): number {
    const def = TREE_BY_ID[id]
    const r = this.host.rank(id)
    let cd = def.cooldown?.(Math.max(1, r)) ?? 10
    if (id === 'bubble_bomb') cd -= 0.6 * this.host.rank('sticky_soap')
    return Math.max(2, cd)
  }

  /** 0..1 cooldown left (HUD). */
  readiness(id: ActiveId): number {
    const cd = this.cooldown[id]
    return cd <= 0 ? 0 : Math.min(1, cd / this.cooldownOf(id))
  }

  /** Fire a skill toward the crosshair point; returns false (and why) when it can't. */
  use(id: ActiveId, world: SkillWorld | null): boolean {
    const { hero } = this.host
    const r = this.host.rank(id)
    if (!world || !hero.alive) return false
    if (r <= 0) {
      this.host.say?.(`${TREE_BY_ID[id].name}: 아직 안 배웠어 (K 스킬)`)
      return false
    }
    if (this.cooldown[id] > 0) {
      this.host.say?.(`${TREE_BY_ID[id].name} 준비 중 · ${Math.ceil(this.cooldown[id])}초`)
      return false
    }
    this.cooldown[id] = this.cooldownOf(id)
    this.used[id] += 1
    if (id === 'bubble_bomb') this.throwBomb(r, world)
    else if (id === 'overdrive') this.overdrive(r, world)
    else if (id === 'mochi_rush') this.startRush(r, world)
    else this.startAura()
    return true
  }

  private aimGround(max: number): Vector3 {
    const p = this.host.hero.object.position
    const aim = this.host.shooter.rig.aim
    const to = new Vector3(aim.x - p.x, 0, aim.z - p.z)
    const len = to.length()
    if (len > max) to.multiplyScalar(max / len)
    if (len < 1.5) {
      const yaw = this.host.hero.yaw
      to.set(Math.sin(yaw) * 4, 0, Math.cos(yaw) * 4)
    }
    return to.add(new Vector3(p.x, 0, p.z))
  }

  private throwBomb(r: number, world: SkillWorld): void {
    const { hero, vfx } = this.host
    const from = hero.muzzle.getWorldPosition(new Vector3())
    const to = this.aimGround(SKILL_RANGE.bomb)
    // Stop short of a wall between her and the spot.
    const flat = new Vector3(to.x - from.x, 0, to.z - from.z)
    const dist = flat.length()
    if (dist > 0.1) {
      flat.normalize()
      const wall = world.solid(from.x, 0.8, from.z, flat.x, 0, flat.z, dist)
      if (wall < dist) to.set(from.x + flat.x * Math.max(0.5, wall - 0.4), 0, from.z + flat.z * Math.max(0.5, wall - 0.4))
    }
    const mesh = new Mesh(this.geo, this.mat)
    mesh.position.copy(from)
    this.host.parent.add(mesh)
    const sticky = this.host.rank('sticky_soap')
    this.bombs.push({
      mesh,
      from,
      to,
      t: 0,
      dur: 0.32 + Math.min(0.3, dist * 0.025),
      r: bombRadius(this.host.rank('big_bubble')),
      rank: r,
      slow: sticky > 0 ? 2 : 0,
    })
    this.host.sfx('shoot_bubble', 1)
    vfx.burst(from, 0xbfe9ff, { count: 6, speed: 1.4, up: 1, life: 0.3, size: 0.12, gravity: 2, drag: 2 })
  }

  private overdrive(r: number, world: SkillWorld): void {
    const { shooter, hero, vfx } = this.host
    shooter.gun.overdrive = 5 + r
    shooter.gun.heat = 0
    shooter.gun.overheated = false
    shooter.overdriveCrit = 0.1
    const at = hero.object.position.clone().setY(1)
    vfx.ring(at.clone().setY(0.06), 0xff8f5c, 0.3, OVERDRIVE_WAVE.radius, 0.5)
    vfx.ring(at.clone().setY(0.1), 0xffd08a, 0.2, OVERDRIVE_WAVE.radius * 0.7, 0.35)
    vfx.ring(at.clone().setY(0.14), 0xffffff, 0.1, OVERDRIVE_WAVE.radius * 1.1, 0.25)
    vfx.burst(at, 0xffb36b, { count: 44, speed: 7, up: 3, life: 0.6, size: 0.22, gravity: 3, drag: 2, additive: true })
    vfx.burst(at, 0xfff0c0, { count: 18, speed: 10, up: 0.6, life: 0.35, size: 0.16, shape: 1, gravity: 0, drag: 3, additive: true })
    // The heat bursts out: a shockwave blows the ring of foes away as the barrel lights.
    const hits = skillBlast(world.bodies(), at.x, at.z, OVERDRIVE_WAVE.radius, { kind: 'wave', rank: r, gear: this.gear(world) }, 2.2, 0, this.numbers)
    this.host.feel?.(hits > 0 ? 0.14 : 0.05, hits > 0 ? 0.2 : 0.1)
    this.host.sfx('windup', 1)
    this.host.gun?.('thunk', 1.3, 0.1)
    this.host.gun?.('pop', 1.2, -0.5)
  }

  private startRush(r: number, world: SkillWorld): void {
    const { hero, mochi, vfx } = this.host
    const p = hero.object.position
    const m = mochi.object.position
    const from = new Vector3((p.x + m.x) / 2, 0, (p.z + m.z) / 2)
    const target = this.aimGround(SKILL_RANGE.rush + 2)
    const dir = new Vector3(target.x - from.x, 0, target.z - from.z)
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(hero.yaw), 0, Math.cos(hero.yaw))
    dir.normalize()
    // Aim assist: lock onto the foe closest to the aim line inside a narrow cone, and run
    // just through it, so the rush lands in town and in the sewer alike.
    const lock = rushLock(world.bodies(), from.x, from.z, dir.x, dir.z, SKILL_RANGE.rush)
    let reach = SKILL_RANGE.rush
    if (lock) {
      dir.set(lock.x - from.x, 0, lock.z - from.z).normalize()
      reach = Math.min(SKILL_RANGE.rush, lock.d + 1.2)
    }
    const wall = world.solid(from.x, 0.4, from.z, dir.x, 0, dir.z, SKILL_RANGE.rush)
    const len = Math.max(Math.min(1.2, wall), Math.min(reach, wall - 0.45))
    this.rush = { from, dir, len, t: 0, dur: 0.36, rank: r, mul: this.host.mochiMul?.() ?? 1, hit: new Set() }
    this.host.sfx('dash', 1.2)
    vfx.ring(from.clone().setY(0.05), 0xffd36b, 0.2, 2.4, 0.4)
    vfx.burst(from.clone().setY(0.4), 0xffe3a0, { count: 16, speed: 4, up: 1.2, life: 0.4, size: 0.2, gravity: 2, drag: 2, additive: true })
  }

  private startAura(): void {
    const { hero, vfx } = this.host
    this.aura = AURA_TIME
    this.auraRing = 0
    this.auraBurn = 0
    this.auraFirst = true
    vfx.poof(hero.object.position.clone().setY(1.2), 0xff9fd2, 2.2)
    vfx.ring(hero.object.position.clone().setY(0.06), 0xff9fd2, 0.3, AURA_BURN.radius * 1.2, 0.5)
    vfx.burst(hero.object.position.clone().setY(1), 0xffb7d8, { count: 30, speed: 4, up: 2.5, life: 0.7, size: 0.22, gravity: 1, drag: 2, additive: true })
    this.host.sfx('heal', 1.2)
    this.host.feel?.(0.05, 0.08)
  }

  /** Her gear against the depth's usual (elites and the boss bite a little more or less). */
  private gear(world: SkillWorld): number {
    return skillGear(this.host.damageMul(), world.refMul ?? SKILL_REF_MUL[0])
  }

  /** A foe died at (x, z): 톡톡 연쇄 may pop a little bubble there. */
  onKill(x: number, z: number, world: SkillWorld | null): void {
    const r = this.host.rank('pop_chain')
    if (!world || r <= 0 || Math.random() >= 0.08 * r) return
    const at = new Vector3(x, 0.5, z)
    this.host.vfx.poof(at, 0xbfe9ff, 0.9)
    this.host.vfx.ring(at.clone().setY(0.06), 0xbfe9ff, 0.2, 1.8, 0.3)
    this.host.gun?.('pop', 0.8, 0.4)
    // Deferred a tick so a chain can't recurse inside the killing blow.
    queueMicrotask(() => skillBlast(world.bodies(), x, z, 1.8, { kind: 'chain', rank: 1, gear: this.gear(world) }, 0, 0, this.numbers))
  }

  /** Skill hits read big: normals as crit-sized numbers, elites/boss in their own colour. */
  private readonly numbers = (amount: number, at: Vector3, tone: SkillBody['tone']) => this.host.shooter.hudFx.number(amount, at, tone === 'n' ? 'skill' : tone)

  /** Advance cooldowns, bombs in flight, Mochi's rush and the aura. Call after the world update. */
  update(dt: number, world: SkillWorld | null): void {
    const { hero, vfx } = this.host
    for (const k of Object.keys(this.cooldown) as ActiveId[]) this.cooldown[k] = Math.max(0, this.cooldown[k] - dt)
    if (this.host.shooter.gun.overdrive <= 0) this.host.shooter.overdriveCrit = 0
    for (let i = this.bombs.length - 1; i >= 0; i -= 1) {
      const b = this.bombs[i]
      b.t += dt
      const k = Math.min(1, b.t / b.dur)
      b.mesh.position.lerpVectors(b.from, b.to, k)
      b.mesh.position.y = b.from.y * (1 - k) + Math.sin(k * Math.PI) * 1.6 + 0.3 * k
      b.mesh.scale.setScalar(1 + k * 0.4)
      if (k < 1) continue
      b.mesh.removeFromParent()
      this.bombs.splice(i, 1)
      const at = b.to.clone().setY(0.6)
      // 펑!: a big soap blast — two rings, a white flash, a spray of suds.
      vfx.poof(at, 0xbfe9ff, 2.6 + b.r * 0.5)
      vfx.ring(b.to.clone().setY(0.06), 0x9fdcff, 0.3, b.r, 0.5)
      vfx.ring(b.to.clone().setY(0.1), 0xffffff, 0.15, b.r * 0.75, 0.35)
      vfx.ring(b.to.clone().setY(0.14), 0xd8f2ff, 0.1, b.r * 1.15, 0.28)
      vfx.burst(at, 0xffffff, { count: 40, speed: 7, up: 4, life: 0.55, size: 0.24, gravity: 5, drag: 2, additive: true })
      vfx.burst(at, 0x9fdcff, { count: 22, speed: 3.5, up: 2, life: 0.8, size: 0.32, gravity: 2, drag: 2 })
      this.host.sfx('splash', 1.3)
      this.host.gun?.('pop', 1.3, -0.45)
      this.host.gun?.('thunk', 1, -0.3)
      const hits = world ? skillBlast(world.bodies(), b.to.x, b.to.z, b.r, { kind: 'bomb', rank: b.rank, gear: this.gear(world) }, 1.8, b.slow, this.numbers) : 0
      this.host.feel?.(hits > 0 ? 0.13 : 0.04, hits > 0 ? 0.2 : 0.07)
    }
    const rush = this.rush
    if (rush) {
      rush.t += dt
      const k = Math.min(1, rush.t / rush.dur)
      const at = rush.from.clone().addScaledVector(rush.dir, rush.len * k)
      this.host.mochi.place(at.x, at.z, Math.atan2(rush.dir.x, rush.dir.z))
      vfx.burst(at.clone().setY(0.4), 0xffe3a0, { count: 2, speed: 1, up: 0.8, life: 0.3, size: 0.18, gravity: 0, drag: 3 })
      if (world) {
        for (const b of world.bodies()) {
          const key = b.id
          if (rush.hit.has(key)) continue
          if (Math.hypot(b.x - at.x, b.z - at.z) > b.r + RUSH_WIDTH) continue
          rush.hit.add(key)
          const amount = skillBite(b, 'rush', rush.rank, this.gear(world) * rush.mul)
          b.hit(amount, rush.dir.x, rush.dir.z, 3.2, 0)
          this.numbers(amount, new Vector3(b.x, 1.1, b.z), b.tone)
          vfx.burst(new Vector3(b.x, 0.8, b.z), 0xffe3a0, { count: 18, speed: 5, up: 2.4, life: 0.4, size: 0.2, gravity: 4, drag: 2, additive: true })
          vfx.ring(new Vector3(b.x, 0.08, b.z), 0xffd36b, 0.2, 1.4, 0.25)
          this.host.gun?.('pop', 0.9, 0.2)
          this.host.feel?.(rush.hit.size === 1 ? 0.12 : 0.04, rush.hit.size === 1 ? 0.14 : 0.08)
        }
      }
      if (k >= 1) {
        this.rush = null
        vfx.poof(at.clone().setY(0.5), 0xffd36b, 1.1)
        this.host.gun?.('thunk', 0.9, 0.2)
      }
    }
    const guard = this.host.armor()
    if (this.aura > 0) {
      this.aura = Math.max(0, this.aura - dt)
      hero.guard = Math.min(0.8, guard + 0.2)
      if (hero.alive) hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * auraHeal(this.host.rank('candy_aura')) * dt)
      this.auraRing -= dt
      if (this.auraRing <= 0) {
        this.auraRing = 0.5
        const p = hero.object.position
        vfx.ring(p.clone().setY(0.06), 0xff9fd2, 0.4, AURA_BURN.radius, 0.5, 0.6)
        vfx.burst(p.clone().setY(1.4), 0xffb7d8, { count: 4, speed: 0.8, up: 1.6, life: 0.7, size: 0.18, gravity: -1, drag: 1.5 })
      }
      // The candy stings: foes inside the ring take a pulse every AURA_PULSE s.
      this.auraBurn -= dt
      if (this.auraBurn <= 0 && world && hero.alive) {
        this.auraBurn = AURA_PULSE
        const p = hero.object.position
        const r = this.host.rank('candy_aura')
        skillBlast(world.bodies(), p.x, p.z, AURA_BURN.radius, { kind: 'aura', rank: r, gear: this.gear(world), share: auraShare(this.auraFirst) }, this.auraFirst ? 1.2 : 0.3, 0, this.numbers)
        this.auraFirst = false
      }
    } else hero.guard = guard
  }

  /** Drop bombs in flight and end effects (leaving a world). */
  reset(): void {
    for (const b of this.bombs) b.mesh.removeFromParent()
    this.bombs.length = 0
    this.rush = null
    this.aura = 0
  }

  get rushing(): boolean {
    return this.rush !== null
  }
}
