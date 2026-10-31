/**
 * The bag (I / Tab): equipment slots, a stats panel, a 6×5 bag grid and a detail card that
 * compares the picked item against what she wears now; plus the skill tree page (K).
 * Plain DOM over the canvas. Every change goes through sim/ (mutate, skilltree) and the host
 * re-applies the build to the live hero.
 */
import { GUN_KO, gunDps } from '../data/guns'
import { ITEMS, MATERIAL_KO } from '../data/items'
import { BRANCH_KO, TIER_LEVEL, TREE, type Branch, type TreeSkill } from '../data/tree'
import { xpToNext } from '../sim/formulas'
import { bagItems, findItem, isEquipped, slotFor, equipItem } from '../sim/inventory'
import { itemLines, itemName, itemPower, sellValue, dismantleYield } from '../sim/loot'
import { fillCell, nameTitle } from './itemcell'
import { dismantleOwned, sellOwned, tryEquip, tryUnequip } from '../sim/mutate'
import { buildOf, learn, learnBlock, rank, respec, respecCost } from '../sim/skilltree'
import { computeStats, type ComputedStats } from '../sim/stats'
import { BAG_CAP, EQUIP_SLOTS, RARITY_KO, SLOT_KO, type EquipSlot, type ItemInstance, type SaveData } from '../sim/types'
import { LEVEL_CAP } from '../data/tree'

export type InvTab = 'bag' | 'skills'

export interface InventoryHost {
  save(): SaveData
  /** Selling and respec happen only in town. */
  inTown(): boolean
  /** Gear or the build changed: re-apply to the hero, persist. */
  changed(): void
  toast(text: string): void
  sfx(cue: 'ui' | 'coin' | 'quest' | 'pop'): void
  opened(): void
  closed(): void
}


const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`

/** One row of the stats panel / compare table. */
interface StatRow {
  key: string
  label: string
  value: (s: ComputedStats) => number
  show: (v: number) => string
}

/** Expected damage per second with crits (tooltips, the stats panel and the QA readout). */
export function dpsOf(s: ComputedStats): number {
  const base = gunDps({ ...s.gun, damage: s.shotDamage }, 1, s.fireRate)
  return base * (1 + s.critChance * (s.critMul - 1))
}

export const STAT_ROWS: StatRow[] = [
  { key: 'maxHp', label: '최대 체력', value: (s) => s.maxHp, show: (v) => `${Math.round(v)}` },
  { key: 'shot', label: '한 발 피해', value: (s) => s.shotDamage, show: (v) => v.toFixed(1) },
  { key: 'dps', label: '초당 피해', value: dpsOf, show: (v) => `${Math.round(v)}` },
  { key: 'fireRate', label: '연사 속도', value: (s) => s.fireRate, show: (v) => pct(v) },
  { key: 'crit', label: '치명타 확률', value: (s) => s.critChance, show: (v) => pct(v) },
  { key: 'critMul', label: '치명타 피해', value: (s) => s.critMul, show: (v) => `×${v.toFixed(2)}` },
  { key: 'pierce', label: '관통', value: (s) => s.pierce, show: (v) => `${v}` },
  { key: 'lifesteal', label: '생명 흡수', value: (s) => s.lifesteal, show: (v) => pct(v, 1) },
  { key: 'move', label: '이동 속도', value: (s) => s.moveMul, show: (v) => pct(v) },
  { key: 'armor', label: '피해 감소', value: (s) => s.armor, show: (v) => pct(v) },
  { key: 'luck', label: '행운', value: (s) => s.luck, show: (v) => `${v}` },
  { key: 'sparkle', label: '반짝 속성', value: (s) => s.sparkle, show: (v) => pct(v) },
  { key: 'ice', label: '얼음 속성', value: (s) => s.ice, show: (v) => pct(v) },
  { key: 'candy', label: '사탕 속성', value: (s) => s.candy, show: (v) => pct(v) },
]

/** Stat changes if `id` went into `slot` (pure; used by the tooltip and tests). */
export function compareEquip(save: SaveData, id: string, prefer?: EquipSlot): { key: string; label: string; from: string; to: string; delta: number }[] {
  const now = computeStats(save)
  const trial = structuredClone(save)
  if (!equipItem(trial, id, prefer).ok) return []
  const then = computeStats(trial)
  const out = []
  for (const row of STAT_ROWS) {
    const a = row.value(now)
    const b = row.value(then)
    if (Math.abs(a - b) < 1e-6) continue
    out.push({ key: row.key, label: row.label, from: row.show(a), to: row.show(b), delta: b - a })
  }
  return out
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

export class InventoryUI {
  private readonly host: InventoryHost
  private readonly root = document.getElementById('inv')
  private tab: InvTab = 'bag'
  private picked: string | null = null
  isOpen = false

  constructor(host: InventoryHost) {
    this.host = host
    document.getElementById('inv-close')?.addEventListener('click', () => this.close())
    this.root?.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as InvTab
        this.host.sfx('ui')
        this.render()
      }),
    )
    this.root?.addEventListener('pointerdown', (event) => event.stopPropagation())
    window.addEventListener('keydown', (event) => {
      if (this.isOpen && event.code === 'Escape') this.close()
    })
  }

  open(tab: InvTab): void {
    this.tab = tab
    this.isOpen = true
    this.root?.classList.remove('hidden')
    this.host.opened()
    this.host.sfx('ui')
    this.render()
  }

  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    this.root?.classList.add('hidden')
    this.host.closed()
  }

  /** I / Tab / K: open on that page, or close if it is already showing. */
  toggle(tab: InvTab): void {
    if (this.isOpen && this.tab === tab) this.close()
    else this.open(tab)
  }

  /** QA hook: pick a bag item as if clicked. */
  pick(id: string | null): void {
    this.picked = id
    this.render()
  }

  render(): void {
    if (!this.isOpen || !this.root) return
    const save = this.host.save()
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab))
    document.getElementById('inv-bag')?.classList.toggle('hidden', this.tab !== 'bag')
    document.getElementById('inv-skills')?.classList.toggle('hidden', this.tab !== 'skills')
    const gold = document.getElementById('inv-gold')
    if (gold) gold.textContent = `골드 ${save.gold}`
    if (this.tab === 'bag') this.renderBag(save)
    else this.renderTree(save)
  }

  // ---- bag page ----

  private cell(item: ItemInstance | undefined, label?: string): HTMLButtonElement {
    const b = el('button', 'inv-cell')
    b.type = 'button'
    if (label) b.append(el('small', 'slot-name', label))
    if (!item) {
      b.classList.add('empty')
      return b
    }
    fillCell(b, item, this.host.save())
    if (item.uid === this.picked) b.classList.add('picked')
    b.addEventListener('click', () => {
      this.picked = item.uid
      this.host.sfx('ui')
      this.render()
    })
    b.addEventListener('dblclick', () => this.equip(item.uid))
    return b
  }

  private renderBag(save: SaveData): void {
    const slots = document.getElementById('inv-slots')
    const grid = document.getElementById('inv-grid')
    const stats = document.getElementById('inv-stats')
    const detail = document.getElementById('inv-detail')
    const count = document.getElementById('inv-count')
    const mats = document.getElementById('inv-mats')
    if (!slots || !grid || !stats || !detail) return
    slots.replaceChildren()
    for (const slot of EQUIP_SLOTS) {
      const c = this.cell(findItem(save, save.equipment[slot]), SLOT_KO[slot])
      c.dataset.slot = slot
      slots.append(c)
    }
    grid.replaceChildren()
    const bag = bagItems(save)
    for (let i = 0; i < BAG_CAP; i += 1) grid.append(this.cell(bag[i]))
    if (count) count.textContent = `${bag.length}/${BAG_CAP}`
    if (mats) mats.textContent = Object.entries(MATERIAL_KO).map(([id, name]) => `${name} ${save.materials[id] ?? 0}`).join(' · ')
    this.renderStats(save, stats)
    this.renderDetail(save, detail)
  }

  private renderStats(save: SaveData, box: HTMLElement): void {
    const s = computeStats(save)
    box.replaceChildren()
    const head = el('div', 'inv-level')
    head.append(el('b', '', `Lv ${s.level}`))
    const need = s.level >= LEVEL_CAP ? 0 : xpToNext(s.level)
    head.append(el('span', '', s.level >= LEVEL_CAP ? '최대 레벨' : `경험치 ${save.xp}/${need}`))
    const bar = el('div', 'inv-xp')
    const fill = el('span')
    fill.style.width = `${s.level >= LEVEL_CAP ? 100 : Math.round((save.xp / need) * 100)}%`
    bar.append(fill)
    head.append(bar)
    box.append(head)
    box.append(el('p', 'inv-gun', `${GUN_KO[s.weaponKind]}`))
    const dl = el('dl')
    for (const row of STAT_ROWS) {
      const v = row.value(s)
      if (['sparkle', 'ice', 'candy', 'lifesteal', 'luck', 'armor'].includes(row.key) && v === 0) continue
      dl.append(el('dt', '', row.label), el('dd', '', row.show(v)))
      dl.lastElementChild?.setAttribute('data-stat', row.key)
    }
    box.append(dl)
  }

  private renderDetail(save: SaveData, box: HTMLElement): void {
    box.replaceChildren()
    const item = this.picked ? findItem(save, this.picked) : undefined
    if (!item) {
      box.append(el('p', 'inv-empty', '물건을 눌러 보면 지금 장비와 비교해 줄게. 두 번 누르면 바로 장착!'))
      return
    }
    const def = ITEMS[item.defId]
    const worn = isEquipped(save, item.uid)
    box.append(nameTitle('h3', item))
    box.append(el('p', 'inv-sub', `${RARITY_KO[item.rarity]} · 아이템 레벨 ${item.itemLevel} · 파워 ${itemPower(item)}${def?.gun ? ` · ${GUN_KO[def.gun]}` : ''}`))
    if (def?.description) box.append(el('p', 'inv-desc', def.description))
    const ul = el('ul', 'inv-lines')
    for (const line of itemLines(item).slice(2, -1)) ul.append(el('li', '', line))
    box.append(ul)
    if (!worn && def?.slot) {
      const target = slotFor(save, item)
      const current = target ? findItem(save, save.equipment[target]) : undefined
      box.append(el('h4', '', current ? `지금 ${SLOT_KO[target!]}: ${itemName(current)} (파워 ${itemPower(current)} → ${itemPower(item)})` : `${SLOT_KO[target ?? def.slot]} 비어 있음`))
      const diff = compareEquip(save, item.uid, target)
      const table = el('ul', 'inv-compare')
      if (!diff.length) table.append(el('li', 'same', '능력치 변화 없음'))
      for (const d of diff) {
        const li = el('li', d.delta > 0 ? 'up' : 'down')
        li.dataset.stat = d.key
        li.append(el('span', '', d.label), el('b', '', `${d.from} → ${d.to} ${d.delta > 0 ? '▲' : '▼'}`))
        table.append(li)
      }
      box.append(table)
    }
    const row = el('div', 'inv-actions')
    const btn = (text: string, fn: () => void, cls = '', disabled = false) => {
      const b = el('button', cls, text)
      b.type = 'button'
      b.disabled = disabled
      b.addEventListener('click', fn)
      row.append(b)
      return b
    }
    if (worn) {
      const slot = EQUIP_SLOTS.find((s) => save.equipment[s] === item.uid)
      if (slot && slot !== 'weapon') btn('해제', () => this.unequip(slot), 'primary')
    } else if (def?.slot === 'accessory' && save.equipment.accessory && save.equipment.accessory2) {
      btn('장신구 1에 장착', () => this.equip(item.uid, 'accessory'), 'primary')
      btn('장신구 2에 장착', () => this.equip(item.uid, 'accessory2'), 'primary')
    } else if (def?.slot) {
      btn('장착', () => this.equip(item.uid), 'primary')
    }
    const gunWorn = save.equipment.weapon === item.uid
    const town = this.host.inTown()
    btn(town ? `판매 +${sellValue(item)}` : '판매 (마을에서)', () => this.sell(item.uid), '', gunWorn || !town)
    const yieldText = Object.entries(dismantleYield(item)).map(([m, n]) => `${MATERIAL_KO[m] ?? m} ${n}`).join(', ')
    btn(`분해 → ${yieldText}`, () => this.dismantle(item.uid), 'warn', gunWorn)
    box.append(row)
  }

  private equip(id: string, prefer?: EquipSlot): void {
    const save = this.host.save()
    const r = tryEquip(save, id, prefer)
    if (!r.ok) this.host.toast(r.reason ?? '장착할 수 없어.')
    else {
      const item = findItem(save, id)
      if (item) this.host.toast(`${itemName(item)} 장착!`)
      this.host.sfx('pop')
      this.host.changed()
    }
    this.render()
  }

  private unequip(slot: EquipSlot): void {
    const r = tryUnequip(this.host.save(), slot)
    if (!r.ok) this.host.toast(r.reason ?? '해제할 수 없어.')
    else {
      this.host.sfx('ui')
      this.host.changed()
    }
    this.render()
  }

  private sell(id: string): void {
    const r = sellOwned(this.host.save(), id)
    if (!r.ok) this.host.toast(r.reason ?? '팔 수 없어.')
    else {
      this.picked = null
      this.host.toast(`${r.gold} 골드에 팔았어`)
      this.host.sfx('coin')
      this.host.changed()
    }
    this.render()
  }

  private dismantle(id: string): void {
    const r = dismantleOwned(this.host.save(), id)
    if (!r.ok) this.host.toast(r.reason ?? '분해할 수 없어.')
    else {
      this.picked = null
      const got = Object.entries(r.got ?? {}).map(([m, n]) => `${MATERIAL_KO[m] ?? m} +${n}`).join(' · ')
      this.host.toast(`분해 완료! ${got}`)
      this.host.sfx('pop')
      this.host.changed()
    }
    this.render()
  }

  // ---- skill tree page ----

  private renderTree(save: SaveData): void {
    const head = document.getElementById('tree-head')
    const tree = document.getElementById('tree')
    if (!head || !tree) return
    const build = buildOf(save)
    head.replaceChildren()
    head.append(el('b', 'tree-points', `남은 스킬 포인트 ${build.points}`))
    head.append(el('span', '', `Lv ${save.level} · 1–4 키로 액티브 스킬 사용`))
    const cost = respecCost(save)
    const reset = el('button', 'warn', this.host.inTown() ? `초기화 (${cost ? `${cost} 골드` : '무료'})` : '초기화는 마을에서')
    reset.type = 'button'
    reset.id = 'tree-respec'
    reset.disabled = !this.host.inTown()
    reset.addEventListener('click', () => {
      const r = respec(save)
      if (!r.ok) this.host.toast(r.reason ?? '초기화할 수 없어.')
      else {
        this.host.toast(`스킬 초기화! 포인트 ${r.refunded}개 돌려받았어`)
        this.host.sfx('quest')
        this.host.changed()
      }
      this.render()
    })
    head.append(reset)
    tree.replaceChildren()
    for (const branch of Object.keys(BRANCH_KO) as Branch[]) {
      const col = el('section', 'branch')
      col.style.setProperty('--br', BRANCH_KO[branch].color)
      col.append(el('h3', '', BRANCH_KO[branch].name), el('p', 'blurb', BRANCH_KO[branch].blurb))
      for (const skill of TREE.filter((s) => s.branch === branch).sort((a, b) => a.tier - b.tier)) col.append(this.skillCard(save, skill))
      tree.append(col)
    }
  }

  private skillCard(save: SaveData, skill: TreeSkill): HTMLButtonElement {
    const r = rank(save, skill.id)
    const block = learnBlock(save, skill.id)
    const b = el('button', `skill ${skill.kind}`)
    b.type = 'button'
    b.dataset.skill = skill.id
    if (r > 0) b.classList.add('owned')
    if (block) b.classList.add('locked')
    b.append(el('i', 'glyph', skill.glyph))
    const body = el('div')
    body.append(el('b', '', `${skill.name}${skill.key ? ` [${skill.key}]` : ''}`))
    body.append(el('small', 'rank', `${r}/${skill.max} · ${skill.kind === 'active' ? '액티브' : '패시브'} · Lv ${TIER_LEVEL[skill.tier]}`))
    body.append(el('p', '', skill.text(Math.max(1, r)) + (skill.cooldown ? ` (대기 ${skill.cooldown(Math.max(1, r))}초)` : '')))
    if (block && r < skill.max) body.append(el('em', 'why', block))
    if (r > 0 && r < skill.max) body.append(el('em', 'next', `다음: ${skill.text(r + 1)}`))
    b.append(body)
    b.title = block || '눌러서 배우기'
    b.addEventListener('click', () => {
      const out = learn(save, skill.id)
      if (!out.ok) {
        this.host.toast(out.reason ?? '배울 수 없어.')
        return
      }
      this.host.toast(`${skill.name} ${rank(save, skill.id)}단계!`)
      this.host.sfx('quest')
      this.host.changed()
      this.render()
    })
    return b
  }
}
