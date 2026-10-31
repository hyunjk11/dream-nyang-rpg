import { ITEMS } from '../data/items'
import { GUN_PROFILES, type GunProfile } from '../data/guns'
import { LEVEL_CAP } from '../data/tree'
import { DIFFICULTY } from '../combat/difficulty'
import type { EquipSlot, ItemInstance, SaveData, StatKey, WeaponKind } from './types'
import { emptyResult, type MutationResult } from './types'
import { findItem } from './inventory'
import { clamp, xpToNext } from './formulas'
import { GUN_RARITY, gunLevelScale, implicitStats, plusOf, upgradeMul } from './loot'
import { buildOf, rank } from './skilltree'

/**
 * Byeolha's numbers in the 3D game: level, tree passives and equipped gear folded together.
 * Level 1 with the starter water gun and nothing else is exactly the old feel (150 hp, the
 * GUN damage/cadence), so depth 1 plays as before; levels and gear carry her deeper.
 */
export interface ComputedStats {
  level: number
  maxHp: number
  /** Multiplier on every droplet / skill hit. */
  damageMul: number
  /** Multiplier on fire cadence. */
  fireRate: number
  critChance: number
  critMul: number
  lifesteal: number
  pierce: number
  /** Multiplier on walk/run speed. */
  moveMul: number
  /** Share of incoming damage blocked. */
  armor: number
  luck: number
  /** Multiplier on health regen. */
  regenMul: number
  /** Seconds after a hit before regen starts. */
  regenDelay: number
  sparkle: number
  ice: number
  candy: number
  weaponKind: WeaponKind
  /** The equipped gun's profile with its level/rarity damage folded in (crit fields are raw base). */
  gun: GunProfile
  /** Gun damage per droplet after level, gear and passives (no crits). */
  shotDamage: number
}

/** Per-level growth (level 30 ≈ 2× hp, +58% damage). */
export const LEVEL_GROWTH = { hp: 0.035, damage: 0.02 }
/** Caps so gear can't break the game. */
export const STAT_CAPS = { critChance: 0.6, lifesteal: 0.08, armor: 0.5, moveMul: 1.35, fireRate: 2 }

export function gearSum(items: ItemInstance[]): Partial<Record<StatKey, number>> {
  const sum: Partial<Record<StatKey, number>> = {}
  const add = (k: StatKey, v: number) => {
    sum[k] = (sum[k] ?? 0) + v
  }
  for (const item of items) {
    for (const [k, v] of Object.entries(implicitStats(item)) as [StatKey, number][]) add(k, v)
    for (const a of item.affixes) add(a.stat, a.value)
  }
  return sum
}

export function equippedItems(save: SaveData): ItemInstance[] {
  const out: ItemInstance[] = []
  for (const slot of Object.keys(save.equipment) as EquipSlot[]) {
    const item = findItem(save, save.equipment[slot])
    if (item && ITEMS[item.defId]) out.push(item)
  }
  return out
}

export function computeStats(save: SaveData, items: ItemInstance[] = equippedItems(save)): ComputedStats {
  const level = clamp(Math.floor(save.level || 1), 1, LEVEL_CAP)
  buildOf(save)
  const g = gearSum(items)
  const gunItem = items.find((i) => ITEMS[i.defId]?.slot === 'weapon')
  const kind: WeaponKind = (gunItem && ITEMS[gunItem.defId]?.gun) || 'water'
  const base = GUN_PROFILES[kind]
  const gunScale = gunItem ? gunLevelScale(gunItem.itemLevel) * GUN_RARITY[gunItem.rarity] * upgradeMul(plusOf(gunItem)) : 1
  const damageMul = (1 + (level - 1) * LEVEL_GROWTH.damage) * (1 + (g.damage ?? 0) + rank(save, 'polish') * 0.05)
  const hpMul = 1 + (level - 1) * LEVEL_GROWTH.hp + rank(save, 'fluffy') * 0.06
  const st = rank(save, 'star_eye')
  const stats: ComputedStats = {
    level,
    maxHp: Math.round(DIFFICULTY.hero.maxHp * hpMul + (g.hp ?? 0)),
    damageMul: Math.round(damageMul * 1000) / 1000,
    fireRate: clamp(1 + (g.fireRate ?? 0) + (g.attackSpeed ?? 0) + rank(save, 'rhythm') * 0.05, 0.5, STAT_CAPS.fireRate),
    critChance: clamp(base.critChance + (g.critChance ?? 0) + st * 0.03, 0, STAT_CAPS.critChance),
    critMul: base.critMul + (g.critDamage ?? 0) + st * 0.1,
    lifesteal: clamp(g.lifesteal ?? 0, 0, STAT_CAPS.lifesteal),
    pierce: base.pierce + Math.round(g.pierce ?? 0) + rank(save, 'dream_pierce'),
    moveMul: clamp(1 + (g.moveSpeed ?? 0), 0.7, STAT_CAPS.moveMul),
    armor: clamp(g.armor ?? 0, 0, STAT_CAPS.armor),
    luck: Math.round((g.luck ?? 0) + rank(save, 'lucky_bell') * 10),
    regenMul: 1 + rank(save, 'purr') * 0.3,
    regenDelay: Math.max(1.6, DIFFICULTY.hero.regenDelay - rank(save, 'purr') * 0.4),
    sparkle: clamp((g.sparkle ?? 0) + (rank(save, 'sparkle_heart') ? 0.12 : 0), 0, 0.6),
    ice: clamp(g.ice ?? 0, 0, 0.6),
    candy: clamp(g.candy ?? 0, 0, 0.6),
    weaponKind: kind,
    gun: { ...base, damage: Math.round(base.damage * gunScale * 100) / 100 },
    shotDamage: 0,
  }
  stats.shotDamage = Math.round(stats.gun.damage * stats.damageMul * 10) / 10
  return stats
}

export function reclampHp(save: SaveData, prevMax: number): void {
  const max = computeStats(save).maxHp
  const delta = max - prevMax
  save.hp = delta > 0 ? Math.min(max, save.hp + delta) : Math.min(save.hp, max)
  save.hp = Math.max(0, save.hp)
}

export function healAmount(save: SaveData, amount: number): number {
  const max = computeStats(save).maxHp
  const before = save.hp
  save.hp = Math.min(max, save.hp + Math.max(0, amount))
  return save.hp - before
}

export function healFull(save: SaveData): void {
  save.hp = computeStats(save).maxHp
}

export function gainXp(save: SaveData, amount: number): MutationResult {
  const before = computeStats(save).maxHp
  const build = buildOf(save)
  if (save.level >= LEVEL_CAP) return emptyResult()
  save.xp += Math.max(0, Math.floor(amount))
  let levels = 0
  let guard = 0
  while (save.level < LEVEL_CAP && save.xp >= xpToNext(save.level) && guard < 40) {
    save.xp -= xpToNext(save.level)
    save.level += 1
    levels += 1
    save.byeolhaPoints += 1
    build.points += 1
    if (save.level % 2 === 0) save.mochiPoints += 1
    guard += 1
  }
  if (save.level >= LEVEL_CAP) save.xp = 0
  const after = computeStats(save).maxHp
  if (after > before) save.hp = Math.min(after, save.hp + (after - before))
  const result = emptyResult()
  if (levels > 0) {
    result.leveled = true
    result.toasts.push(`레벨 ${save.level}! 스킬 포인트 +${levels}`)
  }
  return result
}

export function gainGold(save: SaveData, amount: number): void {
  save.gold = Math.max(0, save.gold + Math.floor(amount))
}

export function spendGold(save: SaveData, amount: number): boolean {
  if (save.gold < amount) return false
  save.gold -= amount
  return true
}
