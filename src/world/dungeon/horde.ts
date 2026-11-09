/**
 * The sewer horde: up to a couple of hundred dream pests pouring out of nest pipes and flowing
 * through the maze toward her. Pure simulation (no three.js objects) so it runs in tests; the
 * view (horde-view.ts) draws it with a few instanced meshes.
 *
 * Pathing: one BFS flow field from her tile, rebuilt only when she changes tile. Each foe steers
 * at the centre of the next tile downhill, or straight at her when it shares her tile or the next.
 * Crowding: a uniform spatial hash pushes overlapping bodies apart; walls via collideCircle.
 */
import { ELEMENTS, speedMul, tickElements } from '../../combat/elements'
import { DIFFICULTY } from '../../combat/difficulty'
import { Tile, TILE, tileCentre, walkable, worldToTile, type Maze } from './maze'
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

/**
 * 원거리 몬스터 (2026-11, "50%의 몬스터를 원거리로"): about half the normals and elites keep 7–11 m off,
 * back away when she closes in, and lob a slow cute dream shot after a glowing 0.4–0.6 s charge.
 * Shots fly at the spot she stood on at release (no lead), so stepping aside or a dash dodges them.
 * They need a clear line (walls block, the 몽실 river does not), at most SHOT_CAP charge at once,
 * and each hit is RANGED.damage × the foe's melee hit (inside the same %maxHP band).
 */
export const RANGED = { share: 0.5, near: 7.5, far: 14, kite: 5.4, maxShot: 17, minShot: 1.4, damage: 0.92, life: 2.2, radius: 0.34, sightEvery: 0.2, homing: 3.4 }
/**
 * Depth-1 sewer explore only. The starter water gun holds at 14 m and default shots stop at 13 m,
 * so auto-hunt cleared packs without a single hit (playtest: 8 kills, ~1m43s, HP full).
 * These shots release out to 16.5 m and fly 1.25× (a 14 m bubble: 0.55 s charge + 14/7.5 s ≈ 2.4 s).
 * A landed hit stays in the existing band, about 13–22 HP at 150 max (9–15%), not a one-shot.
 * +5 is still ×1.20 gun damage, so the slime's ~1.9 s TTK drops under the travel time and the shot often misses the fight.
 */
export const EARLY_SHOT = { far: 15.5, max: 18, speed: 1.12 }
/** Most ranged foes charging a shot at once (like SWING_CAP for melee). */
export const SHOT_CAP = 3
/** Live shots in the pool (the view's instance buffers are sized from it). */
export const SHOTS_CAP = 48
export type ShotStyle = 'bubble' | 'star' | 'spore' | 'moon'
/** Each archetype's projectile: charge time (s) and speed (m/s, slow to medium). */
export const SHOT_STYLES: Record<ShotStyle, { aim: number; speed: number }> = {
  bubble: { aim: 0.48, speed: 15 },
  spore: { aim: 0.45, speed: 16 },
  star: { aim: 0.42, speed: 18 },
  moon: { aim: 0.5, speed: 16 },
}
export const SHOT_STYLE: Record<HordeKind, ShotStyle> = {
  slime: 'bubble',
  jelly: 'bubble',
  bug: 'spore',
  rabbit: 'spore',
  goblin: 'spore',
  wolf: 'star',
  bat: 'star',
  knight: 'star',
  golem: 'star',
  drake: 'star',
  lord: 'star',
  skeleton: 'moon',
  skel_rogue: 'moon',
  skel_warrior: 'moon',
  skel_mage: 'moon',
  wraith: 'moon',
  lich: 'moon',
}
/** Champions stay melee bruisers. */
export const NEVER_RANGED: readonly HordeKind[] = ['lord', 'lich']

export interface Shot {
  alive: boolean
  style: ShotStyle
  x: number
  z: number
  y: number
  vx: number
  vz: number
  life: number
  damage: number
  /** It already slipped past her dash (no second chance this pass). */
  dodged: boolean
  /** Spin / wobble seed for the view. */
  seed: number
}

/** Rest between shots: like swingRest, a touch longer (they trade reach for rate). */
export function shotRest(f: Pick<HordeFoe, 'beat'>): number {
  f.beat = (f.beat + 0.618034) % 1
  return DIFFICULTY.horde.cooldown * (0.75 + 0.7 * f.beat)
}

/** Is the n-th spawned foe ranged for this share? Low-discrepancy, so packs mix instead of clumping. */
export function rangedPick(n: number, share: number): boolean {
  return share > 0 && (n * 0.6180339887 + 0.29) % 1 < share
}

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
  /** Seconds left reeling from a heavy shot (sniper / shotgun stagger): barely moves, knockback carries. */
  stun: number
  /** Melee: wind-up timer (>0 while winding) and cooldown after a swing. */
  windup: number
  cooldown: number
  phase: number
  /** Swing rhythm (0..1): each foe rests a different time between swings. */
  beat: number
  /** Simulated this frame (far foes tick every other frame). */
  far: boolean
  /** Seconds of chill left (서늘: slowed). */
  chill: number
  /** Seconds of sticky candy left, and its damage per second (끈적). */
  goo: number
  gooDps: number
  /** Explore floors: the pack it belongs to (-1 = none: always hunting, like wave foes). */
  pack: number
  /** idle = waiting at home, chase = after her, home = walking back after losing her. */
  mode: FoeMode
  homeX: number
  homeZ: number
  /** Seconds she has been out of sight / out of leash range while it chases. */
  lost: number
  /** Countdown to the next sight check (staggered). */
  look: number
  /** Elites: enraged below DIFFICULTY.elite.rageAt hp (faster, harder hits). */
  rage: boolean
  /** Elites' charge: cooldown, crouch (telegraph) left, run left, and its heading. */
  chargeCd: number
  chargeWind: number
  chargeRun: number
  chargeX: number
  chargeZ: number
  /** 원거리: lobs shots from range instead of swinging. */
  ranged: boolean
  /** Ranged: charge left on the current shot (>0 = glowing), its full length, and line-of-sight cache. */
  aim: number
  aimTime: number
  los: boolean
  losT: number
  /** Strafe side while holding range (±1). */
  side: number
  /** Ranged: the ground marker the shot will fly to (tracks, then the projectile commits). */
  markX: number
  markZ: number
  marking: boolean
}

export type FoeMode = 'idle' | 'chase' | 'home'

/** Optional ray against the walls (sight checks); Horde falls back to the maze grid. */
export type SightFn = (ax: number, az: number, bx: number, bz: number) => boolean

/** How much a chilled foe slows (share of speed kept). */
export const CHILL_SLOW = ELEMENTS.slow

/** BFS distances (in tiles) from one target tile, rebuilt when the target moves. */
/** Speed left to a staggered foe (the shove of the shot carries it instead). */
export const STUN_SPEED = 0.1

/** Seconds a heavy shot staggers a foe: elites keep 40%, never past half a second. Pure. */
export function staggerFor(stagger: number, elite: boolean): number {
  return Math.min(0.5, Math.max(0, stagger) * (elite ? 0.4 : 1))
}

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
  /** Mid-dash: shots pass through her and stop steering. */
  dodge?: boolean
  /** Ground velocity (m/s). Shots and pounces lead it, then commit to a marker. */
  vx?: number
  vz?: number
}

/**
 * Where a shot or a pounce is headed: a short lead on her walk, capped so a dash
 * (a sudden fast step) leaves the marker. Pure.
 */
export function shotAim(fx: number, fz: number, target: { x: number; z: number; vx?: number; vz?: number }, speed: number): { x: number; z: number } {
  const dx = target.x - fx
  const dz = target.z - fz
  const dist = Math.hypot(dx, dz) || 1
  const flight = dist / Math.max(1, speed)
  const lead = Math.min(0.38, flight * 0.62)
  const vx = target.vx ?? 0
  const vz = target.vz ?? 0
  const step = Math.hypot(vx, vz) * lead
  const cap = 1.8
  const k = step > cap ? cap / step : 1
  return { x: target.x + vx * lead * k, z: target.z + vz * lead * k }
}

/** Melee gap-closer: crouch (the lane on the ground), then rush that line. A dash slips past. */
export const POUNCE = { min: 2.2, max: 10.4, wind: 0.4, speed: 18, time: 0.62 }

/** Hard cap: the view's instance buffers are sized from it. */
export const HORDE_CAP = 220

/**
 * Most foes winding up a melee swing at her at once (2026-11 denser fields): a crowd round her
 * takes turns instead of landing six hits in one beat. Others in reach wait a short, staggered beat.
 */
export const SWING_CAP = 3

/** Elite hp multiplier: ×ELITE.hp for a slime-sized foe, compressed for big kinds (a knight elite is not 2.3× a slime elite). */
export function eliteHpMul(kind: HordeKind): number {
  return ELITE.hp * (HORDE.slime.hp / HORDE[kind].hp) ** (1 - DIFFICULTY.elite.hpKindPow)
}

/** A sewer foe's hp: kind × horde tuning × 쉬움/보통/어려움 × floor scale (× elite). */
/**
 * Rest after a swing, different per foe and per swing (fix/real-play): a pack that started together
 * kept swinging on the same frame, and her i-frames ate all but the first hit. ±35% of the cooldown.
 */
/** A normal foe's hit inside the run's band (none = as is). */
export function clampHit(raw: number, band?: readonly [number, number]): number {
  return band ? Math.min(band[1], Math.max(band[0], raw)) : raw
}

export function swingRest(f: Pick<HordeFoe, 'beat'>): number {
  f.beat = (f.beat + 0.618034) % 1
  return DIFFICULTY.horde.cooldown * (0.65 + 0.7 * f.beat)
}

export function hordeHp(kind: HordeKind, scaleHp: number, elite = false): number {
  return Math.round(HORDE[kind].hp * DIFFICULTY.horde.hp * scaleHp * (elite ? eliteHpMul(kind) : 1))
}

const CELL = 1.2

/** Explore-floor aggro rules (see layout.ts EXPLORE). */
export interface Aggro {
  /** Sight range (m) for idle packs. */
  range: number
  /** Chasing foes give up after `leashTime` s out of sight or beyond `leash` m. */
  leash: number
  leashTime: number
  /** Most foes chasing at once (sight wakes wait for room; hits always wake). */
  cap: number
  sight?: SightFn
  onWake?: (pack: number) => void
}

export class Horde {
  readonly foes: HordeFoe[] = []
  readonly flow: FlowField
  /** Kills this run, by kind and elites. */
  kills = 0
  eliteKills = 0
  /** Depth/floor multipliers on hp and damage (1 = depth 1, floor 1). */
  /** hp / damage multipliers; `hit` clamps a normal foe's hit to [min, max] before the elite multiplier. */
  scale: { hp: number; damage: number; hit?: readonly [number, number] } = { hp: 1, damage: 1 }
  /** Every killing blow, whatever dealt it (droplets, bombs, candy). */
  onKill: ((f: HordeFoe) => void) | null = null
  /** An elite just enraged (VFX / banner). */
  onRage: ((f: HordeFoe) => void) | null = null
  /** An elite crouched to charge (sound cue). */
  onCharge: ((f: HordeFoe) => void) | null = null
  /** Explore floors: aggro rules (null = everyone hunts her, the wave behaviour). */
  aggro: Aggro | null = null
  /** Per-pack flow fields home (built on demand). */
  private readonly homes = new Map<number, FlowField>()
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

  /** Foes after her right now. */
  /** Melee wind-ups running this frame (see SWING_CAP). */
  private winding = 0
  swingCap = SWING_CAP
  /** Share of new normals / elites that spawn ranged (0 = all melee; the run sets RANGED.share). */
  rangedShare = 0
  /** Ranged charges running this frame (see SHOT_CAP). */
  private aiming = 0
  shotCap = SHOT_CAP
  /** The shot pool (fixed size, reused). */
  readonly shots: Shot[] = Array.from({ length: SHOTS_CAP }, () => ({ alive: false, style: 'bubble' as ShotStyle, x: 0, z: 0, y: 1, vx: 0, vz: 0, life: 0, damage: 0, dodged: false, seed: 0 }))
  /** Shots that popped this frame (wall, her, timeout): the run puffs VFX there. */
  readonly popped: { x: number; y: number; z: number; style: ShotStyle; hit: boolean }[] = []
  /** Shots fired / dodged (QA). */
  fired = 0
  dodged = 0
  /** Optional shot-line test (default: the maze grid, water is see-through). */
  shotLine: SightFn | null = null
  /** How far a ranged foe will hold and fire. Depth-1 explore raises this to EARLY_SHOT. */
  shotFar = RANGED.far
  shotMax = RANGED.maxShot
  /** Projectile speed scale (1 = SHOT_STYLES). */
  shotSpeed = 1

  get chasing(): number {
    let n = 0
    for (const f of this.foes) if (f.dying <= 0 && f.mode === 'chase') n += 1
    return n
  }

  /** Wake a whole pack (a hit, or one of them saw her). `force` ignores the chase cap. */
  wakePack(pack: number, force = false): number {
    if (pack < 0) return 0
    let room = force || !this.aggro ? Infinity : this.aggro.cap - this.chasing
    let n = 0
    for (const f of this.foes) {
      if (f.pack !== pack || f.dying > 0 || f.mode === 'chase') continue
      if (room <= 0) break
      f.mode = 'chase'
      f.lost = 0
      room -= 1
      n += 1
    }
    if (n) this.aggro?.onWake?.(pack)
    return n
  }

  /** The doors changed: rebuild every flow field next frame. */
  invalidate(): void {
    this.flow.tx = -1
    this.flow.ty = -1
    this.homes.clear()
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
    const hp = hordeHp(kind, this.scale.hp, elite)
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
      damage: Math.max(1, Math.round(clampHit(s.damage * DIFFICULTY.horde.damage * this.scale.damage, this.scale.hit) * (elite ? ELITE.damage : 1))),
      age: 0,
      dying: 0,
      hurt: 0,
      stun: 0,
      windup: 0,
      // First swing staggered too (a pack that arrives together must not swing as one).
      cooldown: 0.12 + ((this.nextId * 0.618) % 1) * 0.45,
      beat: (this.nextId * 0.381) % 1,
      phase: (this.nextId * 0.381) % 1,
      far: false,
      chill: 0,
      goo: 0,
      gooDps: 0,
      pack: -1,
      mode: 'chase',
      homeX: x,
      homeZ: z,
      lost: 0,
      look: ((this.nextId * 0.27) % 1) * 0.25,
      rage: false,
      chargeCd: DIFFICULTY.elite.chargeEvery * (0.5 + ((this.nextId * 0.73) % 1) * 0.5),
      chargeWind: 0,
      chargeRun: 0,
      chargeX: 0,
      chargeZ: 0,
      ranged: !NEVER_RANGED.includes(kind) && rangedPick(this.nextId, this.rangedShare),
      aim: 0,
      aimTime: SHOT_STYLES[SHOT_STYLE[kind]].aim,
      los: false,
      losT: ((this.nextId * 0.41) % 1) * RANGED.sightEvery,
      side: this.nextId % 2 ? 1 : -1,
      markX: x,
      markZ: z,
      marking: false,
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
    this.winding = 0
    this.aiming = 0
    for (const f of this.foes) if (f.dying <= 0 && f.windup > 0) this.winding += 1
    for (const f of this.foes) if (f.dying <= 0 && f.aim > 0) this.aiming += 1
    for (let i = this.foes.length - 1; i >= 0; i -= 1) {
      const f = this.foes[i]
      f.hurt = Math.max(0, f.hurt - dt * 5)
      f.stun = Math.max(0, f.stun - dt)
      if (f.dying > 0) {
        f.dying += dt
        if (f.dying >= DIE_TIME) this.foes.splice(i, 1)
        continue
      }
      f.age += dt
      const goo = tickElements(f, dt)
      if (goo > 0 && this.damage(f, goo)) continue
      const dx = target.x - f.x
      const dz = target.z - f.z
      const d = Math.hypot(dx, dz)
      // Far foes (out of sight anyway) think every other frame with a doubled step.
      f.far = d > 26
      if (f.far && (this.frame + f.id) % 2 === 1) continue
      const step = f.far ? dt * 2 : dt
      if (this.aggro && f.pack >= 0 && f.mode !== 'chase') {
        this.wander(f, step, target, d)
        continue
      }
      if (this.aggro && f.pack >= 0) this.leash(f, step, target, d)
      if (f.ranged) {
        this.ranged(f, step, dx, dz, d, target)
        continue
      }
      if (f.elite && this.charge(f, step, dx, dz, d, target, strike)) continue
      if (!f.elite && this.pounce(f, step, dx, dz, d, target, strike)) continue
      this.steer(f, step, dx, dz, d, target.alive)
      this.melee(f, step, dx, dz, d, target, strike)
    }
    this.flyShots(dt, target, strike)
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

  /** Hurt a foe; a push along (px, pz); `stagger` seconds of reeling (elites shrug most of it off). Returns true on the killing blow. */
  damage(f: HordeFoe, amount: number, px = 0, pz = 0, stagger = 0): boolean {
    if (f.dying > 0) return false
    f.hp -= amount
    f.hurt = 1
    if (stagger > 0) f.stun = Math.max(f.stun, staggerFor(stagger, f.elite))
    const push = f.elite ? 0.6 : 1.6
    f.vx += px * push
    f.vz += pz * push
    // A hit always wakes the foe it hit, and its pack as far as the chase cap allows.
    if (f.mode !== 'chase' && f.pack >= 0) this.wakePack(f.pack)
    f.mode = 'chase'
    f.lost = 0
    if (f.elite && !f.rage && f.hp > 0 && f.hp < f.maxHp * DIFFICULTY.elite.rageAt) {
      f.rage = true
      f.speed *= DIFFICULTY.elite.rageSpeed
      f.damage = Math.round(f.damage * DIFFICULTY.elite.rageDamage)
      this.onRage?.(f)
    }
    if (f.hp > 0) return false
    f.dying = 1e-4
    this.kills += 1
    if (f.elite) this.eliteKills += 1
    this.onKill?.(f)
    return true
  }

  /** Live, hittable foes within r of (x, z) (bombs, sparkle bursts, Mochi's rush). */
  near(x: number, z: number, r: number): HordeFoe[] {
    const out: HordeFoe[] = []
    for (const f of this.foes) {
      if (!this.hittable(f)) continue
      const d = Math.hypot(f.x - x, f.z - z)
      if (d <= r + f.radius) out.push(f)
    }
    return out
  }

  /** Drop everyone (leaving the sewer / boss cleared the room). */
  clear(): void {
    this.foes.length = 0
    for (const s of this.shots) s.alive = false
  }

  /** Shots in the air right now. */
  get liveShots(): number {
    let n = 0
    for (const s of this.shots) if (s.alive) n += 1
    return n
  }

  /** A clear shot from a to b: walls stop it, the river does not. */
  clearShot(ax: number, az: number, bx: number, bz: number): boolean {
    if (this.shotLine) return this.shotLine(ax, az, bx, bz)
    const d = Math.hypot(bx - ax, bz - az)
    const n = Math.ceil(d / (TILE * 0.25))
    for (let i = 1; i < n; i += 1) if (this.solidAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false
    return true
  }

  private solidAt(x: number, z: number): boolean {
    const t = worldToTile(this.maze, x, z)
    const m = this.maze
    if (t.x < 0 || t.y < 0 || t.x >= m.w || t.y >= m.h) return true
    return m.tiles[t.y * m.w + t.x] === Tile.Solid
  }

  /**
   * Ranged foes: walk in until she is in range and in sight, hold 7–11 m (strafing a little), back
   * off when she is closer than RANGED.kite, and charge a shot when the SHOT_CAP allows.
   */
  private ranged(f: HordeFoe, dt: number, dx: number, dz: number, d: number, target: HordeTarget): void {
    f.losT -= dt
    if (f.losT <= 0) {
      f.losT = RANGED.sightEvery
      f.los = target.alive && d < this.shotMax && this.clearShot(f.x, f.z, target.x, target.z)
    }
    f.cooldown = Math.max(0, f.cooldown - dt)
    if (!f.los || d > this.shotFar) {
      // Lost the line mid-charge: the glow fizzles.
      if (f.aim > 0 && !f.los) {
        f.aim = 0
        this.aiming = Math.max(0, this.aiming - 1)
      }
      this.steer(f, dt, dx, dz, d, target.alive)
    } else {
      const inv = d > 1e-4 ? 1 / d : 0
      const ux = dx * inv
      const uz = dz * inv
      let want = 0
      let sx = 0
      let sz = 0
      if (d < RANGED.kite) {
        // Too close: back away (walls stop it via collideCircle), a little sideways.
        want = f.speed * 0.6
        sx = -ux + -uz * 0.35 * f.side
        sz = -uz + ux * 0.35 * f.side
      } else if (d < RANGED.near) {
        want = f.speed * 0.3
        sx = -ux
        sz = -uz
      } else {
        // Holding range: a slow strafe that flips now and then.
        want = f.speed * 0.45
        sx = -uz * f.side
        sz = ux * f.side
        if (((this.time + f.id * 1.7) % 3.2) < dt) f.side = -f.side
      }
      if (f.aim > 0) want *= 0.2
      if (f.age < SPAWN_TIME) want *= 0.5
      if (f.stun > 0) want *= STUN_SPEED
      want *= speedMul(f)
      const sl = Math.hypot(sx, sz) || 1
      const k = Math.min(1, dt * 6)
      f.vx += ((sx / sl) * want - f.vx) * k
      f.vz += ((sz / sl) * want - f.vz) * k
      f.x += f.vx * dt
      f.z += f.vz * dt
      let turn = Math.atan2(dx, dz) - f.yaw
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      f.yaw += turn * Math.min(1, dt * 10)
    }
    if (f.aim > 0) {
      const sp = SHOT_STYLES[SHOT_STYLE[f.kind]].speed * this.shotSpeed
      const aim = shotAim(f.x, f.z, target, sp)
      if (!f.marking) {
        f.markX = aim.x
        f.markZ = aim.z
        f.marking = true
      } else {
        const k = Math.min(1, dt * 8)
        f.markX += (aim.x - f.markX) * k
        f.markZ += (aim.z - f.markZ) * k
      }
      f.aim -= dt
      if (f.aim <= 0) {
        f.aim = 0
        this.aiming = Math.max(0, this.aiming - 1)
        f.cooldown = shotRest(f)
        if (target.alive && f.los) this.fire(f, target)
        f.marking = false
      }
      return
    }
    if (f.cooldown > 0 || !f.los || !target.alive || f.age < SPAWN_TIME || f.stun > 0 || d < RANGED.minShot || d > this.shotMax) return
    if (this.aiming >= this.shotCap) {
      f.cooldown = 0.15 + 0.25 * ((f.beat + f.id * 0.37) % 1)
      return
    }
    this.aiming += 1
    f.aim = f.aimTime
    const sp0 = SHOT_STYLES[SHOT_STYLE[f.kind]].speed * this.shotSpeed
    const aim0 = shotAim(f.x, f.z, target, sp0)
    f.markX = aim0.x
    f.markZ = aim0.z
    f.marking = true
  }

  /** Let a charged shot go at the ground marker (it tracked her walk; a dash has already left it). */
  private fire(f: HordeFoe, target: HordeTarget): void {
    const slot = this.shots.find((s) => !s.alive)
    if (!slot) return
    const style = SHOT_STYLE[f.kind]
    const sp = SHOT_STYLES[style].speed * this.shotSpeed
    const y = Math.max(0.55, Math.min(1.3, HORDE[f.kind].chest * (f.elite ? ELITE.scale : 1)))
    const dx = (f.marking ? f.markX : target.x) - f.x
    const dz = (f.marking ? f.markZ : target.z) - f.z
    const d = Math.hypot(dx, dz) || 1
    const out = f.radius + 0.15
    slot.alive = true
    slot.style = style
    slot.x = f.x + (dx / d) * out
    slot.z = f.z + (dz / d) * out
    slot.y = y
    slot.vx = (dx / d) * sp
    slot.vz = (dz / d) * sp
    slot.life = RANGED.life
    slot.damage = Math.max(1, Math.round(f.damage * RANGED.damage))
    slot.dodged = false
    slot.seed = (f.id * 0.37) % 1
    this.fired += 1
  }

  private flyShots(dt: number, target: HordeTarget, strike: (amount: number, x: number, z: number) => void): void {
    this.popped.length = 0
    for (const s of this.shots) {
      if (!s.alive) continue
      s.life -= dt
      // Sub-step so a medium shot never tunnels past her or through a thin wall.
      const steps = 2
      for (let k = 0; k < steps && s.alive; k += 1) {
        if (target.alive && !target.dodge) {
          const tx = target.x - s.x
          const tz = target.z - s.z
          const td = Math.hypot(tx, tz) || 1
          const sp = Math.hypot(s.vx, s.vz) || 1
          const steer = Math.min(1, (RANGED.homing * dt) / steps)
          s.vx += ((tx / td) * sp - s.vx) * steer
          s.vz += ((tz / td) * sp - s.vz) * steer
        }
        s.x += (s.vx * dt) / steps
        s.z += (s.vz * dt) / steps
        if (this.solidAt(s.x, s.z)) {
          s.alive = false
          this.popped.push({ x: s.x - (s.vx * dt) / steps, y: s.y, z: s.z - (s.vz * dt) / steps, style: s.style, hit: false })
          break
        }
        const reach = RANGED.radius + 0.55
        if (target.alive && Math.hypot(target.x - s.x, target.z - s.z) < reach) {
          if (target.dodge) {
            if (!s.dodged) this.dodged += 1
            s.dodged = true
            continue
          }
          if (s.dodged) continue
          s.alive = false
          strike(s.damage, s.x - s.vx * 0.05, s.z - s.vz * 0.05)
          this.popped.push({ x: s.x, y: s.y, z: s.z, style: s.style, hit: true })
        }
      }
      if (s.alive && s.life <= 0) {
        s.alive = false
        this.popped.push({ x: s.x, y: s.y, z: s.z, style: s.style, hit: false })
      }
    }
  }

  /** Can a foe at (ax, az) see her at (bx, bz)? */
  private sees(ax: number, az: number, bx: number, bz: number): boolean {
    if (this.aggro?.sight) return this.aggro.sight(ax, az, bx, bz)
    const d = Math.hypot(bx - ax, bz - az)
    const n = Math.ceil(d / (TILE * 0.25))
    for (let i = 1; i < n; i += 1) {
      const t = worldToTile(this.maze, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)
      if (!walkable(this.maze, t.x, t.y)) return false
    }
    return true
  }

  /** Waiting at home (or walking back): look for her now and then. */
  private wander(f: HordeFoe, dt: number, target: HordeTarget, d: number): void {
    const a = this.aggro as Aggro
    f.look -= dt
    if (f.look <= 0) {
      f.look = 0.25
      if (target.alive && d < a.range && this.sees(f.x, f.z, target.x, target.z)) {
        if (this.wakePack(f.pack) || this.chasing < a.cap) {
          f.mode = 'chase'
          f.lost = 0
          return
        }
      }
    }
    if (f.mode === 'home') {
      const hx = f.homeX - f.x
      const hz = f.homeZ - f.z
      const hd = Math.hypot(hx, hz)
      if (hd < 0.6) {
        f.mode = 'idle'
        // Back home it licks its wounds.
        f.hp = f.maxHp
      } else {
        let gx = hx
        let gz = hz
        const field = this.homeField(f.pack, f.homeX, f.homeZ)
        const ft = worldToTile(this.maze, f.x, f.z)
        const here = field.at(ft.x, ft.y)
        if (here > 1 || here < 0) {
          const n = field.next(ft.x, ft.y)
          const c = tileCentre(this.maze, n.x, n.y)
          gx = c.x - f.x
          gz = c.z - f.z
        }
        const gl = Math.hypot(gx, gz) || 1
        const want = f.speed * 0.8 * speedMul(f)
        const k = Math.min(1, dt * 7)
        f.vx += ((gx / gl) * want - f.vx) * k
        f.vz += ((gz / gl) * want - f.vz) * k
        f.x += f.vx * dt
        f.z += f.vz * dt
        if (Math.hypot(f.vx, f.vz) > 0.2) f.yaw = Math.atan2(f.vx, f.vz)
        return
      }
    }
    // Idle: settle, bob in place, turn slowly.
    const k = Math.min(1, dt * 6)
    f.vx -= f.vx * k
    f.vz -= f.vz * k
    f.x += f.vx * dt
    f.z += f.vz * dt
    f.windup = 0
  }

  /** Chasing: lose interest when she is out of sight or too far for a while. */
  private leash(f: HordeFoe, dt: number, target: HordeTarget, d: number): void {
    const a = this.aggro as Aggro
    f.look -= dt
    if (f.look > 0) {
      if (f.lost > 0) f.lost += dt
    } else {
      f.look = 0.25
      const lost = !target.alive || d > a.leash || !this.sees(f.x, f.z, target.x, target.z)
      f.lost = lost ? f.lost + 0.25 : 0
    }
    if (f.lost >= a.leashTime) {
      f.mode = 'home'
      f.lost = 0
      f.windup = 0
      f.aim = 0
    }
  }

  private homeField(pack: number, x: number, z: number): FlowField {
    let field = this.homes.get(pack)
    if (!field) {
      field = new FlowField(this.maze)
      const t = worldToTile(this.maze, x, z)
      field.aim(t.x, t.y)
      this.homes.set(pack, field)
    }
    return field
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
    // Close the gap a little faster, then brake into a ring around her.
    if (hunt && d > 3.2) want *= 1.28
    if (d < f.radius + 0.75) want = 0
    if (f.windup > 0) want *= 0.15
    if (f.age < SPAWN_TIME) want *= 0.5
    if (f.stun > 0) want *= STUN_SPEED
    want *= speedMul(f)
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

  /**
   * Elites' charge: when she is a few metres off and in sight, crouch (the telegraph: it stops and
   * shakes), then rush along that line; touching her on the way hits once. True while it runs the
   * show this frame (steer/melee skipped).
   */
  private charge(f: HordeFoe, dt: number, dx: number, dz: number, d: number, target: HordeTarget, strike: (amount: number, x: number, z: number) => void): boolean {
    const e = DIFFICULTY.elite
    if (f.chargeRun > 0) {
      f.chargeRun -= dt
      const v = f.speed * e.chargeSpeed * speedMul(f)
      f.vx = f.chargeX * v
      f.vz = f.chargeZ * v
      f.x += f.vx * dt
      f.z += f.vz * dt
      if (d < f.radius + 0.8 && target.alive) {
        strike(f.damage, f.x, f.z)
        f.chargeRun = 0
        f.cooldown = swingRest(f)
      }
      if (f.chargeRun <= 0) f.chargeCd = e.chargeEvery
      return true
    }
    if (f.chargeWind > 0) {
      f.chargeWind -= dt
      f.vx *= 0.8
      f.vz *= 0.8
      f.yaw = Math.atan2(f.chargeX, f.chargeZ)
      if (f.chargeWind <= 0) f.chargeRun = e.chargeTime
      return true
    }
    f.chargeCd -= dt
    if (f.chargeCd > 0 || f.mode !== 'chase' || f.windup > 0 || !target.alive || f.age < SPAWN_TIME) return false
    if (d < e.chargeMin || d > e.chargeMax) return false
    if (!this.sees(f.x, f.z, target.x, target.z)) {
      f.chargeCd = 0.5
      return false
    }
    f.chargeX = dx / d
    f.chargeZ = dz / d
    f.chargeWind = e.chargeWind * (f.rage ? 0.8 : 1)
    this.onCharge?.(f)
    return true
  }

  /**
   * A short rush from a few metres out: the ground lane is the tell, the line is committed,
   * and a dash (target.dodge) is not struck. True while the pounce owns this frame.
   */
  private pounce(f: HordeFoe, dt: number, _dx: number, _dz: number, d: number, target: HordeTarget, strike: (amount: number, x: number, z: number) => void): boolean {
    if (f.chargeRun > 0) {
      f.chargeRun -= dt
      if (!target.dodge && target.alive) {
        const tx = target.x - f.x
        const tz = target.z - f.z
        const td = Math.hypot(tx, tz) || 1
        const steer = Math.min(1, dt * 1.5)
        f.chargeX += (tx / td - f.chargeX) * steer
        f.chargeZ += (tz / td - f.chargeZ) * steer
        const len = Math.hypot(f.chargeX, f.chargeZ) || 1
        f.chargeX /= len
        f.chargeZ /= len
      }
      const v = POUNCE.speed * speedMul(f)
      f.vx = f.chargeX * v
      f.vz = f.chargeZ * v
      f.x += f.vx * dt
      f.z += f.vz * dt
      const nd = Math.hypot(target.x - f.x, target.z - f.z)
      if (nd < f.radius + 1.05 && target.alive && !target.dodge) {
        strike(f.damage, f.x, f.z)
        f.chargeRun = 0
        f.cooldown = swingRest(f)
      }
      if (f.chargeRun <= 0 && f.cooldown <= 0) f.cooldown = swingRest(f) * 0.65
      return true
    }
    if (f.chargeWind > 0) {
      f.chargeWind -= dt
      f.vx *= 0.45
      f.vz *= 0.45
      f.yaw = Math.atan2(f.chargeX, f.chargeZ)
      if (f.chargeWind <= 0) f.chargeRun = POUNCE.time
      return true
    }
    if (f.cooldown > 0 || f.windup > 0 || !target.alive || f.age < SPAWN_TIME || f.stun > 0 || target.dodge) return false
    if (d < POUNCE.min || d > POUNCE.max) return false
    const aim = shotAim(f.x, f.z, target, POUNCE.speed)
    const ax = aim.x - f.x
    const az = aim.z - f.z
    const ad = Math.hypot(ax, az) || 1
    f.chargeX = ax / ad
    f.chargeZ = az / ad
    f.chargeWind = POUNCE.wind
    return true
  }

  private melee(f: HordeFoe, dt: number, dx: number, dz: number, d: number, target: HordeTarget, strike: (amount: number, x: number, z: number) => void): void {
    f.cooldown = Math.max(0, f.cooldown - dt)
    const reach = f.radius + 1.15
    if (f.windup > 0) {
      // Hop in during the tell so the ring on the ground is the danger, then strike.
      if (d > 0.35) {
        const hop = Math.min(3.4, f.speed * 1.8) * dt
        f.x += (dx / d) * hop
        f.z += (dz / d) * hop
      }
      f.windup -= dt
      if (f.windup <= 0) {
        f.windup = 0
        this.winding = Math.max(0, this.winding - 1)
        f.cooldown = swingRest(f)
        const nd = Math.hypot(target.x - f.x, target.z - f.z)
        if (nd < reach + 0.55 && target.alive && !target.dodge) strike(f.damage, f.x, f.z)
      }
      return
    }
    if (f.cooldown <= 0 && d < reach && target.alive && !target.dodge && f.age >= SPAWN_TIME) {
      if (this.winding >= this.swingCap) {
        // Her turn-taking: wait a short beat (different per foe) and try again.
        f.cooldown = 0.12 + 0.2 * ((f.beat + f.id * 0.37) % 1)
        return
      }
      this.winding += 1
      f.windup = DIFFICULTY.horde.windup
    }
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
