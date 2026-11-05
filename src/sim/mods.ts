/**
 * 총 개조: mod parts (조준경 · 총열 · 탄창 · 속성 칩 · 특수 부품) slot into a gun. Slots come from the gun's
 * rarity (+1 at iLv 10), one part of each kind per gun, except 특수 부품: up to MAX_TRICKS different
 * ones (two of them, or one with a chip, can make a 조합 — see COMBOS). Parts drop with a rarity and iLv like gear;
 * the gunsmith fits / pulls them, and salvage (장난감 부품 · 별조각) raises a part's rarity.
 */
import type { GunLook } from '../actors/toygun'
import { ITEMS } from '../data/items'
import { CHIP_TINT, COMBOS, MAX_TRICKS, MOD_IDS, MOD_KO, MOD_SPECS, TRICK_KO, type ComboSpec, type ModKind, type ModSpec, type TrickId } from '../data/mods'
import { addItem, bagItems, findItem, isEquipped, oneHanded, removeItem } from './inventory'
import { levelScale, roundStat } from './loot'
import { townOf } from './town'
import { BAG_CAP, RARITIES, uid, type Affix, type Element, type ItemInstance, type Rarity, type SaveData, type StatKey } from './types'

/**
 * Rarity → how strong a part rolls. Was 1 / 1.15 / 1.35 / 1.60 / 1.90, so 부품 강화
 * to 전설 nearly doubled a common part on top of the gun's +N. The climb is closer
 * now: each step still matters, and a legendary part is ×1.45 a common one.
 */
export const MOD_RARITY: Record<Rarity, number> = { common: 1, uncommon: 1.08, rare: 1.18, epic: 1.3, legendary: 1.45 }
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

/** Which worn gun a part is aimed at. `weapon` is the main hand, `offhand` the second gun. */
export type PartHand = 'weapon' | 'offhand'
export const HAND_KO: Record<PartHand, string> = { weapon: '주 손', offhand: '보조 손' }

/**
 * The gun in that hand, when parts can actually go there. A two-handed main gun leaves the off
 * hand empty (it is not a second target). An illegal off-hand (old save) is ignored.
 */
export function wornGun(save: SaveData, hand: PartHand): ItemInstance | null {
  const item = findItem(save, save.equipment[hand])
  if (!item || !isGun(item)) return null
  if (hand === 'weapon') return item
  const main = findItem(save, save.equipment.weapon)
  if (!main || !isGun(main) || !oneHanded(main) || !oneHanded(item)) return null
  return item
}

export interface PartTarget {
  hand: PartHand
  gun: ItemInstance | null
  /** Why nothing was fitted (also used when a strict pick misses). Null when `gun` is set with no caveat. */
  note: string | null
}

/**
 * Resolve the worn gun a part action targets.
 * Strict (a tap on that hand, a drop on that slot): never swap hands behind the player's back.
 * Loose (double-click with the preferred hand empty): fall back to the other gun and say so.
 */
export function partTarget(save: SaveData, prefer: PartHand, strict = false): PartTarget {
  const want = wornGun(save, prefer)
  if (want) return { hand: prefer, gun: want, note: null }
  const main = wornGun(save, 'weapon')
  if (prefer === 'offhand' && main && !oneHanded(main)) {
    return { hand: 'weapon', gun: strict ? null : main, note: strict ? '양손 총이라 보조 손이 없어. 주 손 총을 골라 줘.' : '양손 총이라 보조 손이 없어. 주 손에 끼울게.' }
  }
  if (!strict) {
    const other: PartHand = prefer === 'weapon' ? 'offhand' : 'weapon'
    const alt = wornGun(save, other)
    if (alt) return { hand: other, gun: alt, note: prefer === 'offhand' ? '보조 손이 비어 있어. 주 손에 끼울게.' : '주 손이 비어 있어. 보조 손에 끼울게.' }
  }
  const note = prefer === 'offhand' ? '보조 손에 한 손 총을 먼저 차 줘.' : '주 손에 총을 먼저 차 줘.'
  return { hand: prefer, gun: null, note }
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
  // 관통 is flat: one more foe, two from 영웅.
  const value = (stat: StatKey, v: number) => (stat === 'pierce' ? v + (RARITIES.indexOf(rarity) >= 3 ? 1 : 0) : roundStat(stat, v * k))
  return (Object.entries(spec.stats) as [StatKey, number][]).map(([stat, v]) => ({ id: `mod_${stat}`, name: '', stat, value: value(stat, v) }))
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
  const spec = modSpec(mod)
  if (spec?.trick) return `특수 · ${TRICK_KO[spec.trick]}`
  return spec ? MOD_KO[spec.kind] : '부품'
}

/** Which of a gun's parts a new part would swap: same kind, or for 특수 부품 the same trick. */
export function swapIndex(mods: ItemInstance[], mod: ItemInstance): number {
  const kind = modKind(mod)
  if (kind === 'trick') return mods.findIndex((m) => m.defId === mod.defId)
  return mods.findIndex((m) => modKind(m) === kind)
}

/** Why this part can't go in (null = it fits, maybe as a swap). */
export function fitBlock(gun: ItemInstance, mod: ItemInstance): string | null {
  const mods = gunMods(gun)
  if (swapIndex(mods, mod) >= 0) return null
  if (mods.length >= modSlots(gun)) return `빈 개조 칸이 없어. (${mods.length}/${modSlots(gun)})`
  if (modKind(mod) === 'trick' && mods.filter((m) => modKind(m) === 'trick').length >= MAX_TRICKS) return `특수 부품은 ${MAX_TRICKS}개까지야. 하나 빼고 끼워 줘.`
  return null
}

export type Trait = TrickId | Element
/** Stat → the trait it gives a gun (for 조합): from parts, rolled options and legend options. */
const TRAIT_OF: Partial<Record<StatKey, Trait>> = { starShot: 'star', cloud: 'cloud', pierce: 'pierce', lifesteal: 'sip', sparkle: 'sparkle', ice: 'ice', candy: 'candy' }

/** Everything that flavours this gun's shots: its type, rolled / legend options and parts. */
export function gunTraits(gun: ItemInstance | undefined): Set<Trait> {
  const out = new Set<Trait>()
  if (!gun) return out
  // The gun's own flavour counts too: 별똥 점사총 throws stars, 방울 샷건 puffs clouds (GUN_JUICE).
  const kind = ITEMS[gun.defId]?.gun
  if (kind === 'star') out.add('star')
  if (kind === 'bubble') out.add('cloud')
  for (const a of [...gun.affixes, ...gunMods(gun).flatMap((m) => m.affixes)]) {
    const t = TRAIT_OF[a.stat]
    if (t && a.value > 0) out.add(t)
  }
  return out
}

/** The 조합 this gun has on. */
export function gunCombos(gun: ItemInstance | undefined): ComboSpec[] {
  const t = gunTraits(gun)
  return COMBOS.filter((c) => t.has(c.needs[0]) && t.has(c.needs[1]))
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

/** Fit a bag part into a gun. A part of the same kind (특수: same trick) swaps out back to the bag. */
export function attachMod(save: SaveData, gunUid: string, modUid: string): ModResult {
  const gun = locateGun(save, gunUid)
  if (!gun) return { ok: false, reason: '총을 찾을 수 없어.' }
  const mod = findItem(save, modUid)
  if (!mod || !isMod(mod) || isEquipped(save, modUid)) return { ok: false, reason: '가방에 그 부품이 없어.' }
  const mods = gunMods(gun)
  const same = swapIndex(mods, mod)
  const block = fitBlock(gun, mod)
  if (block) return { ok: false, reason: block }
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

/** 부품 강화 단계: a part levels up by rarity (보통 1 … 전설 5). */
export function partTier(mod: ItemInstance): { now: number; max: number } {
  return { now: Math.max(1, RARITIES.indexOf(mod.rarity) + 1), max: RARITIES.length }
}

/** The 조합 a part would newly switch on in this gun (after its swap, if any). */
export function newCombos(gun: ItemInstance, part: ItemInstance): ComboSpec[] {
  const now = new Set(gunCombos(gun).map((c) => c.id))
  const mods = gunMods(gun)
  const i = swapIndex(mods, part)
  const next = i >= 0 ? mods.map((m, k) => (k === i ? part : m)) : [...mods, part]
  return gunCombos({ ...gun, mods: next }).filter((c) => !now.has(c.id))
}

/** The 조합 a part's swap-out would switch off. */
export function lostCombos(gun: ItemInstance, part: ItemInstance): ComboSpec[] {
  const mods = gunMods(gun)
  const i = swapIndex(mods, part)
  if (i < 0) return []
  const after = new Set(gunCombos({ ...gun, mods: mods.map((m, k) => (k === i ? part : m)) }).map((c) => c.id))
  return gunCombos(gun).filter((c) => !after.has(c.id))
}

export interface FitPreview {
  /** Why it can't go in (null = it fits). */
  block: string | null
  /** Socket it lands in (a swap keeps the slot; a new part takes the next empty one). */
  slot: number
  /** The part that comes back to the bag on a swap. */
  swap: ItemInstance | null
  cost: number
  gain: ComboSpec[]
  lose: ComboSpec[]
}

/** What fitting this part into this gun would do, before paying: socket, swap, gold, 조합 ±. */
export function fitPreview(gun: ItemInstance, part: ItemInstance): FitPreview {
  const mods = gunMods(gun)
  const i = swapIndex(mods, part)
  return { block: fitBlock(gun, part), slot: i >= 0 ? i : mods.length, swap: i >= 0 ? mods[i] : null, cost: fitCost(part), gain: newCombos(gun, part), lose: lostCombos(gun, part) }
}

/** Parts in the bag (for the gunsmith list). */
export function bagMods(save: SaveData): ItemInstance[] {
  return bagItems(save).filter(isMod)
}

/** Charm colour per 특수 부품. */
export const TRICK_TINT: Record<TrickId, number> = { star: 0xffe066, cloud: 0xffb3dc, pierce: 0xc9b8ff, sip: 0xff6f9a }

/** Lens / drum colour per part rarity. */
const PART_TONE: Record<Rarity, number> = { common: 0xdfe8ff, uncommon: 0x7ee08a, rare: 0x6fb2ff, epic: 0xc98bff, legendary: 0xffe066 }

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
    } else if (kind === 'trick') {
      const t = modSpec(m)?.trick
      if (t) look.tricks = [...(look.tricks ?? []), TRICK_TINT[t]]
    }
  }
  return look
}
