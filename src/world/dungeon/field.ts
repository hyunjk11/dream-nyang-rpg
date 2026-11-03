/**
 * 몽실 들판 (챕터 2): one big open dream field instead of a maze. A few pillar clumps and
 * cloud hedges break the sight lines; packs stand around the field asleep, wake when she comes
 * close, and keep coming back (a new pack walks in whenever the field thins out). Pure, no
 * three.js — run.ts draws it, tests drive it headless.
 */
import { Horde, type HordeFoe, type HordeKind } from './horde'
import { TILE, Tile, distances, rng, tileCentre, type Crossing, type Maze, type Rect } from './maze'

export const FIELD = {
  /** Field size in tiles (odd). */
  size: 35,
  /** Live foes the field keeps topped up to (desktop, mobile). */
  /**
   * Was 18/13, then 12/9 (tankier foes); 2026-11 dense pass: the field is ~12 000 m² and 12 foes read
   * as empty (one foe per ~1 000 m²), so ~2.8× (one per ~370 m², the maze floors sit near 100 m²).
   */
  alive: [34, 26] as const,
  /** Foes per pack. */
  pack: [3, 5] as const,
  /** New packs walk in this far from her (m). */
  near: 15,
  far: 34,
  /** Seconds between top-ups (the respawn trickle: one pack per tick while the field is short). */
  every: 2,
  /** Share of packs led by an elite. */
  eliteShare: 0.12,
  /**
   * Sleeping packs farther than this (m) are recycled into fresh ones nearer her. Was 52; the first
   * fill now spreads over the whole field (the field is ~119 m across), so only the far corners recycle.
   */
  recycle: 96,
  /** Wake range and leash (m). */
  aggro: 14,
  leash: 22,
  leashTime: 6,
  /** Was 5: more packs out, a few more may chase (melee turn-taking: SWING_CAP in horde.ts). */
  chaseCap: 7,
  /** Foe hp on the field, on top of DIFFICULTY.horde.hp × the plan scale. */
  hp: 1.3,
  /** Safe radius round the arrival portal (tiles). */
  safe: 5,
} as const

/** An open field: border walls, pillar clumps and hedges, a start pocket and a boss ring. */
export function fieldMaze(seed: number, size: number = FIELD.size): Maze {
  const rand = rng(seed)
  const w = size % 2 ? size : size + 1
  const h = w
  const tiles = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) tiles[y * w + x] = Tile.Chamber
  const startRoom: Rect = { x: 2, y: Math.floor(h / 2) - 1, w: 3, h: 3 }
  const bossRoom: Rect = { x: w - 10, y: Math.floor(h / 2) - 3, w: 7, h: 7 }
  const near = (x: number, y: number, r: Rect, m: number) => x >= r.x - m && y >= r.y - m && x < r.x + r.w + m && y < r.y + r.h + m
  // The river (2026-11): two tiles wide, winding north-south through the middle, never more than a
  // tile sideways per row (no diagonal leaks). Three crossings: a bridge on her line to the boss ring
  // and one more bridge plus stepping stones north and south, so nobody is ever cut off.
  const phase = rand() * Math.PI * 2
  const riverX = (y: number) => Math.round(w * 0.47 + 2.4 * Math.sin(y * 0.3 + phase))
  const crossings: Crossing[] = []
  const mid = Math.floor(h / 2) - 1
  const rows = [Math.round(h * 0.2), mid, Math.round(h * 0.72)]
  let last = riverX(1)
  const xs: number[] = []
  for (let y = 1; y < h - 1; y += 1) {
    const want = riverX(y)
    const x = last + Math.max(-1, Math.min(1, want - last))
    xs[y] = x
    last = x
    tiles[y * w + x] = Tile.Water
    tiles[y * w + x + 1] = Tile.Water
  }
  rows.forEach((y, k) => {
    // A crossing spans every water tile on its two rows.
    let a = w
    let b = 0
    for (const yy of [y, y + 1]) {
      a = Math.min(a, xs[yy])
      b = Math.max(b, xs[yy] + 1)
    }
    for (const yy of [y, y + 1]) for (let x = a; x <= b; x += 1) tiles[yy * w + x] = Tile.Corridor
    crossings.push({ x: a, y, len: b - a + 1, kind: k === 2 ? 'stones' : 'bridge' })
  })
  const nearRiver = (x: number, y: number) => {
    for (let yy = Math.max(1, y - 1); yy <= Math.min(h - 2, y + 1); yy += 1) if (xs[yy] !== undefined && x >= xs[yy] - 1 && x <= xs[yy] + 2) return true
    return crossings.some((c) => x >= c.x - 3 && x < c.x + c.len + 3 && y >= c.y - 2 && y <= c.y + 3)
  }
  // Pillar clumps (2×2 / 1×3) and a few short hedges: cover, never walls of a maze.
  // Tree groves since 2026-11 (drawn as round toon trees): keep trying until ~15 stand.
  const clumps = Math.round((w * h) / 80)
  let placed = 0
  for (let k = 0; k < clumps * 8 && placed < clumps; k += 1) {
    const x = 3 + Math.floor(rand() * (w - 6))
    const y = 3 + Math.floor(rand() * (h - 6))
    const long = rand() < 0.35
    const cw = long ? (rand() < 0.5 ? 3 : 1) : 2
    const ch = long ? (cw === 3 ? 1 : 3) : 2
    let ok = true
    for (let yy = y - 1; yy < y + ch + 1 && ok; yy += 1) for (let xx = x - 1; xx < x + cw + 1; xx += 1) if (near(xx, yy, startRoom, FIELD.safe - 2) || near(xx, yy, bossRoom, 1) || tiles[yy * w + xx] !== Tile.Chamber || nearRiver(xx, yy)) ok = false
    if (!ok) continue
    for (let yy = y; yy < y + ch; yy += 1) for (let xx = x; xx < x + cw; xx += 1) tiles[yy * w + xx] = Tile.Solid
    placed += 1
  }
  for (let y = startRoom.y; y < startRoom.y + startRoom.h; y += 1) for (let x = startRoom.x; x < startRoom.x + startRoom.w; x += 1) tiles[y * w + x] = Tile.Start
  for (let y = bossRoom.y; y < bossRoom.y + bossRoom.h; y += 1) for (let x = bossRoom.x; x < bossRoom.x + bossRoom.w; x += 1) tiles[y * w + x] = Tile.Boss
  // Any open pocket the trees and the river sealed off becomes grove (nothing spawns or gets stuck there).
  const start = { x: startRoom.x + 1, y: startRoom.y + 1 }
  const reach = distances(tiles, w, h, start.x, start.y)
  for (let i = 0; i < tiles.length; i += 1) if (reach[i] < 0 && tiles[i] !== Tile.Solid && tiles[i] !== Tile.Water) tiles[i] = Tile.Solid
  return { seed, w, h, tiles, start, startRoom, bossRoom, chambers: [], nests: [], river: { crossings } }
}

export type FieldDirectorEvent = { type: 'pack'; size: number; elite: boolean } | { type: 'named-spawn'; foe: HordeFoe } | { type: 'named-down' }

export interface FieldOpts {
  kinds: HordeKind[]
  /** Spawn the named elite once (hunt quest on). */
  named: { kind: HordeKind; name: string; hp: number } | null
  mobile: boolean
}

export class FieldDirector {
  readonly maze: Maze
  private readonly horde: Horde
  private readonly rand: () => number
  private readonly opts: FieldOpts
  private clock = 0.5
  private nextPack = 5000
  /** Packs walked in so far. */
  packs = 0
  /** The named elite's foe id (0 = not out yet / down). */
  namedId = 0
  namedDown = false
  /** Open tiles to spawn on (not the start pocket, not the boss ring). */
  private readonly open: number[] = []

  constructor(maze: Maze, horde: Horde, rand: () => number, opts: FieldOpts) {
    this.maze = maze
    this.horde = horde
    this.rand = rand
    this.opts = opts
    horde.aggro = { range: FIELD.aggro, leash: FIELD.leash, leashTime: FIELD.leashTime, cap: FIELD.chaseCap }
    for (let i = 0; i < maze.w * maze.h; i += 1) if (maze.tiles[i] === Tile.Chamber) this.open.push(i)
  }

  get target(): number {
    return FIELD.alive[this.opts.mobile ? 1 : 0]
  }

  /** A random open tile `near`..`far` m from her, or null. */
  private spot(px: number, pz: number, near: number = FIELD.near, far: number = FIELD.far): { x: number; z: number } | null {
    for (let k = 0; k < 40; k += 1) {
      const i = this.open[Math.floor(this.rand() * this.open.length)]
      const c = tileCentre(this.maze, i % this.maze.w, Math.floor(i / this.maze.w))
      const d = Math.hypot(c.x - px, c.z - pz)
      if (d >= near && d <= far) return c
    }
    return null
  }

  /** One sleeping pack round (x, z). */
  private pack(x: number, z: number, size: number, elite: boolean): number {
    const id = this.nextPack++
    const kinds = this.opts.kinds.length ? this.opts.kinds : (['slime'] as HordeKind[])
    const a = kinds[Math.floor(this.rand() * kinds.length)]
    const b = kinds[Math.floor(this.rand() * kinds.length)]
    let n = 0
    for (let k = 0; k < size; k += 1) {
      const ang = (k / size) * Math.PI * 2 + this.rand() * 0.5
      const r = k === 0 && elite ? 0 : 0.7 + this.rand() * 0.8
      const f = this.horde.spawn(k % 2 ? b : a, x + Math.cos(ang) * r, z + Math.sin(ang) * r, elite && k === 0)
      if (!f) break
      f.pack = id
      f.mode = 'idle'
      f.homeX = f.x
      f.homeZ = f.z
      f.age = 1
      f.yaw = this.rand() * Math.PI * 2
      n += 1
    }
    this.packs += 1
    return n
  }

  /** Top the field up round her; recycle far sleeping packs; let the named elite out once. */
  update(dt: number, px: number, pz: number, alive: boolean): FieldDirectorEvent[] {
    const out: FieldDirectorEvent[] = []
    if (!alive) return out
    this.clock -= dt
    if (this.clock > 0) return out
    this.clock = FIELD.every
    // Far sleepers walk off and come back nearer (the field never empties where she is).
    for (let i = this.horde.foes.length - 1; i >= 0; i -= 1) {
      const f = this.horde.foes[i]
      if (f.dying > 0 || f.mode === 'chase' || f.id === this.namedId) continue
      if (Math.hypot(f.x - px, f.z - pz) > FIELD.recycle) this.horde.foes.splice(i, 1)
    }
    if (this.opts.named && !this.namedId && !this.namedDown) {
      const at = this.spot(px, pz, 24, 60)
      if (at) {
        const f = this.horde.spawn(this.opts.named.kind, at.x, at.z, true)
        if (f) {
          f.maxHp = Math.round(f.maxHp * this.opts.named.hp)
          f.hp = f.maxHp
          f.radius *= 1.25
          f.pack = this.nextPack++
          f.mode = 'idle'
          f.homeX = f.x
          f.homeZ = f.z
          f.age = 1
          this.namedId = f.id
          out.push({ type: 'named-spawn', foe: f })
        }
      }
    }
    // The first tick fills the whole field at once (she arrives to a field already full of packs).
    // The first fill spreads packs over the whole field (not only round her).
    const first = this.packs === 0
    const rounds = first ? 16 : 1
    for (let r = 0; r < rounds; r += 1) this.topUp(px, pz, out, first)
    return out
  }

  private topUp(px: number, pz: number, out: FieldDirectorEvent[], wide = false): void {
    const missing = this.target - this.horde.alive
    if (missing >= FIELD.pack[0]) {
      const at = wide ? this.spot(px, pz, FIELD.near - 2, FIELD.recycle - 4) : this.spot(px, pz)
      if (at) {
        const size = Math.min(missing, FIELD.pack[0] + Math.floor(this.rand() * (FIELD.pack[1] - FIELD.pack[0] + 1)))
        const elite = this.rand() < FIELD.eliteShare
        const n = this.pack(at.x, at.z, size, elite)
        if (n) out.push({ type: 'pack', size: n, elite })
      }
    }
  }

  /** A foe went down: was it the named one? */
  foeDown(f: HordeFoe): FieldDirectorEvent[] {
    if (f.id !== this.namedId || this.namedDown) return []
    this.namedDown = true
    this.namedId = 0
    return [{ type: 'named-down' }]
  }

  /** Where the named elite is (HUD arrow), or null. */
  named(): HordeFoe | null {
    if (!this.namedId) return null
    return this.horde.foes.find((f) => f.id === this.namedId && f.dying <= 0) ?? null
  }
}

/** Field width in metres (for the HUD and tests). */
export const FIELD_METRES = FIELD.size * TILE
