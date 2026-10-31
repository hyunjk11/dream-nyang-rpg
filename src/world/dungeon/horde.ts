/**
 * The sewer horde: up to a couple of hundred dream pests pouring out of nest pipes and flowing
 * through the maze toward her. Pure simulation (no three.js objects) so it runs in tests; the
 * view (horde-view.ts) draws it with a few instanced meshes.
 *
 * Pathing: one BFS flow field from her tile, rebuilt only when she changes tile. Each foe steers
 * at the centre of the next tile downhill, or straight at her when it shares her tile or the next.
 * Crowding: a uniform spatial hash pushes overlapping bodies apart; walls via collideCircle.
 */
import { DIFFICULTY } from '../../combat/difficulty'
import { TILE, tileCentre, walkable, worldToTile, type Maze } from './maze'
import { collideCircle } from './walls'
import { rayCapsule, type AimTarget } from '../../core/tps'

export type HordeKind =
  | 'slime'
  | 'bug'
  | 'rabbit'
  | 'bat'
  // Reused from hero-defense-3d: KayKit skeletons (CC0) and the Meshy lich.
  | 'skeleton'
  | 'skel_rogue'
  | 'skel_warrior'
  | 'skel_mage'
  | 'lich'
  // Reused from lucky-defense-3d: the procedural monsters.
  | 'jelly'
  | 'wolf'
  | 'goblin'
  | 'knight'
  | 'wraith'
  | 'golem'
  | 'drake'
  | 'lord'

export interface HordeSpec {
  hp: number
  speed: number
  radius: number
  damage: number
  /** Body centre height for shots (m above the floor). */
  chest: number
  /** Dream dust dropped. */
  dust: number
}

export const HORDE: Record<HordeKind, HordeSpec> = {
  slime: { hp: 26, speed: 2.1, radius: 0.4, damage: 5, chest: 0.4, dust: 1 },
  bug: { hp: 34, speed: 3.3, radius: 0.42, damage: 7, chest: 0.42, dust: 2 },
  rabbit: { hp: 30, speed: 2.8, radius: 0.4, damage: 6, chest: 0.5, dust: 2 },
  bat: { hp: 20, speed: 3.0, radius: 0.36, damage: 4, chest: 1.15, dust: 1 },
  skeleton: { hp: 30, speed: 2.6, radius: 0.4, damage: 6, chest: 0.75, dust: 2 },
  skel_rogue: { hp: 26, speed: 3.6, radius: 0.38, damage: 6, chest: 0.75, dust: 2 },
  skel_warrior: { hp: 52, speed: 2.2, radius: 0.46, damage: 9, chest: 0.8, dust: 3 },
  skel_mage: { hp: 28, speed: 2.4, radius: 0.4, damage: 7, chest: 0.8, dust: 3 },
  lich: { hp: 150, speed: 1.7, radius: 0.6, damage: 12, chest: 1.1, dust: 12 },
  jelly: { hp: 22, speed: 2.3, radius: 0.38, damage: 4, chest: 0.35, dust: 1 },
  wolf: { hp: 30, speed: 3.9, radius: 0.44, damage: 7, chest: 0.5, dust: 2 },
  goblin: { hp: 26, speed: 3.2, radius: 0.38, damage: 6, chest: 0.55, dust: 2 },
  knight: { hp: 60, speed: 2.0, radius: 0.46, damage: 9, chest: 0.75, dust: 3 },
  wraith: { hp: 34, speed: 2.7, radius: 0.42, damage: 7, chest: 1.0, dust: 3 },
  golem: { hp: 90, speed: 1.6, radius: 0.6, damage: 12, chest: 0.9, dust: 4 },
  drake: { hp: 70, speed: 2.4, radius: 0.6, damage: 10, chest: 0.9, dust: 4 },
  lord: { hp: 110, speed: 1.8, radius: 0.7, damage: 12, chest: 1.1, dust: 10 },
}

/** Champions only ever spawn as elites, one per wave once unlocked. */
export const CHAMPIONS: HordeKind[] = ['lord', 'lich']

/** Elites: bigger, tougher, hit harder; a golden tint so they read in the crowd. */
export const ELITE = { scale: 1.45, hp: DIFFICULTY.elite.hp, damage: DIFFICULTY.elite.damage, speed: 0.9 }

/** Seconds a foe spends popping out of a pipe / bursting apart. */
export const SPAWN_TIME = 0.45
export const DIE_TIME = 0.42

export interface HordeFoe {
  id: number
  kind: HordeKind
  elite: boolean
  x: number
  z: number
  vx: number
  vz: number
  yaw: number
  hp: number
  maxHp: number
  radius: number
  speed: number
  damage: number
  /** 0..SPAWN_TIME then fully in. */
  age: number
  /** >0 while bursting apart; removed at DIE_TIME. */
  dying: number
  /** 0..1 fresh hit, decays. */
  hurt: number
  /** Melee: wind-up timer (>0 while winding) and cooldown after a swing. */
  windup: number
  cooldown: number
  phase: number
  /** Simulated this frame (far foes tick every other frame). */
  far: boolean
}

/** BFS distances (in tiles) from one target tile, rebuilt when the target moves. */
export class FlowField {
  readonly dist: Int32Array
  tx = -1
  ty = -1
  private readonly queue: Int32Array
  private readonly maze: Maze

  constructor(maze: Maze) {
    this.maze = maze
    this.dist = new Int32Array(maze.w * maze.h).fill(-1)
    this.queue = new Int32Array(maze.w * maze.h)
  }

  /** Re-aim at tile (tx, ty); returns true when it had to rebuild. */
  aim(tx: number, ty: number): boolean {
    if (tx === this.tx && ty === this.ty) return false
    const { w, h } = this.maze
    if (!walkable(this.maze, tx, ty)) return false
    this.tx = tx
    this.ty = ty
    this.dist.fill(-1)
    let head = 0
    let tail = 0
    this.dist[ty * w + tx] = 0
    this.queue[tail++] = ty * w + tx
    while (head < tail) {
      const i = this.queue[head++]
      const x = i % w
      const y = (i - x) / w
      const d = this.dist[i] + 1
      if (x > 0) tail = this.push(i - 1, x - 1, y, d, tail)
      if (x < w - 1) tail = this.push(i + 1, x + 1, y, d, tail)
      if (y > 0) tail = this.push(i - w, x, y - 1, d, tail)
      if (y < h - 1) tail = this.push(i + w, x, y + 1, d, tail)
    }
    return true
  }

  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.maze.w || y >= this.maze.h) return -1
    return this.dist[y * this.maze.w + x]
  }

  /** The neighbour tile one step closer to the target (or the tile itself at the target). */
  next(x: number, y: number): { x: number; y: number } {
    const here = this.at(x, y)
    let bx = x
    let by = y
    let best = here < 0 ? 1e9 : here
    for (const [dx, dy] of STEPS) {
      const d = this.at(x + dx, y + dy)
      if (d >= 0 && d < best) {
        best = d
        bx = x + dx
        by = y + dy
      }
    }
    return { x: bx, y: by }
  }

  private push(i: number, x: number, y: number, d: number, tail: number): number {
    if (this.dist[i] >= 0 || !walkable(this.maze, x, y)) return tail
    this.dist[i] = d
    this.queue[tail] = i
    return tail + 1
  }
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export interface HordeTarget {
  x: number
  z: number
  alive: boolean
}

/** Hard cap: the view's instance buffers are sized from it. */
export const HORDE_CAP = 220

const CELL = 1.2

export class Horde {
  readonly foes: HordeFoe[] = []
  readonly flow: FlowField
  /** Kills this run, by kind and elites. */
  kills = 0
  eliteKills = 0
  /** Depth/floor multipliers on hp and damage (1 = depth 1, floor 1). */
  scale = { hp: 1, damage: 1 }
  private readonly maze: Maze
  private nextId = 1
  private frame = 0
  private time = 0
  // Spatial hash over the maze bounds.
  private readonly gw: number
  private readonly gh: number
  private readonly head: Int32Array
  private readonly link: Int32Array
  /** World position of the hash's (0, 0) corner. */
  private readonly ox: number
  private readonly oz: number

  constructor(maze: Maze) {
    this.maze = maze
    this.flow = new FlowField(maze)
    this.gw = Math.ceil((maze.w * TILE) / CELL) + 1
    this.gh = Math.ceil((maze.h * TILE) / CELL) + 1
    this.head = new Int32Array(this.gw * this.gh)
    this.link = new Int32Array(HORDE_CAP)
    this.ox = (-maze.w / 2) * TILE
    this.oz = (-maze.h / 2) * TILE
  }

  get alive(): number {
    let n = 0
    for (const f of this.foes) if (f.dying <= 0) n += 1
    return n
  }

  /** Pop a foe out at (x, z) heading along (dx, dz). Returns null when the horde is full. */
  spawn(kind: HordeKind, x: number, z: number, elite = false, dx = 0, dz = 0): HordeFoe | null {
    if (this.foes.length >= HORDE_CAP) return null
    const s = HORDE[kind]
    const hp = Math.round(s.hp * DIFFICULTY.horde.hp * this.scale.hp * (elite ? ELITE.hp : 1))
    const foe: HordeFoe = {
      id: this.nextId++,
      kind,
      elite,
      x,
      z,
      vx: dx * s.speed * 1.4,
      vz: dz * s.speed * 1.4,
      yaw: Math.atan2(dx, dz),
      hp,
      maxHp: hp,
      radius: s.radius * (elite ? ELITE.scale : 1),
      speed: s.speed * DIFFICULTY.horde.speed * (elite ? ELITE.speed : 1) * (0.88 + ((this.nextId * 0.618) % 1) * 0.24),
      damage: Math.max(1, Math.round(s.damage * DIFFICULTY.horde.damage * this.scale.damage * (elite ? ELITE.damage : 1))),
      age: 0,
      dying: 0,
      hurt: 0,
      windup: 0,
      cooldown: 0.6,
      phase: (this.nextId * 0.381) % 1,
      far: false,
    }
    this.foes.push(foe)
    return foe
  }

  /**
   * Advance the crowd. `strike` is called when a wind-up lands on her (amount, from x/z).
   */
  update(dt: number, target: HordeTarget, strike: (amount: number, x: number, z: number) => void): void {
    this.frame += 1
    this.time += dt
    const m = this.maze
    const t = worldToTile(m, target.x, target.z)
    this.flow.aim(t.x, t.y)
    this.rebuildHash()
    for (let i = this.foes.length - 1; i >= 0; i -= 1) {
      const f = this.foes[i]
      f.hurt = Math.max(0, f.hurt - dt * 5)
      if (f.dying > 0) {
        f.dying += dt
        if (f.dying >= DIE_TIME) this.foes.splice(i, 1)
        continue
      }
      f.age += dt
      const dx = target.x - f.x
      const dz = target.z - f.z
      const d = Math.hypot(dx, dz)
      // Far foes (out of sight anyway) think every other frame with a doubled step.
      f.far = d > 26
      if (f.far && (this.frame + f.id) % 2 === 1) continue
      const step = f.far ? dt * 2 : dt
      this.steer(f, step, dx, dz, d, target.alive)
      this.melee(f, step, d, target, strike)
    }
    this.separate()
    for (const f of this.foes) {
      if (f.dying > 0) continue
      const out = collideCircle(m, f.x, f.z, f.radius)
      f.x = out.x
      f.z = out.z
    }
  }

  /** The upright body the crosshair and droplets test against (same shape for both). */
  capsule(f: HordeFoe): AimTarget {
    const chest = HORDE[f.kind].chest * (f.elite ? ELITE.scale : 1)
    const r = f.radius * 1.15
    return { x: f.x, z: f.z, y0: Math.max(0, chest - r), y1: chest + r, r }
  }

  /** Can this foe be aimed at / hit yet (not dying, mostly out of the floor)? */
  hittable(f: HordeFoe): boolean {
    return f.dying === 0 && f.age >= SPAWN_TIME * 0.4
  }

  /**
   * First foe a ray (origin o, unit direction d) touches within `max` metres.
   * Bodies are the same upright capsules the aim ray uses, so a droplet sent at
   * the crosshair point always lands on what the crosshair is over.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): { foe: HordeFoe; t: number } | null {
    let best: HordeFoe | null = null
    let bt = max
    for (const f of this.foes) {
      if (!this.hittable(f)) continue
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, this.capsule(f), bt)
      if (t >= 0 && t < bt) {
        bt = t
        best = f
      }
    }
    return best ? { foe: best, t: bt } : null
  }

  /** Hurt a foe; a push along (px, pz). Returns true on the killing blow. */
  damage(f: HordeFoe, amount: number, px = 0, pz = 0): boolean {
    if (f.dying > 0) return false
    f.hp -= amount
    f.hurt = 1
    const push = f.elite ? 0.6 : 1.6
    f.vx += px * push
    f.vz += pz * push
    if (f.hp > 0) return false
    f.dying = 1e-4
    this.kills += 1
    if (f.elite) this.eliteKills += 1
    return true
  }

  /** Drop everyone (leaving the sewer / boss cleared the room). */
  clear(): void {
    this.foes.length = 0
  }

  private steer(f: HordeFoe, dt: number, dx: number, dz: number, d: number, hunt: boolean): void {
    const ft = worldToTile(this.maze, f.x, f.z)
    let gx = dx
    let gz = dz
    const here = this.flow.at(ft.x, ft.y)
    if (here > 1 || here < 0) {
      const n = this.flow.next(ft.x, ft.y)
      const c = tileCentre(this.maze, n.x, n.y)
      gx = c.x - f.x
      gz = c.z - f.z
    }
    const gl = Math.hypot(gx, gz)
    let want = hunt ? f.speed : 0
    // Brake into a ring around her instead of stacking on her feet.
    if (d < f.radius + 0.75) want = 0
    if (f.windup > 0) want *= 0.15
    if (f.age < SPAWN_TIME) want *= 0.5
    const wx = gl > 1e-4 ? (gx / gl) * want : 0
    const wz = gl > 1e-4 ? (gz / gl) * want : 0
    const k = Math.min(1, dt * 7)
    f.vx += (wx - f.vx) * k
    f.vz += (wz - f.vz) * k
    f.x += f.vx * dt
    f.z += f.vz * dt
    const face = d < 3 ? Math.atan2(dx, dz) : Math.hypot(f.vx, f.vz) > 0.2 ? Math.atan2(f.vx, f.vz) : f.yaw
    let turn = face - f.yaw
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    f.yaw += turn * Math.min(1, dt * 10)
  }

  private melee(f: HordeFoe, dt: number, d: number, target: HordeTarget, strike: (amount: number, x: number, z: number) => void): void {
    f.cooldown = Math.max(0, f.cooldown - dt)
    const reach = f.radius + 0.95
    if (f.windup > 0) {
      f.windup -= dt
      if (f.windup <= 0) {
        f.windup = 0
        f.cooldown = DIFFICULTY.horde.cooldown
        if (d < reach + 0.35 && target.alive) strike(f.damage, f.x, f.z)
      }
      return
    }
    if (f.cooldown <= 0 && d < reach && target.alive && f.age >= SPAWN_TIME) f.windup = DIFFICULTY.horde.windup
  }

  private rebuildHash(): void {
    this.head.fill(-1)
    for (let i = 0; i < this.foes.length; i += 1) {
      const f = this.foes[i]
      const c = this.cell(f.x, f.z)
      this.link[i] = this.head[c]
      this.head[c] = i
    }
  }

  private cell(x: number, z: number): number {
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.ox) / CELL)))
    const cz = Math.min(this.gh - 1, Math.max(0, Math.floor((z - this.oz) / CELL)))
    return cz * this.gw + cx
  }

  private separate(): void {
    const foes = this.foes
    for (let i = 0; i < foes.length; i += 1) {
      const a = foes[i]
      if (a.dying > 0) continue
      const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((a.x - this.ox) / CELL)))
      const cz = Math.min(this.gh - 1, Math.max(0, Math.floor((a.z - this.oz) / CELL)))
      for (let oz = -1; oz <= 1; oz += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const x = cx + ox
          const z = cz + oz
          if (x < 0 || z < 0 || x >= this.gw || z >= this.gh) continue
          for (let j = this.head[z * this.gw + x]; j >= 0; j = this.link[j]) {
            if (j <= i || j >= foes.length) continue
            const b = foes[j]
            if (b.dying > 0) continue
            // Bats fly over the crawlers.
            if ((a.kind === 'bat') !== (b.kind === 'bat')) continue
            const dx = b.x - a.x
            const dz = b.z - a.z
            const min = a.radius + b.radius
            const d2 = dx * dx + dz * dz
            if (d2 >= min * min) continue
            const d = Math.sqrt(d2) || 1e-3
            const push = (min - d) * 0.5
            // Exactly stacked (pinned in a corner): split them along an id-seeded direction.
            const stacked = d2 < 1e-6
            const nx = stacked ? Math.cos(a.id * 2.4 + b.id) : dx / d
            const nz = stacked ? Math.sin(a.id * 2.4 + b.id) : dz / d
            // Heavier elites shove the small fry aside.
            const wa = a.elite && !b.elite ? 0.25 : b.elite && !a.elite ? 1.75 : 1
            a.x -= nx * push * wa
            a.z -= nz * push * wa
            b.x += nx * push * (2 - wa)
            b.z += nz * push * (2 - wa)
          }
        }
      }
    }
  }
}
