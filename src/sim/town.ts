/**
 * Town services on the save, with no DOM or three.js:
 *  - 포포 상점: consumables (하트 사탕, 귀환 두루마리), a rotating stock of random gear rolled
 *    for the deepest open depth, selling, and buy-back of the last few things sold.
 *  - 보관함: a chest in front of Byeolha's house with extra room beside the bag.
 * The stock and the quest board refresh whenever she comes home from a trip (delve.runs moved).
 */
import { GEAR_IDS, WEAPON_IDS } from '../data/items'
import { addItem, bagItems, findItem, isEquipped, removeItem } from './inventory'
import { delveOf, itemLevelFor } from './delve'
import { baseValue, capRarity, makeItem, maxRarityFor, rollRarity, sellValue } from './loot'
import { migrateItem } from './migrate-item'
import { computeStats, gainGold, reclampHp, spendGold } from './stats'
import { BAG_CAP, POTION_CAP, type ItemInstance, type Rarity, type SaveData } from './types'

export const STASH_CAP = 40
export const BUYBACK_CAP = 5
export const SCROLL_CAP = 10
export const STOCK_SIZE = 6
/** Gold to roll a fresh stock without going down the sewer. */
export const RESTOCK_COST = 15

export interface Consumable {
  id: 'candy' | 'scroll'
  name: string
  blurb: string
  price: number
  cap: number
}

export const CONSUMABLES: Consumable[] = [
  { id: 'candy', name: '하트 사탕', blurb: 'Q로 먹으면 최대 체력의 40%를 회복해.', price: 25, cap: POTION_CAP },
  { id: 'scroll', name: '귀환 두루마리', blurb: '하수도에서 T: 주문을 읽지 않고 바로 마을로.', price: 40, cap: SCROLL_CAP },
]

export interface StockEntry {
  item: ItemInstance
  price: number
  sold?: boolean
}

export interface BuybackEntry {
  item: ItemInstance
  price: number
}

export interface TownSave {
  scrolls: number
  stock: StockEntry[]
  /** delve.runs when the stock was rolled; a different value means she has been down since. */
  stockAt: number
  buyback: BuybackEntry[]
  stash: ItemInstance[]
  contracts: import('./contracts').Contract[]
  boardAt: number
  /** Contracts finished so far (for the id salt and stats). */
  contractsDone: number
}

export function freshTown(): TownSave {
  return { scrolls: 0, stock: [], stockAt: -1, buyback: [], stash: [], contracts: [], boardAt: -1, contractsDone: 0 }
}

const int = (v: unknown, min: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback)
const okItem = (i: unknown): i is ItemInstance => !!i && typeof i === 'object' && typeof (i as ItemInstance).uid === 'string' && typeof (i as ItemInstance).defId === 'string'

/** The save's town block, made whole (old saves have none). */
const normalized = new WeakSet<object>()

export function townOf(save: SaveData): TownSave {
  if (save.town && normalized.has(save.town)) return save.town
  const raw = (save.town ?? {}) as Partial<TownSave>
  const t: TownSave = {
    scrolls: Math.min(SCROLL_CAP, int(raw.scrolls, 0, 0)),
    stock: Array.isArray(raw.stock) ? raw.stock.filter((e) => e && okItem(e.item)).map((e) => ({ item: migrateItem(e.item), price: int(e.price, 1, 1), sold: Boolean(e.sold) })) : [],
    stockAt: int(raw.stockAt, -1, -1),
    buyback: Array.isArray(raw.buyback) ? raw.buyback.filter((e) => e && okItem(e.item)).slice(0, BUYBACK_CAP).map((e) => ({ item: migrateItem(e.item), price: int(e.price, 1, 1) })) : [],
    stash: Array.isArray(raw.stash) ? raw.stash.filter(okItem).map(migrateItem).slice(0, STASH_CAP) : [],
    contracts: Array.isArray(raw.contracts) ? raw.contracts.filter((c) => c && typeof c.id === 'string') : [],
    boardAt: int(raw.boardAt, -1, -1),
    contractsDone: int(raw.contractsDone, 0, 0),
  }
  save.town = t
  normalized.add(t)
  return t
}

/** What the shop asks for an item: well above its sell price, more for deeper item levels. */
export function buyPrice(item: ItemInstance): number {
  return Math.max(sellValue(item) + 1, Math.round(baseValue(item.defId, item.rarity) * 1.5 * (1 + 0.05 * (item.itemLevel - 1))))
}

/** Popo never sells epics or legendaries; the dungeon keeps those. */
export const SHOP_RARITY_CAP: Rarity = 'rare'

/** Roll a stock for the deepest open depth: STOCK_SIZE items, at least one gun. */
export function rollStock(save: SaveData, rng: () => number): StockEntry[] {
  const depth = delveOf(save).unlocked
  const ilvl = itemLevelFor(depth, 2)
  const cap = capRarity(maxRarityFor(depth), SHOP_RARITY_CAP)
  const out: StockEntry[] = []
  for (let i = 0; i < STOCK_SIZE; i += 1) {
    const gun = i === 0 || rng() < 0.25
    const ids = gun ? WEAPON_IDS : GEAR_IDS
    const defId = ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]
    // Shop goods lean a little better than floor drops, but never past the cap.
    const rarity = capRarity(rollRarity(0, rng, 18 + (depth - 1) * 5), cap)
    const item = makeItem(defId, rarity === 'common' ? 'uncommon' : rarity, rng, ilvl)
    out.push({ item, price: buyPrice(item) })
  }
  return out
}

/** The current stock, rolled anew if she has been down the sewer since it was last rolled. */
export function shopStock(save: SaveData, rng: () => number = Math.random): StockEntry[] {
  const t = townOf(save)
  const runs = delveOf(save).runs
  if (t.stockAt !== runs || t.stock.length === 0) {
    t.stock = rollStock(save, rng)
    t.stockAt = runs
  }
  return t.stock
}

export interface ShopResult {
  ok: boolean
  reason?: string
  gold?: number
  item?: ItemInstance
}

export function restock(save: SaveData, rng: () => number = Math.random): ShopResult {
  const t = townOf(save)
  if (!spendGold(save, RESTOCK_COST)) return { ok: false, reason: `골드가 모자라. ${RESTOCK_COST} 필요해.` }
  t.stock = rollStock(save, rng)
  t.stockAt = delveOf(save).runs
  return { ok: true, gold: RESTOCK_COST }
}

export function consumableCount(save: SaveData, id: Consumable['id']): number {
  return id === 'candy' ? save.potions : townOf(save).scrolls
}

export function buyConsumable(save: SaveData, id: Consumable['id'], count = 1): ShopResult {
  const def = CONSUMABLES.find((c) => c.id === id)
  if (!def) return { ok: false, reason: '진열대에 없는 물건이야.' }
  const have = consumableCount(save, id)
  const n = Math.max(0, Math.min(Math.floor(count), def.cap - have))
  if (n <= 0) return { ok: false, reason: `${def.name}은 ${def.cap}개까지만 들고 다닐 수 있어.` }
  const cost = def.price * n
  if (!spendGold(save, cost)) return { ok: false, reason: `골드가 모자라. ${cost} 필요해.` }
  if (id === 'candy') save.potions += n
  else townOf(save).scrolls += n
  return { ok: true, gold: cost }
}

export function buyStock(save: SaveData, index: number): ShopResult {
  const t = townOf(save)
  const entry = t.stock[index]
  if (!entry || entry.sold) return { ok: false, reason: '이미 팔린 물건이야.' }
  if (bagItems(save).length >= BAG_CAP) return { ok: false, reason: '가방이 가득 찼어.' }
  if (!spendGold(save, entry.price)) return { ok: false, reason: `골드가 모자라. ${entry.price} 필요해.` }
  addItem(save, entry.item)
  entry.sold = true
  return { ok: true, gold: entry.price, item: entry.item }
}

/** Sell from the bag (not the gun in hand); the item waits on the buy-back shelf. */
export function sellItem(save: SaveData, id: string): ShopResult {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '없는 물건이야.' }
  if (save.equipment.weapon === id) return { ok: false, reason: '쓰고 있는 총은 팔 수 없어.' }
  const before = computeStats(save).maxHp
  const gold = sellValue(item)
  removeItem(save, id)
  gainGold(save, gold)
  reclampHp(save, before)
  const t = townOf(save)
  t.buyback.unshift({ item, price: gold })
  t.buyback.length = Math.min(t.buyback.length, BUYBACK_CAP)
  return { ok: true, gold, item }
}

/** Buy something back at exactly what Popo paid for it. */
export function buyBack(save: SaveData, index: number): ShopResult {
  const t = townOf(save)
  const entry = t.buyback[index]
  if (!entry) return { ok: false, reason: '되살 물건이 없어.' }
  if (bagItems(save).length >= BAG_CAP) return { ok: false, reason: '가방이 가득 찼어.' }
  if (!spendGold(save, entry.price)) return { ok: false, reason: `골드가 모자라. ${entry.price} 필요해.` }
  t.buyback.splice(index, 1)
  addItem(save, entry.item)
  return { ok: true, gold: entry.price, item: entry.item }
}

/** Bag → chest (worn things stay on her). */
export function stashPut(save: SaveData, id: string): ShopResult {
  const t = townOf(save)
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '없는 물건이야.' }
  if (isEquipped(save, id)) return { ok: false, reason: '착용 중인 장비는 먼저 해제해 줘.' }
  if (t.stash.length >= STASH_CAP) return { ok: false, reason: '보관함이 가득 찼어.' }
  removeItem(save, id)
  t.stash.push(item)
  return { ok: true, item }
}

/** Chest → bag. */
export function stashTake(save: SaveData, uid: string): ShopResult {
  const t = townOf(save)
  const index = t.stash.findIndex((i) => i.uid === uid)
  if (index < 0) return { ok: false, reason: '보관함에 없는 물건이야.' }
  if (bagItems(save).length >= BAG_CAP) return { ok: false, reason: '가방이 가득 찼어.' }
  const [item] = t.stash.splice(index, 1)
  addItem(save, item)
  return { ok: true, item }
}

/** Heal from a heart candy: 40% of max hp (at least 30). */
export function candyHeal(maxHp: number): number {
  return Math.max(30, Math.round(maxHp * 0.4))
}

/** Eat a heart candy (Q): returns how much it heals, or a reason. */
export function eatCandy(save: SaveData, hp: number, maxHp: number): { ok: boolean; heal?: number; reason?: string } {
  if (save.potions <= 0) return { ok: false, reason: '하트 사탕이 없어. 포포 상점에서 살 수 있어.' }
  if (hp >= maxHp) return { ok: false, reason: '체력이 이미 가득이야.' }
  save.potions -= 1
  return { ok: true, heal: Math.min(maxHp - hp, candyHeal(maxHp)) }
}

/** Read a recall scroll (instant trip home). */
export function useScroll(save: SaveData): boolean {
  const t = townOf(save)
  if (t.scrolls <= 0) return false
  t.scrolls -= 1
  return true
}
