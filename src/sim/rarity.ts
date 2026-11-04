import { ITEMS } from '../data/items'
import { RARITY_COLOR, RARITY_KO, UNIQUE_COLOR, UNIQUE_KO, type ItemInstance } from './types'

/** 유니크 = a fixed named legendary (its def carries `legend`); random 전설 stay plain 전설. */
export function isUnique(item: Pick<ItemInstance, 'defId'> | null | undefined): boolean {
  return !!(item && ITEMS[item.defId]?.legend)
}

/** Text / border / beam colour for an item: orange for 유니크, the rarity ladder otherwise. */
export function itemColor(item: Pick<ItemInstance, 'defId' | 'rarity'>): string {
  return isUnique(item) ? UNIQUE_COLOR : RARITY_COLOR[item.rarity]
}

/** Rarity word for an item: 보통 · 매직 · 희귀 · 영웅 · 전설 · 유니크. */
export function itemRarityKo(item: Pick<ItemInstance, 'defId' | 'rarity'>): string {
  return isUnique(item) ? UNIQUE_KO : RARITY_KO[item.rarity]
}
