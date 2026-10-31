/**
 * Explore floors (Diablo / Hellgate style): instead of timed waves, every normal floor is laid out
 * once when it is built: monster packs waiting in rooms and corridors, one or two elite packs
 * (one of them carries the star key from floor 2 on), a few optional nest pipes, chests in the
 * dead ends, one shrine, maybe a cracked wall with a secret pocket, and the exit room at the
 * far end of the maze behind a star door. Pure data: run.ts / explore.ts bring it to life.
 */
import { waveFor } from './waves'
import type { HordeKind } from './horde'
import { Tile, distances, generateMaze, walkable, type Maze, type Nest, type Rect } from './maze'
import type { FloorPlan } from '../../sim/delve'

/** Every explore-floor knob in one place (numbers from the approved audit plan). */
export const EXPLORE = {
  /** Packs on a depth-1 floor, and the growth per extra depth. */
  packs: [10, 14] as const,
  packGrowth: 0.15,
  /** Foes in an ordinary pack: small near the start, bigger further in. */
  packSize: [3, 6] as const,
  /** Elite packs: one leader + minions. */
  elitePacks: [1, 2] as const,
  minions: 4,
  /** Wake when she is in sight this close (m); the whole pack wakes together. */
  aggro: 12,
  /** Give up after this long (s) out of sight or farther than `leash` (m), then walk home. */
  leash: 18,
  leashTime: 6,
  /** At most this many foes chase her at once (more wake as others fall). */
  chaseCap: 12,
  /** Optional nest pipes: count, burst size, seconds between bursts, live cap per pipe, wake range (m). */
  nests: [2, 3] as const,
  nestBurst: [2, 3] as const,
  nestEvery: 6,
  nestCap: 6,
  nestRange: 14,
  /** Dead-end chests, the shrine buff (s) and the chance of a secret pocket. */
  chests: [3, 5] as const,
  shrineTime: 30,
  secretChance: 0.65,
  /** The exit room's nearest tile is at least this many steps from the start. */
  exitMin: 30,
  /** Dead ends knocked into loops (lower than the boss floor's 0.34: more nooks for chests). */
  braid: 0.12,
  /** No pack this close (tiles) to the start: the first room is safe. */
  safe: 7,
  /** Foe hp on explore floors (on top of DIFFICULTY.horde.hp): fewer foes, each one a bit meatier. */
  hp: 1.35,
} as const

/** Elite affixes: a name prefix and what it does. */
export const ELITE_AFFIXES = {
  swift: { name: '재빠른', speed: 1.35, hp: 1, damage: 1 },
  sturdy: { name: '단단한', speed: 1, hp: 1.5, damage: 1 },
  fierce: { name: '사나운', speed: 1, hp: 1, damage: 1.35 },
  giant: { name: '거대한', speed: 0.9, hp: 1.35, damage: 1.15 },
} as const
export type EliteAffix = keyof typeof ELITE_AFFIXES

/** Korean names for the pack kinds (elite name tags, banners). */
export const KIND_KO: Record<HordeKind, string> = {
  slime: '솜사탕 슬라임',
  bug: '꿈벌레',
  rabbit: '악몽 토끼',
  bat: '꿈박쥐',
  skeleton: '해골 병정',
  skel_rogue: '해골 도적',
  skel_warrior: '해골 전사',
  skel_mage: '해골 마법사',
  lich: '리치',
  jelly: '꿈 젤리',
  wolf: '잠꼬대 늑대',
  goblin: '베개 도둑',
  knight: '구름 기사',
  wraith: '이불 망령',
  golem: '마시멜로 골렘',
  drake: '솜사탕 드레이크',
  lord: '악몽 군주',
}

export interface Pack {
  id: number
  /** Home tile (the foes stand round it and walk back to it). */
  x: number
  y: number
  kinds: HordeKind[]
  size: number
  /** Elite pack: the leader's affixes (minions are ordinary). */
  elite: EliteAffix[] | null
  /** This elite carries the star key. */
  key: boolean
  /** BFS steps from the start (pacing). */
  dist: number
}

export interface Spot {
  x: number
  y: number
}

export interface SecretPocket {
  /** The cracked wall tile (open in the geometry, solid until shot). */
  wall: Spot
  /** The hidden tile behind it (the chest sits here). */
  pocket: Spot
  /** Step from the dead end into the wall. */
  dx: number
  dy: number
}

export interface Layout {
  /** The exit room (the far chamber) and its steps from the start. */
  exit: Rect
  exitDist: number
  /** Star-door tiles in front of the exit room (key floors only). */
  doors: Spot[]
  packs: Pack[]
  /** Optional nest pipes (a subset of the maze's dead ends). */
  nests: Nest[]
  chests: Spot[]
  shrine: Spot | null
  secret: SecretPocket | null
  /** The pack whose elite carries the key, or -1. */
  keyPack: number
  needsKey: boolean
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h

function openCount(m: Maze, x: number, y: number): number {
  let n = 0
  for (const [dx, dy] of DIRS) if (walkable(m, x + dx, y + dy)) n += 1
  return n
}

/** Steps from the start to the nearest tile of the room. */
export function roomDistance(m: Maze, r: Rect): number {
  const d = distances(m.tiles, m.w, m.h, m.start.x, m.start.y)
  let best = Infinity
  for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) if (d[y * m.w + x] >= 0) best = Math.min(best, d[y * m.w + x])
  return best
}

/** The floor's maze; explore floors keep more dead ends and re-roll (seeded) until the exit room is far. */
export function floorMaze(plan: Pick<FloorPlan, 'seed' | 'cells' | 'bossRoom' | 'objective'>): Maze {
  if (plan.objective === 'boss') return generateMaze(plan.seed, plan.cells, plan.cells, plan.bossRoom)
  let best: Maze | null = null
  let bestD = -1
  for (let k = 0; k < 16 && bestD < EXPLORE.exitMin; k += 1) {
    const seed = k ? (plan.seed + Math.imul(k, 0x9e3779b1)) >>> 0 || k : plan.seed
    const maze = generateMaze(seed, plan.cells, plan.cells, plan.bossRoom, EXPLORE.braid)
    const d = roomDistance(maze, maze.bossRoom)
    if (d > bestD) {
      best = maze
      bestD = d
    }
  }
  return best as Maze
}

/** Room kinds for a pack: the roster this deep, harder kinds further from the start. */
function kindsFor(depth: number, floor: number, r: number, rand: () => number): HordeKind[] {
  const tier = 1 + (depth - 1) * 2 + (floor - 1) + (r > 0.55 ? 1 : 0)
  const pool = waveFor(tier).kinds
  // A pack is themed: one or two kinds, favouring the newest unlocks.
  const a = pool[Math.max(0, pool.length - 1 - Math.floor(rand() * Math.min(pool.length, 4)))]
  const b = pool[Math.floor(rand() * pool.length)]
  return a === b || rand() < 0.4 ? [a] : [a, b]
}

/**
 * Lay out an explore floor. Mutates the maze in one small way: `nests` becomes just the chosen
 * optional pipes (so the decor draws only those). The door and cracked-wall tiles stay open in
 * the geometry; the director closes them for walking and shots afterwards (see `blockers`).
 */
export function planLayout(maze: Maze, plan: Pick<FloorPlan, 'depth' | 'floor'>, rand: () => number): Layout {
  const m = maze
  const dist = distances(m.tiles, m.w, m.h, m.start.x, m.start.y)
  const exit = m.bossRoom
  const exitDist = roomDistance(m, exit)
  const needsKey = plan.floor >= 2
  // Door tiles: the open tiles just outside the exit room.
  const doors: Spot[] = []
  if (needsKey) {
    for (let y = exit.y - 1; y <= exit.y + exit.h; y += 1) {
      for (let x = exit.x - 1; x <= exit.x + exit.w; x += 1) {
        if (inRect(exit, x, y) || !walkable(m, x, y)) continue
        if (DIRS.some(([dx, dy]) => inRect(exit, x + dx, y + dy))) doors.push({ x, y })
      }
    }
  }
  const isDoor = (x: number, y: number) => doors.some((d) => d.x === x && d.y === y)
  // What she can reach before the doors open (the key must be out here).
  const shut = Uint8Array.from(m.tiles)
  for (const d of doors) shut[d.y * m.w + d.x] = Tile.Solid
  const before = distances(shut, m.w, m.h, m.start.x, m.start.y)
  // Dead ends (after braiding) far enough from the start: nests, chests, the secret.
  const dead: (Spot & { dx: number; dy: number; d: number })[] = []
  for (let y = 1; y < m.h - 1; y += 1) {
    for (let x = 1; x < m.w - 1; x += 1) {
      const t = m.tiles[y * m.w + x]
      if (t !== Tile.Corridor || openCount(m, x, y) !== 1 || dist[y * m.w + x] < 5 || isDoor(x, y)) continue
      const [dx, dy] = DIRS.find(([ddx, ddy]) => walkable(m, x + ddx, y + ddy)) ?? [1, 0]
      dead.push({ x, y, dx, dy, d: dist[y * m.w + x] })
    }
  }
  shuffle(dead, rand)
  const nNests = Math.min(dead.length, between(EXPLORE.nests, rand))
  const nests: Nest[] = dead.slice(0, nNests).map((d) => ({ x: d.x, y: d.y, dx: d.dx, dy: d.dy }))
  const rest = dead.slice(nNests).sort((a, b) => b.d - a.d)
  // Secret pocket: a dead end at the end of a short spur; the spur tile before it becomes a
  // cracked wall (closed until shot), the dead end behind it the pocket with a rich chest.
  let secret: SecretPocket | null = null
  if (rand() < EXPLORE.secretChance) {
    for (let i = 0; i < rest.length && !secret; i += 1) {
      const d = rest[i]
      const wx = d.x + d.dx
      const wy = d.y + d.dy
      if (m.tiles[wy * m.w + wx] !== Tile.Corridor || openCount(m, wx, wy) !== 2 || isDoor(wx, wy)) continue
      const o = DIRS.find(([dx, dy]) => !(wx + dx === d.x && wy + dy === d.y) && walkable(m, wx + dx, wy + dy))
      if (!o) continue
      // A straight spur only, so the plug reads as a wall at a corridor's end.
      if (o[0] !== d.dx || o[1] !== d.dy) continue
      secret = { wall: { x: wx, y: wy }, pocket: { x: d.x, y: d.y }, dx: -o[0], dy: -o[1] }
      rest.splice(i, 1)
    }
  }
  const wantChests = between(EXPLORE.chests, rand)
  const chests: Spot[] = rest.slice(0, wantChests).map((d) => ({ x: d.x, y: d.y }))
  m.nests = nests
  // Shrine: the side chamber nearest the middle of the route (a rest stop), else a corridor tile.
  const mid = exitDist / 2
  const halls = m.chambers.map((c) => ({ x: c.x + 1, y: c.y + 1 })).filter((c) => dist[c.y * m.w + c.x] >= EXPLORE.safe)
  halls.sort((a, b) => Math.abs(dist[a.y * m.w + a.x] - mid) - Math.abs(dist[b.y * m.w + b.x] - mid))
  const shrine: Spot | null = halls[0] ?? null
  // Too few dead ends (backtracker mazes have few): tuck the rest into hall corners, farthest first.
  if (chests.length < wantChests) {
    const corners: Spot[] = []
    for (const c of [...m.chambers, exit]) {
      const cs = [
        { x: c.x, y: c.y },
        { x: c.x + c.w - 1, y: c.y },
        { x: c.x, y: c.y + c.h - 1 },
        { x: c.x + c.w - 1, y: c.y + c.h - 1 },
      ].filter((k) => openCount(m, k.x, k.y) === 2 && dist[k.y * m.w + k.x] >= EXPLORE.safe)
      shuffle(cs, rand)
      if (cs[0]) corners.push(cs[0])
    }
    corners.sort((a, b) => dist[b.y * m.w + b.x] - dist[a.y * m.w + a.x])
    for (const c of corners) if (chests.length < wantChests) chests.push(c)
  }
  // Still short: corridor bends (a chest round a corner), spread out.
  if (chests.length < EXPLORE.chests[0]) {
    const bends: Spot[] = []
    for (let y = 1; y < m.h - 1; y += 1) {
      for (let x = 1; x < m.w - 1; x += 1) {
        if (m.tiles[y * m.w + x] !== Tile.Corridor || openCount(m, x, y) !== 2 || dist[y * m.w + x] < EXPLORE.safe || isDoor(x, y)) continue
        const h = walkable(m, x - 1, y) || walkable(m, x + 1, y)
        const v = walkable(m, x, y - 1) || walkable(m, x, y + 1)
        if (h && v) bends.push({ x, y })
      }
    }
    shuffle(bends, rand)
    for (const b of bends) {
      if (chests.length >= EXPLORE.chests[0]) break
      if (secret && b.x === secret.wall.x && b.y === secret.wall.y) continue
      if (chests.some((c) => Math.abs(c.x - b.x) + Math.abs(c.y - b.y) < 6)) continue
      chests.push(b)
    }
  }
  // Packs: farthest-point sampling over open tiles, chambers first, away from the start.
  const taken = new Set<number>()
  for (const s of [...chests, ...nests, ...(shrine ? [shrine] : [])]) taken.add(s.y * m.w + s.x)
  const cands: Spot[] = []
  for (let y = 0; y < m.h; y += 1) {
    for (let x = 0; x < m.w; x += 1) {
      const i = y * m.w + x
      const t = m.tiles[i]
      if (t === Tile.Solid || t === Tile.Start || dist[i] < EXPLORE.safe || isDoor(x, y) || taken.has(i)) continue
      if (secret && ((x === secret.wall.x && y === secret.wall.y) || (x === secret.pocket.x && y === secret.pocket.y))) continue
      cands.push({ x, y })
    }
  }
  shuffle(cands, rand)
  // Chambers (and the exit room centre) are the natural lairs: try them first.
  const lairs = [...m.chambers.map((c) => ({ x: c.x + 1, y: c.y + 1 })), { x: exit.x + Math.floor(exit.w / 2), y: exit.y + Math.floor(exit.h / 2) }]
  const want = Math.round(between(EXPLORE.packs, rand) * (1 + EXPLORE.packGrowth * Math.max(0, plan.depth - 1)))
  const homes: Spot[] = []
  const spacing = [5, 4, 3]
  for (const gap of spacing) {
    for (const c of [...lairs, ...cands]) {
      if (homes.length >= want) break
      const i = c.y * m.w + c.x
      if (dist[i] < EXPLORE.safe || taken.has(i) || homes.some((h) => h.x === c.x && h.y === c.y)) continue
      const near = distances(m.tiles, m.w, m.h, c.x, c.y)
      if (homes.some((h) => near[h.y * m.w + h.x] >= 0 && near[h.y * m.w + h.x] < gap)) continue
      homes.push(c)
    }
  }
  homes.sort((a, b) => dist[a.y * m.w + a.x] - dist[b.y * m.w + b.x])
  const far = Math.max(1, dist[homes[homes.length - 1] ? homes[homes.length - 1].y * m.w + homes[homes.length - 1].x : 0])
  const packs: Pack[] = homes.map((h, id) => {
    const d = dist[h.y * m.w + h.x]
    const r = d / far
    // Pacing: small packs first, medium further in.
    const size = Math.max(EXPLORE.packSize[0], Math.min(EXPLORE.packSize[1], 3 + Math.round(r * 2.2 + rand() * 1.1 - 0.3)))
    return { id, x: h.x, y: h.y, kinds: kindsFor(plan.depth, plan.floor, r, rand), size, elite: null, key: false, dist: d }
  })
  // Elites: from the middle of the route on, never in the first third.
  const nElites = Math.min(packs.length, plan.depth === 1 && plan.floor === 1 ? EXPLORE.elitePacks[0] : EXPLORE.elitePacks[1])
  const outside = (p: Pack) => !inRect(exit, p.x, p.y) && before[p.y * m.w + p.x] >= 0
  const pool = packs.filter((p) => p.dist >= exitDist * 0.35 && outside(p))
  const elitePool = pool.length >= nElites ? pool : packs.filter(outside)
  shuffle(elitePool, rand)
  const affixes = Object.keys(ELITE_AFFIXES) as EliteAffix[]
  for (const p of elitePool.slice(0, nElites)) {
    const k = plan.depth >= 2 ? 2 : 1
    const a = shuffle([...affixes], rand).slice(0, k)
    p.elite = a
    p.size = 1 + EXPLORE.minions
  }
  let keyPack = -1
  if (needsKey) {
    const holder = packs.filter((p) => p.elite && outside(p)).sort((a, b) => a.dist - b.dist)[0]
    if (holder) {
      holder.key = true
      keyPack = holder.id
    }
  }
  return { exit, exitDist, doors, packs, nests, chests, shrine, secret, keyPack, needsKey: needsKey && keyPack >= 0 }
}

/** Tiles that are open in the geometry but closed to walking and shots until opened. */
export function blockers(layout: Layout): Spot[] {
  return [...(layout.needsKey ? layout.doors : []), ...(layout.secret ? [layout.secret.wall] : [])]
}

/** "재빠른 단단한 꿈벌레". */
export function eliteName(kind: HordeKind, affixes: readonly EliteAffix[]): string {
  return [...affixes.map((a) => ELITE_AFFIXES[a].name), KIND_KO[kind]].join(' ')
}

function between(r: readonly [number, number], rand: () => number): number {
  return r[0] + Math.floor(rand() * (r[1] - r[0] + 1))
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
