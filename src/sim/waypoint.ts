/**
 * Quest waypoints (편의성): what a tracked quest points at, the walking route to it over the maze
 * grid, and how far it is. Pure (no Three.js, no DOM) so it is tested headless.
 */
import { PLACE } from './places'

/** What to walk to. `foe` may name a horde kind ('any' / undefined = whichever is nearest). */
export type WaypointGoal =
  | { kind: 'foe'; target?: string }
  | { kind: 'named' }
  | { kind: 'boss' }
  | { kind: 'nest' }
  | { kind: 'chest' }
  | { kind: 'exit' }
  | { kind: 'board' }
  | { kind: 'gate' }
  | { kind: 'return' }
  /** A named town spot (몽이, 볼트…). */
  | { kind: 'spot'; id: string }
  /** The quest foe the floor placed (똑딱 파수꾼). */
  | { kind: 'quest' }

export interface Waypoint {
  /** Tracker row id it came from (a second click on the same row clears it). */
  id: string
  /** Short name in the HUD chip ("솜사탕 슬라임", "게시판"). */
  label: string
  goal: WaypointGoal
}

/** Reached when she is this close (m); the waypoint clears itself. */
export const WAYPOINT_REACH = 2.2

/** A chapter-2 field quest row → its goal. Done quests point at the board in town. */
export function goalForQuest(kind: string, target: string, done: boolean, inRun: boolean): WaypointGoal {
  if (done || !inRun) return done ? { kind: 'board' } : { kind: 'gate' }
  if (kind === 'named') return { kind: 'named' }
  if (kind === 'boss') return { kind: 'boss' }
  if (kind === 'kill') return { kind: 'foe', target: target === 'any' ? undefined : target }
  return { kind: 'foe' }
}

/** Where she stands, seen from a 몽실 들판 quest. */
export type FieldLeg = 'island' | 'mongsil' | 'field' | 'elsewhere'

/** The field's real name on every sign (board, tracker, waypoint chip). */
/** Plain place names (places.ts) so routes read like the portal menu without repeating 'n장'. */
export const FIELD_NAME = PLACE.field.name

/**
 * A 몽실 들판 quest row → the next leg of the walk and what the chip says. The field is only reached
 * from 몽실 마을's 별문, so on the island the trail goes to the island 별문 (→ 몽실 마을) first.
 */
export function fieldQuestWay(kind: string, target: string, done: boolean, leg: FieldLeg, title: string): { goal: WaypointGoal; label: string } {
  if (done) return { goal: { kind: 'board' }, label: `${title} · 게시판에서 보상` }
  if (leg === 'field') return { goal: goalForQuest(kind, target, false, true), label: title }
  if (leg === 'mongsil') return { goal: { kind: 'gate' }, label: `${title} · ${PLACE.mongsil.name} 별문 → ${FIELD_NAME}` }
  if (leg === 'island') return { goal: { kind: 'gate' }, label: `${title} · 별문 → ${PLACE.mongsil.name} → ${FIELD_NAME}` }
  return { goal: { kind: 'exit' }, label: `${title} · 마을로 돌아가 ${FIELD_NAME}로` }
}

/** A board contract row → its goal (down in the sewer), the board when done, else the gate. */
export function goalForContract(kind: string, done: boolean, inRun: boolean): WaypointGoal {
  if (done) return { kind: 'board' }
  if (!inRun) return { kind: 'gate' }
  if (kind === 'nests') return { kind: 'nest' }
  if (kind === 'chests') return { kind: 'chest' }
  if (kind === 'boss') return { kind: 'boss' }
  if (kind === 'clean') return { kind: 'exit' }
  return { kind: 'foe' }
}

/** Nearest point to (x, z), or null. */
export function nearest<T extends { x: number; z: number }>(points: readonly T[], x: number, z: number): T | null {
  let best: T | null = null
  let bd = Infinity
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

/** "12m" under 100 m, then "0.1km" steps. */
export function distanceText(m: number): string {
  if (!Number.isFinite(m)) return ''
  return m < 100 ? `${Math.max(0, Math.round(m))}m` : `${(m / 1000).toFixed(1)}km`
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Tile route from (sx, sy) to (tx, ty) over open tiles (`open(x, y)`), both ends included; empty
 * when unreachable. BFS from the target, then walk downhill from the start, so it is the shortest.
 */
export function route(w: number, h: number, open: (x: number, y: number) => boolean, sx: number, sy: number, tx: number, ty: number, cap = 4096): { x: number; y: number }[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h
  if (!inside(sx, sy) || !inside(tx, ty) || !open(tx, ty)) return []
  const dist = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  dist[ty * w + tx] = 0
  queue[tail++] = ty * w + tx
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    if (x === sx && y === sy) break
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (!inside(nx, ny)) continue
      const j = ny * w + nx
      if (dist[j] >= 0 || !open(nx, ny)) continue
      dist[j] = dist[i] + 1
      queue[tail++] = j
    }
  }
  if (dist[sy * w + sx] < 0) return []
  const out = [{ x: sx, y: sy }]
  let x = sx
  let y = sy
  while ((x !== tx || y !== ty) && out.length < cap) {
    const here = dist[y * w + x]
    let moved = false
    for (const [dx, dy] of DIRS) {
      const nx = x + dx
      const ny = y + dy
      if (!inside(nx, ny)) continue
      const d = dist[ny * w + nx]
      if (d >= 0 && d < here) {
        x = nx
        y = ny
        moved = true
        break
      }
    }
    if (!moved) break
    out.push({ x, y })
  }
  return out
}

/** Route length in metres along tile centres (straight hops of `tile` m), plus the end legs. */
export function routeLength(steps: number, tile: number): number {
  return Math.max(0, steps - 1) * tile
}

/**
 * Evenly spaced trail dots along a polyline (world x/z), starting `offset` m from its head, up to
 * `count` dots `gap` m apart. Animating `offset` makes the trail flow toward the goal.
 */
export function trailDots(line: readonly { x: number; z: number }[], gap: number, count: number, offset = 0): { x: number; z: number; t: number }[] {
  const out: { x: number; z: number; t: number }[] = []
  if (line.length < 2 || gap <= 0) return out
  let want = Math.max(0, offset)
  let walked = 0
  for (let i = 1; i < line.length && out.length < count; i += 1) {
    const a = line[i - 1]
    const b = line[i]
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    while (seg > 0 && want <= walked + seg && out.length < count) {
      const k = (want - walked) / seg
      out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, t: out.length / Math.max(1, count - 1) })
      want += gap
    }
    walked += seg
  }
  return out
}
