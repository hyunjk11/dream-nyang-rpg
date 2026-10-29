import { AFFIX_COUNT, AFFIXES } from '../data/affixes'
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

const PERCENT: StatKey[] = ['critChance', 'critDamage', 'attackSpeed']

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

export function rollRarity(luck: number, rng: () => number, bias = 0): Rarity {
  const weights = rarityWeights(luck, bias)
  const total = RARITIES.reduce((sum, key) => sum + weights[key], 0)
  let roll = rng() * total
  for (const key of RARITIES) {
    roll -= weights[key]
    if (roll <= 0) return key
  }
  return 'common'
}

export function rollAffixes(slot: EquipSlot, rarity: Rarity, rng: () => number): Affix[] {
  const count = AFFIX_COUNT[rarity] ?? 0
  const pool = AFFIXES.filter((affix) => (slot === 'weapon' ? true : !affix.weaponOnly))
  const bag = [...pool]
  const scale = 1 + RARITIES.indexOf(rarity) * 0.08
  const out: Affix[] = []
  for (let i = 0; i < count && bag.length; i += 1) {
    const index = Math.min(bag.length - 1, Math.floor(rng() * bag.length))
    const spec = bag.splice(index, 1)[0]
    let value = (spec.min + (spec.max - spec.min) * rng()) * scale
    value = PERCENT.includes(spec.stat) ? Math.round(value * 1000) / 1000 : Math.max(1, Math.round(value))
    out.push({ id: spec.id, name: spec.name, stat: spec.stat, value })
  }
  return out
}

export function makeItem(defId: string, rarity: Rarity, rng: () => number, itemLevel: number): ItemInstance {
  const def = ITEMS[defId]
  return {
    uid: uid(),
    defId,
    rarity,
    itemLevel: Math.max(1, Math.floor(itemLevel)),
    affixes: rollAffixes(def?.slot ?? 'weapon', rarity, rng),
  }
}

export function baseValue(defId: string, rarity: Rarity): number {
  const price = ITEMS[defId]?.price ?? 10
  return Math.max(1, Math.round(price * RARITY_VALUE[rarity]))
}

export function sellValue(item: ItemInstance): number {
  return Math.max(1, Math.round(baseValue(item.defId, item.rarity) * 0.42))
}

export function rerollCost(item: ItemInstance): number {
  return 30 + RARITIES.indexOf(item.rarity) * 28 + item.itemLevel * 6
}

export function itemName(item: ItemInstance): string {
  const def = ITEMS[item.defId]
  const prefix = item.affixes[0]?.name
  return `${prefix ? `${prefix} ` : ''}${def?.name ?? item.defId}`
}

export function formatAffix(affix: Affix): string {
  if (PERCENT.includes(affix.stat)) return `${STAT_KO[affix.stat]} +${Math.round(affix.value * 100)}%`
  return `${STAT_KO[affix.stat]} +${Math.round(affix.value)}`
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
}): Drop[] {
  const { rng } = opts
  const out: Drop[] = []
  const [minGold, maxGold] = opts.table.gold
  let gold = minGold + Math.floor(rng() * (maxGold - minGold + 1))
  if (opts.elite) gold = Math.round(gold * 2.2)
  if (opts.boss) gold = Math.round(gold * 1.15)
  if (gold > 0) out.push({ kind: 'gold', amount: gold })
  const bias = (opts.boss ? 30 : 0) + (opts.elite ? 14 : 0)
  const gearChance = Math.min(0.98, opts.table.gear * (opts.elite ? 2.1 : 1))
  const weaponChance = Math.min(0.98, opts.table.weapon * (opts.elite ? 2.1 : 1))
  if (rng() < weaponChance) {
    out.push({
      kind: 'item',
      amount: 1,
      item: makeItem(pick(WEAPON_IDS, rng), rollRarity(opts.luck, rng, bias), rng, opts.itemLevel),
    })
  }
  if (rng() < gearChance) {
    out.push({
      kind: 'item',
      amount: 1,
      item: makeItem(pick(GEAR_IDS, rng), rollRarity(opts.luck, rng, bias), rng, opts.itemLevel),
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

export function itemLines(item: ItemInstance): string[] {
  const def = ITEMS[item.defId]
  const lines: string[] = []
  if (def?.slot) lines.push(SLOT_KO[def.slot])
  lines.push(RARITY_KO[item.rarity])
  if (def?.weapon) lines.push(`무기 공격력 ${def.weapon.damage}`)
  if (def?.stats) {
    for (const [key, value] of Object.entries(def.stats) as [StatKey, number][]) {
      lines.push(formatAffix({ id: key, name: '', stat: key, value }))
    }
  }
  for (const affix of item.affixes) lines.push(formatAffix(affix))
  lines.push(`판매 ${sellValue(item)} 골드`)
  return lines
}
