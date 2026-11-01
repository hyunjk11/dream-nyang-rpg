/**
 * Convenience rules (편의성): sell-all-junk, bag sort, wear-all-upgrades, auto-sell commons on
 * pickup, auto candy at low HP, and the saved preferences for them. Pure, so tests hold them.
 */
import { ITEMS } from '../data/items'
import { bagItems, powerVsWorn } from './inventory'
import { itemPower } from './loot'
import { EQUIP_SLOTS, RARITIES, type ItemInstance, type Rarity, type SaveData } from './types'

export interface QolPrefs {
  /** Commons picked up in the dungeon turn straight into gold unless they beat what she wears. */
  autoSellCommon: boolean
  /** Eat a heart candy by herself when HP falls under `autoCandyAt` of max. */
  autoCandy: boolean
  autoCandyAt: number
  /** Aim assist: the shot snaps to the nearest foe near the crosshair (default on for touch). */
  autoAim: boolean
}

export const QOL_DEFAULTS: QolPrefs = { autoSellCommon: false, autoCandy: true, autoCandyAt: 0.3, autoAim: false }
export const QOL_KEY = 'dnr.qol'

/** Read saved prefs (bad or missing JSON falls back to the defaults, field by field). */
export function loadQol(raw: string | null | undefined, touch = false): QolPrefs {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<QolPrefs>) : {}
    return {
      autoSellCommon: typeof v.autoSellCommon === 'boolean' ? v.autoSellCommon : QOL_DEFAULTS.autoSellCommon,
      autoCandy: typeof v.autoCandy === 'boolean' ? v.autoCandy : QOL_DEFAULTS.autoCandy,
      autoCandyAt: typeof v.autoCandyAt === 'number' && v.autoCandyAt > 0 && v.autoCandyAt < 1 ? v.autoCandyAt : QOL_DEFAULTS.autoCandyAt,
      autoAim: typeof v.autoAim === 'boolean' ? v.autoAim : touch,
    }
  } catch {
    return { ...QOL_DEFAULTS, autoAim: touch }
  }
}

const rank = (r: Rarity) => RARITIES.indexOf(r)

/** Rare or better asks "정말?" before it is sold or broken down. */
export function needsConfirm(item: ItemInstance): boolean {
  return rank(item.rarity) >= rank('rare')
}

/** Is this bag item an upgrade over what she wears (power ▲)? Non-gear is never an upgrade. */
export function isUpgrade(save: SaveData, item: ItemInstance): boolean {
  const d = powerVsWorn(save, item, itemPower)
  return d !== null && d > 0
}

/** Junk = common/uncommon bag gear that is not an upgrade (and never the gun in hand). */
export function junkIds(save: SaveData): string[] {
  return bagItems(save)
    .filter((item) => rank(item.rarity) <= rank('uncommon') && !!ITEMS[item.defId]?.slot && !isUpgrade(save, item))
    .map((item) => item.uid)
}

/** Auto-sell on pickup: only commons that are not upgrades, and only when the pref is on. */
export function autoSellPick(save: SaveData, item: ItemInstance, prefs: QolPrefs): boolean {
  return prefs.autoSellCommon && item.rarity === 'common' && !!ITEMS[item.defId]?.slot && !isUpgrade(save, item)
}

/**
 * Sort the bag in place: by gear slot (weapon first), then rarity (best first), then power. Worn
 * items keep their place in save.items (order there only matters for the bag grid).
 */
export function sortBag(save: SaveData): void {
  const slotRank = (item: ItemInstance) => {
    const slot = ITEMS[item.defId]?.slot
    const i = slot ? EQUIP_SLOTS.indexOf(slot as (typeof EQUIP_SLOTS)[number]) : -1
    return i < 0 ? 99 : i
  }
  const bag = bagItems(save).sort((a, b) => slotRank(a) - slotRank(b) || rank(b.rarity) - rank(a.rarity) || itemPower(b) - itemPower(a) || b.itemLevel - a.itemLevel)
  const worn = save.items.filter((item) => !bag.includes(item))
  save.items.splice(0, save.items.length, ...worn, ...bag)
}

/**
 * The best upgrade per gear slot from the bag (power ▲ over what is worn), so one button can
 * wear them all. The gun is left alone (switching guns changes how she plays).
 */
export function bestUpgrades(save: SaveData): string[] {
  const best = new Map<string, ItemInstance>()
  for (const item of bagItems(save)) {
    const slot = ITEMS[item.defId]?.slot
    if (!slot || slot === 'weapon' || !isUpgrade(save, item)) continue
    const key = slot === 'accessory' ? 'accessory' : slot
    const cur = best.get(key)
    if (!cur || itemPower(item) > itemPower(cur)) best.set(key, item)
  }
  return [...best.values()].map((item) => item.uid)
}

/** Auto candy: low HP, a candy in the pocket, the pref on and not eaten one just now. */
export function shouldAutoCandy(hp: number, maxHp: number, candies: number, sinceLast: number, prefs: QolPrefs): boolean {
  return prefs.autoCandy && candies > 0 && maxHp > 0 && hp > 0 && hp / maxHp < prefs.autoCandyAt && sinceLast >= AUTO_CANDY_GAP
}
/** Seconds between two automatic candies (so one bad hit does not eat the whole pocket). */
export const AUTO_CANDY_GAP = 4

/** Seconds the down screen waits before getting her up by itself. */
export const AUTO_RISE = 3


export const LAST_GATE_KEY = 'dnr.lastGate'

/**
 * The portal list with the last place she went (same `go`) moved to the top and marked, so a
 * repeat trip is one press. Unknown or missing `last` leaves the list as is.
 */
export function rememberFirst<T extends { text: string; go?: string }>(choices: T[], last: string | null | undefined): T[] {
  if (!last) return choices
  const i = choices.findIndex((c) => c.go === last)
  if (i < 0) return choices
  const pick = { ...choices[i], text: `${choices[i].text} · 지난번` }
  return [pick, ...choices.slice(0, i), ...choices.slice(i + 1)]
}
