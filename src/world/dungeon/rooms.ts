/**
 * Explore-floor layout since 2026-11: rooms on a coarse grid instead of a tile maze. One readable
 * main path of wide (2-tile) corridors runs from the start room to the exit room, a few optional
 * side rooms hang off it on narrow corridors (loot and elites live there), and short straight
 * alcoves give the nests, chests and the secret pocket their dead ends. Same `Maze` data as
 * `generateMaze`, so sewer geometry, the minimap and `planLayout` work unchanged.
 */
import { Tile, rng, type Maze, type Rect } from './maze'

/** Tiles per grid slot (5 open + 1 shared wall line). */
export const SLOT = 6

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export interface RoomMaze extends Maze {
  /** Optional side rooms (also in `chambers`), off the main path. */
  side: Rect[]
  /** Grid slots of the main path, start to exit. */
  path: { x: number; y: number }[]
}

export const ROOMS = {
  /** Side rooms off the main path, inclusive range. */
  side: [3, 4] as const,
  /** Straight 2-tile alcoves (dead ends) for nests, chests and the secret. */
  alcoves: [4, 6] as const,
  /** Chance one side room also joins a second main room (one loop, so a horde can flank). */
  loop: 0.6,
}

export function roomMaze(seed: number, slots = 4, exitSize = 5): RoomMaze {
  const rand = rng(seed)
  const S = slots
  const w = S * SLOT + 1
  const h = w
  const tiles = new Uint8Array(w * h)
  const at = (x: number, y: number) => y * w + x
  const inside = (x: number, y: number) => x > 0 && y > 0 && x < w - 1 && y < h - 1
  const set = (x: number, y: number, v: Tile, over = false) => {
    if (inside(x, y) && (over || tiles[at(x, y)] === Tile.Solid)) tiles[at(x, y)] = v
  }
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]
  // Main path: a monotone staircase from the top-left slot to the bottom-right one, no more
  // than two steps the same way in a row (so it reads as rooms, not a long hall).
  let moves: number[] = []
  for (let k = 0; k < 60; k += 1) {
    moves = [...Array(S - 1).fill(0), ...Array(S - 1).fill(1)]
    for (let i = moves.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1))
      ;[moves[i], moves[j]] = [moves[j], moves[i]]
    }
    if (!moves.some((m, i) => i >= 2 && m === moves[i - 1] && m === moves[i - 2])) break
  }
  const path = [{ x: 0, y: 0 }]
  for (const m of moves) {
    const p = path[path.length - 1]
    path.push(m ? { x: p.x, y: p.y + 1 } : { x: p.x + 1, y: p.y })
  }
  const key = (s: { x: number; y: number }) => s.y * S + s.x
  const onPath = new Map(path.map((s, i) => [key(s), i]))
  // Room rectangles, centred in their slots.
  const rooms = new Map<number, Rect>()
  const roomAt = (sx: number, sy: number, rw: number, rh: number): Rect => {
    const cx = sx * SLOT + 3
    const cy = sy * SLOT + 3
    return { x: cx - Math.floor(rw / 2), y: cy - Math.floor(rh / 2), w: rw, h: rh }
  }
  const fill = (r: Rect, v: Tile) => {
    for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) set(x, y, v, true)
  }
  const startRoom = roomAt(0, 0, 3, 3)
  const exitSlot = path[path.length - 1]
  const bossRoom = roomAt(exitSlot.x, exitSlot.y, Math.min(5, exitSize), Math.min(5, exitSize))
  rooms.set(key(path[0]), startRoom)
  rooms.set(key(exitSlot), bossRoom)
  const chambers: Rect[] = []
  for (const s of path.slice(1, -1)) {
    const r = roomAt(s.x, s.y, pick([3, 5, 5]), pick([3, 5, 5]))
    rooms.set(key(s), r)
    chambers.push(r)
  }
  // Side rooms: empty slots next to a middle room of the main path (never off the exit).
  const nbrs = (s: { x: number; y: number }) =>
    DIRS.map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy })).filter((n) => n.x >= 0 && n.y >= 0 && n.x < S && n.y < S)
  const isMid = (s: { x: number; y: number }) => {
    const i = onPath.get(key(s))
    return i !== undefined && i > 0 && i < path.length - 1
  }
  const free: { x: number; y: number }[] = []
  for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) if (!onPath.has(y * S + x) && nbrs({ x, y }).some(isMid)) free.push({ x, y })
  for (let i = free.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[free[i], free[j]] = [free[j], free[i]]
  }
  const nSide = ROOMS.side[0] + Math.floor(rand() * (ROOMS.side[1] - ROOMS.side[0] + 1))
  const sideSlots = free.slice(0, nSide)
  const side: Rect[] = []
  const links: { a: { x: number; y: number }; b: { x: number; y: number }; wide: boolean }[] = []
  for (let i = 1; i < path.length; i += 1) links.push({ a: path[i - 1], b: path[i], wide: true })
  let looped = false
  for (const s of sideSlots) {
    const r = roomAt(s.x, s.y, pick([3, 3, 5]), pick([3, 3, 5]))
    rooms.set(key(s), r)
    side.push(r)
    chambers.push(r)
    const mains = nbrs(s).filter(isMid)
    links.push({ a: pick(mains), b: s, wide: false })
    if (!looped && mains.length > 1 && rand() < ROOMS.loop) {
      const other = mains.find((m) => !links.some((l) => (l.a === m || l.b === m) && (l.a === s || l.b === s)))
      if (other) {
        links.push({ a: other, b: s, wide: false })
        looped = true
      }
    }
  }
  fill(startRoom, Tile.Start)
  fill(bossRoom, Tile.Boss)
  for (const r of chambers) fill(r, Tile.Chamber)
  // Corridors: straight between the two rooms (slot centres share a row or a column).
  for (const { a, b, wide } of links) {
    const ra = rooms.get(key(a)) as Rect
    const rb = rooms.get(key(b)) as Rect
    const off = wide && rand() < 0.5 ? -1 : 0
    const lanes = wide ? [off, off + 1] : [0]
    if (a.y === b.y) {
      const [l, r] = a.x < b.x ? [ra, rb] : [rb, ra]
      const cy = a.y * SLOT + 3
      for (const o of lanes) for (let x = l.x + l.w; x < r.x; x += 1) set(x, cy + o, Tile.Corridor)
    } else {
      const [t, u] = a.y < b.y ? [ra, rb] : [rb, ra]
      const cx = a.x * SLOT + 3
      for (const o of lanes) for (let y = t.y + t.h; y < u.y; y += 1) set(cx + o, y, Tile.Corridor)
    }
  }
  // Alcoves: two solid tiles straight out of a room wall, with solid all round (a clean dead end).
  const want = ROOMS.alcoves[0] + Math.floor(rand() * (ROOMS.alcoves[1] - ROOMS.alcoves[0] + 1))
  const hosts = [...chambers]
  let made = 0
  for (let tries = 0; tries < 200 && made < want; tries += 1) {
    const r = pick(hosts)
    const [dx, dy] = pick(DIRS)
    // A tile on the chosen wall, not a corner.
    const along = dx ? r.y + 1 + Math.floor(rand() * Math.max(1, r.h - 2)) : r.x + 1 + Math.floor(rand() * Math.max(1, r.w - 2))
    const x0 = dx ? (dx > 0 ? r.x + r.w : r.x - 1) : along
    const y0 = dy ? (dy > 0 ? r.y + r.h : r.y - 1) : along
    const cells = [
      { x: x0, y: y0 },
      { x: x0 + dx, y: y0 + dy },
    ]
    const ok = cells.every((c, i) => {
      if (!inside(c.x, c.y) || tiles[at(c.x, c.y)] !== Tile.Solid) return false
      // Sides solid; the far end solid past the last tile.
      for (const [ex, ey] of DIRS) {
        const nx = c.x + ex
        const ny = c.y + ey
        const back = ex === -dx && ey === -dy
        if (back) continue
        if (i === 0 && ex === dx && ey === dy) continue
        if (!inside(nx, ny) || tiles[at(nx, ny)] !== Tile.Solid) return false
        // Keep a wall between the alcove and anything diagonal, so it reads as a nook.
      }
      return true
    })
    if (!ok) continue
    for (const c of cells) set(c.x, c.y, Tile.Corridor)
    made += 1
  }
  return { seed, w, h, tiles, start: { x: startRoom.x + 1, y: startRoom.y + 1 }, startRoom, bossRoom, chambers, nests: [], side, path }
}

/**
 * Boss floor since 2026-11 (fix/boss-floor): no tile maze and no wave pipes. A small start room,
 * one wide (2-tile) hall, and one big open arena (the boss room) with four pillars near its
 * corners, so the camera has room to breathe and the fight reads at a glance.
 */
export const BOSS_ARENA = {
  /** Arena size in tiles (odd so the boss and the chest sit on a centre tile). */
  size: 9,
  /** Tiles of hall between the start room and the arena. */
  hall: 4,
}

export function bossMaze(seed: number, size: number = BOSS_ARENA.size): RoomMaze {
  const s = Math.max(7, size | 1)
  const w = s + 4
  const startRoom: Rect = { x: Math.floor(w / 2) - 1, y: 1, w: 3, h: 3 }
  const hallY = startRoom.y + startRoom.h
  const bossRoom: Rect = { x: 2, y: hallY + BOSS_ARENA.hall, w: s, h: s }
  const h = (bossRoom.y + bossRoom.h + 2) | 1
  const tiles = new Uint8Array(w * h)
  const set = (x: number, y: number, v: Tile) => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[y * w + x] = v
  }
  const fill = (r: Rect, v: Tile) => {
    for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) set(x, y, v)
  }
  fill(startRoom, Tile.Start)
  // The hall: two lanes, the seed picks which side of centre the second lane takes.
  const cx = startRoom.x + 1
  const lanes = rng(seed)() < 0.5 ? [cx - 1, cx] : [cx, cx + 1]
  for (let y = hallY; y < bossRoom.y; y += 1) for (const x of lanes) set(x, y, Tile.Corridor)
  fill(bossRoom, Tile.Boss)
  // Four pillars two tiles in from the corners: cover from the orb rings, never on the centre lines.
  for (const [px, py] of [[2, 2], [s - 3, 2], [2, s - 3], [s - 3, s - 3]]) tiles[(bossRoom.y + py) * w + bossRoom.x + px] = Tile.Solid
  return { seed, w, h, tiles, start: { x: startRoom.x + 1, y: startRoom.y + 1 }, startRoom, bossRoom, chambers: [], nests: [], side: [], path: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }
}
