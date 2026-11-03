/**
 * fix/mod-parts: old saves had 도탄 · 뭉게뭉게 · 관통 as rolled gun options (and stars / clouds on
 * every gun). Those options turn into the matching 특수 부품 — fitted into the same gun when a slot
 * is free, else into the bag (even from a stashed gun) — so nothing she had is lost. Once per save she also gets a 도탄 and a
 * 뭉게뭉게 part (보통, her level), so the fun that used to be built in is one workshop tap away.
 * Safe to run twice (the options are gone after the first pass; the gift is flagged).
 */
import { TRICK_PART, type TrickId } from '../data/mods'
import { addItem } from './inventory'
import { fitBlock, gunMods, isGun, makeMod } from './mods'
import { townOf } from './town'
import type { ItemInstance, SaveData } from './types'
import { legendOf } from './legends'

/** Old option id → the part it becomes. */
export const AFFIX_TO_TRICK: Record<string, TrickId> = { ricochet: 'star', fluff: 'cloud', pierce: 'pierce' }
export const PARTS_GIFT_FLAG = 'parts_gift_v1'

export interface PartsMigration {
  /** Options turned into parts. */
  converted: number
  /** Gift parts given this load. */
  gifted: number
}

function convertGun(save: SaveData, gun: ItemInstance): number {
  // 전설 keep their signature options as they are.
  if (!isGun(gun) || legendOf(gun)) return 0
  let n = 0
  const keep = []
  for (const a of gun.affixes) {
    const trick = AFFIX_TO_TRICK[a.id]
    if (!trick) {
      keep.push(a)
      continue
    }
    const part = makeMod(TRICK_PART[trick], gun.rarity, gun.itemLevel)
    if (!fitBlock(gun, part)) gun.mods = [...gunMods(gun), part]
    else addItem(save, part, true)
    n += 1
  }
  gun.affixes = keep
  return n
}

export function migrateParts(save: SaveData): PartsMigration {
  let converted = 0
  for (const g of save.items) converted += convertGun(save, g)
  for (const g of townOf(save).stash) converted += convertGun(save, g)
  let gifted = 0
  save.flags = save.flags ?? {}
  if (!save.flags[PARTS_GIFT_FLAG]) {
    save.flags[PARTS_GIFT_FLAG] = true
    // Brand-new saves (level 1, nothing but the starter gun) find parts on the way instead.
    if (save.level > 1 || save.items.length > 1) {
      const lv = Math.max(1, Math.floor(save.level))
      for (const t of ['star', 'cloud'] as TrickId[]) addItem(save, makeMod(TRICK_PART[t], 'common', lv), true)
      gifted = 2
    }
  }
  return { converted, gifted }
}
