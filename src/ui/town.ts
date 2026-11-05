/**
 * Town service panels over the canvas (one dialog, four faces):
 *  - 포포 상점: sweets and scrolls, today's shelf, selling from the bag and buy-back.
 *  - 키키 공방: gun upgrades (+1..+10), one-affix rerolls, element swaps.
 *  - 퀘스트 게시판: three repeatable contracts to take, track and claim.
 *  - 보관함: the chest by the house.
 * Every change goes through sim/ (town, workshop, contracts); the host re-applies the build.
 */
import { ITEMS, MATERIAL_HELP, MATERIAL_KO } from '../data/items'
import { REPEAT_ICON, boardOf, claimContract, contractRuns, contractTitle, dropContract, rewardText, runsText, takeContract, type Contract } from '../sim/contracts'
import { addItem, bagItems, findItem, isEquipped, oneHanded, slotFor } from '../sim/inventory'
import { formatAffix, ilvText, itemLines, itemName, itemPower, plusOf, sellValue, upgradeMul } from '../sim/loot'
import { fillCell, ilvRow, nameTitle, pct } from './itemcell'
import { buyBack, buyConsumable, buyStock, consumableCount, CONSUMABLES, RESTOCK_COST, restock, sellItem, shopStock, STASH_CAP, stashPut, stashTake, townOf } from '../sim/town'
import { canPay, changeElement, ELEMENT_COST, elementOf, MAX_PLUS, PITY_STEP, rerollAffix, rerollAffixCost, rerollChoices, upFailsOf, upgradeChance, upgradeCost, upgradeGun, type Cost } from '../sim/workshop'
import { CHAPTER2, CHAPTER_TITLE, chapter2Open, chapterProgress, chaptersOf, claimQuest, fieldOpen, questRewardText, takeQuest } from '../sim/chapters'
import { BAG_CAP, type MutationResult, type Element, type ItemInstance, type SaveData } from '../sim/types'
import { compareEquip } from './inventory'
import { iconSvg } from './icons'
import { COMBOS, MAX_TRICKS, TRICK_KO } from '../data/mods'
import { attachMod, bagMods, detachMod, fitBlock, fitCost, gunCombos, gunMods, gunTraits, HAND_KO, isMod, MAX_MOD_SLOTS, MOD_SLOT_ILV, modKind, modLabel, modSlots, modUpgradeCost, newCombos, partTarget, swapIndex, upgradeMod, wornGun, type PartHand, type Trait } from '../sim/mods'
import { RARITY_COLOR, RARITY_KO } from '../sim/types'
import { itemColor, itemRarityKo } from '../sim/rarity'
import type { LegendSource } from '../data/legends'
import { codexRows, legendAffixes, legendChance } from '../sim/legends'

export type TownPanel = 'shop' | 'workshop' | 'board' | 'stash' | 'codex'

/** 조합 partner name: a trick or a chip. */
function traitName(t: Trait): string {
  return t in TRICK_KO ? TRICK_KO[t as keyof typeof TRICK_KO] : ({ sparkle: '별빛', ice: '서리', candy: '사탕' } as Record<string, string>)[t] + ' 속성'
}

/** Combos this part would switch on if fitted (swapping a same-kind part out). */

/** 강화 반짝이 기다림 (ms). */
export const FORGE_MS = 600

export type TownSuccess = 'buy' | 'sell' | 'upgrade' | 'upfail' | 'reroll' | 'element' | 'take' | 'claim' | 'stash' | 'mod'

export interface TownHost {
  save(): SaveData
  /** Gear, gold or contracts changed: re-apply to the hero, persist, repaint the HUD. */
  changed(): void
  toast(text: string): void
  sfx(cue: 'ui' | 'coin' | 'quest' | 'pop'): void
  /** A job went well: sparkles and a jingle in the world. */
  success(kind: TownSuccess, item?: ItemInstance): void
  /** The story quests (old 꿈의 게시판 log). */
  openStory(): void
  opened(): void
  closed(): void
  /** A panel was shown (the guide chapter waits for each one). */
  viewed?(panel: TownPanel): void
  /** A chapter quest was turned in (rewards to show; the chapter it cleared, or 0). */
  chapterClaimed?(result: MutationResult, cleared: number): void
  /** ⚡ 가방 판매 모드 / 분해 모드: close the panel, open the bag in that mode. */
  openBag?(mode: 'sell' | 'salvage'): void
}

const TITLE: Record<TownPanel, string> = { shop: '포포 상점', workshop: '키키의 총 공방', board: '퀘스트 게시판', stash: '별하의 보관함', codex: '유니크 도감' }
const SUB: Record<TownPanel, string> = {
  shop: '하수도에 다녀올 때마다 진열대가 바뀌어.',
  workshop: '+6부터 실패할 수도 · 실패해도 강화 수치는 안 떨어져!',
  board: '의뢰는 하수도에서 진행되고, 돌아오면 여기서 보상을 받아.',
  stash: '가방이 꽉 차면 여기에 넣어 둬.',
  codex: '이름 붙은 총 일곱 자루. 정해진 곳에서만 떨어지고, 못 찾을수록 확률이 올라가.',
}

const SOURCE_KO: Record<LegendSource['kind'], string> = { boss: '보스 상자', areaBoss: '보스 상자', areaChest: '지역 보물 상자 하나당', mazeElite: '미로 정예' }

const ELEMENT_KO: Record<Element, string> = { sparkle: '반짝', ice: '서늘', candy: '끈적' }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function costText(c: Cost): string {
  const mats = Object.entries(c.mats)
    .filter(([, n]) => n > 0)
    .map(([m, n]) => `${MATERIAL_KO[m] ?? m} ${n}`)
  return [`${c.gold}골드`, ...mats].join(' · ')
}

type Pick = { from: 'stock' | 'bag' | 'buyback' | 'stash' | 'work'; key: string } | null

export class TownUI {
  private readonly host: TownHost
  private readonly root: HTMLElement
  private panel: TownPanel = 'shop'
  private picked: Pick = null
  isOpen = false

  constructor(host: TownHost) {
    this.host = host
    let root = document.getElementById('town')
    if (!root) {
      root = el('div')
      root.id = 'town'
      root.className = 'hidden'
      root.setAttribute('role', 'dialog')
      ;(document.getElementById('app') ?? document.body).append(root)
    }
    this.root = root
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation())
    window.addEventListener('keydown', (event) => {
      if (this.isOpen && event.code === 'Escape') this.close()
    })
  }

  get current(): TownPanel {
    return this.panel
  }

  open(panel: TownPanel): void {
    this.panel = panel
    this.picked = null
    this.isOpen = true
    this.root.classList.remove('hidden')
    this.root.setAttribute('aria-label', TITLE[panel])
    if (panel === 'workshop') {
      const gun = this.host.save().equipment.weapon
      if (gun) this.picked = { from: 'work', key: gun }
    }
    this.host.opened()
    this.host.sfx('ui')
    this.render()
  }

  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    this.root.classList.add('hidden')
    this.host.closed()
  }

  /** QA hook: pick an entry as if tapped. */
  pick(from: NonNullable<Pick>['from'], key: string): void {
    this.picked = { from, key }
    this.render()
  }

  render(): void {
    if (!this.isOpen) return
    const save = this.host.save()
    this.root.innerHTML = ''
    const card = el('div', `inv-card town-card town-${this.panel}`)
    const head = el('header')
    // 몽실 마을's gunsmith is 볼트 (same workshop, same save).
    const h = el('h2', 'town-title', this.panel === 'workshop' && document.body.classList.contains('mongsil') ? '볼트의 총 개조 공방' : TITLE[this.panel])
    head.append(h, el('small', 'town-sub', SUB[this.panel]))
    const wallet = el('span', 'town-wallet')
    wallet.id = 'town-gold'
    wallet.append(`골드 ${save.gold}`)
    for (const m of ['dream_dust', 'toy_part', 'star_shard']) {
      const tag = el('span', 'mat', `${MATERIAL_KO[m]} ${save.materials[m] ?? 0}`)
      tag.title = MATERIAL_HELP[m] ?? ''
      wallet.append(' · ', tag)
    }
    if (this.panel !== 'codex') {
      const codex = el('button', 'town-close town-codex-btn', '유니크 도감')
      codex.type = 'button'
      codex.id = 'town-codex'
      codex.title = '유니크 (이름 있는 고정 전설) 모음'
      codex.addEventListener('click', () => this.open('codex'))
      head.append(codex)
    }
    const close = el('button', 'town-close', '닫기')
    close.type = 'button'
    close.id = 'town-close'
    close.title = '닫기 (Esc)'
    close.addEventListener('click', () => this.close())
    head.append(wallet, close)
    card.append(head)
    const body = el('div', 'town-body')
    card.append(body)
    this.root.append(card)
    if (this.panel === 'shop') this.renderShop(save, body)
    else if (this.panel === 'workshop') this.renderWorkshop(save, body)
    else if (this.panel === 'board') this.renderBoard(save, body)
    else if (this.panel === 'codex') this.renderCodex(save, body)
    else this.renderStash(save, body)
    this.host.viewed?.(this.panel)
  }

  // ---- shared bits ----

  private cell(item: ItemInstance | undefined, from: NonNullable<Pick>['from'], price?: number, sold = false): HTMLButtonElement {
    const b = el('button', 'inv-cell')
    b.type = 'button'
    if (!item) {
      b.classList.add('empty')
      return b
    }
    fillCell(b, item, this.host.save())
    b.dataset.from = from
    b.dataset.uid = item.uid
    if (plusOf(item) > 0) b.append(el('small', 'plus', `+${plusOf(item)}`))
    if (price !== undefined) b.append(el('small', 'price', sold ? '팔림' : `${price}`))
    if (sold) b.classList.add('sold')
    if (this.picked?.from === from && this.picked.key === item.uid) b.classList.add('picked')
    b.addEventListener('click', () => {
      this.picked = { from, key: item.uid }
      this.host.sfx('ui')
      this.render()
    })
    const quick = this.quickText(from)
    if (quick) b.dataset.tip = `${b.dataset.tip ?? ''}\n오른쪽 클릭: ${quick}`
    b.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.quick(from, item)
    })
    return b
  }

  /** What a right-click on a cell from `from` does in this panel ('' = nothing quick). */
  private quickText(from: NonNullable<Pick>['from']): string {
    if (this.panel === 'shop' && from === 'bag') return '바로 팔기 (되사기 가능)'
    if (this.panel === 'stash' && from === 'bag') return '보관함에 넣기'
    if (this.panel === 'stash' && from === 'stash') return '가방으로 꺼내기'
    return ''
  }

  /** Right-click: sell from the bag at 포포's, move between bag and stash; elsewhere just pick it. */
  quick(from: NonNullable<Pick>['from'], item: ItemInstance): void {
    const save = this.host.save()
    if (this.panel === 'shop' && from === 'bag' && !isEquipped(save, item.uid)) {
      this.picked = null
      this.run(sellItem(save, item.uid), `${itemName(item)}을(를) 팔았어. (되사기 가능)`, 'sell', item)
    } else if (this.panel === 'stash' && from === 'bag') {
      const r = stashPut(save, item.uid)
      if (r.ok) this.picked = { from: 'stash', key: item.uid }
      this.run(r, '보관함에 넣었어.', 'stash', item)
    } else if (this.panel === 'stash' && from === 'stash') {
      const r = stashTake(save, item.uid)
      if (r.ok) this.picked = { from: 'bag', key: item.uid }
      this.run(r, '가방에 넣었어.', 'stash', item)
    } else {
      this.picked = { from, key: item.uid }
      this.render()
    }
  }

  private grid(items: (ItemInstance | undefined)[], from: NonNullable<Pick>['from'], prices?: number[], sold?: boolean[]): HTMLElement {
    const g = el('div', 'town-grid')
    items.forEach((item, i) => g.append(this.cell(item, from, prices?.[i], sold?.[i])))
    return g
  }

  private button(text: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; id?: string; warn?: boolean } = {}): HTMLButtonElement {
    const b = el('button', opts.primary ? 'primary' : opts.warn ? 'warn' : '', text)
    b.type = 'button'
    if (opts.id) b.id = opts.id
    b.disabled = Boolean(opts.disabled)
    b.addEventListener('click', onClick)
    return b
  }

  private itemCard(item: ItemInstance, save: SaveData): HTMLElement {
    const box = el('div', 'town-detail')
    const h = nameTitle('h3', item)
    box.append(h, el('p', 'inv-sub', `${ilvText(item.itemLevel)} · 파워 ${itemPower(item)}${plusOf(item) ? ` · 강화 +${plusOf(item)} (총 피해 ×${upgradeMul(plusOf(item)).toFixed(2)})` : ''}`))
    const ul = el('ul', 'inv-lines')
    for (const line of itemLines(item)) ul.append(el('li', '', line))
    box.append(ul)
    // How it would change her stats if worn (shop shelf and stash too).
    const trial = structuredClone(save)
    if (!findItem(trial, item.uid)) addItem(trial, structuredClone(item), true)
    if (!isEquipped(trial, item.uid)) {
      const rows = compareEquip(trial, item.uid)
      const target = slotFor(trial, item)
      const lv = ilvRow(target ? findItem(trial, trial.equipment[target]) : undefined, item)
      if (rows.length || lv) {
        box.append(el('h4', '', '지금 장비와 비교'))
        const cmp = el('ul', 'inv-compare')
        if (lv) cmp.append(lv)
        for (const r of rows.slice(0, 6)) {
          const li = el('li', r.delta > 0 ? 'up' : 'down')
          li.append(el('span', '', r.label), el('b', '', `${r.from} → ${r.to}`))
          cmp.append(li)
        }
        box.append(cmp)
      }
    }
    return box
  }

  /** 강화 중 (0.6초 반짝이 기다림): the button is locked so one click is one try. */
  private forging = false

  /** One upgrade try: pay and roll now, show 0.6 s of sparkle, then the result toast. */
  private forge(save: SaveData, item: ItemInstance, box: HTMLElement): void {
    if (this.forging) return
    const r = upgradeGun(save, item.uid)
    if (!r.ok) {
      this.run(r, '', 'upgrade', item)
      return
    }
    this.forging = true
    this.host.changed()
    box.classList.add('forging')
    const btn = box.querySelector<HTMLButtonElement>('#work-upgrade')
    if (btn) {
      btn.disabled = true
      btn.textContent = '반짝반짝…'
    }
    this.host.sfx('pop')
    window.setTimeout(() => {
      this.forging = false
      box.classList.remove('forging')
      if (r.success) {
        this.host.toast(`반짝! +${plusOf(item)}`)
        this.render()
        this.host.success('upgrade', item)
      } else {
        this.host.toast(`픽… 실패 · 다음 확률 ${pct(r.nextChance ?? 1)}`)
        this.render()
        this.host.success('upfail', item)
      }
    }, FORGE_MS)
  }

  private run(r: { ok: boolean; reason?: string }, ok: string, kind: TownSuccess, item?: ItemInstance): void {
    if (!r.ok) {
      this.host.toast(r.reason ?? '할 수 없어.')
      this.host.sfx('pop')
      this.render()
      return
    }
    this.host.toast(ok)
    this.host.changed()
    this.render()
    this.host.success(kind, item)
  }

  // ---- 포포 상점 ----

  private renderShop(save: SaveData, body: HTMLElement): void {
    const left = el('section', 'town-col')
    const right = el('section', 'town-col town-side')
    body.append(left, right)

    left.append(el('h3', '', '사탕 · 두루마리'))
    const sweets = el('div', 'town-sweets')
    for (const c of CONSUMABLES) {
      const row = el('div', 'town-sweet')
      row.dataset.id = c.id
      const have = consumableCount(save, c.id)
      const text = el('div')
      text.append(el('b', '', `${c.name} · ${c.price}골드`), el('small', '', `${c.blurb} (보유 ${have}/${c.cap})`))
      row.append(text)
      row.append(this.button('1개', () => this.run(buyConsumable(save, c.id, 1), `${c.name} 1개를 샀어.`, 'buy'), { primary: true, disabled: have >= c.cap, id: `buy-${c.id}` }))
      row.append(this.button('5개', () => this.run(buyConsumable(save, c.id, 5), `${c.name}을 샀어.`, 'buy'), { disabled: have >= c.cap }))
      sweets.append(row)
    }
    left.append(sweets)

    const stock = shopStock(save)
    const shelfHead = el('h3', '', '오늘의 진열대 ')
    shelfHead.append(el('small', '', '희귀 등급까지'))
    left.append(shelfHead)
    left.append(
      this.grid(
        stock.map((e) => e.item),
        'stock',
        stock.map((e) => e.price),
        stock.map((e) => Boolean(e.sold)),
      ),
    )
    left.append(this.button(`진열대 새로 들이기 (${RESTOCK_COST}골드)`, () => this.run(restock(save), '포포가 새 물건을 꺼냈어!', 'buy'), { id: 'shop-restock' }))

    const bag = bagItems(save)
    const bagHead = el('h3', '', '팔기 · 내 가방 ')
    bagHead.append(el('small', '', `${bag.length}/${BAG_CAP}`))
    left.append(bagHead)
    if (this.host.openBag) left.append(this.button('⚡ 가방 판매 모드로 (누르면 바로 판매 · 일괄 판매)', () => this.host.openBag?.('sell'), { primary: true, id: 'shop-fastsell' }))
    left.append(bag.length ? this.grid(bag, 'bag') : el('p', 'inv-empty', '팔 물건이 없어. (착용 중인 장비는 가방에서 먼저 벗어 줘)'))

    const back = townOf(save).buyback
    left.append(el('h3', '', '되사기 · 최근에 판 물건'))
    left.append(back.length ? this.grid(back.map((e) => e.item), 'buyback', back.map((e) => e.price)) : el('p', 'inv-empty', '아직 판 물건이 없어.'))

    // Detail of what is picked.
    const pick = this.picked
    if (!pick) {
      right.append(el('p', 'inv-empty', '물건을 눌러 자세히 봐. 산 물건은 가방으로, 판 물건은 되사기 칸으로 가.'))
      return
    }
    if (pick.from === 'stock') {
      const i = stock.findIndex((e) => e.item.uid === pick.key)
      const entry = stock[i]
      if (!entry) return
      right.append(this.itemCard(entry.item, save))
      const row = el('div', 'inv-actions')
      row.append(this.button(entry.sold ? '팔렸어' : `사기 ${entry.price}골드`, () => this.run(buyStock(save, i), `${itemName(entry.item)}을(를) 샀어.`, 'buy', entry.item), { primary: true, disabled: entry.sold || save.gold < entry.price, id: 'shop-buy' }))
      right.append(row)
    } else if (pick.from === 'bag') {
      const item = findItem(save, pick.key)
      if (!item || isEquipped(save, item.uid)) return
      right.append(this.itemCard(item, save))
      const row = el('div', 'inv-actions')
      row.append(
        this.button(`팔기 +${sellValue(item)}골드`, () => {
          const r = sellItem(save, item.uid)
          this.picked = null
          this.run(r, `${itemName(item)}을(를) 팔았어. (되사기 가능)`, 'sell', item)
        }, { warn: true, id: 'shop-sell' }),
      )
      right.append(row)
    } else if (pick.from === 'buyback') {
      const i = back.findIndex((e) => e.item.uid === pick.key)
      const entry = back[i]
      if (!entry) return
      right.append(this.itemCard(entry.item, save))
      const row = el('div', 'inv-actions')
      row.append(
        this.button(`되사기 ${entry.price}골드`, () => {
          const r = buyBack(save, i)
          if (r.ok) this.picked = { from: 'bag', key: entry.item.uid }
          this.run(r, `${itemName(entry.item)}을(를) 되찾았어.`, 'buy', entry.item)
        }, { primary: true, disabled: save.gold < entry.price, id: 'shop-buyback' }),
      )
      right.append(row)
    }
  }

  // ---- 키키 공방 ----

  private workItems(save: SaveData): ItemInstance[] {
    const worn = Object.values(save.equipment)
      .map((id) => findItem(save, id))
      .filter((i): i is ItemInstance => Boolean(i))
    const gunsFirst = (a: ItemInstance, b: ItemInstance) => Number(ITEMS[b.defId]?.slot === 'weapon') - Number(ITEMS[a.defId]?.slot === 'weapon')
    // 보관함 총도 맡길 수 있어 (강화 · 개조 · 재굴림 모두 보관함 안에서 된다).
    const stash = townOf(save).stash.filter((i) => !isMod(i) && ITEMS[i.defId])
    return [...worn.sort(gunsFirst), ...bagItems(save).filter((i) => !isMod(i)).sort(gunsFirst), ...stash.sort(gunsFirst)]
  }

  private renderWorkshop(save: SaveData, body: HTMLElement): void {
    const left = el('section', 'town-col')
    const right = el('section', 'town-col town-side')
    body.append(left, right)
    const items = this.workItems(save)
    left.append(el('h3', '', '어느 총에 끼울까'))
    left.append(this.handPicks(save))
    left.append(el('h3', '', '맡길 물건 (착용 중 → 가방 → 보관함)'))
    left.append(this.grid(items, 'work'))
    left.append(el('p', 'inv-empty', '강화: 총만 · 옵션 재굴림: 모든 장비 · 속성 변경: 속성 옵션이 붙은 총'))
    if (this.host.openBag) left.append(this.button('⚡ 가방 분해 모드로 (누르면 바로 분해 · 보통 전부 분해)', () => this.host.openBag?.('salvage'), { warn: true, id: 'work-fastsalvage' }))
    const item = this.picked?.from === 'work' ? items.find((i) => i.uid === this.picked?.key) : undefined
    if (!item) {
      right.append(el('p', 'inv-empty', '물건을 골라 줘.'))
      return
    }
    right.append(this.itemCard(item, save))
    const gun = ITEMS[item.defId]?.slot === 'weapon'

    if (gun) {
      const box = el('div', 'town-job')
      box.append(el('h4', '', `강화 +${plusOf(item)} / +${MAX_PLUS}`))
      const meter = el('div', 'town-plus')
      for (let i = 1; i <= MAX_PLUS; i += 1) meter.append(el('i', i <= plusOf(item) ? 'on' : ''))
      box.append(meter)
      const cost = upgradeCost(item)
      if (cost) {
        const chance = upgradeChance(item) ?? 1
        const fails = upFailsOf(item)
        box.append(el('small', '', `총 피해 ×${upgradeMul(plusOf(item)).toFixed(2)} → ×${upgradeMul(plusOf(item) + 1).toFixed(2)} · ${costText(cost)}`))
        const odds = el('div', `town-odds${chance < 1 ? ' risky' : ''}`)
        odds.id = 'work-odds'
        odds.append(el('b', '', `성공 확률 ${pct(chance)}`))
        if (fails) odds.append(el('span', 'pity', ` (실패 ${fails}번 · +${Math.round(fails * PITY_STEP * 100)}%p 보너스)`))
        odds.append(el('small', '', chance < 1 ? '실패해도 강화 수치는 안 떨어져 · 골드·재료만 들고, 다음 확률 +10%p' : '실패해도 강화 수치는 안 떨어져 · 이 단계는 꼭 성공해'))
        box.append(odds)
        box.append(this.button(this.forging ? '반짝반짝…' : `+${plusOf(item) + 1} 강화하기 (${pct(chance)})`, () => this.forge(save, item, box), { primary: true, disabled: this.forging || !canPay(save, cost), id: 'work-upgrade' }))
      } else box.append(el('small', '', '최고 단계야. 더는 반짝일 수 없어!'))
      right.append(box)
    }

    if (gun) right.append(this.modBox(save, item))

    if (item.affixes.length) {
      const box = el('div', 'town-job')
      const cost = rerollAffixCost(item)
      box.append(el('h4', '', `옵션 하나 다시 굴리기 · ${costText(cost)}`))
      item.affixes.forEach((_, i) => {
        const row = el('div', 'town-affix')
        row.append(el('span', '', lineOf(item, i)))
        row.append(this.button('굴리기', () => this.run(rerollAffix(save, item.uid, i), '새 옵션이 나왔어!', 'reroll', item), { disabled: !canPay(save, cost) || !rerollChoices(item, i).length, id: `work-reroll-${i}` }))
        box.append(row)
      })
      right.append(box)
    }

    if (gun) {
      const box = el('div', 'town-job')
      const now = elementOf(item)
      box.append(el('h4', '', `속성 바꾸기 · ${costText(ELEMENT_COST)}`))
      if (!now) box.append(el('small', '', '속성 옵션(반짝·서늘·끈적)이 붙은 총만 바꿀 수 있어.'))
      else {
        const row = el('div', 'inv-actions')
        for (const e of ['sparkle', 'ice', 'candy'] as Element[]) {
          row.append(this.button(ELEMENT_KO[e], () => this.run(changeElement(save, item.uid, e), `${ELEMENT_KO[e]} 속성으로 바꿨어!`, 'element', item), { disabled: e === now || !canPay(save, ELEMENT_COST), primary: e === now, id: `work-element-${e}` }))
        }
        box.append(row)
      }
      right.append(box)
    }
  }

  /** Big 주 손 / 보조 손 chips so the second gun is one tap, not a hunt through the grid. */
  private handPicks(save: SaveData): HTMLElement {
    const row = el('div', 'hand-picks')
    row.id = 'work-hands'
    const main = wornGun(save, 'weapon')
    const picked = this.picked?.from === 'work' ? this.picked.key : ''
    for (const hand of ['weapon', 'offhand'] as const) {
      const gun = wornGun(save, hand)
      const on = !!gun && picked === gun.uid
      const b = el('button', `hand-pick${on ? ' on' : ''}${gun ? '' : ' empty'}`)
      b.type = 'button'
      b.id = `work-hand-${hand}`
      const empty = hand === 'offhand' && main && !oneHanded(main) ? '양손 총이 사용 중' : '비어 있음 · 눌러서 안내'
      b.append(el('b', '', HAND_KO[hand]), el('small', '', gun ? itemName(gun) : empty))
      b.addEventListener('click', () => {
        if (!gun) {
          this.host.toast(partTarget(save, hand, true).note ?? '총을 먼저 차 줘.')
          this.host.sfx('ui')
          return
        }
        this.picked = { from: 'work', key: gun.uid }
        this.host.sfx('ui')
        this.render()
      })
      row.append(b)
    }
    return row
  }

  /** 주 손 / 보조 손 / 가방, for the banner on the gun being modified. */
  private handOf(save: SaveData, gun: ItemInstance): PartHand | 'bag' {
    if (save.equipment.weapon === gun.uid) return 'weapon'
    if (save.equipment.offhand === gun.uid && wornGun(save, 'offhand')?.uid === gun.uid) return 'offhand'
    return 'bag'
  }

  /**
   * 총 개조: the gun's slots and the bag's parts. Tap a part to fit it (same kind swaps), or drag
   * it onto a slot; tap 빼기 (or Alt+click a slot) to pull it; 부품 강화 spends salvage.
   */
  private modBox(save: SaveData, gun: ItemInstance): HTMLElement {
    const box = el('div', 'town-job town-mods')
    box.id = 'work-mods'
    const mods = gunMods(gun)
    const slots = modSlots(gun)
    const hand = this.handOf(save, gun)
    const where = hand === 'bag' ? '가방' : HAND_KO[hand]
    const banner = el('p', 'mod-which', `지금 개조: ${where} · ${itemName(gun)}`)
    banner.id = 'work-mod-which'
    box.append(banner)
    box.append(el('h4', '', `총 개조 ${mods.length}/${slots}칸`))
    box.append(el('small', '', `위쪽 주 손 · 보조 손을 누르면 총이 바뀌어 · 부품을 한 번 누르면 이 총에 끼워 · 칸의 빼기 / Alt+클릭으로 빼기 · 같은 종류는 서로 바뀌어 · 특수 부품은 서로 다른 것 ${MAX_TRICKS}개까지`))
    const row = el('div', 'mod-slots')
    const fit = (uid: string) => {
      const part = findItem(save, uid)
      const whereNow = `${where} ${itemName(gun)}`
      this.run(attachMod(save, gun.uid, uid), part ? `${whereNow}에 ${itemName(part)} 장착!` : `${whereNow}에 부품을 끼웠어!`, 'mod', gun)
    }
    for (let i = 0; i < MAX_MOD_SLOTS; i += 1) {
      const m = mods[i]
      const cell = el('div', `mod-slot${m ? ' on' : ''}${i >= slots ? ' locked' : ''}`)
      cell.dataset.slot = String(i)
      if (m) {
        cell.style.setProperty('--rar', RARITY_COLOR[m.rarity])
        cell.innerHTML = iconSvg(ITEMS[m.defId]?.icon, 26)
        if (modKind(m) === 'trick') cell.classList.add('trick')
        cell.append(el('b', '', modLabel(m)), el('small', '', `${RARITY_KO[m.rarity]} · ${m.affixes.map(formatAffix).join(' · ')}`))
        cell.title = `${itemLines(m).join('\n')}\n(Alt+클릭: 빼기)`
        cell.addEventListener('click', (e) => {
          if (e.altKey) this.run(detachMod(save, gun.uid, m.uid), `${itemName(m)}을(를) 뺐어.`, 'mod', gun)
        })
        const acts = el('div', 'mod-acts')
        acts.append(this.button('빼기', () => this.run(detachMod(save, gun.uid, m.uid), `${itemName(m)}을(를) 뺐어.`, 'mod', gun), { id: `work-mod-out-${i}` }))
        const up = modUpgradeCost(m)
        if (up) acts.append(this.button(`강화 ${costText(up)}`, () => this.run(upgradeMod(save, m.uid), `${modLabel(m)} 부품이 ${RARITY_KO[m.rarity]}(으)로!`, 'upgrade', gun), { disabled: !canPay(save, up), id: `work-mod-up-${i}` }))
        cell.append(acts)
      } else if (i < slots) cell.append(el('small', '', '빈 칸'))
      else cell.append(el('small', '', i < 4 && gun.itemLevel < MOD_SLOT_ILV ? `더 높은 등급 · iLv ${MOD_SLOT_ILV}` : '더 높은 등급'))
      if (i < slots) {
        cell.addEventListener('dragover', (e) => {
          e.preventDefault()
          cell.classList.add('over')
        })
        cell.addEventListener('dragleave', () => cell.classList.remove('over'))
        cell.addEventListener('drop', (e) => {
          e.preventDefault()
          const uid = e.dataTransfer?.getData('text/plain')
          if (uid) fit(uid)
        })
      }
      row.append(cell)
    }
    box.append(row)
    const parts = bagMods(save)
    box.append(el('h4', '', `가방 속 부품 ${parts.length}개`))
    if (!parts.length) box.append(el('small', '', '부품은 던전 몹·보물 상자·보스에게서 나와. (보스와 비밀 상자가 잘 줘)'))
    const list = el('div', 'mod-parts')
    parts.forEach((p, i) => {
      const swap = swapIndex(mods, p) >= 0
      const block = fitBlock(gun, p)
      const gain = newCombos(gun, p)
      const b = el('button', `mod-part${modKind(p) === 'trick' ? ' trick' : ''}${gain.length ? ' combo' : ''}`)
      b.type = 'button'
      b.id = `work-mod-part-${i}`
      b.draggable = true
      b.dataset.uid = p.uid
      b.style.setProperty('--rar', itemColor(p))
      b.innerHTML = iconSvg(ITEMS[p.defId]?.icon, 22)
      b.append(
        el('span', '', `${ITEMS[p.defId]?.name ?? p.defId} · ${itemRarityKo(p)}`),
        el('small', '', `${modLabel(p)} · ${p.affixes.map(formatAffix).join(' · ')}`),
        el('small', gain.length && !block ? 'mod-gain' : '', block ?? (gain.length ? `✦ ${gain.map((c) => c.name).join(' · ')} · ` : '') + `${swap ? '바꾸기' : '끼우기'} ${fitCost(p)}골드`),
      )
      b.title = itemLines(p).join('\n')
      if (block || save.gold < fitCost(p)) b.classList.add('no')
      b.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', p.uid))
      b.addEventListener('click', () => fit(p.uid))
      // Hover a part: its landing socket glows (the swap slot, or the next empty one).
      const target = swap ? swapIndex(mods, p) : mods.length
      b.addEventListener('mouseenter', () => row.querySelector(`[data-slot="${target}"]`)?.classList.add('target'))
      b.addEventListener('mouseleave', () => row.querySelector(`[data-slot="${target}"]`)?.classList.remove('target'))
      list.append(b)
    })
    box.append(list)
    box.append(this.comboBox(gun))
    return box
  }

  /** 부품 조합: what this gun has on, and the pairs still open to it. */
  private comboBox(gun: ItemInstance): HTMLElement {
    const box = el('div', 'mod-combos')
    box.id = 'work-combos'
    const on = new Set(gunCombos(gun).map((c) => c.id))
    const traits = gunTraits(gun)
    box.append(el('b', '', `부품 조합 ${on.size}/${COMBOS.length}`))
    for (const c of COMBOS) {
      const have = c.needs.filter((t) => traits.has(t)).length
      const row = el('div', `mod-combo${on.has(c.id) ? ' on' : have ? ' near' : ''}`)
      row.append(el('span', '', `${on.has(c.id) ? '✦' : '◇'} ${c.name}`), el('small', '', `${c.needs.map(traitName).join(' + ')} · ${c.text}`))
      box.append(row)
    }
    return box
  }

  // ---- 퀘스트 게시판 ----

  private renderBoard(save: SaveData, body: HTMLElement): void {
    const list = el('section', 'town-col town-board')
    body.append(list)
    this.renderChapter(save, list)
    const board = boardOf(save)
    const head = el('div', 'town-repeat-head')
    head.id = 'board-repeat-head'
    head.append(el('b', '', `${REPEAT_ICON} 반복 의뢰 · 하수도`), el('small', '', '끝내고 보상을 받아도 다음 원정 뒤 새로 붙어. 이야기 퀘스트가 HUD 에 먼저 보여.'))
    list.append(head)
    board.forEach((c, i) => list.append(this.contractCard(save, c, i)))
    const foot = el('div', 'inv-actions')
    foot.append(this.button('이야기 퀘스트 보기', () => {
      this.close()
      this.host.openStory()
    }, { id: 'board-story' }))
    foot.append(el('small', 'town-sub', `${REPEAT_ICON} 반복 의뢰 완료 ${townOf(save).contractsDone}회 · 맡지 않은 의뢰는 하수도에 다녀오면 바뀌어.`))
    list.append(foot)
  }

  /** 챕터 퀘스트: the story hunts on top of the board (take, track, turn in). */
  private renderChapter(save: SaveData, list: HTMLElement): void {
    const c = chaptersOf(save)
    const box = el('div', 'town-chapter')
    box.id = 'board-chapter'
    if (!chapter2Open(save)) {
      // 1장 중에는 다음 장 이름도, 퀘스트도 안 보여 준다.
      box.append(el('b', '', `1장 · ${CHAPTER_TITLE[1]}`), el('small', '', '가이드를 따라 깊이 1의 악몽 꽃을 쓰러뜨려 봐. 그다음 이야기는 그때 열려.'))
      list.append(box)
      return
    }
    if (!fieldOpen(save)) {
      box.append(el('b', '', `2장 · ${CHAPTER_TITLE[2]}`), el('small', '', '모찌와 꿈 미로를 지나 몽실 마을에 닿으면, 그곳 퀘스트가 여기 붙어.'))
      list.append(box)
      return
    }
    const prog = chapterProgress(save)
    const head = prog.claimed >= prog.total ? `몽실 들판 퀘스트 · 모두 완료!` : `몽실 들판 퀘스트 (${prog.claimed}/${prog.total}) · 2장 ${CHAPTER_TITLE[2]}${c.cleared.includes(2) ? ' 클리어' : ''}`
    box.append(el('b', 'town-chapter-head', head))
    box.append(el('small', '', '맡은 퀘스트는 몽실 마을 별문의 "몽실 들판"에서 진행돼. 끝나면 여기서 보상!'))
    const shown = CHAPTER2.filter((d) => c.quests[d.id].status !== 'locked' && c.quests[d.id].status !== 'claimed')
    if (!shown.length && c.cleared.includes(2)) box.append(el('small', '', '들판 퀘스트를 모두 마쳤어. 들판 사냥은 계속할 수 있어.'))
    for (const d of shown) {
      const q = c.quests[d.id]
      const card = el('div', `town-contract chapter s-${q.status}`)
      card.dataset.id = d.id
      card.append(el('b', '', d.title), el('small', '', d.text), el('small', '', `보상: ${questRewardText(d)}`))
      const bar = el('div', 'town-bar')
      const fill = el('span')
      fill.style.width = `${Math.round((q.progress / d.goal) * 100)}%`
      bar.append(fill)
      card.append(bar, el('small', 'town-prog', `${q.progress}/${d.goal}`))
      const row = el('div', 'inv-actions')
      if (q.status === 'offered') row.append(this.button('퀘스트 받기', () => this.run(takeQuest(save, d.id), `퀘스트 "${d.title}" 시작! 몽실 마을 별문 → 몽실 들판 · 퀘스트 줄을 누르면 길 안내`, 'take'), { primary: true, id: `chapter-take-${d.id}` }))
      else if (q.status === 'active') row.append(el('small', 'town-sub', '진행 중 · 몽실 들판에서'))
      else if (q.status === 'done')
        row.append(
          this.button('보상 받기', () => {
            const r = claimQuest(save, d.id)
            if (!r.ok) return this.run(r, '', 'claim')
            this.host.chapterClaimed?.(r.result, r.cleared)
            this.run(r, `"${d.title}" 완료!`, 'claim')
          }, { primary: true, id: `chapter-claim-${d.id}` }),
        )
      card.append(row)
      box.append(card)
    }
    list.append(box)
  }

  private contractCard(save: SaveData, c: Contract, i: number): HTMLElement {
    const card = el('div', `town-contract repeat s-${c.status}`)
    card.dataset.id = c.id
    card.dataset.kind = c.kind
    const runs = runsText(contractRuns(save, c.kind))
    card.append(el('span', 'repeat-badge', `${REPEAT_ICON} 반복${runs ? ` · ${runs}` : ''}`))
    card.append(el('b', '', `${REPEAT_ICON} ${contractTitle(c)}`))
    card.append(el('small', '', `보상: ${rewardText(c.reward)}`))
    const bar = el('div', 'town-bar')
    const fill = el('span')
    fill.style.width = `${Math.round((c.progress / c.goal) * 100)}%`
    bar.append(fill)
    card.append(bar, el('small', 'town-prog', `${c.progress}/${c.goal}`))
    const row = el('div', 'inv-actions')
    if (c.status === 'offered') row.append(this.button('맡기', () => this.run(takeContract(save, c.id), `${REPEAT_ICON} 반복 의뢰를 맡았어! 하수도에서 진행돼.`, 'take'), { primary: true, id: `board-take-${i}` }))
    else if (c.status === 'active') row.append(this.button('그만두기', () => this.run({ ok: dropContract(save, c.id) }, '의뢰를 게시판에 돌려놨어.', 'take'), { id: `board-drop-${i}` }))
    else if (c.status === 'done')
      row.append(
        this.button('보상 받기', () => {
          const r = claimContract(save, c.id)
          this.run(r, `${REPEAT_ICON} 반복 의뢰 완료! ${rewardText(c.reward)} · ${runsText(contractRuns(save, c.kind))}`, 'claim')
        }, { primary: true, id: `board-claim-${i}` }),
      )
    else row.append(el('small', 'town-sub', '보상을 받았어. 다음 원정 뒤 새 의뢰가 붙어.'))
    card.append(row)
    return card
  }

  // ---- 보관함 ----

  private codexPick = ''

  /** 전설 도감: seven cards (found ones in full, the rest as a silhouette + where to look). */
  private renderCodex(save: SaveData, body: HTMLElement): void {
    const left = el('section', 'town-col')
    const right = el('section', 'town-col town-side')
    body.append(left, right)
    const rows = codexRows(save)
    const found = rows.filter((r) => r.found).length
    const hh = el('h3', '', '유니크 ')
    hh.append(el('small', '', `${found}/${rows.length}`))
    left.append(hh)
    const grid = el('div', 'codex-grid')
    grid.id = 'codex-grid'
    if (!this.codexPick || !rows.some((r) => r.def.id === this.codexPick)) this.codexPick = rows[0].def.id
    rows.forEach((r, i) => {
      const b = el('button', `codex-card${r.found ? ' found' : ' unknown'}${this.codexPick === r.def.id ? ' picked' : ''}`)
      b.type = 'button'
      b.id = `codex-${i}`
      b.dataset.id = r.def.id
      const icon = el('span', 'codex-icon')
      icon.innerHTML = iconSvg(ITEMS[r.def.id]?.icon, 34)
      b.append(icon, el('b', '', r.found ? r.def.name : '???'), el('small', '', r.found ? `${r.count}번 획득` : r.def.where))
      b.addEventListener('click', () => {
        this.codexPick = r.def.id
        this.host.sfx('ui')
        this.render()
      })
      grid.append(b)
    })
    left.append(grid)
    const row = rows.find((r) => r.def.id === this.codexPick) ?? rows[0]
    const def = row.def
    const card = el('div', `codex-detail${row.found ? ' found' : ''}`)
    card.id = 'codex-detail'
    card.append(el('h3', '', row.found ? `★ ${def.name}` : '??? (아직 못 찾음)'))
    card.append(el('p', 'codex-sig', row.found ? def.signature : '어딘가에서 하얀 금빛 기둥이 솟는다고 해.'))
    const owned = [...save.items, ...townOf(save).stash].filter((it) => it.defId === def.id)
    const level = owned.reduce((m, it) => Math.max(m, it.itemLevel), 1)
    const list = el('ul', 'codex-stats')
    for (const a of legendAffixes(def, level)) list.append(el('li', '', row.found ? formatAffix(a) : formatAffix(a).replace(/[0-9.]+/g, '?')))
    card.append(el('small', 'codex-ilv', row.found ? `${ilvText(level)} 기준 옵션 (고정)` : '옵션은 찾으면 보여'), list)
    card.append(el('p', 'codex-where', `출처: ${def.where}`))
    for (const src of def.sources) {
      const pct = Math.round(legendChance(save, def, src) * 100)
      card.append(el('small', 'codex-odds', `${SOURCE_KO[src.kind]} 이번 확률 ${pct}%${row.found ? ' (이미 찾음: 낮아져)' : ' · 못 찾을수록 올라가'}`))
    }
    right.append(card)
  }

  private renderStash(save: SaveData, body: HTMLElement): void {
    const left = el('section', 'town-col')
    const right = el('section', 'town-col town-side')
    body.append(left, right)
    const bag = bagItems(save)
    const stash = townOf(save).stash
    const bh = el('h3', '', '가방 ')
    bh.append(el('small', '', `${bag.length}/${BAG_CAP}`))
    left.append(bh, bag.length ? this.grid(bag, 'bag') : el('p', 'inv-empty', '가방이 비었어.'))
    const sh = el('h3', '', '보관함 ')
    sh.append(el('small', '', `${stash.length}/${STASH_CAP}`))
    left.append(sh, stash.length ? this.grid(stash, 'stash') : el('p', 'inv-empty', '보관함이 비었어.'))
    const pick = this.picked
    const item = pick?.from === 'bag' ? findItem(save, pick.key) : pick?.from === 'stash' ? stash.find((i) => i.uid === pick.key) : undefined
    if (!item || !pick) {
      right.append(el('p', 'inv-empty', '물건을 눌러 넣거나 꺼내.'))
      return
    }
    right.append(this.itemCard(item, save))
    const row = el('div', 'inv-actions')
    if (pick.from === 'bag')
      row.append(
        this.button('보관함에 넣기', () => {
          const r = stashPut(save, item.uid)
          if (r.ok) this.picked = { from: 'stash', key: item.uid }
          this.run(r, '보관함에 넣었어.', 'stash', item)
        }, { primary: true, id: 'stash-put' }),
      )
    else
      row.append(
        this.button('가방으로 꺼내기', () => {
          const r = stashTake(save, item.uid)
          if (r.ok) this.picked = { from: 'bag', key: item.uid }
          this.run(r, '가방에 넣었어.', 'stash', item)
        }, { primary: true, id: 'stash-take' }),
      )
    right.append(row)
  }
}

/** The display line for one affix (same wording as the bag). */
function lineOf(item: ItemInstance, index: number): string {
  const lines = itemLines(item)
  // itemLines: slot, rarity, implicits..., affixes..., sell. Affixes sit just before the sell line.
  const start = lines.length - 1 - item.affixes.length
  return lines[start + index] ?? item.affixes[index].name
}
