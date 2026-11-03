/**
 * One item cell for the bag, the shop shelf and the stash: the base's icon on a rarity
 * background, its name, item power and ▲▼ against what she wears (legendaries shimmer).
 */
import { ITEMS } from '../data/items'
import { powerVsWorn } from '../sim/inventory'
import { ilvText, itemLines, itemName, itemNameParts, itemPower } from '../sim/loot'
import { RARITY_COLOR, RARITY_KO, type ItemInstance, type SaveData } from '../sim/types'
import { iconSvg } from './icons'

function span(cls: string, text: string): HTMLElement {
  const s = document.createElement('span')
  s.className = cls
  s.textContent = text
  return s
}

/** Fill a cell button with an item (the caller handles clicks and empties). */
export function fillCell(b: HTMLElement, item: ItemInstance, save: SaveData | null): void {
  const def = ITEMS[item.defId]
  b.style.setProperty('--rar', RARITY_COLOR[item.rarity])
  b.dataset.rarity = item.rarity
  b.dataset.uid = item.uid
  b.classList.add('item')
  const icon = document.createElement('i')
  icon.className = 'icon'
  icon.innerHTML = iconSvg(def?.icon)
  b.append(icon)
  b.append(span('name', def?.name ?? item.defId))
  const power = itemPower(item)
  const pw = span('power', `${power}`)
  b.append(pw)
  if (save) {
    const d = powerVsWorn(save, item, itemPower)
    if (d !== null && d !== 0) {
      const arrow = span(d > 0 ? 'cmp up' : 'cmp down', d > 0 ? '▲' : '▼')
      b.dataset.cmp = d > 0 ? 'up' : 'down'
      b.append(arrow)
    }
  }
  b.append(span('ilvl', ilvText(item.itemLevel)))
  b.dataset.tip = itemTip(item)
}

/** Hover card text: name, rarity line, then the item's stat lines (first line is the title). */
export function itemTip(item: ItemInstance): string {
  const lines = itemLines(item).slice(2)
  return [itemName(item), `${RARITY_KO[item.rarity]} · 파워 ${itemPower(item)} · ${ilvText(item.itemLevel)}`, ...lines].join('\n')
}

/** Item title with the prefix and suffix words coloured (detail cards, tooltips). */
export function nameTitle(tag: 'h3' | 'h4', item: ItemInstance): HTMLElement {
  const h = document.createElement(tag)
  h.className = 'item-title'
  const p = itemNameParts(item)
  if (p.prefix) h.append(span('pre', p.prefix), ' ')
  if (p.suffix) h.append(span('suf', p.suffix), ' ')
  const base = span('base', p.base)
  base.style.color = RARITY_COLOR[item.rarity]
  // Pale rarities (일반 white) need a soft outline to read on the pastel cards.
  h.dataset.rarity = item.rarity
  h.append(base)
  if (p.plus) h.append(' ', span('plus', p.plus))
  return h
}

/** Compare row "아이템 레벨 iLv 3 → iLv 5" (worn → this one), or null when nothing is worn there. */
export function ilvRow(worn: ItemInstance | undefined, item: ItemInstance): HTMLLIElement | null {
  if (!worn) return null
  const d = item.itemLevel - worn.itemLevel
  const li = document.createElement('li')
  li.className = d > 0 ? 'up' : d < 0 ? 'down' : 'same'
  li.dataset.stat = 'ilvl'
  const a = document.createElement('span')
  a.textContent = '아이템 레벨'
  const b = document.createElement('b')
  b.textContent = `${ilvText(worn.itemLevel)} → ${ilvText(item.itemLevel)}${d > 0 ? ' ▲' : d < 0 ? ' ▼' : ''}`
  li.append(a, b)
  return li
}
