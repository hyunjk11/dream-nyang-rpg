/**
 * One item cell for the bag, the shop shelf and the stash: the base's icon on a rarity
 * background, its name, item power and ▲▼ against what she wears (legendaries shimmer).
 */
import { ITEMS, MATERIAL_KO } from '../data/items'
import { powerVsWorn } from '../sim/inventory'
import { ilvText, itemLines, itemName, itemNameParts, itemPower, plusOf, upgradeMul } from '../sim/loot'
import { gunMods, isGun, isMod, modLabel, modSlots, modUpgradeCost, partTier } from '../sim/mods'
import { MAX_PLUS, upgradeChance, upgradeCost } from '../sim/workshop'
import { type ItemInstance, type SaveData } from '../sim/types'
import { isUnique, itemColor, itemRarityKo } from '../sim/rarity'
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
  b.style.setProperty('--rar', itemColor(item))
  if (isUnique(item)) b.dataset.unique = '1'
  else delete b.dataset.unique
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
  // 강화 +N on guns; 개조 칸 (filled/total) under it; a part's 강화 단계 (n/5).
  const plus = plusOf(item)
  if (plus > 0) b.append(span('plus-badge', `+${plus}`))
  b.classList.toggle('plus-max', plus >= MAX_PLUS)
  if (isGun(item)) {
    const slots = modSlots(item)
    if (slots > 0) b.append(span('sock-badge', `${'●'.repeat(gunMods(item).length)}${'○'.repeat(Math.max(0, slots - gunMods(item).length))}`))
  } else if (isMod(item)) b.append(span('plus-badge tier', `${partTier(item).now}/${partTier(item).max}`))
  b.dataset.tip = itemTip(item)
}

/** Hover card text: name, rarity line, then the item's stat lines (first line is the title). */
export function itemTip(item: ItemInstance): string {
  const lines = itemLines(item).slice(2)
  return [itemName(item), `${itemRarityKo(item)} · 파워 ${itemPower(item)} · ${ilvText(item.itemLevel)}`, ...upgradeLines(item), ...lines].join('\n')
}

/** 0.65 → '65%'. */
export function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

/** 강화 lines for a tooltip: guns +N/+10 and the next step's damage and price; parts their 단계. */
export function upgradeLines(item: ItemInstance): string[] {
  if (isGun(item)) {
    const p = plusOf(item)
    const out = [`강화 +${p} / +${MAX_PLUS} · 총 피해 ×${upgradeMul(p).toFixed(2)}`]
    const cost = upgradeCost(item)
    out.push(cost ? `다음 +${p + 1}: 총 피해 ×${upgradeMul(p + 1).toFixed(2)} · 성공 ${pct(upgradeChance(item) ?? 1)} · ${costLine(cost)} (키키 공방)` : '최대 강화 완료!')
    const slots = modSlots(item)
    if (slots) out.push(`개조 칸 ${gunMods(item).length}/${slots}${gunMods(item).length ? ` · ${gunMods(item).map(modLabel).join(', ')}` : ''}`)
    return out
  }
  if (isMod(item)) {
    const t = partTier(item)
    const cost = modUpgradeCost(item)
    return [`부품 강화 ${t.now}/${t.max}단계`, cost ? `다음 ${t.now + 1}단계: ${costLine(cost)} (키키 공방)` : '최대 단계 부품!']
  }
  return []
}

function costLine(cost: { gold: number; mats: Record<string, number> }): string {
  return [`${cost.gold}골드`, ...Object.entries(cost.mats).map(([m, n]) => `${MATERIAL_KO[m] ?? m} ${n}`)].join(' + ')
}

/** Item title with the prefix and suffix words coloured (detail cards, tooltips). */
export function nameTitle(tag: 'h3' | 'h4', item: ItemInstance): HTMLElement {
  const h = document.createElement(tag)
  h.className = 'item-title'
  const p = itemNameParts(item)
  if (p.plus) h.append(span('plus', p.plus), ' ')
  if (p.prefix) h.append(span('pre', p.prefix), ' ')
  if (p.suffix) h.append(span('suf', p.suffix), ' ')
  const base = span('base', p.base)
  base.style.color = itemColor(item)
  // Pale rarities (일반 white) need a soft outline to read on the pastel cards.
  h.dataset.rarity = item.rarity
  h.append(base)
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
