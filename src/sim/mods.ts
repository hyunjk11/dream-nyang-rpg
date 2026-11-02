/**
 * 총 개조: mod parts (조준경 · 총열 · 탄창 · 속성 칩) slot into a gun. Slots come from the gun's
 * rarity (+1 at iLv 10), one part of each kind per gun. Parts drop with a rarity and iLv like gear;
 * the gunsmith fits / pulls them, and salvage (장난감 부품 · 별조각) raises a part's rarity.
 */
import type { GunLook } from '../actors/toygun'
import { ITEMS } from '../data/items'
import { CHIP_TINT, MOD_IDS, MOD_KO, MOD_SPECS, type ModKind, type ModSpec } from '../data/mods'
import { addItem, bagItems, findItem, isEquipped, removeItem } from './inventory'
import { levelScale, roundStat } from './loot'
import { townOf } from './town'
import { BAG_CAP, RARITIES, uid, type Affix, type ItemInstance, type Rarity, type SaveData, type StatKey } from './types'

/** Rarity → how strong a part rolls. */
export const MOD_RARITY: Record<Rarity, number> = { common: 1, uncommon: 1.15, rare: 1.35, epic: 1.6, legendary: 1.9 }
/** Mod slots per gun rarity (보통 1 · 매직 1 · 희귀 2 · 영웅 3 · 전설 4); iLv 10+ adds one (max 4). */
export const MOD_SLOTS: Record<Rarity, number> = { common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 4 }
export const MOD_SLOT_ILV = 10
export const MAX_MOD_SLOTS = 4

export function isMod(item: ItemInstance | undefined): boolean {
  return !!item && !!ITEMS[item.defId]?.mod && !!MOD_SPECS[item.defId]
}

export function modSpec(item: ItemInstance): ModSpec | undefined {
  return MOD_SPECS[item.defId]
}

export function modKind(item: ItemInstance): ModKind | undefined {
  return MOD_SPECS[item.defId]?.kind
}

export function isGun(item: ItemInstance | undefined): boolean {
  return !!item && ITEMS[item.defId]?.slot === 'weapon'
}

/** Slots this gun has. */
export function modSlots(gun: ItemInstance): number {
  if (!isGun(gun)) return 0
  return Math.min(MAX_MOD_SLOTS, (MOD_SLOTS[gun.rarity] ?? 1) + (gun.itemLevel >= MOD_SLOT_ILV ? 1 : 0))
}

/** The parts in a gun (old saves: none). */
export function gunMods(gun: ItemInstance): ItemInstance[] {
  return Array.isArray(gun.mods) ? gun.mods.filter(isMod) : []
}

function modAffixes(defId: string, rarity: Rarity, itemLevel: number): Affix[] {
  const spec = MOD_SPECS[defId]
  if (!spec) return []
  const k = levelScale(itemLevel) * MOD_RARITY[rarity]
  return (Object.entries(spec.stats) as [StatKey, number][]).map(([stat, v]) => ({ id: `mod_${stat}`, name: '', stat, value: roundStat(stat, v * k) }))
}

/** A fresh part (values fixed by kind, rarity and iLv: no roll, so upgrades are predictable). */
export function makeMod(defId: string, rarity: Rarity, itemLevel: number): ItemInstance {
  const level = Math.max(1, Math.floor(itemLevel))
  return { uid: uid(), defId, rarity, itemLevel: level, affixes: modAffixes(defId, rarity, level), v: 2 }
}

/** Random part for a drop. */
export function rollMod(rng: () => number, rarity: Rarity, itemLevel: number): ItemInstance {
  const id = MOD_IDS[Math.min(MOD_IDS.length - 1, Math.floor(rng() * MOD_IDS.length))]
  return makeMod(id, rarity, itemLevel)
}

/** "조준경 · 치명타 +2%" style label. */
export function modLabel(mod: ItemInstance): string {
  const kind = modKind(mod)
  return kind ? MOD_KO[kind] : '부품'
}

export interface ModResult {
  ok: boolean
  reason?: string
  gun?: ItemInstance
  mod?: ItemInstance
  /** A part of the same kind that came back to the bag (swap). */
  swapped?: ItemInstance
}

/** Guns the gunsmith can see: worn, bag, stash. */
export function locateGun(save: SaveData, gunUid: string): ItemInstance | undefined {
  const g = findItem(save, gunUid) ?? townOf(save).stash.find((i) => i.uid === gunUid)
  return isGun(g) ? g : undefined
}

/** Gold to fit a part (cheap: the fun is in finding them). */
export function fitCost(mod: ItemInstance): number {
  return 10 + 12 * RARITIES.indexOf(mod.rarity)
}

/** Fit a bag part into a gun. A part of the same kind swaps out back to the bag. */
export function attachMod(save: SaveData, gunUid: string, modUid: string): ModResult {
  const gun = locateGun(save, gunUid)
  if (!gun) return { ok: false, reason: '총을 찾을 수 없어.' }
  const mod = findItem(save, modUid)
  if (!mod || !isMod(mod) || isEquipped(save, modUid)) return { ok: false, reason: '가방에 그 부품이 없어.' }
  const mods = gunMods(gun)
  const kind = modKind(mod)
  const same = mods.findIndex((m) => modKind(m) === kind)
  if (same < 0 && mods.length >= modSlots(gun)) return { ok: false, reason: `빈 개조 칸이 없어. (${mods.length}/${modSlots(gun)})` }
  const cost = fitCost(mod)
  if (save.gold < cost) return { ok: false, reason: `골드가 모자라. ${cost} 필요해.` }
  save.gold -= cost
  removeItem(save, modUid)
  let swapped: ItemInstance | undefined
  if (same >= 0) {
    swapped = mods.splice(same, 1, mod)[0]
    addItem(save, swapped, true)
  } else mods.push(mod)
  gun.mods = mods
  return { ok: true, gun, mod, swapped }
}

/** Pull a part out (free) back into the bag. */
export function detachMod(save: SaveData, gunUid: string, modUid: string): ModResult {
  const gun = locateGun(save, gunUid)
  if (!gun) return { ok: false, reason: '총을 찾을 수 없어.' }
  const mods = gunMods(gun)
  const i = mods.findIndex((m) => m.uid === modUid)
  if (i < 0) return { ok: false, reason: '그 부품은 이 총에 없어.' }
  if (bagItems(save).length >= BAG_CAP) return { ok: false, reason: '가방이 가득 찼어.' }
  const [mod] = mods.splice(i, 1)
  gun.mods = mods
  addItem(save, mod)
  return { ok: true, gun, mod }
}

/** Selling / breaking a gun gives its parts back first (they never vanish). */
export function stripMods(save: SaveData, gun: ItemInstance): ItemInstance[] {
  const mods = gunMods(gun)
  delete gun.mods
  for (const m of mods) addItem(save, m, true)
  return mods
}

export interface ModCost {
  gold: number
  mats: Record<string, number>
}

/** Salvage price to lift a part one rarity (null at 전설). */
export function modUpgradeCost(mod: ItemInstance): ModCost | null {
  const i = RARITIES.indexOf(mod.rarity)
  if (i < 0 || i >= RARITIES.length - 1) return null
  const mats: Record<string, number> = { toy_part: i + 1 }
  if (i + 1 >= 3) mats.star_shard = i - 1
  return { gold: 30 + 30 * i, mats }
}

/** Where a part sits: the bag or a gun (worn, bag, stash). */
export function locateMod(save: SaveData, modUid: string): { mod: ItemInstance; gun?: ItemInstance } | undefined {
  const inBag = findItem(save, modUid)
  if (inBag && isMod(inBag)) return { mod: inBag }
  for (const g of [...save.items, ...townOf(save).stash]) {
    if (!isGun(g)) continue
    const m = gunMods(g).find((x) => x.uid === modUid)
    if (m) return { mod: m, gun: g }
  }
  return undefined
}

/** 부품 강화: salvage (장난감 부품, 별조각) + gold → next rarity; values recomputed. */
export function upgradeMod(save: SaveData, modUid: string): ModResult {
  const at = locateMod(save, modUid)
  if (!at) return { ok: false, reason: '그 부품이 없어.' }
  const cost = modUpgradeCost(at.mod)
  if (!cost) return { ok: false, reason: '이미 전설 부품이야!' }
  const short = save.gold < cost.gold || Object.entries(cost.mats).some(([m, n]) => (save.materials[m] ?? 0) < n)
  if (short) return { ok: false, reason: save.gold < cost.gold ? `골드가 모자라. ${cost.gold} 필요해.` : '재료가 모자라. 부품이나 장비를 분해해 봐.' }
  save.gold -= cost.gold
  for (const [m, n] of Object.entries(cost.mats)) save.materials[m] = (save.materials[m] ?? 0) - n
  const mod = at.mod
  mod.rarity = RARITIES[RARITIES.indexOf(mod.rarity) + 1]
  mod.affixes = modAffixes(mod.defId, mod.rarity, mod.itemLevel)
  return { ok: true, mod, gun: at.gun }
}

/** Parts in the bag (for the gunsmith list). */
export function bagMods(save: SaveData): ItemInstance[] {
  return bagItems(save).filter(isMod)
}

/** Lens / drum colour per part rarity. */
const PART_TONE: Record<Rarity, number> = { common: 0xdfe8ff, uncommon: 0x9be7c7, rare: 0x8fc8ff, epic: 0xc79bff, legendary: 0xffc65a }

/** The gun model with its parts on: longer barrel, a scope, a drum, chip-tinted tank and tracer. */
export function gunLookWithMods(base: GunLook, gun: ItemInstance | undefined): GunLook {
  if (!gun) return base
  const mods = gunMods(gun)
  if (!mods.length) return base
  const look: GunLook = { ...base }
  for (const m of mods) {
    const kind = modKind(m)
    const r = RARITIES.indexOf(m.rarity)
    if (kind === 'barrel') look.barrelLen = base.barrelLen * (1.25 + 0.05 * r)
    else if (kind === 'scope') look.scope = PART_TONE[m.rarity]
    else if (kind === 'mag') look.mag = PART_TONE[m.rarity]
    else if (kind === 'chip') {
      const el = modSpec(m)?.element
      if (el) {
        look.chip = CHIP_TINT[el]
        look.tank = CHIP_TINT[el]
        look.tracer = CHIP_TINT[el]
      }
    }
  }
  return look
}
