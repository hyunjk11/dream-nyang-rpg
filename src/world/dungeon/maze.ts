/**
 * Dream sewer maze: a seeded grid maze (recursive backtracker, partly braided so the horde has
 * more than one way in), with a start chamber, a few side chambers, dead-end nests and a boss
 * chamber at the far end. Pure data; sewer.ts turns it into geometry.
 */

/** Size of one maze tile in metres (corridor width). */
export const TILE = 3.4
/** Tunnel ceiling height (m); the camera stays under it. */
export const CEILING = 4.2

export const Tile = {
  Solid: 0,
  Corridor: 1,
  Chamber: 2,
  Start: 3,
  Boss: 4,
} as const
export type Tile = (typeof Tile)[keyof typeof Tile]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Nest {
  x: number
  y: number
  /** Unit step (tile) from the nest into the open tunnel. */
  dx: number
  dy: number
}

export interface Maze {
  seed: number
  /** Width and height in tiles (always odd). */
  w: number
  h: number
  tiles: Uint8Array
  start: { x: number; y: number }
  startRoom: Rect
  bossRoom: Rect
  chambers: Rect[]
  nests: Nest[]
}

/** Small, fast seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/** `braid`: share of dead ends knocked through into loops (explore floors keep more dead ends). */
export function generateMaze(seed: number, cellsW = 9, cellsH = 9, bossSize = 5, braid = 0.34): Maze {
  const rand = rng(seed)
  const w = cellsW * 2 + 1
  const h = cellsH * 2 + 1
  const tiles = new Uint8Array(w * h)
  const at = (x: number, y: number) => y * w + x
  const set = (x: number, y: number, v: Tile) => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[at(x, y)] = v
  }
  // Perfect maze over the odd tiles.
  const seen = new Uint8Array(cellsW * cellsH)
  const stack: [number, number][] = [[0, 0]]
  seen[0] = 1
  set(1, 1, Tile.Corridor)
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1]
    const open = DIRS.filter(([dx, dy]) => {
      const nx = cx + dx
      const ny = cy + dy
      return nx >= 0 && ny >= 0 && nx < cellsW && ny < cellsH && !seen[ny * cellsW + nx]
    })
    if (!open.length) {
      stack.pop()
      continue
    }
    const [dx, dy] = open[Math.floor(rand() * open.length)]
    const nx = cx + dx
    const ny = cy + dy
    seen[ny * cellsW + nx] = 1
    set(cx * 2 + 1 + dx, cy * 2 + 1 + dy, Tile.Corridor)
    set(nx * 2 + 1, ny * 2 + 1, Tile.Corridor)
    stack.push([nx, ny])
  }
  // Braid some dead ends into loops (about a third by default) so a horde can flank.
  for (let cy = 0; cy < cellsH; cy += 1) {
    for (let cx = 0; cx < cellsW; cx += 1) {
      const x = cx * 2 + 1
      const y = cy * 2 + 1
      if (openCount(tiles, w, x, y) !== 1 || rand() > braid) continue
      const walls = DIRS.filter(([dx, dy]) => {
        const bx = x + dx * 2
        const by = y + dy * 2
        return bx > 0 && by > 0 && bx < w - 1 && by < h - 1 && tiles[at(x + dx, y + dy)] === Tile.Solid
      })
      if (!walls.length) continue
      const [dx, dy] = walls[Math.floor(rand() * walls.length)]
      set(x + dx, y + dy, Tile.Corridor)
    }
  }
  const fill = (r: Rect, v: Tile) => {
    for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) set(x, y, v)
  }
  const startRoom: Rect = { x: 1, y: 1, w: 3, h: 3 }
  fill(startRoom, Tile.Start)
  const start = { x: 2, y: 2 }
  // Boss chamber round the tile farthest from the start.
  const far = farthest(tiles, w, h, start.x, start.y)
  const bw = bossSize
  const bh = bossSize
  const half = Math.floor(bossSize / 2)
  const bossRoom: Rect = {
    x: clamp(far.x - half, 1, w - 1 - bw),
    y: clamp(far.y - half, 1, h - 1 - bh),
    w: bw,
    h: bh,
  }
  fill(bossRoom, Tile.Boss)
  // Side chambers: 3x3 halls on odd tiles, away from the start and the boss.
  const chambers: Rect[] = []
  for (let tries = 0; tries < 40 && chambers.length < 3; tries += 1) {
    const r: Rect = { x: 1 + 2 * Math.floor(rand() * (cellsW - 1)), y: 1 + 2 * Math.floor(rand() * (cellsH - 1)), w: 3, h: 3 }
    if (overlaps(r, startRoom, 2) || overlaps(r, bossRoom, 2) || chambers.some((c) => overlaps(r, c, 1))) continue
    chambers.push(r)
    fill(r, Tile.Chamber)
  }
  // Dead ends left after the carving become nests (spawn pipes), if not too close to the start.
  const dist = distances(tiles, w, h, start.x, start.y)
  const nests: Nest[] = []
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (tiles[at(x, y)] !== Tile.Corridor || openCount(tiles, w, x, y) !== 1) continue
      if (dist[at(x, y)] < 6) continue
      const [dx, dy] = DIRS.find(([ddx, ddy]) => tiles[at(x + ddx, y + ddy)] !== Tile.Solid) ?? [1, 0]
      nests.push({ x, y, dx, dy })
    }
  }
  return { seed, w, h, tiles, start, startRoom, bossRoom, chambers, nests }
}

export function walkable(maze: Maze, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < maze.w && y < maze.h && maze.tiles[y * maze.w + x] !== Tile.Solid
}

/** Tile centre in world metres; the maze is centred on the origin. */
export function tileCentre(maze: Maze, x: number, y: number): { x: number; z: number } {
  return { x: (x - maze.w / 2 + 0.5) * TILE, z: (y - maze.h / 2 + 0.5) * TILE }
}

export function worldToTile(maze: Maze, x: number, z: number): { x: number; y: number } {
  return { x: Math.floor(x / TILE + maze.w / 2), y: Math.floor(z / TILE + maze.h / 2) }
}

/** BFS step counts from a tile over open tiles; -1 where unreachable. */
export function distances(tiles: Uint8Array, w: number, h: number, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  dist[sy * w + sx] = 0
  queue[tail++] = sy * w + sx
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (tiles[j] === Tile.Solid || dist[j] >= 0) continue
      dist[j] = dist[i] + 1
      queue[tail++] = j
    }
  }
  return dist
}

function farthest(tiles: Uint8Array, w: number, h: number, sx: number, sy: number): { x: number; y: number } {
  const dist = distances(tiles, w, h, sx, sy)
  let best = 0
  for (let i = 0; i < dist.length; i += 1) if (dist[i] > dist[best]) best = i
  return { x: best % w, y: Math.floor(best / w) }
}

function openCount(tiles: Uint8Array, w: number, x: number, y: number): number {
  let n = 0
  for (const [dx, dy] of DIRS) if (tiles[(y + dy) * w + x + dx] !== Tile.Solid) n += 1
  return n
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
