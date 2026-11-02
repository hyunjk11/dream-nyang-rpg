/**
 * 던전 유지 (편의성): one floor's state, small enough for the save. The floor itself is rebuilt
 * from its seed (same maze, same packs); this only says what changed since: who is gone, which
 * doors / chests / nests are done, where she stood and what the minimap has seen.
 */
import type { FieldNeeds } from './delve'

export interface FloorState {
  depth: number
  floor: number
  /** Trip salt the maze seed was mixed with. */
  salt: number
  /** 몽실 들판 trips rebuild from these needs (null = a sewer floor). */
  field: FieldNeeds | null
  at: { x: number; z: number; yaw: number }
  /** Ids of the floor's first-spawned foes that are gone (ids count up from 1 in spawn order). */
  dead: number[]
  /** First-spawned foe count (a guard: a different roster means a different floor). */
  initial: number
  /** Hurt first-spawned foes: [id, hp]. */
  hurt: [number, number][]
  /** Per nest: [hp, spawned]. */
  nests: [number, number][]
  key: boolean
  doors: boolean
  secret: boolean
  /** Opened chests by tile, "x_y". */
  chests: string[]
  shrine: boolean
  arrived: boolean
  /** Boss hp left (boss floors), or null. */
  boss: number | null
  /** Minimap fog: seen tiles as a hex bitmask. */
  seen: string
}

/** Uint8 0/1 per tile → hex bitmask (4 tiles per hex digit). */
export function packSeen(seen: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < seen.length; i += 4) {
    let v = 0
    for (let b = 0; b < 4; b += 1) if (seen[i + b]) v |= 1 << b
    out += v.toString(16)
  }
  return out
}

export function unpackSeen(hex: string, into: Uint8Array): void {
  for (let i = 0; i < into.length; i += 1) {
    const v = parseInt(hex[i >> 2] ?? '0', 16) || 0
    into[i] = (v >> (i & 3)) & 1
  }
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const int = (v: unknown, min: number, fallback: number): number => Math.max(min, Math.floor(num(v, fallback)))

/** A saved floor state made safe (null when it is unusable). */
export function sanitizeFloor(raw: unknown): FloorState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<FloorState>
  if (num(o.depth) < 1 || num(o.floor) < 1) return null
  const depth = int(o.depth, 1, 1)
  const floor = int(o.floor, 1, 1)
  const at = o.at && typeof o.at === 'object' ? o.at : { x: 0, z: 0, yaw: 0 }
  const pairs = (v: unknown): [number, number][] => (Array.isArray(v) ? v.filter((p) => Array.isArray(p) && p.length === 2).map((p) => [num(p[0]), num(p[1])] as [number, number]) : [])
  const f = o.field
  const field: FieldNeeds | null =
    f && typeof f === 'object' && Array.isArray(f.kinds) ? { kinds: f.kinds.filter((k) => typeof k === 'string'), fluff: !!f.fluff, named: !!f.named, boss: !!f.boss } : null
  return {
    depth,
    floor,
    salt: int(o.salt, 0, 0),
    field,
    at: { x: num(at.x), z: num(at.z), yaw: num(at.yaw) },
    dead: Array.isArray(o.dead) ? o.dead.filter((n) => typeof n === 'number' && Number.isFinite(n)) : [],
    initial: int(o.initial, 0, 0),
    hurt: pairs(o.hurt),
    nests: pairs(o.nests),
    key: !!o.key,
    doors: !!o.doors,
    secret: !!o.secret,
    chests: Array.isArray(o.chests) ? o.chests.filter((c) => typeof c === 'string') : [],
    shrine: !!o.shrine,
    arrived: !!o.arrived,
    boss: typeof o.boss === 'number' && Number.isFinite(o.boss) ? o.boss : null,
    seen: typeof o.seen === 'string' && /^[0-9a-f]*$/.test(o.seen) ? o.seen : '',
  }
}

/** Short label for the return portal toast. */
export function floorStateLabel(s: Pick<FloorState, 'depth' | 'floor' | 'field'>): string {
  return s.field ? '몽실 들판' : `깊이 ${s.depth} · ${s.floor}층`
}
