/**
 * 고정 전설: making the fixed guns, who drops them (with a pity counter per source) and the 전설 도감.
 */
import { ITEMS } from '../data/items'
import { LEGEND_BY_ID, LEGENDS, type LegendDef, type LegendSource } from '../data/legends'
import type { AreaId } from './areas'
import { levelScale, RARITY_POWER, roundStat } from './loot'
import type { ItemInstance, SaveData, StatKey } from './types'

export interface LegendSave {
  /** Ids found at least once (the 도감). */
  found: string[]
  /** How many times each one has dropped (dupes count). */
  count: Record<string, number>
  /** Misses in a row per source key (pity). */
  tries: Record<string, number>
}

/** Where a roll happens (a boss chest, a chest in an area, the maze quest elite). */
export type LegendEvent =
  | { kind: 'boss'; depth: number; area?: AreaId }
  | { kind: 'chest'; area?: AreaId }
  | { kind: 'mazeElite' }
  | { kind: 'storyElite'; area: AreaId }

/** Base chance and pity step per source kind. Boss: certain on the 6th try; chests are many, so lower. */
export const LEGEND_ODDS = {
  boss: { base: 0.2, step: 0.16 },
  areaBoss: { base: 0.25, step: 0.19 },
  areaChest: { base: 0.05, step: 0.035 },
  mazeElite: { base: 1, step: 0 },
  storyElite: { base: 1, step: 0 },
  quest: { base: 0, step: 0 },
} as const
/** A legend already in the 도감 drops again at this share of the base chance, with no pity. */
export const DUPE_SHARE = 0.35

let n = 0
const uid = () => `leg${Date.now().toString(36)}${(n++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

export function legendsOf(save: SaveData): LegendSave {
  const l = (save.legends ??= { found: [], count: {}, tries: {} })
  l.found ??= []
  l.count ??= {}
  l.tries ??= {}
  return l
}

export function isLegend(item: ItemInstance | null | undefined): boolean {
  return !!item && !!ITEMS[item.defId]?.legend
}

export function legendOf(item: ItemInstance | null | undefined): LegendDef | null {
  return item ? (LEGEND_BY_ID[item.defId] ?? null) : null
}

/** The fixed options at an item level (same scaling as any 전설 affix). */
export function legendAffixes(def: LegendDef, itemLevel: number): ItemInstance['affixes'] {
  const k = levelScale(itemLevel) * RARITY_POWER.legendary
  return (Object.entries(def.stats) as [StatKey, number][]).map(([stat, v]) => ({
    id: `leg_${stat}`,
    name: '',
    stat,
    value: roundStat(stat, stat === 'pierce' ? v : v * k),
  }))
}

export function makeLegend(id: string, itemLevel: number): ItemInstance {
  const def = LEGEND_BY_ID[id]
  if (!def) throw new Error(`unknown legend ${id}`)
  const level = Math.max(1, Math.floor(itemLevel))
  return { uid: uid(), defId: id, rarity: 'legendary', itemLevel: level, affixes: legendAffixes(def, level), v: 2 }
}

function matches(src: LegendSource, ev: LegendEvent): boolean {
  if (src.kind === 'boss') return ev.kind === 'boss' && !ev.area && ev.depth === src.depth
  if (src.kind === 'areaBoss') return ev.kind === 'boss' && ev.area === src.area
  if (src.kind === 'areaChest') return ev.kind === 'chest' && ev.area === src.area
  if (src.kind === 'storyElite') return ev.kind === 'storyElite' && ev.area === src.area
  if (src.kind === 'quest') return false
  return ev.kind === 'mazeElite'
}

/** Legends this event can drop, with the source that matched. */
export function legendsFor(ev: LegendEvent): { def: LegendDef; src: LegendSource }[] {
  const out: { def: LegendDef; src: LegendSource }[] = []
  for (const def of LEGENDS) {
    const src = def.sources.find((s) => matches(s, ev))
    if (src) out.push({ def, src })
  }
  return out
}

const keyOf = (def: LegendDef, src: LegendSource) => `${def.id}:${src.kind}`

/** Chance this try drops `def` (pity rises per miss; found ones are rarer and have no pity). */
export function legendChance(save: SaveData, def: LegendDef, src: LegendSource): number {
  const odds = LEGEND_ODDS[src.kind]
  const l = legendsOf(save)
  if (l.found.includes(def.id)) return src.kind === 'mazeElite' || src.kind === 'storyElite' ? 0 : odds.base * DUPE_SHARE
  return Math.min(1, odds.base + odds.step * (l.tries[keyOf(def, src)] ?? 0))
}

/**
 * Roll the legends an event can drop; updates pity in the save. Returns at most one gun.
 * Pure apart from the save and `rng`.
 */
export function rollLegend(save: SaveData, ev: LegendEvent, itemLevel: number, rng: () => number = Math.random): ItemInstance | null {
  const l = legendsOf(save)
  for (const { def, src } of legendsFor(ev)) {
    const chance = legendChance(save, def, src)
    if (chance <= 0) continue
    const key = keyOf(def, src)
    if (rng() < chance) {
      l.tries[key] = 0
      return makeLegend(def.id, itemLevel + 1)
    }
    if (!l.found.includes(def.id)) l.tries[key] = (l.tries[key] ?? 0) + 1
  }
  return null
}

/** She picked one up: into the 도감. Returns true the first time. */
export function recordLegend(save: SaveData, item: ItemInstance): boolean {
  if (!isLegend(item)) return false
  const l = legendsOf(save)
  l.count[item.defId] = (l.count[item.defId] ?? 0) + 1
  if (l.found.includes(item.defId)) return false
  l.found.push(item.defId)
  return true
}

/** 도감 rows in display order. */
export function codexRows(save: SaveData): { def: LegendDef; found: boolean; count: number }[] {
  const l = legendsOf(save)
  return LEGENDS.map((def) => ({ def, found: l.found.includes(def.id), count: l.count[def.id] ?? 0 }))
}

/** Count legends she owns anywhere (bag, worn, stash) that the 도감 hasn't seen (old saves / dev). */
export function syncCodex(save: SaveData): void {
  const all = [...save.items, ...(save.town?.stash ?? [])]
  for (const it of all) if (isLegend(it) && !legendsOf(save).found.includes(it.defId)) recordLegend(save, it)
}
