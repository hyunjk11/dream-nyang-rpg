import { ITEMS } from '../data/items'
import { BAG_CAP, type EquipSlot, type ItemInstance, type SaveData } from './types'

export function findItem(save: SaveData, id: string | undefined): ItemInstance | undefined {
  if (!id) return undefined
  return save.items.find((item) => item.uid === id)
}

/** A gun in either weapon set (live hands or the holster). Other gear uses `isEquipped`. */
export function gunHeld(save: SaveData, id: string): boolean {
  if (!id) return false
  if (save.equipment.weapon === id || save.equipment.offhand === id) return true
  const st = save.weaponSets?.stowed
  return !!st && (st.weapon === id || st.offhand === id)
}

export function isEquipped(save: SaveData, id: string): boolean {
  return Object.values(save.equipment).includes(id) || gunHeld(save, id)
}

/**
 * A gun that cannot enter the bag (full bag, auto-sell) gives its 부품 back first.
 * The parts are forced into the bag even past the cap, so they are never deleted with the gun.
 */
export function rescueMods(save: SaveData, item: ItemInstance): ItemInstance[] {
  const mods = (item.mods ?? []).filter((m) => m && ITEMS[m.defId]?.mod)
  if (item.mods) delete item.mods
  for (const m of mods) addItem(save, m, true)
  return mods
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

export interface EquipOutcome {
  ok: boolean
  reason?: string
  slot?: EquipSlot
  /** Guns (and anything else) that left a slot and are now in the bag. Still in `save.items`, 부품 included. */
  toBag?: ItemInstance[]
  /**
   * Would not fit. The equip did not happen, and these items are still where they were.
   * Never a signal that something was deleted.
   */
  overflow?: ItemInstance[]
}

function bagFullReason(items: ItemInstance[]): string {
  const names = items.map((i) => ITEMS[i.defId]?.name ?? '물건').join(', ')
  return `가방이 가득 차서 「${names}」 넣을 자리가 없어. 가방을 비운 뒤에 바꿔 껴 줘.`
}

/**
 * Wear `id`. Anything it displaces goes back to the bag with its 부품 still attached.
 * If the bag cannot hold them, nothing changes and `overflow` names what would not fit.
 * Ground-drop is intentionally not a path: a full bag turns a pickup into gold, which would
 * discard the gun. Blocking keeps every item.
 */
export function equipItem(save: SaveData, id: string, prefer?: EquipSlot): EquipOutcome {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '그 물건은 가방에 없어.' }
  if (prefer === 'offhand') {
    const why = offhandProblem(save, item)
    if (why) return { ok: false, reason: why }
  }
  const slot = prefer === 'offhand' ? 'offhand' : slotFor(save, item, prefer)
  if (!slot) return { ok: false, reason: '장착할 수 없는 물건이야.' }

  const next: Partial<Record<EquipSlot, string>> = { ...save.equipment }
  for (const s of Object.keys(next) as EquipSlot[]) if (next[s] === id) delete next[s]
  next[slot] = id
  // A two-handed gun takes both hands. The off-hand gun is displaced, not deleted.
  if (slot === 'weapon' && next.offhand && next.offhand !== id && !oneHanded(item)) delete next.offhand

  const stowed = save.weaponSets?.stowed
  const stowedHand: 'weapon' | 'offhand' | null = stowed?.weapon === id ? 'weapon' : stowed?.offhand === id ? 'offhand' : null
  const displaced: ItemInstance[] = []
  for (const s of Object.keys(save.equipment) as EquipSlot[]) {
    const uid = save.equipment[s]
    if (!uid || uid === id) continue
    if (Object.values(next).includes(uid)) continue
    const it = findItem(save, uid)
    if (it && !displaced.some((d) => d.uid === it.uid)) displaced.push(it)
  }
  const wasBag = !Object.values(save.equipment).includes(id) && !stowedHand
  const bagAfter = bagItems(save).length - (wasBag ? 1 : 0) + displaced.length
  if (bagAfter > BAG_CAP) return { ok: false, reason: bagFullReason(displaced), overflow: displaced }

  save.equipment = next
  if (stowedHand && stowed) delete stowed[stowedHand]
  return { ok: true, slot, toBag: displaced.length ? displaced : undefined }
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
