/**
 * Two weapon sets (세트 A / 세트 B). The live pair stays in `equipment.weapon` / `offhand`
 * so the rest of the game keeps reading one pair of hands. The other pair is holstered
 * (`weaponSets.stowed`): those guns are not in the bag, and their 부품 stay on the gun.
 * Old saves have no block; `ensureSets` fills an empty holster and never deletes an item.
 */
import { ITEMS } from '../data/items'
import { itemName } from './loot'
import { bagItems, findItem, gunHeld, oneHanded } from './inventory'
import { fixHands } from './hands'
import { BAG_CAP, type ItemInstance, type SaveData, type WeaponSet, type WeaponSets } from './types'

export { gunHeld }

export function ensureSets(save: SaveData): WeaponSets {
  const prev = save.weaponSets
  const active: 0 | 1 = prev?.active === 1 ? 1 : 0
  const stowed: WeaponSet = { weapon: prev?.stowed?.weapon, offhand: prev?.stowed?.offhand }
  save.weaponSets = { active, stowed }
  const live = new Set([save.equipment.weapon, save.equipment.offhand])
  if (!stowed.weapon || !findItem(save, stowed.weapon) || live.has(stowed.weapon)) delete stowed.weapon
  if (!stowed.offhand || !findItem(save, stowed.offhand) || live.has(stowed.offhand) || stowed.offhand === stowed.weapon) delete stowed.offhand
  // A two-handed main (or a missing one) cannot keep an off-hand gun holstered. It returns to the bag.
  const main = findItem(save, stowed.weapon)
  const off = findItem(save, stowed.offhand)
  if (stowed.offhand && (!main || !oneHanded(main) || !oneHanded(off))) delete stowed.offhand
  return save.weaponSets
}

export function activeSet(save: SaveData): 0 | 1 {
  return ensureSets(save).active
}

/** The holstered pair (the one that is not in her hands). */
export function stowedSet(save: SaveData): WeaponSet {
  return ensureSets(save).stowed
}

export function setName(which: 0 | 1): 'A' | 'B' {
  return which === 0 ? 'A' : 'B'
}

/** Short label for a pair: the main gun's name, or 비어 있음. */
export function setBlurb(save: SaveData, hands: WeaponSet): string {
  const gun = findItem(save, hands.weapon)
  if (!gun) return '비어 있음'
  const off = findItem(save, hands.offhand)
  return off ? `${itemName(gun)} + ${itemName(off)}` : itemName(gun)
}

export interface SwapResult {
  ok: boolean
  reason?: string
  active?: 0 | 1
  /** What she is holding now. */
  now?: string
}

/**
 * Exchange the live hands with the holster. Guns move between the two sets; nothing is
 * removed from `save.items`. An illegal off hand (under a two-handed gun) falls back to the bag.
 */
export function swapLoadout(save: SaveData): SwapResult {
  const sets = ensureSets(save)
  const live: WeaponSet = { weapon: save.equipment.weapon, offhand: save.equipment.offhand }
  const next = { ...sets.stowed }
  if (next.weapon) save.equipment.weapon = next.weapon
  else delete save.equipment.weapon
  if (next.offhand) save.equipment.offhand = next.offhand
  else delete save.equipment.offhand
  sets.stowed = { weapon: live.weapon, offhand: live.offhand }
  sets.active = sets.active === 0 ? 1 : 0
  // The pair she just drew might be an old illegal combo. fixHands only clears the slot.
  fixHands(save)
  ensureSets(save)
  const which = sets.active
  const hands: WeaponSet = { weapon: save.equipment.weapon, offhand: save.equipment.offhand }
  const blurb = setBlurb(save, hands)
  return { ok: true, active: which, now: blurb === '비어 있음' ? `세트 ${setName(which)}로 바꿨어. 이 손은 비어 있어.` : `세트 ${setName(which)} · ${blurb}` }
}

/**
 * Park a bag gun into the holstered set without drawing it. The gun it replaces comes back
 * to the bag. A full bag blocks the move (the gun stays where it was) — nothing is deleted.
 */
export function parkWeapon(save: SaveData, id: string, hand: 'weapon' | 'offhand'): { ok: boolean; reason?: string; toBag?: ItemInstance[] } {
  const sets = ensureSets(save)
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '그 물건은 가방에 없어.' }
  if (ITEMS[item.defId]?.slot !== 'weapon') return { ok: false, reason: '총만 세트에 넣을 수 있어.' }
  if (gunHeld(save, id)) return { ok: false, reason: '이미 손에 있거나 다른 세트에 들어 있어.' }
  // slot check is done by the caller via ITEMS; here we only accept items the bag is holding.
  const stowed = sets.stowed
  const main = findItem(save, stowed.weapon)
  if (hand === 'offhand') {
    if (!oneHanded(item)) return { ok: false, reason: '양손 총은 보조 세트 칸에 못 넣어. 주 손 칸에 넣어 줘.' }
    if (!main || !oneHanded(main)) return { ok: false, reason: '그 세트의 주 손이 한 손 총일 때만 보조 총을 넣을 수 있어.' }
  }
  const displaced: ItemInstance[] = []
  if (hand === 'weapon' && stowed.weapon && stowed.weapon !== id) {
    const prev = findItem(save, stowed.weapon)
    if (prev) displaced.push(prev)
    if (!oneHanded(item) && stowed.offhand) {
      const off = findItem(save, stowed.offhand)
      if (off) displaced.push(off)
    }
  } else if (hand === 'offhand' && stowed.offhand && stowed.offhand !== id) {
    const prev = findItem(save, stowed.offhand)
    if (prev) displaced.push(prev)
  }
  // The parked gun leaves the bag; displaced holster guns enter it.
  const bagAfter = bagItems(save).length - 1 + displaced.length
  if (bagAfter > BAG_CAP) {
    const names = displaced.map((i) => itemName(i)).join(', ')
    return { ok: false, reason: `가방이 가득 차서 「${names}」 넣을 자리가 없어. 가방을 비운 뒤에 넣어 줘.` }
  }
  if (hand === 'weapon') {
    stowed.weapon = id
    if (!oneHanded(item)) delete stowed.offhand
  } else stowed.offhand = id
  return { ok: true, toBag: displaced }
}
