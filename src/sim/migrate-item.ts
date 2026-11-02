/** Older (2D-scale) items → 3D affix scale. Kept apart so town/stash code can use it without cycles. */
import type { Affix, ItemInstance, StatKey } from './types'

/** Old (2D) stat → new stat and factor. */
const LEGACY: Partial<Record<StatKey, [StatKey, number]>> = {
  atk: ['damage', 0.012],
  weaponDamage: ['damage', 0.01],
  def: ['armor', 0.007],
  hp: ['hp', 0.7],
  attackSpeed: ['fireRate', 1],
  moveSpeed: ['moveSpeed', 1 / 400],
  luck: ['luck', 1],
  critChance: ['critChance', 1],
  critDamage: ['critDamage', 1],
}

/** Sanity cap: an item level above this is a broken save. */
export const ILVL_CAP = 999

/**
 * The item level an old item without a usable one gets: what her progress would drop now (the
 * deepest open depth's first floor), never above her own level + 2. `save` is the raw save.
 */
export function fallbackItemLevel(save: { level?: number; delve?: { unlocked?: number } | null }): number {
  const unlocked = Math.max(1, Math.floor(Number(save.delve?.unlocked) || 1))
  const level = Math.max(1, Math.floor(Number(save.level) || 1))
  return Math.max(1, Math.min(1 + 4 * (unlocked - 1), level + 2))
}

/** A usable item level: whole, 1..ILVL_CAP, else the fallback. */
function cleanLevel(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.min(ILVL_CAP, Math.floor(v)) : Math.max(1, Math.floor(fallback))
}

export function migrateItem(item: ItemInstance, fallback = 1): ItemInstance {
  if (item.v === 2) {
    item.itemLevel = cleanLevel(item.itemLevel, fallback)
    return item
  }
  const affixes: Affix[] = []
  for (const a of item.affixes ?? []) {
    const map = LEGACY[a.stat]
    if (!map || !Number.isFinite(a.value)) continue
    const [stat, k] = map
    const value = a.value * k
    const pct = stat !== 'hp' && stat !== 'luck'
    affixes.push({ ...a, stat, value: pct ? Math.round(value * 1000) / 1000 : Math.max(1, Math.round(value)) })
  }
  item.affixes = affixes
  item.itemLevel = cleanLevel(item.itemLevel, fallback)
  item.v = 2
  return item
}
