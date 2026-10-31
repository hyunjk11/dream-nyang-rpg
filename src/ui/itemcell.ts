/**
 * One item cell for the bag, the shop shelf and the stash: the base's icon on a rarity
 * background, its name, item power and ▲▼ against what she wears (legendaries shimmer).
 */
import { ITEMS } from '../data/items'
import { powerVsWorn } from '../sim/inventory'
import { itemName, itemNameParts, itemPower } from '../sim/loot'
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
  b.append(span('ilvl', `Lv${item.itemLevel}`))
  b.title = `${itemName(item)} · ${RARITY_KO[item.rarity]} · 파워 ${power}`
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
  h.append(base)
  if (p.plus) h.append(' ', span('plus', p.plus))
  return h
}
