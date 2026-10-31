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

export function migrateItem(item: ItemInstance): ItemInstance {
  if (item.v === 2) return item
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
  item.itemLevel = Math.max(1, Math.floor(item.itemLevel || 1))
  item.v = 2
  return item
}
