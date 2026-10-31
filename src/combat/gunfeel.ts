/**
 * The "두두두두" full-auto water gun: fire cadence, crosshair bloom and spread, a soft heat
 * gauge, crits, and how long the world freezes on a meaty hit. No Three.js, so it tests fast.
 */
import { CEILING, TILE, Tile, type Maze } from '../world/dungeon/maze'

export const GUN = {
  /** Seconds between shots (~15 per second). */
  gap: 0.066,
  /** Bloom 0..1: each shot adds, it bleeds off once the trigger rests. */
  bloomPerShot: 0.085,
  bloomHold: 0.07,
  bloomDecay: 2.8,
  /** Cone half-angle (rad) at no bloom and full bloom. */
  spreadMin: 0.0035,
  spreadMax: 0.03,
  /** Camera kick per shot (rad up, ± rad sideways). */
  kickUp: 0.0062,
  kickSide: 0.0042,
  /** Heat 0..1: full auto for ~6 s before the tank boils over. */
  heatPerShot: 0.011,
  coolDelay: 0.22,
  coolRate: 0.55,
  /** Overheated: locked until heat falls back to this, cooling faster. */
  resumeAt: 0.3,
  ventRate: 0.85,
  damage: 9,
  critChance: 0.12,
  critMul: 1.8,
  /** Crosshair tick gap in px at no bloom; full bloom adds spreadPx. */
  gapPx: 7,
  spreadPx: 15,
} as const

/** The cadence part of a gun base (data/guns.ts GunProfile fits it). */
export interface GunFeel {
  gap: number
  burst: number
  burstRest: number
  bloomPerShot: number
  heatPerShot: number
  spreadMin: number
  spreadMax: number
}

const WATER_FEEL: GunFeel = {
  gap: GUN.gap,
  burst: 0,
  burstRest: 0,
  bloomPerShot: GUN.bloomPerShot,
  heatPerShot: GUN.heatPerShot,
  spreadMin: GUN.spreadMin,
  spreadMax: GUN.spreadMax,
}

/** Overdrive (과열 폭주): cadence ×1.6 and no heat while it lasts. */
export const OVERDRIVE_RATE = 1.6

export class Gun {
  cooldown = 0
  bloom = 0
  heat = 0
  overheated = false
  shots = 0
  /** Base cadence/bloom/heat (the equipped gun). */
  feel: GunFeel = WATER_FEEL
  /** Fire-rate multiplier from level, gear and passives. */
  rate = 1
  /** Seconds of overdrive left (skill). */
  overdrive = 0
  private rest = 1
  private burstLeft = 0

  /** Swap the gun base (keeps heat; a fresh burst). */
  setFeel(feel: GunFeel, rate = 1): void {
    this.feel = feel
    this.rate = Math.max(0.25, rate)
    this.burstLeft = 0
  }

  /**
   * Advance by dt with the trigger held or not; returns how many shots leave the barrel this
   * frame (0, 1 or 2 on a long frame, so cadence holds at low fps). Burst guns fire `burst`
   * shots `gap` apart, then rest `burstRest`.
   */
  update(dt: number, trigger: boolean): number {
    const f = this.feel
    this.cooldown -= dt
    this.rest += dt
    if (this.overdrive > 0) this.overdrive = Math.max(0, this.overdrive - dt)
    const rate = this.rate * (this.overdrive > 0 ? OVERDRIVE_RATE : 1)
    const heatPer = this.overdrive > 0 ? 0 : f.heatPerShot
    let fired = 0
    if (trigger && !this.overheated) {
      while (this.cooldown <= 0 && fired < 2) {
        fired += 1
        this.shots += 1
        if (f.burst > 0) {
          if (this.burstLeft <= 0) this.burstLeft = f.burst
          this.burstLeft -= 1
          this.cooldown += this.burstLeft > 0 ? f.gap / rate : (f.gap + f.burstRest) / rate
        } else this.cooldown += f.gap / rate
        this.bloom = Math.min(1, this.bloom + f.bloomPerShot)
        this.heat = Math.min(1, this.heat + heatPer)
        this.rest = 0
        if (this.heat >= 1) {
          this.overheated = true
          break
        }
      }
    } else if (!trigger && f.burst > 0 && this.burstLeft > 0 && this.rest > f.gap * 2) {
      // Let go mid-burst: the next pull starts a fresh burst after the rest.
      this.burstLeft = 0
    }
    if (this.cooldown < 0) this.cooldown = 0
    if (this.rest > GUN.bloomHold) this.bloom = Math.max(0, this.bloom - dt * GUN.bloomDecay)
    if (this.overheated) {
      this.heat = Math.max(0, this.heat - dt * GUN.ventRate)
      if (this.heat <= GUN.resumeAt) this.overheated = false
    } else if (this.rest > GUN.coolDelay) this.heat = Math.max(0, this.heat - dt * GUN.coolRate)
    return fired
  }

  /** Current cone half-angle in radians. */
  get spread(): number {
    const f = this.feel
    return f.spreadMin + (f.spreadMax - f.spreadMin) * this.bloom * this.bloom
  }

  /** Crosshair tick gap in px. */
  get gapPx(): number {
    return GUN.gapPx + GUN.spreadPx * this.bloom + (this.feel.spreadMin > 0.02 ? 10 : 0)
  }
}

/** Damage for one droplet: a few crits so the numbers dance. */
export function rollDamage(r: number, damage: number = GUN.damage, critChance: number = GUN.critChance, critMul: number = GUN.critMul): { amount: number; crit: boolean } {
  const crit = r < critChance
  return { amount: Math.max(1, Math.round(damage * (crit ? critMul : 1))), crit }
}

/** World freeze (seconds) for a hit: only elites, kills of elites and the boss get weight. */
export function hitStopFor(hit: { elite?: boolean; kill?: boolean; boss?: boolean; crit?: boolean }): number {
  if (hit.boss) return hit.kill ? 0.16 : hit.crit ? 0.018 : 0
  if (hit.elite) return hit.kill ? 0.075 : hit.crit ? 0.03 : 0.012
  return 0
}

/**
 * Jitter a unit direction inside a cone of half-angle `angle`. r1, r2 in [0, 1) pick the point
 * (sqrt keeps the pattern even rather than piling in the centre).
 */
export function spreadDir(dx: number, dy: number, dz: number, angle: number, r1: number, r2: number): { x: number; y: number; z: number } {
  // Any two axes perpendicular to d.
  const ax = Math.abs(dy) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  let ux = dy * ax.z - dz * ax.y
  let uy = dz * ax.x - dx * ax.z
  let uz = dx * ax.y - dy * ax.x
  const ul = Math.hypot(ux, uy, uz) || 1
  ux /= ul
  uy /= ul
  uz /= ul
  const vx = dy * uz - dz * uy
  const vy = dz * ux - dx * uz
  const vz = dx * uy - dy * ux
  const a = Math.sqrt(r1) * Math.tan(angle)
  const t = r2 * Math.PI * 2
  const ox = dx + (ux * Math.cos(t) + vx * Math.sin(t)) * a
  const oy = dy + (uy * Math.cos(t) + vy * Math.sin(t)) * a
  const oz = dz + (uz * Math.cos(t) + vz * Math.sin(t)) * a
  const l = Math.hypot(ox, oy, oz) || 1
  return { x: ox / l, y: oy / l, z: oz / l }
}

/** Surface normal where a ray (horizontal direction dx, dz) met the maze at p: floor, ceiling or a tile face. */
export function hitNormal(maze: Maze, px: number, py: number, pz: number, dx: number, dz: number): { x: number; y: number; z: number } {
  if (py <= 0.04) return { x: 0, y: 1, z: 0 }
  if (py >= CEILING - 0.04) return { x: 0, y: -1, z: 0 }
  const tileOf = (x: number, z: number) => ({ x: Math.floor(x / TILE + maze.w / 2), y: Math.floor(z / TILE + maze.h / 2) })
  const a = tileOf(px - dx * 0.05, pz - dz * 0.05)
  const b = tileOf(px + dx * 0.05, pz + dz * 0.05)
  const solid = (t: { x: number; y: number }) => t.x < 0 || t.y < 0 || t.x >= maze.w || t.y >= maze.h || maze.tiles[t.y * maze.w + t.x] === Tile.Solid
  if (a.x !== b.x && (a.y === b.y || solid({ x: b.x, y: a.y }))) return { x: -Math.sign(dx), y: 0, z: 0 }
  if (a.y !== b.y) return { x: 0, y: 0, z: -Math.sign(dz) }
  // Grazing hit inside one tile: fall back to the bigger horizontal component.
  return Math.abs(dx) > Math.abs(dz) ? { x: -Math.sign(dx), y: 0, z: 0 } : { x: 0, y: 0, z: -Math.sign(dz) }
}
