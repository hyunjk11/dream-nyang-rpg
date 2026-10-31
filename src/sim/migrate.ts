/**
 * Bring an older save up to stage 3: the skill-tree block, 3D-scaled items (v: 2) and a trip
 * left open by a reload (its run gold is banked as if she had recalled). Safe to run twice.
 */
import { ITEMS } from '../data/items'
import { buildOf } from './skilltree'
import { delveOf, settleOpenRun, type OpenRun } from './delve'
import { computeStats } from './stats'
import { EQUIP_SLOTS, type Affix, type EquipSlot, type ItemInstance, type SaveData, type StatKey } from './types'
import { LEVEL_CAP } from '../data/tree'

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

export interface Migration {
  /** A trip a reload interrupted, whose gold was just banked (null = none). */
  banked: OpenRun | null
}

export function migrateSave(save: SaveData): Migration {
  save.level = Math.max(1, Math.min(LEVEL_CAP, Math.floor(save.level || 1)))
  save.xp = Math.max(0, Math.floor(save.xp || 0))
  save.items = (save.items ?? []).filter((i) => i && ITEMS[i.defId]).map(migrateItem)
  save.materials = { dream_dust: 0, toy_part: 0, star_shard: 0, ...save.materials }
  const eq: Partial<Record<EquipSlot, string>> = {}
  for (const slot of EQUIP_SLOTS) {
    const id = save.equipment?.[slot]
    if (id && save.items.some((i) => i.uid === id)) eq[slot] = id
  }
  // Mochi's old collar slot stays as it was (not part of Byeolha's stats panel).
  if (save.equipment?.collar) eq.collar = save.equipment.collar
  save.equipment = eq
  buildOf(save)
  delveOf(save)
  const banked = settleOpenRun(save)
  const max = computeStats(save).maxHp
  save.hp = Math.max(1, Math.min(max, Number.isFinite(save.hp) ? save.hp : max))
  return { banked }
}
