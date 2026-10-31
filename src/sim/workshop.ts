/**
 * 키키의 총 공방: upgrade a gun (+1..+10), reroll one affix, or swap a gun's element. Every job
 * succeeds (a cute game: no breaking, no downgrades); prices climb with the level instead.
 */
import { AFFIXES, type AffixSpec } from '../data/affixes'
import { ITEMS } from '../data/items'
import { findItem } from './inventory'
import { levelScale, plusOf, RARITY_POWER, rerollCost, roundStat, upgradeMul } from './loot'
import { townOf } from './town'
import type { Element, ItemInstance, SaveData } from './types'

export const MAX_PLUS = 10

export interface Cost {
  gold: number
  mats: Record<string, number>
}

/** Price of taking a gun from +n to +(n+1). */
export function upgradeCost(item: ItemInstance): Cost | null {
  const next = plusOf(item) + 1
  if (next > MAX_PLUS) return null
  const mats: Record<string, number> = { dream_dust: next }
  if (next >= 8) mats.star_shard = next - 7
  return { gold: 20 * next + 8 * next * next, mats }
}

export function rerollAffixCost(item: ItemInstance): Cost {
  return { gold: rerollCost(item), mats: { dream_dust: 1 } }
}

export const ELEMENT_COST: Cost = { gold: 40, mats: { toy_part: 1 } }

export function canPay(save: SaveData, cost: Cost): boolean {
  return save.gold >= cost.gold && Object.entries(cost.mats).every(([m, n]) => (save.materials[m] ?? 0) >= n)
}

function pay(save: SaveData, cost: Cost): void {
  save.gold -= cost.gold
  for (const [m, n] of Object.entries(cost.mats)) save.materials[m] = (save.materials[m] ?? 0) - n
}

export interface WorkResult {
  ok: boolean
  reason?: string
  item?: ItemInstance
}

/** Items Kiki can work on: whatever is in the bag or worn, plus the stash (guns first). */
function locate(save: SaveData, uid: string): ItemInstance | undefined {
  return findItem(save, uid) ?? townOf(save).stash.find((i) => i.uid === uid)
}

function short(save: SaveData, cost: Cost): string {
  if (save.gold < cost.gold) return `골드가 모자라. ${cost.gold} 필요해.`
  return '재료가 모자라.'
}

export function upgradeGun(save: SaveData, uid: string): WorkResult {
  const item = locate(save, uid)
  if (!item) return { ok: false, reason: '그 물건이 없어.' }
  if (ITEMS[item.defId]?.slot !== 'weapon') return { ok: false, reason: '강화는 총만 할 수 있어.' }
  const cost = upgradeCost(item)
  if (!cost) return { ok: false, reason: '이미 +10이야. 더는 반짝일 수 없어!' }
  if (!canPay(save, cost)) return { ok: false, reason: short(save, cost) }
  pay(save, cost)
  item.plus = plusOf(item) + 1
  return { ok: true, item }
}

/** Gun damage factor before → after the next upgrade (tooltip). */
export function upgradePreview(item: ItemInstance): { from: number; to: number } {
  const p = plusOf(item)
  return { from: upgradeMul(p), to: upgradeMul(Math.min(MAX_PLUS, p + 1)) }
}

function specOf(id: string): AffixSpec | undefined {
  return AFFIXES.find((a) => a.id === id)
}

/** Affixes this slot of this item could turn into (not one it already has; one element max). */
export function rerollChoices(item: ItemInstance, index: number): AffixSpec[] {
  const gun = ITEMS[item.defId]?.slot === 'weapon'
  const others = item.affixes.filter((_, i) => i !== index)
  const taken = new Set(others.map((a) => a.id))
  const hasElement = others.some((a) => specOf(a.id)?.element)
  return AFFIXES.filter((s) => (gun ? !s.gearOnly : !s.weaponOnly) && !taken.has(s.id) && !(hasElement && s.element) && s.id !== item.affixes[index]?.id)
}

function rollValue(spec: AffixSpec, item: ItemInstance, rng: () => number): number {
  const roll = spec.min + (spec.max - spec.min) * rng()
  return roundStat(spec.stat, spec.flat ? roll : roll * levelScale(item.itemLevel) * RARITY_POWER[item.rarity])
}

/** Re-roll just one affix (the others stay). */
export function rerollAffix(save: SaveData, uid: string, index: number, rng: () => number = Math.random): WorkResult {
  const item = locate(save, uid)
  if (!item) return { ok: false, reason: '그 물건이 없어.' }
  if (!item.affixes[index]) return { ok: false, reason: '다시 굴릴 옵션을 골라 줘.' }
  const choices = rerollChoices(item, index)
  if (!choices.length) return { ok: false, reason: '바꿀 수 있는 옵션이 없어.' }
  const cost = rerollAffixCost(item)
  if (!canPay(save, cost)) return { ok: false, reason: short(save, cost) }
  pay(save, cost)
  const spec = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))]
  item.affixes[index] = { id: spec.id, name: spec.name, stat: spec.stat, value: rollValue(spec, item, rng) }
  return { ok: true, item }
}

export function elementOf(item: ItemInstance): Element | null {
  const a = item.affixes.find((x) => specOf(x.id)?.element)
  return a ? (a.stat as Element) : null
}

/** Swap a gun's element (반짝 / 서늘 / 끈적), keeping how good the roll was. */
export function changeElement(save: SaveData, uid: string, to: Element): WorkResult {
  const item = locate(save, uid)
  if (!item) return { ok: false, reason: '그 물건이 없어.' }
  const index = item.affixes.findIndex((x) => specOf(x.id)?.element)
  if (index < 0) return { ok: false, reason: '속성 옵션이 붙은 총만 바꿀 수 있어.' }
  const from = specOf(item.affixes[index].id)
  const spec = AFFIXES.find((s) => s.element && s.stat === to)
  if (!from || !spec) return { ok: false, reason: '모르는 속성이야.' }
  if (from.id === spec.id) return { ok: false, reason: '이미 그 속성이야.' }
  if (!canPay(save, ELEMENT_COST)) return { ok: false, reason: short(save, ELEMENT_COST) }
  pay(save, ELEMENT_COST)
  const scale = levelScale(item.itemLevel) * RARITY_POWER[item.rarity]
  const share = Math.max(0, Math.min(1, (item.affixes[index].value / scale - from.min) / Math.max(1e-6, from.max - from.min)))
  item.affixes[index] = { id: spec.id, name: spec.name, stat: spec.stat, value: roundStat(spec.stat, (spec.min + (spec.max - spec.min) * share) * scale) }
  return { ok: true, item }
}
