/**
 * Wave director: escalating waves pouring out of the nest pipes nearest her, elites from the
 * second wave on, and a pause once she reaches the boss chamber. Pure; the run feeds it her
 * BFS distances and turns its spawn orders into foes.
 */
import { DIFFICULTY, waveSize } from '../difficulty'
import type { HordeKind } from './horde'

export interface Wave {
  n: number
  total: number
  elites: number
  kinds: HordeKind[]
  /** Elite-only champions (lucky-defense lord, the hero-defense lich) that lead this wave. */
  champions: HordeKind[]
}

/** Which kinds join at which wave: the old dream pests first, then the reused rosters. */
export const UNLOCKS: [number, HordeKind][] = [
  [1, 'slime'],
  [2, 'bug'],
  [2, 'jelly'],
  [3, 'rabbit'],
  [3, 'skeleton'],
  [3, 'goblin'],
  [4, 'bat'],
  [4, 'wolf'],
  [4, 'skel_rogue'],
  [5, 'knight'],
  [5, 'skel_warrior'],
  [5, 'wraith'],
  [6, 'golem'],
  [6, 'skel_mage'],
  [6, 'drake'],
]

/** Wave n (1-based): bigger, faster to pour, more kinds and more elites. */
export function waveFor(n: number): Wave {
  const kinds = UNLOCKS.filter(([w]) => n >= w).map(([, k]) => k)
  const champions: HordeKind[] = []
  if (n >= 3) champions.push('lord')
  if (n >= 5) champions.push('lich')
  const elites = n < DIFFICULTY.waves.firstElite ? 0 : Math.max(champions.length, Math.min(6, Math.floor((n - 1) / 2)))
  return { n, total: waveSize(n), elites, kinds, champions }
}

export interface SpawnOrder {
  kind: HordeKind
  elite: boolean
  /** Index into the nest list, or DRAIN: bubble up from a floor drain a few tiles from her. */
  nest: number
}

/** Pseudo-nest: a floor drain 5–8 tiles away (keeps pressure on when the pipes are far). */
export const DRAIN = -1
/** Pipes farther than this (tiles) are too far to matter; drains take over. */
export const NEST_REACH = 14

export interface DirectorView {
  /** BFS tile distance from her to each nest (-1 unreachable). */
  nestDistance: number[]
  /** Foes still standing. */
  alive: number
  /** She stands in the boss chamber: the pipes go quiet. */
  inBoss: boolean
}

export const REST = DIFFICULTY.waves.rest
const POUR_RATE = DIFFICULTY.waves.pour // foes per second across all pipes
const WAVE_MAX_TIME = 28
/** Live cap; the view holds a few more for the dying. */
export const LIVE_CAP = DIFFICULTY.waves.liveCap

export class Director {
  wave = 0
  /** Seconds until the next wave begins (during rest). */
  rest = 2.5
  private left = 0
  private elitesLeft = 0
  private pour = 0
  private clock = 0
  private current: Wave | null = null
  private serial = 0

  get active(): Wave | null {
    return this.current
  }

  /** Orders for this frame. */
  update(dt: number, v: DirectorView): SpawnOrder[] {
    const out: SpawnOrder[] = []
    if (v.inBoss) return out
    if (!this.current) {
      this.rest -= dt
      if (this.rest > 0) return out
      this.begin()
    }
    const w = this.current
    if (!w) return out
    this.clock += dt
    if (this.left > 0) {
      this.pour += dt * POUR_RATE * (1 + w.n * DIFFICULTY.waves.rampPerWave)
      const nests = this.pick(v.nestDistance)
      while (this.pour >= 1 && this.left > 0 && v.alive + out.length < LIVE_CAP && nests.length) {
        this.pour -= 1
        this.serial += 1
        // Elites spread evenly through the wave, never in the first handful.
        const spacing = Math.max(2, Math.floor(w.total / (w.elites + 1)))
        const spawned = w.total - this.left + 1
        const elite = this.elitesLeft > 0 && spawned % spacing === 0
        let kind = w.kinds[this.serial % w.kinds.length]
        if (elite) {
          // Champions lead the elite line-up: the first elites of the wave are them.
          const c = w.elites - this.elitesLeft
          if (c < w.champions.length) kind = w.champions[c]
          this.elitesLeft -= 1
        }
        out.push({ kind, elite, nest: nests[this.serial % nests.length] })
        this.left -= 1
      }
      if (v.alive + out.length >= LIVE_CAP) this.pour = Math.min(this.pour, 1)
    } else if (v.alive <= Math.max(3, Math.floor(w.total * 0.15)) || this.clock > WAVE_MAX_TIME) {
      this.current = null
      this.rest = REST
    }
    return out
  }

  /** Start the next wave now (tests, QA stress). */
  begin(): Wave {
    this.wave += 1
    this.current = waveFor(this.wave)
    this.left = this.current.total
    this.elitesLeft = this.current.elites
    this.pour = 0
    this.clock = 0
    return this.current
  }

  /** Up to three nest pipes in reach (not right on top of her), plus the floor drains. */
  private pick(dist: number[]): number[] {
    const ok = dist
      .map((d, i) => ({ d, i }))
      .filter((n) => n.d >= 3 && n.d <= NEST_REACH)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((n) => n.i)
    return [...ok, DRAIN]
  }
}
