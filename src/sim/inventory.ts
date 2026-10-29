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

export function equipItem(save: SaveData, id: string): { ok: boolean; reason?: string } {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '그 물건은 가방에 없어.' }
  const def = ITEMS[item.defId]
  if (!def?.slot) return { ok: false, reason: '장착할 수 없는 물건이야.' }
  save.equipment[def.slot] = item.uid
  return { ok: true }
}

export function unequipItem(save: SaveData, slot: EquipSlot): { ok: boolean; reason?: string } {
  if (!save.equipment[slot]) return { ok: false, reason: '비어 있는 칸이야.' }
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
