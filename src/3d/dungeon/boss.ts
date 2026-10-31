/**
 * The boss of the dream sewer: a great nightmare bloom rooted in the moonlit chamber. Wakes when
 * she steps into the chamber, creeps after her, fires rings of slow dream orbs she can weave
 * through, and calls the horde at two-thirds and one-third health. Pure simulation.
 */
import { DIFFICULTY } from '../difficulty'
import type { Maze, Rect } from './maze'
import { TILE, tileCentre } from './maze'
import { collideCircle, solidAt } from './walls'
import { rayCapsule, type AimTarget } from '../tps'

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
}

export interface Orb {
  x: number
  y: number
  z: number
  vx: number
  vz: number
  life: number
}

export type BossEvent = 'wake' | 'ring' | 'summon' | 'down'

export class Boss {
  x: number
  z: number
  hp = BOSS.hp
  awake = false
  /** >0 while bursting apart after the last hit. */
  dying = 0
  hurt = 0
  /** 0..1 wind-up before a ring, 0 otherwise. */
  windup = 0
  yaw = 0
  readonly orbs: Orb[] = []
  private ringClock = 2
  private contactCd = 0
  private summoned = 0
  private spin = 0
  private readonly maze: Maze
  private readonly room: Rect

  constructor(maze: Maze) {
    this.maze = maze
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
    if (!this.awake) {
      if (this.inRoom(hx, hz)) {
        this.awake = true
        this.ringClock = 1.6
        ev.push('wake')
      }
      return ev
    }
    const dx = hx - this.x
    const dz = hz - this.z
    const d = Math.hypot(dx, dz)
    this.yaw = Math.atan2(dx, dz)
    if (this.windup <= 0 && d > BOSS.radius + 1.2 && heroAlive) {
      this.x += (dx / d) * BOSS.speed * dt
      this.z += (dz / d) * BOSS.speed * dt
      const out = collideCircle(this.maze, this.x, this.z, BOSS.radius)
      this.x = out.x
      this.z = out.z
    }
    this.contactCd = Math.max(0, this.contactCd - dt)
    if (d < BOSS.radius + 0.6 && this.contactCd <= 0 && heroAlive) {
      this.contactCd = 1.2
      hit(BOSS.contact, this.x, this.z)
    }
    this.ringClock -= dt
    if (this.windup > 0) {
      this.windup += dt / BOSS.windup
      if (this.windup >= 1) {
        this.windup = 0
        this.ring()
        ev.push('ring')
      }
    } else if (this.ringClock <= 0) {
      this.windup = 1e-3
      this.ringClock = BOSS.ringEvery * (this.hp < BOSS.hp / 2 ? 0.72 : 1)
    }
    const third = this.hp / BOSS.hp
    if ((this.summoned === 0 && third < 2 / 3) || (this.summoned === 1 && third < 1 / 3)) {
      this.summoned += 1
      ev.push('summon')
    }
    return ev
  }

  /** Hurt; returns true on the killing blow. */
  damage(amount: number): boolean {
    if (!this.alive || !this.awake) return false
    this.hp = Math.max(0, this.hp - amount)
    this.hurt = 1
    if (this.hp > 0) return false
    this.dying = 1e-4
    this.orbs.length = 0
    return true
  }

  /** Ray (unit direction) against the body sphere; distance or -1. */
  /** Upright body shared by the crosshair and the droplets. */
  capsule(): AimTarget {
    return { x: this.x, z: this.z, y0: BOSS.chest - BOSS.radius, y1: BOSS.chest + BOSS.radius, r: BOSS.radius }
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    if (!this.alive || !this.awake) return -1
    return rayCapsule(ox, oy, oz, dx, dy, dz, this.capsule(), max)
  }

  private ring(): void {
    this.spin += 0.37
    const n = BOSS.ringCount + (this.hp < BOSS.hp / 2 ? 4 : 0)
    for (let i = 0; i < n; i += 1) {
      const a = this.spin + (i / n) * Math.PI * 2
      this.orbs.push({ x: this.x + Math.sin(a) * 1.1, y: 1.0, z: this.z + Math.cos(a) * 1.1, vx: Math.sin(a) * BOSS.orbSpeed, vz: Math.cos(a) * BOSS.orbSpeed, life: 4 })
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
        hit(BOSS.orbDamage, o.x - o.vx * 0.1, o.z - o.vz * 0.1)
        gone = true
      }
      if (gone) this.orbs.splice(i, 1)
    }
  }
}
