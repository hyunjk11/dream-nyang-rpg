/**
 * 빠른 판매 · 분해 (Diablo-style): one-action sell / salvage from the bag anywhere, bulk by rarity,
 * a 🔒 lock per item, and 되돌리기 for the last few actions. Selling still goes through Popo's
 * buy-back shelf (sellItem); undo restores the exact item (and the parts that were in it).
 */
import { ITEMS } from '../data/items'
import { addItem, bagItems, findItem, isEquipped, removeItem } from './inventory'
import { isLegend } from './legends'
import { dismantleYield, sellValue } from './loot'
import { gunMods, isMod, modKind } from './mods'
import { dismantleOwned } from './mutate'
import { isUpgrade, needsConfirm } from './qol'
import { isUnique, itemRarityKo } from './rarity'
import { spendGold } from './stats'
import { sellItem, townOf } from './town'
import { BAG_CAP, RARITY_KO, type ItemInstance, type Rarity, type SaveData } from './types'

export type FastAct = 'sell' | 'salvage'

/** The rarities the bulk buttons can pick (전설 is never bulk-processed). */
export const BULK_RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic']
export const UNDO_CAP = 5

export interface UndoEntry {
  act: FastAct
  items: ItemInstance[]
  /** Parts that sat in a sold / broken gun (they dropped to the bag): gun uid → parts. */
  parts: Record<string, ItemInstance[]>
  gold: number
  got: Record<string, number>
}

export interface FastResult {
  ok: boolean
  reason?: string
  entry?: UndoEntry
}

export const isLocked = (item: ItemInstance | undefined): boolean => !!item?.locked

/** Flip 🔒 on a bag or worn item; returns the new state. */
export function toggleLock(save: SaveData, id: string): boolean {
  const item = findItem(save, id)
  if (!item) return false
  if (item.locked) delete item.locked
  else item.locked = true
  return !!item.locked
}

/** Why a single fast action may not touch this item (null = fine). Rare+ still asks once in the UI. */
export function fastBlock(save: SaveData, item: ItemInstance | undefined, act: FastAct): string | null {
  if (!item) return '없는 물건이야.'
  if (isEquipped(save, item.uid)) return act === 'sell' ? '착용 중인 장비는 먼저 벗어 줘.' : '착용 중인 장비는 분해할 수 없어.'
  if (item.locked) return '🔒 잠긴 물건이야. 잠금을 풀면 돼.'
  return null
}

/** Rare or better (and every 유니크) wants a second press. */
export const fastNeedsConfirm = (item: ItemInstance): boolean => needsConfirm(item) || isUnique(item)

/**
 * What the bulk buttons may take for these rarities: bag only (never worn), never 🔒, never 유니크
 * or a legend part, never a ▲ upgrade, never a gun with parts in it, never a 특수 부품.
 */
export function bulkIds(save: SaveData, rarities: readonly Rarity[]): string[] {
  const pick = new Set(rarities.filter((r) => BULK_RARITIES.includes(r)))
  return bagItems(save)
    .filter((item) => {
      if (!pick.has(item.rarity) || item.locked || isUnique(item) || isLegend(item)) return false
      if (isMod(item)) return modKind(item) !== 'trick'
      if (!ITEMS[item.defId]?.slot) return false
      return !isUpgrade(save, item) && gunMods(item).length === 0
    })
    .map((item) => item.uid)
}

/** "보통" · "매직 이하" · "보통·희귀" for the bulk button labels. */
export function rarityPickLabel(rarities: readonly Rarity[]): string {
  const on = BULK_RARITIES.filter((r) => rarities.includes(r))
  if (!on.length) return '선택 없음'
  if (on.length === 1) return RARITY_KO[on[0]]
  const top = on[on.length - 1]
  const contiguous = on.every((r, i) => r === BULK_RARITIES[i])
  return contiguous ? `${RARITY_KO[top]} 이하` : on.map((r) => RARITY_KO[r]).join('·')
}

/** Sell value / salvage yield shown before acting (tooltips, mode hints). */
export function fastPreview(item: ItemInstance, matKo: Record<string, string>): { gold: number; salvage: string } {
  const salvage = Object.entries(dismantleYield(item)).map(([m, n]) => `${matKo[m] ?? m} ${n}`).join(', ')
  return { gold: sellValue(item), salvage }
}

/** Sell or salvage these bag items now (no confirm here: the UI asks for rare+). */
export function fastProcess(save: SaveData, act: FastAct, ids: readonly string[]): FastResult {
  const entry: UndoEntry = { act, items: [], parts: {}, gold: 0, got: {} }
  let reason: string | undefined
  for (const id of ids) {
    const item = findItem(save, id)
    const block = fastBlock(save, item, act)
    if (block || !item) {
      reason ??= block ?? undefined
      continue
    }
    const parts = gunMods(item)
    if (act === 'sell') {
      const r = sellItem(save, id)
      if (!r.ok) {
        reason ??= r.reason
        continue
      }
      entry.gold += r.gold ?? 0
    } else {
      const r = dismantleOwned(save, id)
      if (!r.ok) {
        reason ??= r.reason
        continue
      }
      for (const [m, n] of Object.entries(r.got ?? {})) entry.got[m] = (entry.got[m] ?? 0) + n
    }
    entry.items.push(item)
    if (parts.length) entry.parts[item.uid] = parts
  }
  if (!entry.items.length) return { ok: false, reason: reason ?? '처리할 물건이 없어.' }
  return { ok: true, entry, reason }
}

/** 되돌리기: give the gold / materials back and put the items (and their parts) back. */
export function undoFast(save: SaveData, entry: UndoEntry): { ok: boolean; reason?: string } {
  const partCount = Object.values(entry.parts).reduce((n, list) => n + list.filter((p) => findItem(save, p.uid)).length, 0)
  if (bagItems(save).length - partCount + entry.items.length > BAG_CAP) return { ok: false, reason: '가방이 가득 차서 되돌릴 수 없어.' }
  if (entry.act === 'sell') {
    if (save.gold < entry.gold) return { ok: false, reason: `골드가 모자라서 되돌릴 수 없어. ${entry.gold} 필요해.` }
  } else {
    for (const [m, n] of Object.entries(entry.got)) {
      if ((save.materials[m] ?? 0) < n) return { ok: false, reason: '재료를 이미 써 버려서 되돌릴 수 없어.' }
    }
  }
  if (entry.act === 'sell') {
    spendGold(save, entry.gold)
    const shelf = townOf(save).buyback
    const uids = new Set(entry.items.map((i) => i.uid))
    for (let i = shelf.length - 1; i >= 0; i -= 1) if (uids.has(shelf[i].item.uid)) shelf.splice(i, 1)
  } else {
    for (const [m, n] of Object.entries(entry.got)) save.materials[m] = (save.materials[m] ?? 0) - n
  }
  for (const item of entry.items) {
    const back = (entry.parts[item.uid] ?? []).filter((p) => findItem(save, p.uid) && !isEquipped(save, p.uid))
    for (const p of back) removeItem(save, p.uid)
    if (back.length) item.mods = back
    addItem(save, item, true)
  }
  return { ok: true }
}

/** Toast line for an action: "+42 골드" or "꿈가루 +2 · 부품 +1". */
export function fastGain(entry: UndoEntry, matKo: Record<string, string>): string {
  if (entry.act === 'sell') return `+${entry.gold} 골드`
  return Object.entries(entry.got).map(([m, n]) => `${matKo[m] ?? m} +${n}`).join(' · ') || '재료 없음'
}

/** "희귀 장비야. 한 번 더 누르면 판매." */
export function confirmText(item: ItemInstance, act: FastAct): string {
  return `${itemRarityKo(item)} 장비야. 한 번 더 누르면 ${act === 'sell' ? '판매' : '분해'}.`
}
