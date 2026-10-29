import { ITEMS } from '../data/items'
import type { SaveData, StatKey, WeaponKind } from './types'
import { emptyResult, type MutationResult } from './types'
import { findItem } from './inventory'
import { clamp, xpToNext } from './formulas'

export interface ComputedStats {
  maxHp: number
  atk: number
  def: number
  critChance: number
  critDamage: number
  attackSpeed: number
  moveSpeed: number
  luck: number
  weaponDamage: number
  weaponKind: WeaponKind
  weaponCooldown: number
  weaponSpeed: number
  weaponLife: number
  weaponPierce: number
  weaponAoe: number
  weaponSpread: number
}

const ARMOR_RARITY = { common: 1, uncommon: 1.12, rare: 1.28, epic: 1.5, legendary: 1.8 }
const WEAPON_RARITY = { common: 1, uncommon: 1.15, rare: 1.32, epic: 1.55, legendary: 1.85 }

export function computeStats(save: SaveData): ComputedStats {
  const level = save.level
  const stats: ComputedStats = {
    maxHp: 110 + (level - 1) * 16,
    atk: 6 + (level - 1) * 1.4,
    def: 4 + (level - 1) * 1,
    critChance: 0.05,
    critDamage: 1.5,
    attackSpeed: 1,
    moveSpeed: 228 + (level - 1),
    luck: 2 + (level - 1) * 0.4,
    weaponDamage: 8,
    weaponKind: 'water',
    weaponCooldown: 0.34,
    weaponSpeed: 640,
    weaponLife: 0.38,
    weaponPierce: 1,
    weaponAoe: 0,
    weaponSpread: 0.04,
  }
  if (save.learnedSkills.includes('sense')) stats.critChance += 0.05
  if (save.learnedSkills.includes('lucky')) stats.luck += 12

  for (const id of Object.values(save.equipment)) {
    const item = findItem(save, id)
    if (!item) continue
    const def = ITEMS[item.defId]
    if (!def) continue
    if (def.weapon && def.slot === 'weapon') {
      const scale = (1 + (item.itemLevel - 1) * 0.08) * WEAPON_RARITY[item.rarity]
      stats.weaponDamage = def.weapon.damage * scale
      stats.weaponKind = def.weapon.kind
      stats.weaponCooldown = def.weapon.cooldown
      stats.weaponSpeed = def.weapon.speed
      stats.weaponLife = def.weapon.life
      stats.weaponPierce = def.weapon.pierce
      stats.weaponAoe = def.weapon.aoe
      stats.weaponSpread = def.weapon.spread
    }
    if (def.stats && def.slot && def.slot !== 'weapon') {
      const scale = (1 + (item.itemLevel - 1) * 0.05) * ARMOR_RARITY[item.rarity]
      for (const [key, value] of Object.entries(def.stats) as [StatKey, number][]) addStat(stats, key, value * scale)
    }
    for (const affix of item.affixes) addStat(stats, affix.stat, affix.value)
  }

  stats.maxHp = Math.round(stats.maxHp)
  stats.atk = Math.round(stats.atk * 10) / 10
  stats.def = Math.round(stats.def * 10) / 10
  stats.luck = Math.round(stats.luck)
  stats.weaponDamage = Math.round(stats.weaponDamage * 10) / 10
  stats.critChance = clamp(stats.critChance, 0, 0.7)
  stats.attackSpeed = clamp(stats.attackSpeed, 0.6, 2.1)
  stats.moveSpeed = clamp(stats.moveSpeed, 160, 360)
  return stats
}

function addStat(stats: ComputedStats, key: StatKey, value: number): void {
  if (key === 'hp') stats.maxHp += value
  else if (key === 'atk') stats.atk += value
  else if (key === 'def') stats.def += value
  else if (key === 'critChance') stats.critChance += value
  else if (key === 'critDamage') stats.critDamage += value
  else if (key === 'attackSpeed') stats.attackSpeed += value
  else if (key === 'moveSpeed') stats.moveSpeed += value
  else if (key === 'luck') stats.luck += value
  else if (key === 'weaponDamage') stats.weaponDamage += value
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
  save.xp += Math.max(0, Math.floor(amount))
  let levels = 0
  let guard = 0
  while (save.level < 99 && save.xp >= xpToNext(save.level) && guard < 40) {
    save.xp -= xpToNext(save.level)
    save.level += 1
    levels += 1
    save.byeolhaPoints += 1
    if (save.level % 2 === 0) save.mochiPoints += 1
    guard += 1
  }
  const after = computeStats(save).maxHp
  if (after > before) save.hp = Math.min(after, save.hp + (after - before))
  const result = emptyResult()
  if (levels > 0) {
    result.leveled = true
    result.toasts.push(`레벨 ${save.level}! 스킬 포인트가 자랐다.`)
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
