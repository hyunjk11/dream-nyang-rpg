/** Pure layout for the dream island: paths, decoration spots and budgets. No Three.js. */

import { PLACES } from './places'

export const ISLAND_RADIUS = 14.5
export const WALK_RADIUS = 13.2

export interface Budget {
  grass: number
  flowers: number
  pebbles: number
  crystals: number
  mushrooms: number
  motes: number
  texture: number
}

export function islandBudget(lowPower: boolean): Budget {
  return lowPower
    ? { grass: 800, flowers: 160, pebbles: 80, crystals: 12, mushrooms: 14, motes: 60, texture: 1024 }
    : { grass: 2200, flowers: 320, pebbles: 150, crystals: 18, mushrooms: 22, motes: 140, texture: 2048 }
}

/** Deterministic RNG so the island looks the same every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Pt = { x: number; z: number }

/** Two soft winding paths that cross near the middle, plus a loop around the plaza. */
export function islandPaths(): Pt[][] {
  const paths: Pt[][] = []
  const a: Pt[] = []
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40
    const x = -13 + t * 26
    a.push({ x, z: Math.sin(t * Math.PI * 1.6 + 0.4) * 2.2 + 0.6 })
  }
  paths.push(a)
  const b: Pt[] = []
  for (let i = 0; i <= 36; i += 1) {
    const t = i / 36
    const z = -12.5 + t * 25
    b.push({ x: Math.sin(t * Math.PI * 1.3 + 1.1) * 2.4 - 0.8, z })
  }
  paths.push(b)
  const loop: Pt[] = []
  for (let i = 0; i <= 48; i += 1) {
    const ang = (i / 48) * Math.PI * 2
    const r = 7.4 + Math.sin(ang * 3) * 0.6
    loop.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r })
  }
  paths.push(loop)
  return paths
}

export const PATH_WIDTH = [0.72, 0.62, 0.46]

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len))
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

/** Distance from a point to the nearest path edge (negative = on the path). */
export function pathEdgeDistance(p: Pt, paths = islandPaths()): number {
  let best = Infinity
  paths.forEach((path, k) => {
    const half = PATH_WIDTH[k] ?? 0.8
    for (let i = 1; i < path.length; i += 1) best = Math.min(best, segDist(p, path[i - 1], path[i]) - half)
  })
  return best
}

export interface Spot {
  x: number
  z: number
  scale: number
  turn: number
  tint: number
}

export interface ScatterRule {
  count: number
  minR: number
  maxR: number
  /** Required distance from the path edge. Negative values allow placement on the path. */
  clearPath: number
  /** Keep the spawn plaza clear. */
  clearCenter: number
  scale: [number, number]
  /** Clump spots around a few seeds instead of spreading them evenly. */
  clumps?: number
  seed: number
}

export function scatterSpots(rule: ScatterRule, paths = islandPaths()): Spot[] {
  const rand = mulberry32(rule.seed)
  const out: Spot[] = []
  const seeds: Pt[] = []
  for (let i = 0; i < (rule.clumps ?? 0); i += 1) {
    const ang = rand() * Math.PI * 2
    const r = rule.minR + Math.sqrt(rand()) * (rule.maxR - rule.minR)
    seeds.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r })
  }
  let guard = 0
  while (out.length < rule.count && guard < rule.count * 40) {
    guard += 1
    let x: number
    let z: number
    if (seeds.length && rand() < 0.7) {
      const s = seeds[Math.floor(rand() * seeds.length)]
      const ang = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * 1.6
      x = s.x + Math.cos(ang) * r
      z = s.z + Math.sin(ang) * r
    } else {
      const ang = rand() * Math.PI * 2
      const r = rule.minR + Math.sqrt(rand()) * (rule.maxR - rule.minR)
      x = Math.cos(ang) * r
      z = Math.sin(ang) * r
    }
    const radial = Math.hypot(x, z)
    if (radial < rule.minR || radial > rule.maxR || radial < rule.clearCenter) continue
    if (pathEdgeDistance({ x, z }, paths) < rule.clearPath) continue
    // Leave the landmark footprints (and a little apron) clear of crystals and tufts.
    if (PLACES.some((p) => p.solid > 0 && Math.hypot(x - p.x, z - p.z) < p.solid + 0.35)) continue
    out.push({ x, z, scale: rule.scale[0] + rand() * (rule.scale[1] - rule.scale[0]), turn: rand() * Math.PI * 2, tint: rand() })
  }
  return out
}

/** Irregular rim radius so the cliff edge is not a perfect circle. */
export function rimRadius(angle: number): number {
  return ISLAND_RADIUS + Math.sin(angle * 5 + 0.7) * 0.35 + Math.sin(angle * 11 + 2.1) * 0.18 + Math.sin(angle * 23) * 0.08
}
