/**
 * Chapter overlays: the guide prompt (top centre), a short 별하/모찌 line under it, the skip
 * offer for players who already know the ropes, and the chapter-clear card.
 */
import { CHAPTER_TITLE, guideHud } from '../sim/chapters'
import type { SaveData } from '../sim/types'
import { fitHud } from './layout'
import { chipText, foldHide, foldPoke, foldStep, foldToggle, foldView, freshFold, type GuideFold, type GuideView } from './guidefold'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

export class ChapterUI {
  private readonly panel: HTMLElement
  private readonly head: HTMLElement
  private readonly keys: HTMLElement
  private readonly count: HTMLElement
  private readonly line: HTMLElement
  private readonly chip: HTMLButtonElement
  private readonly close: HTMLButtonElement
  private lineTimer = 0
  private last = ''
  private lastView: GuideView | 'none' | '' = ''
  private fold: GuideFold = freshFold()
  private combat = false
  private active = false

  constructor(root: HTMLElement) {
    this.panel = el('div', 'hidden')
    this.panel.id = 'guide'
    this.head = el('b')
    this.keys = el('span')
    this.count = el('em')
    this.line = el('p', 'guide-line hidden')
    this.close = el('button', 'guide-x', '×')
    this.close.type = 'button'
    this.close.setAttribute('aria-label', '가이드 숨기기')
    this.close.dataset.tip = '가이드 숨기기\n다음 단계에서 다시 나와 · J로 다시 보기'
    this.panel.append(this.head, this.keys, this.count, this.close, this.line)
    this.chip = el('button', 'hidden')
    this.chip.id = 'guide-chip'
    this.chip.type = 'button'
    this.chip.dataset.tip = '가이드\n눌러서 펼치기 (J)'
    this.close.addEventListener('click', (e) => {
      e.stopPropagation()
      this.fold = foldHide(this.fold)
      this.apply(performance.now())
    })
    this.chip.addEventListener('click', () => this.toggle())
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ' && !e.repeat && this.active) this.toggle()
    })
    root.append(this.panel, this.chip)
  }

  /** J / chip: open the full card or fold it. */
  toggle(now = performance.now()): void {
    if (!this.active) return
    this.fold = foldToggle(this.fold, now)
    this.apply(now)
  }

  /** What the guide shows right now (QA and tests). */
  view(now = performance.now()): GuideView | 'none' {
    return this.active ? foldView(this.fold, now) : 'none'
  }

  /** Dev/QA: force the card open or folded. */
  force(v: 'full' | 'chip'): void {
    const now = performance.now()
    this.fold = { ...this.fold, hidden: false, pending: false, manual: v === 'full', until: v === 'full' ? now + 60_000 : 0 }
    this.apply(now)
  }

  /**
   * Repaint the prompt (cheap when nothing changed). `combat`: foes are on her, so the card stays folded.
   */
  paint(save: SaveData | null, touch: boolean, show: boolean, combat = false, now = performance.now()): void {
    const g = save && show ? guideHud(save, touch) : null
    this.combat = combat
    this.active = !!g
    if (g) this.fold = foldStep(this.fold, now, g.head, g.count, combat)
    const text = g ? `${g.head}|${g.keys}|${g.count}` : ''
    if (text !== this.last) {
      const stepChanged = g && this.last.split('|')[0] !== g.head
      this.last = text
      document.body.classList.toggle('guiding', !!g)
      if (g) {
        this.head.textContent = g.head
        this.keys.textContent = g.keys
        this.count.textContent = g.count
        this.chip.textContent = `📜 ${chipText(g.head, g.count)}`
        if (stepChanged) {
          this.panel.classList.remove('pop')
          void this.panel.offsetWidth
          this.panel.classList.add('pop')
        }
      }
    }
    this.apply(now)
  }

  private apply(now: number): void {
    const v: GuideView | 'none' = this.active ? foldView(this.fold, now) : 'none'
    if (v === this.lastView) return
    this.lastView = v
    this.panel.classList.toggle('hidden', v !== 'full')
    // The chip waits in the corner while the card is open, for when the layout has no room for the card.
    this.chip.classList.toggle('hidden', v === 'off' || v === 'none')
    this.chip.classList.toggle('standby', v === 'full')
    this.chip.setAttribute('aria-expanded', String(v === 'full'))
    // Re-fit now, so a card that would reach the crosshair never shows for even a frame.
    fitHud()
  }

  /** A short line from 별하 or 모찌 under the prompt (fades by itself). */
  say(who: string, text: string): void {
    this.line.innerHTML = ''
    this.line.append(el('b', who === '별하' ? 'byeolha' : 'mochi', who), document.createTextNode(` ${text}`))
    this.line.classList.remove('hidden')
    this.fold = foldPoke(this.fold, performance.now(), this.combat)
    this.apply(performance.now())
    window.clearTimeout(this.lineTimer)
    this.lineTimer = window.setTimeout(() => this.line.classList.add('hidden'), 5200)
  }

  /** Card over the game; resolves with the button picked. */
  private card(id: string, title: string, sub: string, lines: string[], buttons: { text: string; primary?: boolean; id: string }[]): Promise<string> {
    document.getElementById(id)?.remove()
    const wrap = el('div', 'chapter-card')
    wrap.id = id
    const box = el('div', 'chapter-box')
    box.append(el('small', 'chapter-kicker', sub), el('h2', '', title))
    for (const l of lines) box.append(el('p', '', l))
    const row = el('div', 'chapter-actions')
    box.append(row)
    wrap.append(box)
    document.body.append(wrap)
    return new Promise((resolve) => {
      for (const b of buttons) {
        const btn = el('button', b.primary ? 'primary' : '', b.text)
        btn.type = 'button'
        btn.id = b.id
        btn.addEventListener('click', () => {
          wrap.remove()
          resolve(b.id)
        })
        row.append(btn)
      }
    })
  }

  /** Existing players: skip the guide chapter or walk through it. */
  skipCard(): Promise<boolean> {
    return this.card(
      'chapter-skip',
      '가이드 챕터를 건너뛸까?',
      '챕터 1 · 가이드 챕터',
      ['이미 꿈 하수도에 다녀온 기록이 있어.', '건너뛰면 바로 챕터 2 "몽실 들판" 퀘스트가 열려. 설정에서 언제든 건너뛸 수도 있어.'],
      [
        { text: '건너뛰기', primary: true, id: 'chapter-skip-yes' },
        { text: '가이드 따라가기', id: 'chapter-skip-no' },
      ],
    ).then((id) => id === 'chapter-skip-yes')
  }

  /** Chapter n cleared. */
  clearCard(n: number): Promise<void> {
    const next = CHAPTER_TITLE[n + 1]
    const lines =
      n === 1
        ? ['별하: 해냈다… 꿈이 조금 밝아진 것 같아.', '모찌: 별문에서 "꿈 미로"로 가자냥! 미로 끝에 새 마을이 있대.']
        : ['몽이: 몽실 마을의 등불이 전부 다시 켜졌어요!', '별하: 꿈 바깥에서… 누가 내 이름을 불렀어.', '모찌: 그 목소리, 따라가 보자냥.']
    const tail = n === 2 ? `챕터 3 "${next ?? ''}" 열림 · 다음 꿈에서 이어져요` : next ? `챕터 ${n + 1} "${next}" 열림` : '다음 챕터는 준비 중이야'
    return this.card('chapter-clear', `챕터 ${n} 클리어!`, `챕터 ${n} · ${CHAPTER_TITLE[n] ?? ''}`, [...lines, tail], [{ text: '좋아!', primary: true, id: 'chapter-clear-ok' }]).then(() => undefined)
  }
}
