/**
 * Town service panels over the canvas (one dialog, four faces):
 *  - 포포 상점: sweets and scrolls, today's shelf, selling from the bag and buy-back.
 *  - 키키 공방: gun upgrades (+1..+10), one-affix rerolls, element swaps.
 *  - 퀘스트 게시판: three repeatable contracts to take, track and claim.
 *  - 보관함: the chest by the house.
 * Every change goes through sim/ (town, workshop, contracts); the host re-applies the build.
 */
import { ITEMS, MATERIAL_HELP, MATERIAL_KO } from '../data/items'
import { boardOf, claimContract, contractTitle, dropContract, rewardText, takeContract, type Contract } from '../sim/contracts'
import { addItem, bagItems, findItem, isEquipped } from '../sim/inventory'
import { itemLines, itemName, itemPower, plusOf, sellValue, upgradeMul } from '../sim/loot'
import { fillCell, nameTitle } from './itemcell'
import { buyBack, buyConsumable, buyStock, consumableCount, CONSUMABLES, RESTOCK_COST, restock, sellItem, shopStock, STASH_CAP, stashPut, stashTake, townOf } from '../sim/town'
import { canPay, changeElement, ELEMENT_COST, elementOf, MAX_PLUS, rerollAffix, rerollAffixCost, rerollChoices, upgradeCost, upgradeGun, type Cost } from '../sim/workshop'
import { BAG_CAP, type Element, type ItemInstance, type SaveData } from '../sim/types'
import { compareEquip } from './inventory'

export type TownPanel = 'shop' | 'workshop' | 'board' | 'stash'

export type TownSuccess = 'buy' | 'sell' | 'upgrade' | 'reroll' | 'element' | 'take' | 'claim' | 'stash'

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
}

const TITLE: Record<TownPanel, string> = { shop: '포포 상점', workshop: '키키의 총 공방', board: '퀘스트 게시판', stash: '별하의 보관함' }
const SUB: Record<TownPanel, string> = {
  shop: '하수도에 다녀올 때마다 진열대가 바뀌어.',
  workshop: '강화는 실패하지 않아. 대신 갈수록 비싸져!',
  board: '의뢰는 하수도에서 진행되고, 돌아오면 여기서 보상을 받아.',
  stash: '가방이 꽉 차면 여기에 넣어 둬.',
}

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
    const h = el('h2', 'town-title', TITLE[this.panel])
    head.append(h, el('small', 'town-sub', SUB[this.panel]))
    const wallet = el('span', 'town-wallet')
    wallet.id = 'town-gold'
    wallet.append(`골드 ${save.gold}`)
    for (const m of ['dream_dust', 'toy_part', 'star_shard']) {
      const tag = el('span', 'mat', `${MATERIAL_KO[m]} ${save.materials[m] ?? 0}`)
      tag.title = MATERIAL_HELP[m] ?? ''
      wallet.append(' · ', tag)
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
    else this.renderStash(save, body)
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
    if (plusOf(item) > 0) b.append(el('small', 'plus', `+${plusOf(item)}`))
    if (price !== undefined) b.append(el('small', 'price', sold ? '팔림' : `${price}`))
    if (sold) b.classList.add('sold')
    if (this.picked?.from === from && this.picked.key === item.uid) b.classList.add('picked')
    b.addEventListener('click', () => {
      this.picked = { from, key: item.uid }
      this.host.sfx('ui')
      this.render()
    })
    return b
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
    box.append(h, el('p', 'inv-sub', `아이템 레벨 ${item.itemLevel} · 파워 ${itemPower(item)}${plusOf(item) ? ` · 강화 +${plusOf(item)} (총 피해 ×${upgradeMul(plusOf(item)).toFixed(2)})` : ''}`))
    const ul = el('ul', 'inv-lines')
    for (const line of itemLines(item)) ul.append(el('li', '', line))
    box.append(ul)
    // How it would change her stats if worn (shop shelf and stash too).
    const trial = structuredClone(save)
    if (!findItem(trial, item.uid)) addItem(trial, structuredClone(item), true)
    if (!isEquipped(trial, item.uid)) {
      const rows = compareEquip(trial, item.uid)
      if (rows.length) {
        box.append(el('h4', '', '지금 장비와 비교'))
        const cmp = el('ul', 'inv-compare')
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
    return [...worn.sort(gunsFirst), ...bagItems(save).sort(gunsFirst)]
  }

  private renderWorkshop(save: SaveData, body: HTMLElement): void {
    const left = el('section', 'town-col')
    const right = el('section', 'town-col town-side')
    body.append(left, right)
    const items = this.workItems(save)
    left.append(el('h3', '', '맡길 물건 (착용 중 → 가방)'))
    left.append(this.grid(items, 'work'))
    left.append(el('p', 'inv-empty', '강화: 총만 · 옵션 재굴림: 모든 장비 · 속성 변경: 속성 옵션이 붙은 총'))
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
        box.append(el('small', '', `총 피해 ×${upgradeMul(plusOf(item)).toFixed(2)} → ×${upgradeMul(plusOf(item) + 1).toFixed(2)} · ${costText(cost)}`))
        box.append(this.button(`+${plusOf(item) + 1} 강화하기`, () => this.run(upgradeGun(save, item.uid), `${itemName(item)}! 반짝반짝 강화 성공!`, 'upgrade', item), { primary: true, disabled: !canPay(save, cost), id: 'work-upgrade' }))
      } else box.append(el('small', '', '최고 단계야. 더는 반짝일 수 없어!'))
      right.append(box)
    }

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

  // ---- 퀘스트 게시판 ----

  private renderBoard(save: SaveData, body: HTMLElement): void {
    const list = el('section', 'town-col town-board')
    body.append(list)
    const board = boardOf(save)
    board.forEach((c, i) => list.append(this.contractCard(save, c, i)))
    const foot = el('div', 'inv-actions')
    foot.append(this.button('이야기 퀘스트 보기', () => {
      this.close()
      this.host.openStory()
    }, { id: 'board-story' }))
    foot.append(el('small', 'town-sub', `완료한 의뢰 ${townOf(save).contractsDone}개 · 맡지 않은 의뢰는 하수도에 다녀오면 바뀌어.`))
    list.append(foot)
  }

  private contractCard(save: SaveData, c: Contract, i: number): HTMLElement {
    const card = el('div', `town-contract s-${c.status}`)
    card.dataset.id = c.id
    card.dataset.kind = c.kind
    card.append(el('b', '', contractTitle(c)))
    card.append(el('small', '', `보상: ${rewardText(c.reward)}`))
    const bar = el('div', 'town-bar')
    const fill = el('span')
    fill.style.width = `${Math.round((c.progress / c.goal) * 100)}%`
    bar.append(fill)
    card.append(bar, el('small', 'town-prog', `${c.progress}/${c.goal}`))
    const row = el('div', 'inv-actions')
    if (c.status === 'offered') row.append(this.button('맡기', () => this.run(takeContract(save, c.id), '의뢰를 맡았어! 하수도에서 진행돼.', 'take'), { primary: true, id: `board-take-${i}` }))
    else if (c.status === 'active') row.append(this.button('그만두기', () => this.run({ ok: dropContract(save, c.id) }, '의뢰를 게시판에 돌려놨어.', 'take'), { id: `board-drop-${i}` }))
    else if (c.status === 'done')
      row.append(
        this.button('보상 받기', () => {
          const r = claimContract(save, c.id)
          this.run(r, `의뢰 완료! ${rewardText(c.reward)}`, 'claim')
        }, { primary: true, id: `board-claim-${i}` }),
      )
    else row.append(el('small', 'town-sub', '보상을 받았어. 다음 원정 뒤 새 의뢰가 붙어.'))
    card.append(row)
    return card
  }

  // ---- 보관함 ----

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
