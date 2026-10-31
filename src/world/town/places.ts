/** Pure layout for the island's landmarks and their solid footprints. No Three.js. */

export type PlaceKind = 'house' | 'workshop' | 'tree' | 'portal' | 'fountain' | 'well' | 'board' | 'lantern' | 'kiki' | 'luna' | 'popo' | 'stash'

export interface Place {
  kind: PlaceKind
  x: number
  z: number
  /** Facing in radians; 0 looks down +z. Most face the plaza. */
  turn: number
  /** Model height in metres after normalising. */
  height: number
  /** Solid footprint radius on the ground (0 = walk-through). */
  solid: number
  /** Dialogue id when the hero can talk to it. */
  talk?: string
}

/** Face from (x, z) toward the island centre. */
export function faceCentre(x: number, z: number): number {
  return Math.atan2(-x, -z)
}

function at(kind: PlaceKind, x: number, z: number, height: number, solid: number, talk?: string, turn = faceCentre(x, z)): Place {
  return { kind, x, z, turn, height, solid, talk }
}

/**
 * Landmarks ring the outer meadow, outside the combat plaza and clear of the paths. The big
 * buildings sit on the far (north) side so they stand in view ahead of her, and every model
 * faces the default camera (+z) like a storybook diorama; Kiki turns to watch Byeolha.
 */
export const PLACES: readonly Place[] = [
  at('house', 7.8, -8.6, 3.6, 1.55, undefined, 0),
  at('workshop', -8.4, -7.8, 3.4, 1.6, undefined, 0),
  at('kiki', -6.0, -6.0, 1.45, 0.35, 'kiki', 0.5),
  at('luna', -1.4, -5.8, 1.6, 0.35, 'luna', 0.15),
  at('board', -9.8, -3.6, 1.7, 0.4, 'board', 0.35),
  // Stage 4: Popo's candy stall beside the lane, and Byeolha's stash chest by her house (both procedural).
  at('popo', 3.0, -8.4, 2.2, 0.7, 'popo', -0.1),
  at('stash', 6.2, -6.0, 0.7, 0.45, 'stash', -0.4),
  at('tree', 11.0, -4.6, 4.8, 0.9, undefined, -0.4),
  at('portal', -11.0, 4.2, 3.4, 0, 'gate', 0.6),
  at('fountain', 4.6, 9.8, 2.3, 1.25, undefined, 0),
  at('well', 10.4, 4.4, 2.0, 0.85, 'well', -0.5),
  at('lantern', 2.9, 7.4, 0, 0),
  at('lantern', -8.8, 3.7, 0, 0),
  at('lantern', 7.2, -2.5, 0, 0),
  at('lantern', -3.8, -7.3, 0, 0),
  at('lantern', 4.6, -7.0, 0, 0),
  at('lantern', -4.1, 10.4, 0, 0),
]

/** The models that ship as Meshy GLBs (lanterns, Popo's stall and the stash chest are procedural). */
export const PLACE_MODELS: readonly PlaceKind[] = ['house', 'workshop', 'kiki', 'luna', 'board', 'tree', 'portal', 'fountain', 'well']

/**
 * Push a moving circle (x, z, radius) out of every solid landmark. Returns the corrected
 * position; slides along the footprint instead of stopping dead.
 */
export function pushOutOfPlaces(x: number, z: number, radius: number, places: readonly Place[] = PLACES): { x: number; z: number } {
  let px = x
  let pz = z
  for (const p of places) {
    if (p.solid <= 0) continue
    const dx = px - p.x
    const dz = pz - p.z
    const min = p.solid + radius
    const d2 = dx * dx + dz * dz
    if (d2 >= min * min) continue
    const d = Math.sqrt(d2)
    if (d < 1e-5) {
      px = p.x + min
      continue
    }
    px = p.x + (dx / d) * min
    pz = p.z + (dz / d) * min
  }
  return { x: px, z: pz }
}

/** Whether a point sits inside any solid footprint (used to stop shots). */
export function insidePlace(x: number, z: number, places: readonly Place[] = PLACES): boolean {
  return places.some((p) => p.solid > 0 && Math.hypot(x - p.x, z - p.z) < p.solid)
}

/** The nearest talkable place within reach, if any. */
export function nearestTalk(x: number, z: number, reach = 2.4, places: readonly Place[] = PLACES): Place | null {
  let best: Place | null = null
  let dist = Infinity
  for (const p of places) {
    if (!p.talk) continue
    const d = Math.hypot(x - p.x, z - p.z) - p.solid
    if (d < reach && d < dist) {
      best = p
      dist = d
    }
  }
  return best
}

/** Village-only landmarks: out in the wild zones only the tree, fountain, portal and lanterns stay. */
export const VILLAGE_ONLY: readonly PlaceKind[] = ['house', 'workshop', 'kiki', 'luna', 'board', 'well', 'popo', 'stash']

/** The landmarks standing (and solid) in one zone. */
export function placesFor(zone: string): readonly Place[] {
  return zone === 'village' ? PLACES : PLACES.filter((p) => !VILLAGE_ONLY.includes(p.kind))
}
