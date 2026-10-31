import { AFFIX_COUNT, AFFIXES, GEAR_AFFIX, PERCENT_STATS } from '../data/affixes'
import { GUN_PROFILES, gunDps } from '../data/guns'
import { GEAR_IDS, ITEMS, WEAPON_IDS } from '../data/items'
import type { EnemyDef } from '../data/enemies'
import {
  RARITIES,
  RARITY_KO,
  SLOT_KO,
  STAT_KO,
  type Affix,
  type EquipSlot,
  type ItemInstance,
  type Rarity,
  type StatKey,
  uid,
} from './types'

const RARITY_VALUE: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.7,
  rare: 3.2,
  epic: 6.4,
  legendary: 12,
}

export function rarityWeights(luck: number, bias = 0): Record<Rarity, number> {
  const shift = Math.max(0, luck) * 0.35 + bias
  return {
    common: Math.max(8, 62 - shift),
    uncommon: 24 + shift * 0.25,
    rare: 10 + shift * 0.3,
    epic: 3.2 + shift * 0.25,
    legendary: 0.8 + shift * 0.2,
  }
}

export function rollRarity(luck: number, rng: () => number, bias = 0, cap: Rarity = 'legendary'): Rarity {
  const weights = rarityWeights(luck, bias)
  const total = RARITIES.reduce((sum, key) => sum + weights[key], 0)
  let roll = rng() * total
  for (const key of RARITIES) {
    roll -= weights[key]
    if (roll <= 0) return capRarity(key, cap)
  }
  return 'common'
}

/**
 * Best rarity a drop can be at a depth: 깊이 1 tops out at 희귀 (its boss chest at 영웅),
 * 깊이 2 at 영웅 (boss chest 전설), 깊이 3 and deeper anything. Keeps an epic dart gun from
 * flattening depth 1.
 */
export function maxRarityFor(depth: number, boss = false): Rarity {
  const d = Math.max(1, Math.floor(depth))
  return RARITIES[Math.min(RARITIES.length - 1, d + 1 + (boss ? 1 : 0))]
}

export function capRarity(rarity: Rarity, cap: Rarity): Rarity {
  return RARITIES.indexOf(rarity) > RARITIES.indexOf(cap) ? cap : rarity
}

/** Rarity multiplier on affix values (legendary rolls are fat). */
export const RARITY_POWER: Record<Rarity, number> = { common: 1, uncommon: 1, rare: 1.1, epic: 1.2, legendary: 1.35 }

/** How much item level lifts affix and implicit values: +5% per level. */
export function levelScale(itemLevel: number): number {
  return 1 + (Math.max(1, itemLevel) - 1) * 0.05
}

/**
 * Roll affixes for a slot. Same rng → same affixes (tests seed it). Guns can roll elements
 * (one at most) and pierce; hp / armour / move only roll on gear.
 */
export function rollAffixes(slot: EquipSlot, rarity: Rarity, rng: () => number, itemLevel = 1): Affix[] {
  const count = AFFIX_COUNT[rarity] ?? 0
  const gun = slot === 'weapon'
  const bag = AFFIXES.filter((spec) => (gun ? !spec.gearOnly : !spec.weaponOnly))
  const scale = levelScale(itemLevel) * RARITY_POWER[rarity] * (gun ? 1 : GEAR_AFFIX)
  const out: Affix[] = []
  for (let i = 0; i < count && bag.length; i += 1) {
    const index = Math.min(bag.length - 1, Math.floor(rng() * bag.length))
    const spec = bag.splice(index, 1)[0]
    if (spec.element) for (let j = bag.length - 1; j >= 0; j -= 1) if (bag[j].element) bag.splice(j, 1)
    const roll = spec.min + (spec.max - spec.min) * rng()
    out.push({ id: spec.id, name: spec.name, stat: spec.stat, value: roundStat(spec.stat, spec.flat ? roll : roll * scale) })
  }
  return out
}

export function roundStat(stat: StatKey, value: number): number {
  if (stat === 'pierce') return Math.max(1, Math.round(value))
  return PERCENT_STATS.includes(stat) ? Math.round(value * 1000) / 1000 : Math.max(1, Math.round(value))
}

export function makeItem(defId: string, rarity: Rarity, rng: () => number, itemLevel: number): ItemInstance {
  const def = ITEMS[defId]
  const level = Math.max(1, Math.floor(itemLevel))
  return {
    uid: uid(),
    defId,
    rarity,
    itemLevel: level,
    affixes: rollAffixes(def?.slot ?? 'weapon', rarity, rng, level),
    v: 2,
  }
}

export function baseValue(defId: string, rarity: Rarity): number {
  const price = ITEMS[defId]?.price ?? 10
  return Math.max(1, Math.round(price * RARITY_VALUE[rarity]))
}

export function sellValue(item: ItemInstance): number {
  return Math.max(1, Math.round(baseValue(item.defId, item.rarity) * 0.42 * (1 + 0.1 * plusOf(item))))
}

/** Gun damage multiplier from the workshop: +7% per upgrade level (+10 = ×1.7). */
export function upgradeMul(plus: number): number {
  return 1 + 0.07 * Math.max(0, Math.min(10, Math.floor(plus)))
}

/** Workshop upgrade level (+0..+10). */
export function plusOf(item: ItemInstance): number {
  return Math.max(0, Math.min(10, Math.floor(item.plus ?? 0)))
}

export function rerollCost(item: ItemInstance): number {
  return 30 + RARITIES.indexOf(item.rarity) * 28 + item.itemLevel * 6
}

/** Name pieces: first affix as the prefix, second as a "~의" suffix word, the base, the upgrade. */
export function itemNameParts(item: ItemInstance): { prefix: string; suffix: string; base: string; plus: string } {
  const def = ITEMS[item.defId]
  const second = item.affixes[1]
  const suffix = second ? (AFFIXES.find((a) => a.id === second.id)?.suffix ?? '') : ''
  const plus = plusOf(item)
  return { prefix: item.affixes[0]?.name ?? '', suffix, base: def?.name ?? item.defId, plus: plus ? `+${plus}` : '' }
}

/** "힘찬 바람의 별빛 물총 +3". */
export function itemName(item: ItemInstance): string {
  const p = itemNameParts(item)
  return [p.prefix, p.suffix, p.base, p.plus].filter(Boolean).join(' ')
}

/** Item power per stat point (hp 1, 1% armour 6, ...): one number to compare any two items. */
export const POWER_WEIGHT: Partial<Record<StatKey, number>> = {
  hp: 1,
  armor: 600,
  moveSpeed: 500,
  damage: 500,
  fireRate: 450,
  attackSpeed: 450,
  critChance: 700,
  critDamage: 120,
  lifesteal: 1500,
  luck: 2,
  pierce: 30,
  sparkle: 150,
  ice: 150,
  candy: 150,
}

/** Item power: implicit + affix stats by POWER_WEIGHT; guns add half their base DPS at this level. */
export function itemPower(item: ItemInstance): number {
  const def = ITEMS[item.defId]
  let p = 0
  if (def?.gun) p += gunDps(GUN_PROFILES[def.gun], gunLevelScale(item.itemLevel) * GUN_RARITY[item.rarity] * upgradeMul(plusOf(item))) * 0.5
  for (const [key, value] of Object.entries(implicitStats(item)) as [StatKey, number][]) p += value * (POWER_WEIGHT[key] ?? 0)
  for (const a of item.affixes) p += a.value * (POWER_WEIGHT[a.stat] ?? 0)
  return Math.round(p)
}

export function formatStat(stat: StatKey, value: number): string {
  if (stat === 'pierce') return `${STAT_KO.pierce} +${Math.round(value)}`
  if (stat === 'sparkle' || stat === 'ice' || stat === 'candy') return `${STAT_KO[stat]} ${Math.round(value * 100)}%`
  if (PERCENT_STATS.includes(stat)) return `${STAT_KO[stat]} +${Math.round(value * 1000) / 10}%`
  return `${STAT_KO[stat]} +${Math.round(value)}`
}

export function formatAffix(affix: Affix): string {
  return formatStat(affix.stat, affix.value)
}

export interface Drop {
  kind: 'gold' | 'item' | 'material' | 'potion'
  amount: number
  item?: ItemInstance
  matId?: string
}

function pick(ids: string[], rng: () => number): string {
  return ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]
}

export function rollDrops(opts: {
  table: Pick<EnemyDef, 'gold' | 'gear' | 'weapon' | 'dust' | 'part' | 'potion'>
  luck: number
  elite: boolean
  boss?: boolean
  rng: () => number
  itemLevel: number
  /** Extra rarity bias (deeper depths). */
  bias?: number
  /** Best rarity allowed (see maxRarityFor). */
  cap?: Rarity
}): Drop[] {
  const { rng } = opts
  const out: Drop[] = []
  const [minGold, maxGold] = opts.table.gold
  let gold = minGold + Math.floor(rng() * (maxGold - minGold + 1))
  if (opts.elite) gold = Math.round(gold * 2.2)
  if (opts.boss) gold = Math.round(gold * 1.15)
  if (gold > 0) out.push({ kind: 'gold', amount: gold })
  const bias = (opts.boss ? 30 : 0) + (opts.elite ? 14 : 0) + (opts.bias ?? 0)
  const gearChance = Math.min(0.98, opts.table.gear * (opts.elite ? 2.1 : 1))
  const weaponChance = Math.min(0.98, opts.table.weapon * (opts.elite ? 2.1 : 1))
  if (rng() < weaponChance) {
    out.push({
      kind: 'item',
      amount: 1,
      item: makeItem(pick(WEAPON_IDS, rng), rollRarity(opts.luck, rng, bias, opts.cap), rng, opts.itemLevel),
    })
  }
  if (rng() < gearChance) {
    out.push({
      kind: 'item',
      amount: 1,
      item: makeItem(pick(GEAR_IDS, rng), rollRarity(opts.luck, rng, bias, opts.cap), rng, opts.itemLevel),
    })
  }
  if (rng() < opts.table.dust) out.push({ kind: 'material', amount: rng() < 0.28 ? 2 : 1, matId: 'dream_dust' })
  if (rng() < opts.table.part) out.push({ kind: 'material', amount: 1, matId: 'toy_part' })
  if (rng() < opts.table.potion) out.push({ kind: 'potion', amount: 1 })
  return out
}

export function splitGold(total: number, piles: number): number[] {
  const n = Math.max(1, piles)
  const base = Math.floor(total / n)
  const extra = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)).filter((v) => v > 0)
}

/** Implicit (base) stats of an item at its level and rarity. */
export function implicitStats(item: ItemInstance): Partial<Record<StatKey, number>> {
  const def = ITEMS[item.defId]
  const out: Partial<Record<StatKey, number>> = {}
  if (!def?.stats) return out
  const scale = levelScale(item.itemLevel) * IMPLICIT_RARITY[item.rarity]
  for (const [key, value] of Object.entries(def.stats) as [StatKey, number][]) out[key] = roundStat(key, value * scale)
  return out
}

export const IMPLICIT_RARITY: Record<Rarity, number> = { common: 1, uncommon: 1.1, rare: 1.22, epic: 1.36, legendary: 1.55 }
/** Gun damage multiplier per rarity. */
export const GUN_RARITY: Record<Rarity, number> = { common: 1, uncommon: 1.1, rare: 1.22, epic: 1.36, legendary: 1.55 }
/** Gun damage multiplier per item level: +6% each. */
export function gunLevelScale(itemLevel: number): number {
  return 1 + (Math.max(1, itemLevel) - 1) * 0.06
}

/** What dismantling an item gives back (for the stage 4 workshop). */
export function dismantleYield(item: ItemInstance): Record<string, number> {
  switch (item.rarity) {
    case 'common':
      return { dream_dust: 1 }
    case 'uncommon':
      return { dream_dust: 2 }
    case 'rare':
      return { dream_dust: 3, toy_part: 1 }
    case 'epic':
      return { dream_dust: 3, star_shard: 1 }
    default:
      return { dream_dust: 4, star_shard: 3 }
  }
}

export function itemLines(item: ItemInstance): string[] {
  const def = ITEMS[item.defId]
  const lines: string[] = []
  if (def?.slot) lines.push(SLOT_KO[def.slot])
  lines.push(RARITY_KO[item.rarity])
  for (const [key, value] of Object.entries(implicitStats(item)) as [StatKey, number][]) lines.push(formatStat(key, value))
  for (const affix of item.affixes) lines.push(formatAffix(affix))
  lines.push(`판매 ${sellValue(item)} 골드`)
  return lines
}
