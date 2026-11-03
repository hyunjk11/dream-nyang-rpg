/**
 * 팡팡 터지는 총 맛: 별 도탄과 솜사탕 구름 — fix/mod-parts 부터 특수 부품(도탄 · 뭉게뭉게)이나 전설
 * 옵션, 총 종류(별똥 점사총 · 방울 샷건)가 있어야 나온다. 부품 조합(COMBOS)이 모양과 맛을 바꾼다.
 *  - 별 도탄: 몇 발마다(또는 '별도탄 확률' 옵션으로) 반짝이는 별이 튀어나가 벽·바닥·몹에 맞고
 *    팅팅 튕기며 다음 몹을 찾아 날아간다. 반짝 꼬리를 남긴다.
 *  - 솜사탕 구름: 맞힌 자리(치명타면 더 자주)에 분홍·하늘색 몽실 구름이 피어 잠깐 동안 안의 몹에게
 *    조금씩 피해를 준다.
 * 모두 풀링된 InstancedMesh 두 개로 그리고, 모바일에서는 개수를 더 줄인다.
 */
import { AdditiveBlending, Color, DoubleSide, Group, IcosahedronGeometry, InstancedMesh, MeshBasicMaterial, Object3D, Shape, ShapeGeometry, Vector3 } from 'three'
import type { RayFn } from '../core/tps'
import type { Vfx } from '../core/vfx'
import type { SkillBody } from './skills'
import { COMBO, type ComboId } from '../data/mods'

export const JUICE = {
  /** With any star chance on the gun, every Nth droplet also throws one. */
  starEvery: 7,
  starSpeed: 21,
  /** Bounces (walls + foes) before a star fizzles. */
  starBounces: 4,
  starLife: 1.8,
  /** Star damage per foe it bounces through, as a share of the droplet. */
  starShare: 0.6,
  /** How far a star looks for its next foe after a bounce. */
  starSeek: 9,
  /** With any cloud chance on the gun: extra chance on a landed droplet, and on a crit. */
  cloudBase: 0.05,
  cloudCrit: 0.3,
  cloudRadius: 1.7,
  cloudLife: 2.4,
  cloudTick: 0.4,
  /** Each tick hurts every foe inside for this share of the droplet that made it. */
  cloudShare: 0.2,
  /** Live caps [desktop, mobile]. */
  maxStars: [14, 6] as const,
  maxClouds: [8, 3] as const,
}

/** Does this droplet throw a star? `shot` counts droplets fired (1-based). No star chance = no stars. */
export function rollStar(shot: number, chance: number, r: number): boolean {
  if (!(chance > 0)) return false
  return (shot > 0 && shot % JUICE.starEvery === 0) || r < chance
}

/** Does this landed droplet puff a cotton-candy cloud? No cloud chance = no clouds. */
export function rollCloud(crit: boolean, chance: number, r: number): boolean {
  if (!(chance > 0)) return false
  return r < Math.min(0.9, (crit ? JUICE.cloudCrit : JUICE.cloudBase) + chance)
}

/**
 * Expected juice damage per droplet as a share of the droplet (balance: tests and sims).
 * Stars: chance × share × average foes hit; clouds: chance × ticks × share × average foes inside.
 */
export function juiceShare(starShot: number, cloud: number, critChance: number, combos: readonly ComboId[] = [], foes = 2): number {
  const has = (c: ComboId) => combos.includes(c)
  const starP = starShot > 0 ? Math.min(1, 1 / JUICE.starEvery + starShot) : 0
  const hops = Math.min(foes, JUICE.starBounces + 1 + (has('piercestar') ? COMBO.pierceBounces : 0))
  let star = starP * JUICE.starShare * (has('piercestar') ? COMBO.pierceShare : 1) * hops
  if (has('sparkstar')) star += starP * JUICE.starShare * COMBO.sparkShare * hops * Math.max(0, foes - 1) * 0.5
  const cloudP = cloud > 0 ? Math.min(0.9, (critChance * JUICE.cloudCrit + (1 - critChance) * JUICE.cloudBase) + cloud) : 0
  const ticks = JUICE.cloudLife / JUICE.cloudTick
  // One cloud per trigger pull at most, and most land on one or two foes.
  let puff = cloudP * ticks * JUICE.cloudShare * Math.min(foes, 1.5) * 0.5
  if (has('fluffstar')) puff += starP * ticks * JUICE.cloudShare * COMBO.fluffShare * JUICE.starShare * 0.6 * 0.5
  return Math.round((star + puff) * 1000) / 1000
}

/** Mirror a velocity off a surface with unit normal n (keeps speed). */
export function reflect(v: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const d = v.x * n.x + v.y * n.y + v.z * n.z
  return { x: v.x - 2 * d * n.x, y: v.y - 2 * d * n.y, z: v.z - 2 * d * n.z }
}

/** Nearest body within range that this star has not hit yet (stars hop foe to foe). */
export function seekNext(bodies: readonly SkillBody[], x: number, z: number, hit: ReadonlySet<string>, range: number): SkillBody | null {
  let best: SkillBody | null = null
  let bd = range
  for (const b of bodies) {
    if (hit.has(b.id)) continue
    const d = Math.hypot(b.x - x, b.z - z)
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return best
}

/** Bodies inside a cloud of radius r at (x, z). */
export function inCloud(bodies: readonly SkillBody[], x: number, z: number, r: number): SkillBody[] {
  return bodies.filter((b) => Math.hypot(b.x - x, b.z - z) <= r + b.r * 0.5)
}

/** Distance along the segment (o + d·t, t∈[0,len]) to a body's upright capsule, or -1. */
export function segmentBody(ox: number, oy: number, oz: number, dx: number, dz: number, len: number, b: SkillBody): number {
  if (oy < -0.2 || oy > 2.4) return -1
  const px = b.x - ox
  const pz = b.z - oz
  const t = Math.max(0, Math.min(len, px * dx + pz * dz))
  const cx = ox + dx * t - b.x
  const cz = oz + dz * t - b.z
  return Math.hypot(cx, cz) <= b.r + 0.2 ? t : -1
}

export interface JuiceWorld {
  solid: RayFn
  normal: (end: Vector3, d: Vector3) => { x: number; y: number; z: number }
  bodies?: () => SkillBody[]
}

export interface JuiceHost {
  vfx: Vfx
  number: (amount: number, at: Vector3, tone: 'n' | 'crit' | 'elite' | 'boss' | 'star' | 'candy') => void
  sound?: (cue: 'star' | 'boing' | 'puff' | 'pop', gain?: number, pitch?: number) => void
  /** 달콤 구름: hp back from cloud ticks. */
  heal?: (amount: number) => void
  lowPower: boolean
}

interface Star {
  p: Vector3
  v: Vector3
  bounces: number
  age: number
  amount: number
  hit: Set<string>
  trail: number
  spin: number
  /** 통통 솜사탕: this star already puffed its mini cloud. */
  puffed: boolean
}

interface Cloud {
  x: number
  y: number
  z: number
  age: number
  tick: number
  amount: number
  blue: boolean
  seed: number
  /** Radius (mini clouds from stars are smaller). */
  r: number
  /** 서리 구름: icy white-blue and a strong slow. */
  frost: boolean
}

const PUFFS = 6
const STAR_TINTS = [0xfff2a0, 0xffd0f0, 0xbfeaff]
/** 꿰뚫는 별똥: hotter lilac-gold stars. */
const PIERCE_TINTS = [0xffd36b, 0xd9b8ff, 0xffe9a8]

function starShape(outer: number, inner: number): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? inner : outer
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return s
}

export class Juice {
  readonly group = new Group()
  private readonly stars: Star[] = []
  private readonly clouds: Cloud[] = []
  private readonly starMesh: InstancedMesh
  private readonly cloudMesh: InstancedMesh
  private readonly e = new Object3D()
  private readonly c = new Color()
  private readonly d = new Vector3()
  private readonly q = new Vector3()
  /** Totals for QA. */
  starHits = 0
  cloudHits = 0
  readonly maxStars: number
  readonly maxClouds: number
  /** 부품 조합 on the equipped gun (set from the loadout). */
  combos: ReadonlySet<ComboId> = new Set()
  /** Combo procs for QA. */
  comboHits = 0

  constructor(private readonly host: JuiceHost) {
    this.group.name = 'gun-juice'
    this.maxStars = JUICE.maxStars[host.lowPower ? 1 : 0]
    this.maxClouds = JUICE.maxClouds[host.lowPower ? 1 : 0]
    this.starMesh = new InstancedMesh(
      new ShapeGeometry(starShape(0.22, 0.095)),
      new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(1.6), side: DoubleSide, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      JUICE.maxStars[0],
    )
    this.cloudMesh = new InstancedMesh(
      new IcosahedronGeometry(0.5, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
      JUICE.maxClouds[0] * PUFFS,
    )
    for (const im of [this.starMesh, this.cloudMesh]) {
      im.count = 0
      im.frustumCulled = false
      im.setColorAt(0, new Color(1, 1, 1))
      this.group.add(im)
    }
  }

  get live(): { stars: number; clouds: number } {
    return { stars: this.stars.length, clouds: this.clouds.length }
  }

  /** Throw a ricochet star from the muzzle along `dir`. */
  star(from: Vector3, dir: Vector3, amount: number): void {
    if (this.stars.length >= this.maxStars) this.stars.shift()
    const pierce = this.combos.has('piercestar')
    this.stars.push({
      p: from.clone(),
      v: dir.clone().normalize().multiplyScalar(JUICE.starSpeed),
      bounces: JUICE.starBounces + (pierce ? COMBO.pierceBounces : 0),
      age: 0,
      amount: amount * (pierce ? COMBO.pierceShare : 1),
      hit: new Set(),
      trail: 0,
      spin: Math.random() * 6,
      puffed: false,
    })
    this.host.sound?.('star', 0.7, (Math.random() - 0.5) * 0.2)
  }

  /** Puff a cotton-candy cloud where a droplet landed (mini: the small one a 통통 솜사탕 star leaves). */
  cloud(at: Vector3, amount: number, mini = false): void {
    if (this.clouds.length >= this.maxClouds) this.clouds.shift()
    const frost = this.combos.has('frostcloud')
    const blue = frost || Math.random() < 0.4
    const r = JUICE.cloudRadius * (mini ? 0.6 : 1)
    this.clouds.push({ x: at.x, y: Math.max(0.6, Math.min(1.4, at.y)), z: at.z, age: 0, tick: JUICE.cloudTick * 0.5, amount, blue, seed: Math.random() * 10, r, frost })
    this.host.vfx.burst(at, frost ? 0xe6f8ff : blue ? 0xbfe6ff : 0xffbfe2, { count: this.host.lowPower ? 6 : mini ? 8 : 12, speed: 2.2, up: 1.2, life: 0.5, size: mini ? 0.2 : 0.3, grow: 1.2, gravity: -0.5, drag: 3 })
    this.host.sound?.('puff', 0.8, (Math.random() - 0.5) * 0.15)
  }

  update(dt: number, world: JuiceWorld): void {
    const bodies = world.bodies ? world.bodies() : []
    this.stepStars(dt, world, bodies)
    this.stepClouds(dt, bodies)
    this.draw()
  }

  private stepStars(dt: number, world: JuiceWorld, bodies: SkillBody[]): void {
    for (let i = this.stars.length - 1; i >= 0; i -= 1) {
      const s = this.stars[i]
      s.age += dt
      s.spin += dt * 14
      if (s.age > JUICE.starLife || s.bounces < 0) {
        this.host.vfx.burst(s.p, 0xfff2a0, { count: 5, speed: 1.6, up: 0.6, life: 0.3, size: 0.1, shape: 1, additive: true })
        this.stars.splice(i, 1)
        continue
      }
      const speed = s.v.length()
      let step = speed * dt
      const dir = this.d.copy(s.v).divideScalar(speed || 1)
      // Foes first: a star passing through a foe hits it and hops to the next one.
      const hl = Math.hypot(dir.x, dir.z) || 1
      let hitBody: SkillBody | null = null
      let hitT = step
      for (const b of bodies) {
        if (s.hit.has(b.id)) continue
        const t = segmentBody(s.p.x, s.p.y, s.p.z, dir.x / hl, dir.z / hl, step * hl, b)
        if (t >= 0 && t / hl < hitT) {
          hitT = t / hl
          hitBody = b
        }
      }
      const wall = world.solid(s.p.x, s.p.y, s.p.z, dir.x, dir.y, dir.z, step)
      if (hitBody && hitT <= wall) {
        s.p.addScaledVector(dir, hitT)
        s.hit.add(hitBody.id)
        const amount = Math.max(1, Math.round(s.amount))
        hitBody.hit(amount, dir.x / hl, dir.z / hl, 0.4, 0)
        this.starHits += 1
        this.host.number(amount, this.q.set(hitBody.x, 1.3, hitBody.z), 'star')
        this.starCombos(s, hitBody, amount, bodies)
        this.host.vfx.burst(s.p, (this.combos.has('piercestar') ? PIERCE_TINTS : STAR_TINTS)[this.starHits % 3], { count: this.host.lowPower ? 6 : 12, speed: 4, up: 1.6, life: 0.35, size: 0.14, shape: 1, gravity: 3, drag: 2, additive: true })
        this.host.sound?.('boing', 0.8, 0.15 + (JUICE.starBounces - s.bounces) * 0.08)
        s.bounces -= 1
        const next = seekNext(bodies, s.p.x, s.p.z, s.hit, JUICE.starSeek)
        if (next) {
          this.q.set(next.x - s.p.x, 1.1 - s.p.y, next.z - s.p.z).normalize()
          s.v.copy(this.q).multiplyScalar(speed)
        } else {
          // No one left to hop to: pop off sideways.
          s.v.set(-s.v.z + (Math.random() - 0.5) * 6, 3, s.v.x + (Math.random() - 0.5) * 6).normalize().multiplyScalar(speed)
        }
        step = 0
      } else if (wall < step) {
        s.p.addScaledVector(dir, Math.max(0, wall - 0.02))
        const n = s.p.y < 0.15 ? { x: 0, y: 1, z: 0 } : world.normal(s.p, dir)
        const r = reflect(s.v, n)
        s.v.set(r.x, r.y, r.z)
        s.bounces -= 1
        this.host.vfx.burst(s.p, 0xfff2a0, { count: this.host.lowPower ? 4 : 8, speed: 3, up: 1, life: 0.28, size: 0.1, shape: 1, gravity: 2, drag: 2, additive: true })
        this.host.sound?.('boing', 0.45, 0.4)
        step = 0
      } else s.p.addScaledVector(dir, step)
      // Float back to chest height so they keep finding foes rather than skipping on the floor.
      s.v.y += (1.05 - s.p.y) * dt * 6
      s.trail -= dt
      if (s.trail <= 0) {
        s.trail = this.host.lowPower ? 0.06 : 0.03
        this.host.vfx.burst(s.p, STAR_TINTS[i % 3], { count: 1, speed: 0.3, up: 0.2, life: 0.35, size: 0.12, shape: 1, gravity: 0, drag: 4, additive: true })
      }
    }
  }

  /** 통통 솜사탕 · 별빛 폭죽: what a star does on a foe besides its own hit. */
  private starCombos(s: Star, hit: SkillBody, amount: number, bodies: SkillBody[]): void {
    if (this.combos.has('fluffstar') && !s.puffed) {
      s.puffed = true
      this.comboHits += 1
      this.cloud(this.q.set(hit.x, 1, hit.z), amount * COMBO.fluffShare, true)
    }
    if (this.combos.has('sparkstar')) {
      const pop = Math.max(1, Math.round(amount * COMBO.sparkShare))
      let any = false
      for (const b of inCloud(bodies, hit.x, hit.z, COMBO.sparkRadius)) {
        if (b.id === hit.id) continue
        b.hit(pop, 0, 0, 0.2, 0)
        this.host.number(pop, this.q.set(b.x, 1.4, b.z), 'star')
        any = true
      }
      if (any) this.comboHits += 1
      this.host.vfx.burst(this.q.set(hit.x, 1.1, hit.z), 0xffe27a, { count: this.host.lowPower ? 8 : 18, speed: 5.5, up: 0.8, life: 0.3, size: 0.12, shape: 1, gravity: 1, drag: 3, additive: true })
    }
  }

  private stepClouds(dt: number, bodies: SkillBody[]): void {
    for (let i = this.clouds.length - 1; i >= 0; i -= 1) {
      const c = this.clouds[i]
      c.age += dt
      if (c.age > JUICE.cloudLife) {
        this.clouds.splice(i, 1)
        continue
      }
      c.tick -= dt
      if (c.tick > 0) continue
      c.tick += JUICE.cloudTick
      const amount = Math.max(1, Math.round(c.amount * JUICE.cloudShare))
      let dealt = 0
      for (const b of inCloud(bodies, c.x, c.z, c.r)) {
        b.hit(amount, 0, 0, 0, c.frost ? COMBO.frostSlow : 0.3)
        this.cloudHits += 1
        dealt += amount
        this.host.number(amount, this.q.set(b.x, 1.2, b.z), 'candy')
        this.host.vfx.burst(this.q, c.frost ? 0xeaf8ff : c.blue ? 0xbfe6ff : 0xffb6dc, { count: c.frost ? 3 : 2, speed: 0.6, up: 0.6, life: 0.4, size: 0.16, gravity: c.frost ? 1.5 : -0.4, drag: 2 })
      }
      // 달콤 구름: a sip of the tickle back, with a little pink heart puff over the cloud.
      if (dealt > 0 && this.combos.has('sweetcloud')) {
        this.comboHits += 1
        this.host.heal?.(Math.max(1, Math.round(dealt * COMBO.sweetShare)))
        this.host.vfx.burst(this.q.set(c.x, c.y + 0.7, c.z), 0xff7fb5, { count: 3, speed: 0.8, up: 1.6, life: 0.5, size: 0.14, shape: 1, gravity: -1, drag: 2, additive: true })
      }
    }
  }

  private draw(): void {
    let n = 0
    for (let i = 0; i < this.stars.length; i += 1) {
      const s = this.stars[i]
      this.e.position.copy(s.p)
      this.e.rotation.set(s.spin * 0.6, s.spin, 0)
      this.e.scale.setScalar(1 + Math.sin(s.age * 30) * 0.15)
      this.e.updateMatrix()
      this.starMesh.setMatrixAt(n, this.e.matrix)
      this.starMesh.setColorAt(n, this.c.set((this.combos.has('piercestar') ? PIERCE_TINTS : STAR_TINTS)[i % 3]))
      n += 1
    }
    this.starMesh.count = n
    this.starMesh.instanceMatrix.needsUpdate = true
    if (this.starMesh.instanceColor) this.starMesh.instanceColor.needsUpdate = true
    let k = 0
    for (const c of this.clouds) {
      // Swell in, breathe, shrink away.
      const grow = Math.min(1, c.age / 0.18)
      const fade = Math.min(1, (JUICE.cloudLife - c.age) / 0.45)
      const size = grow * fade
      for (let p = 0; p < PUFFS; p += 1) {
        const a = (p / PUFFS) * Math.PI * 2 + c.seed
        const ring = p === 0 ? 0 : c.r * 0.55
        const breathe = 1 + Math.sin(c.age * 5 + p * 1.7) * 0.08
        this.e.position.set(c.x + Math.cos(a) * ring * size, c.y + (p === 0 ? 0.25 : Math.sin(a * 2) * 0.15), c.z + Math.sin(a) * ring * size)
        this.e.rotation.set(0, a, 0)
        this.e.scale.setScalar((p === 0 ? 1.5 : 1.05) * size * breathe * (c.r / JUICE.cloudRadius))
        this.e.updateMatrix()
        this.cloudMesh.setMatrixAt(k, this.e.matrix)
        const pink = c.blue ? p % 3 === 0 : p % 3 !== 0
        this.cloudMesh.setColorAt(k, this.c.set(c.frost ? (p % 2 ? 0xe8f8ff : 0x9fdcff) : pink ? 0xffa8d8 : 0xa8dcff))
        k += 1
      }
    }
    this.cloudMesh.count = k
    this.cloudMesh.instanceMatrix.needsUpdate = true
    if (this.cloudMesh.instanceColor) this.cloudMesh.instanceColor.needsUpdate = true
  }

  reset(): void {
    this.stars.length = 0
    this.clouds.length = 0
    this.draw()
  }

  dispose(): void {
    for (const im of [this.starMesh, this.cloudMesh]) {
      im.geometry.dispose()
      ;(im.material as MeshBasicMaterial).dispose()
      im.dispose()
    }
    this.group.removeFromParent()
  }
}
