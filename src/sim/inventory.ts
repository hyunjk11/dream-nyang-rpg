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

/** Gun bases held in one hand (쌍권총 possible): the water pistol. */
export const ONE_HANDED_GUNS: ReadonlySet<string> = new Set(['water'])

export function oneHanded(item: ItemInstance | undefined): boolean {
  const k = item ? ITEMS[item.defId]?.gun : undefined
  return !!k && ONE_HANDED_GUNS.has(k)
}

/** 보조 손: only a one-handed gun, only beside a one-handed main gun. */
function offhandProblem(save: SaveData, item: ItemInstance): string | null {
  const def = ITEMS[item.defId]
  if (def?.slot !== 'weapon') return '보조 손에는 한 손 총만 찰 수 있어.'
  if (!oneHanded(item)) return `${def.name}은(는) 양손 총이라 보조 손에 못 차. 두 손을 다 써!`
  if (item.uid === save.equipment.weapon) return '이미 주 손에 든 총이야. 다른 한 손 총을 보조 손에 차 줘.'
  if (!oneHanded(findItem(save, save.equipment.weapon))) return '주 손 총이 양손 총이야. 주 손에 한 손 총(물총)을 먼저 들어 줘.'
  return null
}

export function equipItem(save: SaveData, id: string, prefer?: EquipSlot): { ok: boolean; reason?: string; slot?: EquipSlot } {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '그 물건은 가방에 없어.' }
  if (prefer === 'offhand') {
    const why = offhandProblem(save, item)
    if (why) return { ok: false, reason: why }
    save.equipment.offhand = item.uid
    return { ok: true, slot: 'offhand' }
  }
  const slot = slotFor(save, item, prefer)
  if (!slot) return { ok: false, reason: '장착할 수 없는 물건이야.' }
  // A two-handed gun takes both hands: the off-hand gun goes back to the bag.
  if (slot === 'weapon' && save.equipment.offhand && save.equipment.offhand !== id && !oneHanded(item)) {
    const net = (save.equipment.weapon ? 1 : 0) + 1 - (isEquipped(save, id) ? 0 : 1)
    if (bagItems(save).length + net > BAG_CAP) return { ok: false, reason: '가방이 가득 차서 보조 손 총을 넣을 데가 없어.' }
    delete save.equipment.offhand
  }
  for (const s of Object.keys(save.equipment) as EquipSlot[]) if (save.equipment[s] === id) delete save.equipment[s]
  save.equipment[slot] = item.uid
  return { ok: true, slot }
}

export function unequipItem(save: SaveData, slot: EquipSlot): { ok: boolean; reason?: string } {
  if (!save.equipment[slot]) return { ok: false, reason: '비어 있는 칸이야.' }
  if (slot === 'weapon') return { ok: false, reason: '총은 다른 총으로 바꿔 끼워야 해.' }
  // (보조 손 is free to empty: one gun in the main hand is a one-hand hold.)
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

/** Can an item made for `itemSlot` go into the `slot` cell (drag and drop)? Either ring cell takes a ring. */
export function slotFits(itemSlot: string | undefined, slot: string): boolean {
  if (!itemSlot) return false
  return itemSlot === slot || (itemSlot === 'accessory' && slot.startsWith('accessory')) || (itemSlot === 'weapon' && slot === 'offhand')
}
