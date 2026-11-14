/**
 * The boss of the dream sewer: a great nightmare bloom rooted in the moonlit chamber. Wakes when
 * she steps into the chamber, creeps after her, fires rings of slow dream orbs she can weave
 * through, and calls the horde at two-thirds and one-third health. Pure simulation.
 */
import { DIFFICULTY } from '../../combat/difficulty'
import type { Maze, Rect } from './maze'
import { TILE, tileCentre } from './maze'
import { collideCircle, solidAt } from './walls'
import { rayCapsule, type AimTarget } from '../../core/tps'

export const BOSS = {
  hp: Math.round(1400 * DIFFICULTY.boss.hp),
  radius: 1.25,
  /** Shot height of the body centre (m). */
  chest: 1.7,
  speed: 0.85,
  contact: Math.round(12 * DIFFICULTY.boss.damage),
  orbDamage: Math.round(8 * DIFFICULTY.boss.damage),
  orbSpeed: 5.2 * DIFFICULTY.boss.orbSpeed,
  orbRadius: 0.32,
  ringEvery: 3.1,
  ringCount: Math.round(14 * DIFFICULTY.boss.ringCount),
  windup: 0.7,
  /** She stops this far from her (m) and fights at range, so she never fills the camera (fix/boss-floor). */
  keep: 4.4,
}

export interface Orb {
  x: number
  y: number
  z: number
  vx: number
  vz: number
  life: number
}

export type BossEvent = 'wake' | 'ring' | 'summon' | 'down' | 'phase2' | 'phase3'

/** 꿈 하수도의 악몽 꽃, 또는 달빛 둥지의 밤나방 (패턴만 다르고 체력 배율은 호출자가 정한다). */
export type BossStyle = 'bloom' | 'moth'

/** Depth scaling for one boss (1 = the depth-1 bloom). */
export interface BossScale {
  hp: number
  damage: number
}

export class Boss {
  x: number
  z: number
  /** Full health for this depth. */
  readonly maxHp: number
  hp: number
  private readonly dmg: number
  awake = false
  /** >0 while bursting apart after the last hit. */
  dying = 0
  hurt = 0
  /** 0..1 wind-up before a ring, 0 otherwise. */
  windup = 0
  yaw = 0
  readonly orbs: Orb[] = []
  private ringClock = 2
  /** Woken by a hit (not by walking in): `update` still reports 'wake' once. */
  private woken = false
  private contactCd = 0
  private summoned = 0
  private spin = 0
  /** Aim locked when a wind-up starts (the moth's safe lane / fan). */
  private aim = 0
  private phaseTold = 1
  private readonly maze: Maze
  private readonly room: Rect
  readonly style: BossStyle

  constructor(maze: Maze, scale: BossScale = { hp: 1, damage: 1 }, style: BossStyle = 'bloom') {
    this.maze = maze
    this.maxHp = Math.round(BOSS.hp * scale.hp)
    this.hp = this.maxHp
    this.dmg = scale.damage
    this.style = style
    this.room = maze.bossRoom
    const c = tileCentre(maze, this.room.x + Math.floor(this.room.w / 2), this.room.y + Math.floor(this.room.h / 2))
    this.x = c.x
    this.z = c.z - TILE * 0.6
  }

  get alive(): boolean {
    return this.hp > 0
  }

  /** Is (x, z) inside the chamber? */
  inRoom(x: number, z: number): boolean {
    const r = this.room
    const a = tileCentre(this.maze, r.x, r.y)
    const h = TILE / 2
    return x > a.x - h && x < a.x - h + r.w * TILE && z > a.z - h && z < a.z - h + r.h * TILE
  }

  /**
   * Advance. `hit` lands damage on her; events tell the run what to show/hear/spawn.
   */
  update(dt: number, hx: number, hz: number, heroAlive: boolean, hit: (amount: number, x: number, z: number) => void): BossEvent[] {
    const ev: BossEvent[] = []
    this.hurt = Math.max(0, this.hurt - dt * 4)
    this.tickOrbs(dt, hx, hz, heroAlive, hit)
    if (this.dying > 0) {
      this.dying += dt
      return ev
    }
    if (this.woken) {
      this.woken = false
      ev.push('wake')
    }
    if (!this.awake) {
      if (this.inRoom(hx, hz)) {
        this.wake()
        ev.push('wake')
      }
      return ev
    }
    const dx = hx - this.x
    const dz = hz - this.z
    const d = Math.hypot(dx, dz)
    this.yaw = Math.atan2(dx, dz)
    if (this.windup <= 0 && d > BOSS.keep && heroAlive) {
      this.x += (dx / d) * BOSS.speed * dt
      this.z += (dz / d) * BOSS.speed * dt
      const out = collideCircle(this.maze, this.x, this.z, BOSS.radius)
      this.x = out.x
      this.z = out.z
    }
    this.contactCd = Math.max(0, this.contactCd - dt)
    if (d < BOSS.radius + 0.6 && this.contactCd <= 0 && heroAlive) {
      this.contactCd = 1.2
      hit(Math.round(BOSS.contact * this.dmg), this.x, this.z)
    }
    this.ringClock -= dt
    const wind = this.style === 'moth' ? (this.phase() === 3 ? 0.62 : 0.85) : BOSS.windup
    if (this.windup > 0) {
      this.windup += dt / wind
      if (this.windup >= 1) {
        this.windup = 0
        this.ring()
        ev.push('ring')
      }
    } else if (this.ringClock <= 0) {
      this.aim = Math.atan2(hx - this.x, hz - this.z)
      this.windup = 1e-3
      this.ringClock = this.nextRing()
    }
    if (this.style === 'moth') {
      const ph = this.phase()
      if (ph !== this.phaseTold) {
        this.phaseTold = ph
        ev.push(ph === 2 ? 'phase2' : 'phase3')
      }
    }
    const third = this.hp / this.maxHp
    if ((this.summoned === 0 && third < 2 / 3) || (this.summoned === 1 && third < 1 / 3)) {
      this.summoned += 1
      ev.push('summon')
    }
    return ev
  }

  /** Hurt; returns true on the killing blow. */
  damage(amount: number): boolean {
    if (!this.alive) return false
    // A hit from the doorway counts (fix/skill-hit-proof): it used to vanish (0) until she walked in.
    if (!this.awake) {
      this.wake()
      this.woken = true
    }
    this.hp = Math.max(0, this.hp - amount)
    this.hurt = 1
    if (this.hp > 0) return false
    this.dying = 1e-4
    this.orbs.length = 0
    return true
  }

  private wake(): void {
    this.awake = true
    this.ringClock = 1.6
  }

  /** Ray (unit direction) against the body sphere; distance or -1. */
  /** Upright body shared by the crosshair and the droplets. */
  capsule(): AimTarget {
    return { x: this.x, z: this.z, y0: BOSS.chest - BOSS.radius, y1: BOSS.chest + BOSS.radius, r: BOSS.radius }
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    if (!this.alive) return -1
    return rayCapsule(ox, oy, oz, dx, dy, dz, this.capsule(), max)
  }

  /** 1 above 2/3, 2 until 1/3, then 3. Bloom ignores this. */
  phase(): 1 | 2 | 3 {
    const t = this.hp / this.maxHp
    if (t > 2 / 3) return 1
    if (t > 1 / 3) return 2
    return 3
  }

  private nextRing(): number {
    if (this.style !== 'moth') return BOSS.ringEvery * (this.hp < this.maxHp / 2 ? 0.72 : 1)
    const ph = this.phase()
    return BOSS.ringEvery * (ph === 1 ? 1.05 : ph === 2 ? 0.9 : 0.78)
  }

  private ring(): void {
    this.spin += 0.37
    if (this.style === 'moth') {
      this.mothRing()
      return
    }
    const n = BOSS.ringCount + (this.hp < this.maxHp / 2 ? 4 : 0)
    for (let i = 0; i < n; i += 1) {
      const a = this.spin + (i / n) * Math.PI * 2
      this.orbs.push({ x: this.x + Math.sin(a) * 1.1, y: 1.0, z: this.z + Math.cos(a) * 1.1, vx: Math.sin(a) * BOSS.orbSpeed, vz: Math.cos(a) * BOSS.orbSpeed, life: 4 })
    }
  }

  /**
   * 밤나방. 1단계: 플레이어 쪽에 빈 부채꼴(그 자리에 서면 안 맞음).
   * 2단계: 빈칸이 돌아가고 탄이 소용돌이친다.
   * 3단계: 빈칸은 등 뒤, 조준해 둔 방향으로 느린 부채 탄 (옆으로 빠지면 된다).
   */
  private mothRing(): void {
    const ph = this.phase()
    const gap = ph === 3 ? 0.7 : 1.15
    const hole = ph === 1 ? this.aim : ph === 2 ? this.spin : this.aim + Math.PI
    const n = Math.max(8, BOSS.ringCount - (ph === 1 ? 2 : 0))
    const span = Math.PI * 2 - gap
    const speed = BOSS.orbSpeed * (ph === 2 ? 0.92 : 0.85)
    for (let i = 0; i < n; i += 1) {
      const a = hole + gap / 2 + (i / n) * span
      const tang = ph === 2 ? 1.8 : 0
      this.orbs.push({
        x: this.x + Math.sin(a) * 1.15,
        y: 1.05,
        z: this.z + Math.cos(a) * 1.15,
        vx: Math.sin(a) * speed + Math.cos(a) * tang,
        vz: Math.cos(a) * speed - Math.sin(a) * tang,
        life: 4.2,
      })
    }
    if (ph !== 3) return
    const fan = 5
    const spread = 0.42
    for (let i = 0; i < fan; i += 1) {
      const a = this.aim + (i - (fan - 1) / 2) * (spread / (fan - 1))
      const sp = BOSS.orbSpeed * 0.72
      this.orbs.push({ x: this.x + Math.sin(a) * 1.3, y: 1.15, z: this.z + Math.cos(a) * 1.3, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, life: 3.6 })
    }
  }

  private tickOrbs(dt: number, hx: number, hz: number, heroAlive: boolean, hit: (amount: number, x: number, z: number) => void): void {
    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const o = this.orbs[i]
      o.x += o.vx * dt
      o.z += o.vz * dt
      o.life -= dt
      let gone = o.life <= 0 || solidAt(this.maze, o.x, o.z)
      if (!gone && heroAlive && Math.hypot(o.x - hx, o.z - hz) < BOSS.orbRadius + 0.36) {
        hit(Math.round(BOSS.orbDamage * this.dmg), o.x - o.vx * 0.1, o.z - o.vz * 0.1)
        gone = true
      }
      if (gone) this.orbs.splice(i, 1)
    }
  }
}
