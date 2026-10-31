/**
 * Explore-floor director (pure, no three.js): spawns the laid-out packs into the horde as
 * sleeping groups, wakes optional nest pipes when she comes close (small local bursts, never a
 * flood), and tracks the star key, doors and the cracked wall. run.ts draws it; the audit sim
 * drives the same class headless.
 */
import { EXPLORE, ELITE_AFFIXES, blockers, eliteName, type Layout, type Pack, type Spot } from './layout'
import { Horde, type HordeFoe, type HordeKind } from './horde'
import { TILE, Tile, tileCentre, type Maze } from './maze'

export interface NestState {
  i: number
  /** Pipe mouth in world metres. */
  x: number
  z: number
  hp: number
  maxHp: number
  hurt: number
  /** Seconds to the next burst while she is near. */
  clock: number
  /** Pseudo-pack id its foes belong to (they walk back to the pipe). */
  pack: number
  /** Live foes it has out. */
  out: number
  /** It has noticed her (first burst). */
  woke: boolean
}

export type ExploreEvent =
  | { type: 'nest-wake'; i: number }
  | { type: 'spawn'; foe: HordeFoe; nest: number }
  | { type: 'key' }
  | { type: 'door' }
  | { type: 'secret' }

/** Elite tag for the HUD: name and whether it carries the key. */
export interface EliteTag {
  name: string
  key: boolean
}

export class ExploreDirector {
  readonly layout: Layout
  readonly nests: NestState[] = []
  /** She picked the star key up. */
  hasKey = false
  doorsOpen = false
  secretOpen = false
  /** Cracked wall hp (water shots). */
  secretHp = 60
  readonly elites = new Map<number, EliteTag>()
  private readonly maze: Maze
  private readonly horde: Horde
  private readonly rand: () => number

  constructor(maze: Maze, layout: Layout, horde: Horde, rand: () => number, nestHp: number) {
    this.maze = maze
    this.layout = layout
    this.horde = horde
    this.rand = rand
    horde.aggro = { range: EXPLORE.aggro, leash: EXPLORE.leash, leashTime: EXPLORE.leashTime, cap: EXPLORE.chaseCap }
    for (const p of layout.packs) this.spawnPack(p)
    layout.nests.forEach((n, i) => {
      const c = tileCentre(maze, n.x, n.y)
      this.nests.push({ i, x: c.x - n.dx * (TILE / 2 - 0.55), z: c.z - n.dy * (TILE / 2 - 0.55), hp: nestHp, maxHp: nestHp, hurt: 0, clock: 0.8, pack: 1000 + i, out: 0, woke: false })
    })
    // Doors and the cracked wall are open in the geometry; close them for walking and shots.
    for (const b of blockers(layout)) maze.tiles[b.y * maze.w + b.x] = Tile.Solid
    horde.invalidate()
  }

  /** Put a pack's foes round its home tile, asleep. */
  private spawnPack(p: Pack): void {
    const c = tileCentre(this.maze, p.x, p.y)
    for (let k = 0; k < p.size; k += 1) {
      const elite = !!p.elite && k === 0
      const kind: HordeKind = p.kinds[k % p.kinds.length]
      const a = (k / p.size) * Math.PI * 2 + this.rand() * 0.6
      const r = k === 0 && elite ? 0 : 0.6 + this.rand() * 0.6
      const x = c.x + Math.cos(a) * r
      const z = c.z + Math.sin(a) * r
      const f = this.horde.spawn(kind, x, z, elite)
      if (!f) return
      f.age = 1
      f.pack = p.id
      f.mode = 'idle'
      f.homeX = x
      f.homeZ = z
      f.yaw = this.rand() * Math.PI * 2
      if (elite && p.elite) {
        for (const a2 of p.elite) {
          const m = ELITE_AFFIXES[a2]
          f.maxHp = Math.round(f.maxHp * m.hp)
          f.hp = f.maxHp
          f.speed *= m.speed
          f.damage = Math.round(f.damage * m.damage)
          if (a2 === 'giant') f.radius *= 1.12
        }
        this.elites.set(f.id, { name: eliteName(kind, p.elite), key: p.key })
      }
    }
  }

  get keyHolder(): HordeFoe | null {
    for (const f of this.horde.foes) if (f.dying <= 0 && this.elites.get(f.id)?.key) return f
    return null
  }

  /** A foe went down: the key elite drops the star key. */
  foeDown(f: HordeFoe): ExploreEvent[] {
    const out: ExploreEvent[] = []
    const tag = this.elites.get(f.id)
    if (tag?.key && !this.hasKey) {
      this.hasKey = true
      out.push({ type: 'key' })
    }
    for (const n of this.nests) if (f.pack === n.pack) n.out = Math.max(0, n.out - 1)
    return out
  }

  /** She walked up to a door with the key: open every door tile. */
  openDoors(): ExploreEvent[] {
    if (this.doorsOpen || !this.layout.needsKey || !this.hasKey) return []
    this.doorsOpen = true
    for (const d of this.layout.doors) this.maze.tiles[d.y * this.maze.w + d.x] = Tile.Corridor
    this.horde.invalidate()
    return [{ type: 'door' }]
  }

  /** Water on the cracked wall; true when it gives way. */
  hitSecret(amount: number): boolean {
    const s = this.layout.secret
    if (!s || this.secretOpen) return false
    this.secretHp -= amount
    if (this.secretHp > 0) return false
    this.secretOpen = true
    this.maze.tiles[s.wall.y * this.maze.w + s.wall.x] = Tile.Corridor
    this.horde.invalidate()
    return true
  }

  /** The cracked wall's face (world metres) on the dead-end side, for the crosshair. */
  get secretFace(): { x: number; z: number } | null {
    const s = this.layout.secret
    if (!s || this.secretOpen) return null
    const c = tileCentre(this.maze, s.wall.x, s.wall.y)
    return { x: c.x - s.dx * (TILE / 2 - 0.25), z: c.z - s.dy * (TILE / 2 - 0.25) }
  }

  /** Nearest door tile within `r` metres of (x, z), or null. */
  doorNear(x: number, z: number, r: number): Spot | null {
    if (this.doorsOpen || !this.layout.needsKey) return null
    for (const d of this.layout.doors) {
      const c = tileCentre(this.maze, d.x, d.y)
      if (Math.hypot(c.x - x, c.z - z) < r) return d
    }
    return null
  }

  /** Nest bursts near her. `spawnAt` places a foe at a pipe mouth (the run knows the mouths). */
  update(dt: number, hx: number, hz: number, alive: boolean, spawnAt: (nest: number, kind: HordeKind) => HordeFoe | null, kinds: HordeKind[]): ExploreEvent[] {
    const out: ExploreEvent[] = []
    for (const n of this.nests) {
      n.hurt = Math.max(0, n.hurt - dt * 4)
      if (n.hp <= 0 || !alive) continue
      const d = Math.hypot(n.x - hx, n.z - hz)
      if (d > EXPLORE.nestRange) continue
      n.clock -= dt
      if (n.clock > 0) continue
      if (!n.woke) {
        n.woke = true
        out.push({ type: 'nest-wake', i: n.i })
      }
      n.clock = EXPLORE.nestEvery
      const burst = EXPLORE.nestBurst[0] + Math.floor(this.rand() * (EXPLORE.nestBurst[1] - EXPLORE.nestBurst[0] + 1))
      for (let k = 0; k < burst && n.out < EXPLORE.nestCap; k += 1) {
        const f = spawnAt(n.i, kinds[Math.floor(this.rand() * kinds.length)])
        if (!f) break
        f.pack = n.pack
        f.mode = 'chase'
        f.homeX = n.x
        f.homeZ = n.z
        n.out += 1
        out.push({ type: 'spawn', foe: f, nest: n.i })
      }
    }
    return out
  }
}
