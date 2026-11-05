/**
 * One-tile steps around maze walls for 자동 사냥. The wish used to point straight at the foe, so
 * she rubbed a corner forever. This walks open tiles (the same grid the sewer uses) and only
 * cuts straight across when every sampled tile on the way is open.
 */

export interface HuntGrid {
  w: number
  h: number
  open: (tx: number, ty: number) => boolean
  toTile: (x: number, z: number) => { x: number; y: number }
  toWorld: (tx: number, ty: number) => { x: number; z: number }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

function inside(grid: HuntGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h
}

/** Nearest open tile to (x, y), or null when the grid has none nearby. */
export function nearestOpen(grid: HuntGrid, x: number, y: number, radius = 6): { x: number; y: number } | null {
  if (inside(grid, x, y) && grid.open(x, y)) return { x, y }
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (let r = 1; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = x + dx
        const ny = y + dy
        if (!inside(grid, nx, ny) || !grid.open(nx, ny)) continue
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = { x: nx, y: ny }
        }
      }
    }
    if (best) return best
  }
  return best
}

/** True when samples along the segment all sit on open tiles (corners included). */
export function worldClear(px: number, pz: number, gx: number, gz: number, grid: HuntGrid): boolean {
  const dx = gx - px
  const dz = gz - pz
  const dist = Math.hypot(dx, dz)
  const n = Math.max(1, Math.ceil(dist / 0.7))
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const tile = grid.toTile(px + dx * t, pz + dz * t)
    if (!inside(grid, tile.x, tile.y) || !grid.open(tile.x, tile.y)) return false
  }
  return true
}

/** First open step from (sx, sy) toward (gx, gy). Null when no path exists. */
export function bfsNext(grid: HuntGrid, sx: number, sy: number, gx: number, gy: number): { x: number; y: number } | null {
  if (!inside(grid, sx, sy) || !inside(grid, gx, gy)) return null
  if (!grid.open(sx, sy) || !grid.open(gx, gy)) return null
  if (sx === gx && sy === gy) return { x: sx, y: sy }
  const { w, h } = grid
  const dist = new Int32Array(w * h).fill(-1)
  const parent = new Int32Array(w * h).fill(-1)
  const qx = new Int32Array(w * h)
  const qy = new Int32Array(w * h)
  let head = 0
  let tail = 0
  dist[sy * w + sx] = 0
  qx[tail] = sx
  qy[tail] = sy
  tail += 1
  while (head < tail) {
    const x = qx[head]
    const y = qy[head]
    head += 1
    if (x === gx && y === gy) break
    const base = dist[y * w + x] + 1
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (!inside(grid, nx, ny) || !grid.open(nx, ny)) continue
      const j = ny * w + nx
      if (dist[j] >= 0) continue
      dist[j] = base
      parent[j] = y * w + x
      qx[tail] = nx
      qy[tail] = ny
      tail += 1
    }
  }
  const goal = gy * w + gx
  if (dist[goal] < 0) return null
  const start = sy * w + sx
  let cur = goal
  let prev = parent[cur]
  while (prev !== start && prev >= 0) {
    cur = prev
    prev = parent[cur]
  }
  return { x: cur % w, y: (cur - (cur % w)) / w }
}

/**
 * World point to walk toward. A clear hallway is the goal itself; a wall in the way is the next
 * open tile on the path, never the wall.
 */
export function routePoint(px: number, pz: number, gx: number, gz: number, grid: HuntGrid): { x: number; z: number } {
  const here = grid.toTile(px, pz)
  let goal = grid.toTile(gx, gz)
  if (!inside(grid, here.x, here.y) || !grid.open(here.x, here.y)) {
    const n = nearestOpen(grid, here.x, here.y)
    if (!n) return { x: gx, z: gz }
    return grid.toWorld(n.x, n.y)
  }
  if (!inside(grid, goal.x, goal.y) || !grid.open(goal.x, goal.y)) {
    const n = nearestOpen(grid, goal.x, goal.y)
    if (!n) return { x: gx, z: gz }
    goal = n
  }
  if (here.x === goal.x && here.y === goal.y) return { x: gx, z: gz }
  if (worldClear(px, pz, gx, gz, grid)) return { x: gx, z: gz }
  const step = bfsNext(grid, here.x, here.y, goal.x, goal.y)
  if (!step || (step.x === here.x && step.y === here.y)) return { x: gx, z: gz }
  return grid.toWorld(step.x, step.y)
}
