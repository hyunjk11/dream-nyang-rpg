import { ITEMS } from '../data/items'
import { BAG_CAP, type EquipSlot, type ItemInstance, type SaveData } from './types'

export function findItem(save: SaveData, id: string | undefined): ItemInstance | undefined {
  if (!id) return undefined
  return save.items.find((item) => item.uid === id)
}

export function isEquipped(save: SaveData, id: string): boolean {
  return Object.values(save.equipment).includes(id)
}

export function bagItems(save: SaveData): ItemInstance[] {
  return save.items.filter((item) => !isEquipped(save, item.uid))
}

export function addItem(save: SaveData, item: ItemInstance, force = false): boolean {
  if (!force && bagItems(save).length >= BAG_CAP) return false
  save.items.push(item)
  return true
}

/** Which slot an item goes to: accessories fill the empty one of two (else the first). */
export function slotFor(save: SaveData, item: ItemInstance, prefer?: EquipSlot): EquipSlot | undefined {
  const slot = ITEMS[item.defId]?.slot
  if (!slot) return undefined
  if (slot !== 'accessory') return slot
  if (prefer === 'accessory' || prefer === 'accessory2') return prefer
  if (save.equipment.accessory === item.uid) return 'accessory'
  if (save.equipment.accessory2 === item.uid) return 'accessory2'
  if (!save.equipment.accessory) return 'accessory'
  if (!save.equipment.accessory2) return 'accessory2'
  return 'accessory'
}

export function equipItem(save: SaveData, id: string, prefer?: EquipSlot): { ok: boolean; reason?: string; slot?: EquipSlot } {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '그 물건은 가방에 없어.' }
  const slot = slotFor(save, item, prefer)
  if (!slot) return { ok: false, reason: '장착할 수 없는 물건이야.' }
  for (const s of Object.keys(save.equipment) as EquipSlot[]) if (save.equipment[s] === id) delete save.equipment[s]
  save.equipment[slot] = item.uid
  return { ok: true, slot }
}

export function unequipItem(save: SaveData, slot: EquipSlot): { ok: boolean; reason?: string } {
  if (!save.equipment[slot]) return { ok: false, reason: '비어 있는 칸이야.' }
  if (slot === 'weapon') return { ok: false, reason: '총은 다른 총으로 바꿔 끼워야 해.' }
  if (bagItems(save).length >= BAG_CAP) return { ok: false, reason: '가방이 가득 찼어.' }
  delete save.equipment[slot]
  return { ok: true }
}

export function removeItem(save: SaveData, id: string): ItemInstance | undefined {
  const index = save.items.findIndex((item) => item.uid === id)
  if (index < 0) return undefined
  const [item] = save.items.splice(index, 1)
  for (const slot of Object.keys(save.equipment) as EquipSlot[]) {
    if (save.equipment[slot] === id) delete save.equipment[slot]
  }
  return item
}

/**
 * Item power against what she wears in that slot: +n better, −n worse, 0 same, null when it is
 * worn or not wearable. Accessories compare with the weaker of the two (that is the one it replaces).
 */
export function powerVsWorn(save: SaveData, item: ItemInstance, power: (i: ItemInstance) => number): number | null {
  const slot = ITEMS[item.defId]?.slot
  if (!slot || isEquipped(save, item.uid)) return null
  const worn = (s: EquipSlot) => findItem(save, save.equipment[s])
  let now = 0
  if (slot === 'accessory') {
    const a = worn('accessory')
    const b = worn('accessory2')
    now = a && b ? Math.min(power(a), power(b)) : 0
  } else {
    const w = worn(slot)
    now = w ? power(w) : 0
  }
  return power(item) - now
}
