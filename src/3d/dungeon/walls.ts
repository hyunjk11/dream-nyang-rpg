import { CEILING, TILE, Tile, type Maze } from './maze'

/** Pure collision queries against the maze's solid tiles (walls run floor to ceiling). */

export function solidAt(maze: Maze, x: number, z: number): boolean {
  const tx = Math.floor(x / TILE + maze.w / 2)
  const ty = Math.floor(z / TILE + maze.h / 2)
  if (tx < 0 || ty < 0 || tx >= maze.w || ty >= maze.h) return true
  return maze.tiles[ty * maze.w + tx] === Tile.Solid
}

/** Push a circle (radius r) out of any solid tile it overlaps; returns the corrected centre. */
export function collideCircle(maze: Maze, x: number, z: number, r: number): { x: number; z: number } {
  let px = x
  let pz = z
  for (let pass = 0; pass < 2; pass += 1) {
    const tx = Math.floor(px / TILE + maze.w / 2)
    const ty = Math.floor(pz / TILE + maze.h / 2)
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = tx + dx
        const ny = ty + dy
        const solid = nx < 0 || ny < 0 || nx >= maze.w || ny >= maze.h || maze.tiles[ny * maze.w + nx] === Tile.Solid
        if (!solid) continue
        const minX = (nx - maze.w / 2) * TILE
        const minZ = (ny - maze.h / 2) * TILE
        const cx = Math.max(minX, Math.min(px, minX + TILE))
        const cz = Math.max(minZ, Math.min(pz, minZ + TILE))
        const ox = px - cx
        const oz = pz - cz
        const d2 = ox * ox + oz * oz
        if (d2 >= r * r) continue
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2)
          px = cx + (ox / d) * r
          pz = cz + (oz / d) * r
        } else {
          // Centre inside the block: leave by the nearest face that opens onto a walkable tile.
          const open = (x: number, y: number) => x >= 0 && y >= 0 && x < maze.w && y < maze.h && maze.tiles[y * maze.w + x] !== Tile.Solid
          const exits = [
            { d: px - minX, ok: open(nx - 1, ny), x: minX - r, z: pz },
            { d: minX + TILE - px, ok: open(nx + 1, ny), x: minX + TILE + r, z: pz },
            { d: pz - minZ, ok: open(nx, ny - 1), x: px, z: minZ - r },
            { d: minZ + TILE - pz, ok: open(nx, ny + 1), x: px, z: minZ + TILE + r },
          ].sort((a, b) => Number(b.ok) - Number(a.ok) || a.d - b.d)
          px = exits[0].x
          pz = exits[0].z
        }
      }
    }
  }
  return { x: px, z: pz }
}

/**
 * Distance along a 3D ray to the first wall, floor or ceiling (grid DDA over the tiles).
 * The direction need not be normalised; the answer is in units of its length.
 */
export function rayHit(maze: Maze, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  const len = Math.hypot(dx, dy, dz) || 1
  const ux = dx / len
  const uy = dy / len
  const uz = dz / len
  let best = max
  if (uy < -1e-6) best = Math.min(best, (0 - oy) / uy)
  if (uy > 1e-6) best = Math.min(best, (CEILING - oy) / uy)
  // Tile-space DDA.
  const gx = ox / TILE + maze.w / 2
  const gz = oz / TILE + maze.h / 2
  let tx = Math.floor(gx)
  let tz = Math.floor(gz)
  const isSolid = (x: number, y: number) => x < 0 || y < 0 || x >= maze.w || y >= maze.h || maze.tiles[y * maze.w + x] === Tile.Solid
  if (isSolid(tx, tz)) return 0
  const stepX = ux > 0 ? 1 : -1
  const stepZ = uz > 0 ? 1 : -1
  const perX = Math.abs(ux) > 1e-9 ? TILE / Math.abs(ux) : Infinity
  const perZ = Math.abs(uz) > 1e-9 ? TILE / Math.abs(uz) : Infinity
  let nextX = Math.abs(ux) > 1e-9 ? (ux > 0 ? tx + 1 - gx : gx - tx) * perX : Infinity
  let nextZ = Math.abs(uz) > 1e-9 ? (uz > 0 ? tz + 1 - gz : gz - tz) * perZ : Infinity
  for (let i = 0; i < 256; i += 1) {
    const t = Math.min(nextX, nextZ)
    if (t >= best) break
    if (nextX < nextZ) {
      tx += stepX
      nextX += perX
    } else {
      tz += stepZ
      nextZ += perZ
    }
    if (isSolid(tx, tz)) return Math.min(best, t)
  }
  return best
}
