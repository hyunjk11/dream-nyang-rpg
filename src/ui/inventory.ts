/**
 * The bag (I / Tab): equipment slots, a stats panel, a 6×5 bag grid and a detail card that
 * compares the picked item against what she wears now; plus the skill tree page (K).
 * Plain DOM over the canvas. Every change goes through sim/ (mutate, skilltree) and the host
 * re-applies the build to the live hero.
 */
import { GUN_KO, GUN_PROFILES, gunDps, gunStatLine } from '../data/guns'
import { ITEMS, MATERIAL_HELP, MATERIAL_KO } from '../data/items'
import { BRANCH_KO, TIER_LEVEL, TREE, type Branch, type TreeSkill } from '../data/tree'
import { xpToNext } from '../sim/formulas'
import { bagItems, findItem, isEquipped, slotFor, equipItem, slotFits } from '../sim/inventory'
import { ilvText, itemLines, itemName, itemPower } from '../sim/loot'
import { fillCell, ilvRow, nameTitle } from './itemcell'
import { tryEquip, tryUnequip } from '../sim/mutate'
import { buildOf, learn, learnBlock, rank, respec, respecCost } from '../sim/skilltree'
import { computeStats, type ComputedStats } from '../sim/stats'
import { BAG_CAP, EQUIP_SLOTS, RARITY_COLOR, RARITY_KO, SLOT_KO, type Rarity, type EquipSlot, type ItemInstance, type SaveData } from '../sim/types'
import { itemRarityKo } from '../sim/rarity'
import { attachMod, detachMod, fitPreview, gunMods, isGun, isMod, MAX_MOD_SLOTS, modLabel, modSlots } from '../sim/mods'
import { iconSvg } from './icons'
import { LEVEL_CAP } from '../data/tree'
import { skillSvg } from './skillicons'
import { bestUpgrades, sortBag } from '../sim/qol'
import { BULK_RARITIES, bulkIds, confirmText, fastBlock, fastGain, fastNeedsConfirm, fastPreview, fastProcess, rarityPickLabel, toggleLock, undoFast, UNDO_CAP, type FastAct, type UndoEntry } from '../sim/fastsell'

export type InvTab = 'bag' | 'skills'
/** 판매 모드 / 분해 모드: every bag click sells / salvages at once. */
export type BagMode = 'none' | FastAct

const PICK_KEY = 'dnr-fast-pick-v1'
function loadPick(): { sell: Rarity[]; salvage: Rarity[] } {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? '') as { sell?: Rarity[]; salvage?: Rarity[] }
    const ok = (a: unknown): a is Rarity[] => Array.isArray(a) && a.every((r) => BULK_RARITIES.includes(r as Rarity))
    return { sell: ok(v.sell) ? v.sell : ['common', 'uncommon'], salvage: ok(v.salvage) ? v.salvage : ['common'] }
  } catch {
    return { sell: ['common', 'uncommon'], salvage: ['common'] }
  }
}

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
  /** The bag's 도감 button: the legend codex (it closes the bag first). */
  codex?(): void
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
  /** Rare+ sell/dismantle waits for a second press: `sell:<uid>` / `dismantle:<uid>`. */
  private confirm: string | null = null
  private confirmTimer = 0
  /** 판매 모드 / 분해 모드 (a click on a bag item does it at once). */
  mode: BagMode = 'none'
  /** 되돌리기: the last few fast actions, newest last. */
  private undoStack: UndoEntry[] = []
  /** The bag item under the mouse (S / X / C hotkeys act on it). */
  private hover: string | null = null
  private pickR = loadPick()
  private longTimer = 0
  private longFired = false
  isOpen = false

  constructor(host: InventoryHost) {
    this.host = host
    document.getElementById('inv-close')?.addEventListener('click', () => this.close())
    document.getElementById('inv-codex')?.addEventListener('click', () => {
      this.host.sfx('ui')
      this.close()
      this.host.codex?.()
    })
    this.root?.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as InvTab
        this.host.sfx('ui')
        this.render()
      }),
    )
    this.root?.addEventListener('pointerdown', (event) => event.stopPropagation())
    window.addEventListener('keydown', (event) => {
      if (!this.isOpen) return
      if (event.code === 'Escape') {
        if (this.closeMenu()) return
        this.close()
        return
      }
      this.hotkey(event)
    })
  }

  /** Bag hotkeys: hover + S 판매 · X 분해 · C 🔒; Z (or Ctrl+Z) 되돌리기. */
  private hotkey(event: KeyboardEvent): void {
    if (this.tab !== 'bag' || event.repeat) return
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (event.code === 'KeyZ') {
      event.preventDefault()
      this.undo()
      return
    }
    const id = this.hover
    if (!id) return
    if (event.code === 'KeyS') this.act(id, 'sell')
    else if (event.code === 'KeyX') this.act(id, 'salvage')
    else if (event.code === 'KeyC') this.lock(id)
  }

  /** Open on a tab, optionally straight into 판매 / 분해 모드 (포포 / 키키 send you here). */
  open(tab: InvTab, mode?: BagMode): void {
    if (mode) this.mode = mode
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
    this.mode = 'none'
    this.hover = null
    this.closeMenu()
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
    this.root.classList.toggle('mode-sell', this.tab === 'bag' && this.mode === 'sell')
    this.root.classList.toggle('mode-salvage', this.tab === 'bag' && this.mode === 'salvage')
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
    const save = this.host.save()
    fillCell(b, item, save)
    if (item.uid === this.picked) b.classList.add('picked')
    const worn = isEquipped(save, item.uid)
    if (item.locked) b.append(el('span', 'lock-badge', '🔒'))
    if (this.confirm === `sell:${item.uid}` || this.confirm === `salvage:${item.uid}`) {
      b.classList.add('armed')
      b.append(el('span', 'armed-badge', '한 번 더!'))
    }
    if (!worn) {
      const pv = fastPreview(item, MATERIAL_KO)
      b.dataset.tip = `${b.dataset.tip ?? ''}\n—\n판매 +${pv.gold}골드 · 분해 → ${pv.salvage}${item.locked ? '\n🔒 잠김 (C로 풀기)' : ''}\nShift+클릭·S 판매 · Ctrl+클릭·X 분해 · C 잠금`
    }
    b.addEventListener('click', (event) => {
      if (this.longFired) {
        this.longFired = false
        return
      }
      if (!worn && (event.shiftKey || event.ctrlKey || event.metaKey)) {
        this.act(item.uid, event.shiftKey ? 'sell' : 'salvage')
        return
      }
      if (!worn && this.mode !== 'none') {
        this.act(item.uid, this.mode)
        return
      }
      this.picked = item.uid
      this.host.sfx('ui')
      this.render()
    })
    b.addEventListener('mouseenter', () => (this.hover = worn ? null : item.uid))
    b.addEventListener('mouseleave', () => {
      if (this.hover === item.uid) this.hover = null
    })
    // Touch: hold ~0.45 s for the big 판매 / 분해 / 잠금 menu.
    if (!worn) {
      let start: { x: number; y: number } | null = null
      const cancel = () => {
        window.clearTimeout(this.longTimer)
        start = null
      }
      b.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        start = { x: event.clientX, y: event.clientY }
        this.longFired = false
        window.clearTimeout(this.longTimer)
        this.longTimer = window.setTimeout(() => {
          this.longFired = true
          this.openMenu(item.uid)
        }, 450)
      })
      b.addEventListener('pointermove', (event) => {
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel()
      })
      b.addEventListener('pointerup', cancel)
      b.addEventListener('pointerleave', cancel)
      b.addEventListener('pointercancel', cancel)
    }
    b.addEventListener('dblclick', () => (isMod(item) ? this.fit(item.uid) : this.equip(item.uid)))
    // Right-click: wear it, or take it off when it is already worn.
    b.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.quick(item.uid)
    })
    // Drag a bag item onto a gear slot to wear it, or a worn item onto the bag to take it off.
    b.draggable = true
    b.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/x-dnr-item', item.uid)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      this.root?.classList.add('dragging')
    })
    b.addEventListener('dragend', () => this.root?.classList.remove('dragging'))
    return b
  }

  /** Right-click / QA: equip a bag item, unequip a worn one (the gun stays). */
  quick(id: string): void {
    const save = this.host.save()
    const worn = EQUIP_SLOTS.find((s) => save.equipment[s] === id)
    if (worn) {
      if (worn !== 'weapon') this.unequip(worn)
      return
    }
    const item = findItem(save, id)
    if (isMod(item)) this.fit(id)
    else if (item && ITEMS[item.defId]?.slot) this.equip(id)
  }

  /** 총 개조 from the bag: fit a part into the worn gun (same kind swaps back to the bag). */
  fit(partUid: string): void {
    const save = this.host.save()
    const gun = findItem(save, save.equipment.weapon)
    const part = findItem(save, partUid)
    if (!gun || !part) return
    const r = attachMod(save, gun.uid, partUid)
    if (!r.ok) this.host.toast(r.reason ?? '못 끼워.')
    else {
      this.host.toast(r.swapped ? `${itemName(part)} 장착! ${itemName(r.swapped)}은(는) 가방으로.` : `${itemName(part)} 장착! 총이 달라졌어.`)
      this.host.sfx('pop')
      this.picked = gun.uid
      this.host.changed()
    }
    this.render()
  }

  /** One click on a filled socket: the part goes back to the bag (free). */
  unfit(gunUid: string, partUid: string): void {
    const save = this.host.save()
    const r = detachMod(save, gunUid, partUid)
    if (!r.ok) this.host.toast(r.reason ?? '못 빼.')
    else {
      this.host.toast(`${r.mod ? itemName(r.mod) : '부품'}을(를) 뺐어.`)
      this.host.sfx('ui')
      this.host.changed()
    }
    this.render()
  }

  /** The gun's sockets: filled ones show the part (click = 빼기), empty ones dashed, `target` glows. */
  private sockets(gun: ItemInstance, target: number, removable: boolean): HTMLElement {
    const row = el('div', 'inv-socks')
    row.id = 'inv-socks'
    const mods = gunMods(gun)
    const slots = modSlots(gun)
    for (let i = 0; i < Math.max(slots, Math.min(MAX_MOD_SLOTS, slots + 1)); i += 1) {
      const m = mods[i]
      const s = el('button', `inv-sock${m ? ' on' : ''}${i >= slots ? ' locked' : ''}${i === target ? ' target' : ''}`)
      s.type = 'button'
      s.dataset.slot = String(i)
      if (m) {
        s.style.setProperty('--rar', RARITY_COLOR[m.rarity])
        s.innerHTML = iconSvg(ITEMS[m.defId]?.icon, 16)
        s.append(` ${modLabel(m)}${removable ? ' ✕' : ''}`)
        s.title = `${itemName(m)}${removable ? '\n누르면 빼서 가방으로 (무료)' : ''}`
        if (removable) s.addEventListener('click', () => this.unfit(gun.uid, m.uid))
        else s.disabled = true
      } else {
        s.append(i >= slots ? '🔒 더 높은 등급' : '빈 칸')
        s.disabled = true
      }
      row.append(s)
    }
    return row
  }

  /** Drop handler: an item dropped on a gear slot (slot) or on the bag (null). */
  dropOn(id: string, slot: EquipSlot | null): void {
    const save = this.host.save()
    const worn = EQUIP_SLOTS.find((s) => save.equipment[s] === id)
    if (slot) {
      if (worn === slot) return
      const def = findItem(save, id)
      if (slot === 'weapon' && isMod(def)) {
        this.fit(id)
        return
      }
      const fits = !!def && slotFits(ITEMS[def.defId]?.slot, slot)
      if (!fits) {
        this.host.toast('그 칸에는 못 끼워.')
        return
      }
      this.picked = id
      this.equip(id, slot)
    } else if (worn && worn !== 'weapon') this.unequip(worn)
  }

  private dropZone(target: HTMLElement, slot: EquipSlot | null): void {
    target.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('text/x-dnr-item')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      target.classList.add('drop-on')
    })
    target.addEventListener('dragleave', () => target.classList.remove('drop-on'))
    target.addEventListener('drop', (event) => {
      event.preventDefault()
      target.classList.remove('drop-on')
      const id = event.dataTransfer?.getData('text/x-dnr-item')
      if (id) this.dropOn(id, slot)
    })
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
      if (!c.dataset.tip) c.dataset.tip = `${SLOT_KO[slot]}\n비어 있어. 가방에서 끌어다 놓으면 장착!`
      this.dropZone(c, slot)
      slots.append(c)
    }
    grid.replaceChildren()
    if (!grid.dataset.drop) {
      grid.dataset.drop = '1'
      this.dropZone(grid, null)
    }
    const bag = bagItems(save)
    for (let i = 0; i < BAG_CAP; i += 1) grid.append(this.cell(bag[i]))
    if (count) count.textContent = `${bag.length}/${BAG_CAP}`
    this.renderTools(save)
    if (mats) {
      mats.replaceChildren()
      Object.entries(MATERIAL_KO).forEach(([id, name], i) => {
        if (i) mats.append(' · ')
        const tag = el('span', 'mat', `${name} ${save.materials[id] ?? 0}`)
        tag.dataset.tip = `${name}\n${MATERIAL_HELP[id] ?? ''}`
        mats.append(tag)
      })
    }
    this.renderStats(save, stats)
    this.renderDetail(save, detail)
  }

  /** 정렬 · 좋은 장비 입기 · 잡동사니 판매 (마을). */
  private renderTools(save: SaveData): void {
    const tools = document.getElementById('inv-tools')
    if (!tools) return
    tools.replaceChildren()
    const add = (id: string, text: string, tip: string, fn: () => void, disabled = false) => {
      const b = el('button', '', text)
      b.type = 'button'
      b.id = id
      b.dataset.tip = tip
      b.disabled = disabled
      b.addEventListener('click', fn)
      tools.append(b)
    }
    add('inv-sort', '정렬', '가방 정렬\n부위 → 희귀도 → 파워 순으로', () => this.sortNow())
    const ups = bestUpgrades(save)
    add('inv-best', `좋은 장비 입기${ups.length ? ` (${ups.length})` : ''}`, '좋은 장비 입기\n▲ 표시된 것 중 부위마다 가장 센 걸 한 번에 장착 (총은 그대로)', () => this.wearBest(), !ups.length)
    const mode = (m: FastAct, text: string, tip: string) => {
      const on = this.mode === m
      add(`inv-mode-${m}`, on ? `${text} 켜짐 ✓` : text, tip, () => this.setMode(on ? 'none' : m))
      const btn = document.getElementById(`inv-mode-${m}`)
      btn?.classList.toggle('on', on)
      btn?.setAttribute('aria-pressed', String(on))
    }
    mode('sell', '💰 판매 모드', '판매 모드\n켜 두면 가방 물건을 누를 때마다 바로 팔아. (어디서든, 포포의 되사기 칸으로 가)\n희귀 이상은 한 번 더 눌러야 해.')
    mode('salvage', '🔨 분해 모드', '분해 모드\n켜 두면 가방 물건을 누를 때마다 바로 분해해서 재료로.\n희귀 이상은 한 번 더 눌러야 해.')
    const last = this.undoStack[this.undoStack.length - 1]
    add('inv-undo', `↶ 되돌리기${this.undoStack.length ? ` (${this.undoStack.length})` : ''}`, `되돌리기 (Z)\n방금 판 것·분해한 것을 골드·재료를 내고 그대로 되돌려 받아. 최근 ${UNDO_CAP}번까지.${last ? `\n다음: ${last.act === 'sell' ? '판매' : '분해'} ${last.items.length}개` : ''}`, () => this.undo(), !last)
    // Bulk: one row each, with rarity checkboxes.
    tools.append(this.bulkRow(save, 'sell'), this.bulkRow(save, 'salvage'))
  }

  private bulkRow(save: SaveData, act: FastAct): HTMLElement {
    const row = el('div', 'inv-bulk')
    row.dataset.act = act
    const picked = this.pickR[act]
    for (const r of BULK_RARITIES) {
      const label = el('label', 'bulk-r')
      label.style.setProperty('--rar', RARITY_COLOR[r])
      const box = el('input')
      box.type = 'checkbox'
      box.checked = picked.includes(r)
      box.dataset.rarity = r
      box.addEventListener('change', () => {
        this.pickR[act] = BULK_RARITIES.filter((x) => (x === r ? box.checked : this.pickR[act].includes(x)))
        try {
          localStorage.setItem(PICK_KEY, JSON.stringify(this.pickR))
        } catch {
          /* private mode */
        }
        this.render()
      })
      label.append(box, RARITY_KO[r])
      row.append(label)
    }
    const ids = bulkIds(save, picked)
    const gold = ids.reduce((n, id) => n + fastPreview(findItem(save, id)!, MATERIAL_KO).gold, 0)
    const armed = this.confirm === `bulk:${act}`
    const what = `${rarityPickLabel(picked)} 전부 ${act === 'sell' ? '판매' : '분해'}`
    const b = el('button', armed ? 'danger' : act === 'sell' ? '' : 'warn', armed ? `정말? ${what} ${ids.length}개` : `${what}${ids.length ? ` ${ids.length}개${act === 'sell' ? ` +${gold}` : ''}` : ''}`)
    b.type = 'button'
    b.id = `inv-bulk-${act}`
    b.disabled = !ids.length
    b.dataset.tip = `${what}\n착용 중·🔒 잠금·유니크·▲ 더 좋은 장비·부품 낀 총·특수 부품은 절대 안 건드려.\n되돌리기로 한 번에 되돌릴 수 있어.`
    b.addEventListener('click', () => this.bulk(act))
    row.append(b)
    return row
  }

  /** QA hook too: switch 판매 / 분해 모드. */
  setMode(mode: BagMode): void {
    this.mode = mode
    this.host.sfx('ui')
    if (mode !== 'none') this.host.toast(mode === 'sell' ? '판매 모드: 누르는 물건을 바로 팔아. 다시 누르면 꺼져.' : '분해 모드: 누르는 물건을 바로 분해해. 다시 누르면 꺼져.')
    this.render()
  }

  /** One fast action on one bag item (rare+ waits for a second press). QA hook too. */
  act(id: string, act: FastAct): void {
    const save = this.host.save()
    const item = findItem(save, id)
    const block = fastBlock(save, item, act)
    if (block || !item) {
      this.host.toast(block ?? '없는 물건이야.')
      return
    }
    if (fastNeedsConfirm(item) && !this.armed(act, item.uid, confirmText(item, act))) return
    const at = this.cellRect(id)
    const r = fastProcess(save, act, [id])
    if (!r.ok || !r.entry) {
      this.host.toast(r.reason ?? '못 했어.')
      return
    }
    this.done(r.entry, at)
  }

  /** 보통 전부 분해 / 매직 이하 전부 판매 (rare+ in the pick asks once). */
  bulk(act: FastAct): void {
    const save = this.host.save()
    const ids = bulkIds(save, this.pickR[act])
    if (!ids.length) return
    const risky = ids.some((id) => fastNeedsConfirm(findItem(save, id)!))
    if (risky && !this.armed(act, 'bulk', `희귀 이상이 섞여 있어. 한 번 더 누르면 ${ids.length}개 ${act === 'sell' ? '판매' : '분해'}.`, `bulk:${act}`)) return
    const at = document.getElementById(`inv-bulk-${act}`)?.getBoundingClientRect() ?? null
    const r = fastProcess(save, act, ids)
    if (r.ok && r.entry) this.done(r.entry, at)
  }

  private done(entry: UndoEntry, at: DOMRect | null): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift()
    const gain = fastGain(entry, MATERIAL_KO)
    const save = this.host.save()
    if (this.picked && !findItem(save, this.picked)) this.picked = null
    if (this.hover && !findItem(save, this.hover)) this.hover = null
    this.popup(gain, at, entry.act)
    const n = entry.items.length
    const parts = Object.values(entry.parts).flat().length
    this.host.toast(`${n > 1 ? `${n}개 ` : `${itemName(entry.items[0])} `}${entry.act === 'sell' ? '판매' : '분해'} ${gain}${parts ? ` · 끼워 둔 부품 ${parts}개는 가방으로` : ''} (Z 되돌리기)`)
    this.host.sfx(entry.act === 'sell' ? 'coin' : 'pop')
    this.host.changed()
    this.render()
  }

  /** 되돌리기 (Z): undo the newest fast action. QA hook too. */
  undo(): void {
    const entry = this.undoStack[this.undoStack.length - 1]
    if (!entry) {
      this.host.toast('되돌릴 게 없어.')
      return
    }
    const r = undoFast(this.host.save(), entry)
    if (!r.ok) {
      this.host.toast(r.reason ?? '되돌릴 수 없어.')
      return
    }
    this.undoStack.pop()
    this.host.toast(`되돌렸어: ${entry.items.length}개 가방으로 ${entry.act === 'sell' ? `(-${entry.gold} 골드)` : '(재료 반납)'}`)
    this.host.sfx('ui')
    this.host.changed()
    this.render()
  }

  /** 🔒 toggle (C on hover, the detail button, the long-press menu). */
  lock(id: string): void {
    const on = toggleLock(this.host.save(), id)
    this.host.toast(on ? '🔒 잠갔어. 빠른 판매·분해·일괄 처리에서 빠져.' : '🔓 잠금을 풀었어.')
    this.host.sfx('ui')
    this.host.changed()
    this.render()
  }

  private cellRect(id: string): DOMRect | null {
    return this.root?.querySelector<HTMLElement>(`#inv-grid .inv-cell[data-uid="${id}"]`)?.getBoundingClientRect() ?? null
  }

  /** The floating "+42 골드" / "꿈가루 +2" over where the item was. */
  private popup(text: string, at: DOMRect | null, act: FastAct): void {
    const pop = el('div', `fast-pop ${act}`, text)
    const x = at ? at.left + at.width / 2 : window.innerWidth / 2
    const y = at ? at.top + at.height / 3 : window.innerHeight / 2
    pop.style.left = `${Math.round(x)}px`
    pop.style.top = `${Math.round(y)}px`
    document.body.append(pop)
    window.setTimeout(() => pop.remove(), 1100)
  }

  /** Long-press menu (mobile): big 판매 / 분해 / 잠금 buttons. */
  private openMenu(id: string): void {
    const save = this.host.save()
    const item = findItem(save, id)
    if (!item) return
    this.closeMenu()
    const pv = fastPreview(item, MATERIAL_KO)
    const wrap = el('div', 'fast-menu')
    wrap.id = 'fast-menu'
    wrap.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      if (event.target === wrap) this.closeMenu()
    })
    const card = el('div', 'fast-card')
    card.append(nameTitle('h3', item), el('p', 'inv-sub', `${itemRarityKo(item)} · 파워 ${itemPower(item)}`))
    const big = (cls: string, text: string, fn: () => void, disabled = false) => {
      const b = el('button', cls, text)
      b.type = 'button'
      b.disabled = disabled
      b.addEventListener('click', () => {
        this.closeMenu()
        fn()
      })
      card.append(b)
      return b
    }
    big('big sell', `💰 판매 +${pv.gold}골드`, () => this.act(id, 'sell'), !!item.locked).dataset.act = 'sell'
    big('big salvage', `🔨 분해 → ${pv.salvage}`, () => this.act(id, 'salvage'), !!item.locked).dataset.act = 'salvage'
    big('big lock', item.locked ? '🔓 잠금 풀기' : '🔒 잠그기', () => this.lock(id)).dataset.act = 'lock'
    big('big pick', '자세히 보기', () => this.pick(id))
    big('big cancel', '닫기', () => undefined)
    wrap.append(card)
    this.root?.append(wrap)
    this.host.sfx('ui')
  }

  private closeMenu(): boolean {
    const m = document.getElementById('fast-menu')
    m?.remove()
    return !!m
  }

  /** Sort the bag (QA hook too). */
  sortNow(): void {
    sortBag(this.host.save())
    this.host.sfx('ui')
    this.host.changed()
    this.render()
  }

  /** Wear every ▲ upgrade, best per slot. */
  wearBest(): void {
    const save = this.host.save()
    const ids = bestUpgrades(save)
    let n = 0
    for (const id of ids) if (tryEquip(save, id).ok) n += 1
    if (!n) {
      this.host.toast('지금보다 좋은 장비가 없어.')
      return
    }
    this.host.toast(`더 좋은 장비 ${n}개 장착!`)
    this.host.sfx('pop')
    this.host.changed()
    this.render()
  }

  /** First press on a rare+ item arms the action; the second (within 4 s) does it. */
  private armed(act: FastAct, uid: string, text: string, key = `${act}:${uid}`): boolean {
    if (this.confirm === key) {
      this.confirm = null
      return true
    }
    this.confirm = key
    window.clearTimeout(this.confirmTimer)
    this.confirmTimer = window.setTimeout(() => {
      this.confirm = null
      this.render()
    }, 4000)
    this.host.toast(text)
    this.host.sfx('ui')
    this.render()
    return false
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
    // The gun's personality as a little card: its kind on top, the blurb under, then the stat chips.
    const gun = el('p', 'inv-gun')
    gun.dataset.gun = s.weaponKind
    gun.append(el('b', '', GUN_KO[s.weaponKind]), el('span', '', GUN_PROFILES[s.weaponKind].blurb))
    box.append(gun)
    const line = gunStatLine(GUN_PROFILES[s.weaponKind], s.shotDamage, s.fireRate)
    const chips = el('p', 'inv-gun-stats')
    chips.title = line
    for (const part of line.split(' · ')) chips.append(el('span', '', part))
    box.append(chips)
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
      box.append(el('p', 'inv-empty', '물건을 눌러 보면 지금 장비와 비교해 줄게. 두 번 누르거나 오른쪽 클릭하면 바로 장착, 장비 칸으로 끌어다 놓아도 돼!'))
      return
    }
    const def = ITEMS[item.defId]
    const worn = isEquipped(save, item.uid)
    box.append(nameTitle('h3', item))
    box.append(el('p', 'inv-sub', `${itemRarityKo(item)} · ${ilvText(item.itemLevel)} · 파워 ${itemPower(item)}${def?.gun ? ` · ${GUN_KO[def.gun]}` : ''}`))
    if (def?.description) box.append(el('p', 'inv-desc', def.description))
    const ul = el('ul', 'inv-lines')
    for (const line of itemLines(item).slice(2, -1)) ul.append(el('li', '', line))
    box.append(ul)
    const wornGun = findItem(save, save.equipment.weapon)
    if (isGun(item) && modSlots(item) > 0) {
      box.append(el('h4', '', `개조 칸 ${gunMods(item).length}/${modSlots(item)}${worn ? ' · 칸을 누르면 빼기' : ''}`))
      box.append(this.sockets(item, -1, worn))
    }
    let fitBtn: (() => void) | null = null
    if (isMod(item) && !worn && wornGun) {
      const pv = fitPreview(wornGun, item)
      box.append(el('h4', '', `${itemName(wornGun)}에 끼우면`))
      box.append(this.sockets(wornGun, pv.block ? -1 : pv.slot, true))
      const p = el('p', 'inv-fit')
      p.id = 'inv-fit-preview'
      if (pv.block) p.append(el('span', 'lose', pv.block))
      else {
        p.append(pv.swap ? `${pv.slot + 1}번 칸 ${modLabel(pv.swap)}과(와) 바꿔 · ` : `${pv.slot + 1}번 빈 칸에 끼워 · `, `${pv.cost}골드`)
        if (pv.gain.length) p.append(' · ', el('span', 'gain', `✦ 조합 켜짐: ${pv.gain.map((c) => c.name).join(', ')}`))
        if (pv.lose.length) p.append(' · ', el('span', 'lose', `✖ 조합 꺼짐: ${pv.lose.map((c) => c.name).join(', ')}`))
      }
      box.append(p)
      if (!pv.block) fitBtn = () => this.fit(item.uid)
    }
    if (!worn && def?.slot) {
      const target = slotFor(save, item)
      const current = target ? findItem(save, save.equipment[target]) : undefined
      box.append(el('h4', '', current ? `지금 ${SLOT_KO[target!]}: ${itemName(current)} (파워 ${itemPower(current)} → ${itemPower(item)})` : `${SLOT_KO[target ?? def.slot]} 비어 있음`))
      const diff = compareEquip(save, item.uid, target)
      const table = el('ul', 'inv-compare')
      const lv = ilvRow(current, item)
      if (lv) table.append(lv)
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
    if (fitBtn) {
      const fb = btn(`총에 끼우기 ${fitPreview(wornGun!, item).cost}골드`, fitBtn, 'primary', save.gold < fitPreview(wornGun!, item).cost)
      fb.id = 'inv-fit'
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
    if (!worn) {
      const pv = fastPreview(item, MATERIAL_KO)
      const sellArmed = this.confirm === `sell:${item.uid}`
      const sellBtn = btn(sellArmed ? `한 번 더! 판매 +${pv.gold}` : `판매 +${pv.gold}`, () => this.act(item.uid, 'sell'), sellArmed ? 'danger' : '', !!item.locked)
      sellBtn.dataset.act = 'sell'
      const disArmed = this.confirm === `salvage:${item.uid}`
      const disBtn = btn(disArmed ? `한 번 더! 분해 → ${pv.salvage}` : `분해 → ${pv.salvage}`, () => this.act(item.uid, 'salvage'), disArmed ? 'danger' : 'warn', !!item.locked)
      disBtn.dataset.act = 'dismantle'
    }
    const lockBtn = btn(item.locked ? '🔓 잠금 풀기' : '🔒 잠그기', () => this.lock(item.uid), item.locked ? 'on' : '')
    lockBtn.dataset.act = 'lock'
    lockBtn.title = '잠그면 빠른 판매·분해·일괄 처리에서 빠져 (C)'
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
    const glyph = el('i', 'glyph')
    glyph.innerHTML = skillSvg(skill.id, 28)
    b.append(glyph)
    const body = el('div')
    body.append(el('b', '', `${skill.name}${skill.key ? ` [${skill.key}]` : ''}`))
    body.append(el('small', 'rank', `${r}/${skill.max} · ${skill.kind === 'active' ? '액티브' : '패시브'} · Lv ${TIER_LEVEL[skill.tier]}`))
    body.append(el('p', '', skill.text(Math.max(1, r)) + (skill.cooldown ? ` (대기 ${skill.cooldown(Math.max(1, r))}초)` : '')))
    if (block && r < skill.max) body.append(el('em', 'why', block))
    if (r > 0 && r < skill.max) body.append(el('em', 'next', `다음: ${skill.text(r + 1)}`))
    b.append(body)
    b.dataset.tip = `${skill.name} · ${r}/${skill.max}\n${skill.text(Math.max(1, r))}${skill.cooldown ? `\n대기 ${skill.cooldown(Math.max(1, r))}초` : ''}\n${block || '눌러서 배우기'}`
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
