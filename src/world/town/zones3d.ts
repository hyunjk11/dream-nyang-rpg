import { ZONES } from '../../data/zones'
import type { SaveData } from '../../sim/types'
import type { FoeKind } from '../../combat/foes'
import { placesFor, pushOutOfPlaces } from './places'

/**
 * The zones in src/data/zones replayed on the one 3D island. Each zone keeps its name, music,
 * enemy roster, elites and pickups; map positions (pixels) are squeezed onto the island, and the village
 * buildings only stand in the village. The portal (별문) is the only way between zones.
 */
export type ZoneId = 'meadow' | 'village' | 'forest' | 'vale' | 'altar'
export const ZONE_IDS: readonly ZoneId[] = ['meadow', 'village', 'forest', 'vale', 'altar']

export interface ZoneFoe {
  kind: FoeKind
  x: number
  z: number
  tags: string[]
  elite?: string
}

export interface ZonePickup {
  id: string
  x: number
  z: number
}

export interface Mood {
  fog: number
  sky: number
  clear: number
}

export interface Zone3d {
  id: ZoneId
  name: string
  bgm: 'village' | 'battle'
  foes: ZoneFoe[]
  pickups: ZonePickup[]
  mood: Mood
}

/** Where she lands after stepping through the portal; the start of the meadow is the plaza. */
export const PORTAL_ARRIVAL = { x: -8.4, z: 3.4 } as const
export const PLAZA = { x: 0, z: 0 } as const
/** Half-width of the island patch the zone map is squeezed into. */
const SPREAD = 9.6
const MAX_R = 10.6
/** Foes never wake up right on top of her arrival. */
const CLEAR_ARRIVAL = 4.2

const MOODS: Record<ZoneId, Mood> = {
  meadow: { fog: 0x9a78c4, sky: 0xffeefa, clear: 0x1b1030 },
  village: { fog: 0xa985c4, sky: 0xfff0ea, clear: 0x1f1230 },
  forest: { fog: 0x6f6cb8, sky: 0xe2e4ff, clear: 0x120f2c },
  vale: { fog: 0xb07ab8, sky: 0xffe2f0, clear: 0x1e0f2a },
  altar: { fog: 0x55449a, sky: 0xd6c8ff, clear: 0x0d0a22 },
}

/** Zone map pixels → island metres (north stays north: map y down is +z). */
export function toIsland(zone: ZoneId, x: number, y: number): { x: number; z: number } {
  const def = ZONES[zone]
  let ix = (x / def.width - 0.5) * 2 * SPREAD
  let iz = (y / def.height - 0.5) * 2 * SPREAD
  const r = Math.hypot(ix, iz)
  if (r > MAX_R) {
    ix *= MAX_R / r
    iz *= MAX_R / r
  }
  const ax = ix - PORTAL_ARRIVAL.x
  const az = iz - PORTAL_ARRIVAL.z
  const ar = Math.hypot(ax, az)
  if (ar < CLEAR_ARRIVAL) {
    const k = CLEAR_ARRIVAL / Math.max(ar, 1e-3)
    ix = PORTAL_ARRIVAL.x + (ar > 1e-3 ? ax : 1) * k
    iz = PORTAL_ARRIVAL.z + (ar > 1e-3 ? az : 0) * k
  }
  return pushOutOfPlaces(ix, iz, 0.9, placesFor(zone))
}

const cache = new Map<ZoneId, Zone3d>()

export function zone3d(id: ZoneId): Zone3d {
  const hit = cache.get(id)
  if (hit) return hit
  const def = ZONES[id]
  const zone: Zone3d = {
    id,
    name: def.name,
    bgm: def.bgm,
    mood: MOODS[id],
    foes: def.enemies.map((e) => ({ kind: e.id as FoeKind, ...toIsland(id, e.x, e.y), tags: e.tags, elite: e.elite })),
    pickups: def.pickups.filter((p) => p.kind === 'material' && p.id).map((p) => ({ id: p.id as string, ...toIsland(id, p.x, p.y) })),
  }
  cache.set(id, zone)
  return zone
}

export interface Destination {
  to: ZoneId
  label: string
}

const status = (save: SaveData, id: string) => save.quests[id]?.status ?? 'inactive'

/**
 * Where the portal can take her from `from`, following the story: the meadow opens once the
 * tutorial slime sleeps, the forest after arriving in the village, the vale once Luna's dust
 * errand is done (or Kiki wants parts), the altar once the bloom quest is taken. The altar's
 * way home stays sealed while the bloom is awake, like a boss seal.
 */
export function destinations(save: SaveData, from: ZoneId, bossAwake = false): Destination[] {
  if (from === 'meadow') {
    const slept = (save.quests.q_awaken?.counts.slime ?? 0) >= 1 || status(save, 'q_awaken') === 'turnedIn'
    return slept ? [{ to: 'village', label: '꿈의 마을로' }] : []
  }
  if (from === 'altar' && bossAwake) return []
  if (from !== 'village') return [{ to: 'village', label: '꿈의 마을로 돌아가기' }]
  const out: Destination[] = [{ to: 'meadow', label: '꿈의 초원' }]
  if (status(save, 'q_awaken') === 'turnedIn') out.push({ to: 'forest', label: '몽환의 숲' })
  const parts = status(save, 'q_parts')
  if (status(save, 'q_dust') === 'turnedIn' || parts === 'active' || parts === 'completed') out.push({ to: 'vale', label: '버섯 골짜기' })
  if (status(save, 'q_bloom') !== 'inactive') out.push({ to: 'altar', label: '별빛 제단' })
  return out
}

/** The sealed-portal line, when there is nowhere to go yet. */
export function gateLocked(from: ZoneId): string {
  if (from === 'meadow') return '별문이 잠잠해. 솜사탕 슬라임부터 잠재우자.'
  if (from === 'altar') return '꽃의 악몽이 별문을 막고 있어. 먼저 블룸을 잠재워야 해.'
  return '별문이 아직 열리지 않았어.'
}
