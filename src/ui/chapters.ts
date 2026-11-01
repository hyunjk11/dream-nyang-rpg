/**
 * Chapter overlays: the guide prompt (top centre), a short 별하/모찌 line under it, the skip
 * offer for players who already know the ropes, and the chapter-clear card.
 */
import { CHAPTER_TITLE, guideHud } from '../sim/chapters'
import type { SaveData } from '../sim/types'

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
  private lineTimer = 0
  private last = ''

  constructor(root: HTMLElement) {
    this.panel = el('div', 'hidden')
    this.panel.id = 'guide'
    this.head = el('b')
    this.keys = el('span')
    this.count = el('em')
    this.line = el('p', 'guide-line hidden')
    this.panel.append(this.head, this.keys, this.count, this.line)
    root.append(this.panel)
  }

  /** Repaint the prompt (cheap when nothing changed). */
  paint(save: SaveData | null, touch: boolean, show: boolean): void {
    const g = save && show ? guideHud(save, touch) : null
    const text = g ? `${g.head}|${g.keys}|${g.count}` : ''
    if (text === this.last) return
    const stepChanged = g && this.last.split('|')[0] !== g.head
    this.last = text
    this.panel.classList.toggle('hidden', !g)
    document.body.classList.toggle('guiding', !!g)
    if (!g) return
    this.head.textContent = g.head
    this.keys.textContent = g.keys
    this.count.textContent = g.count
    if (stepChanged) {
      this.panel.classList.remove('pop')
      void this.panel.offsetWidth
      this.panel.classList.add('pop')
    }
  }

  /** A short line from 별하 or 모찌 under the prompt (fades by itself). */
  say(who: string, text: string): void {
    this.line.innerHTML = ''
    this.line.append(el('b', who === '별하' ? 'byeolha' : 'mochi', who), document.createTextNode(` ${text}`))
    this.line.classList.remove('hidden')
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
        ? ['별하: 해냈다… 꿈이 조금 밝아진 것 같아.', '모찌: 이제 게시판에서 챕터 2 퀘스트를 받아 봐냥! 별문 → 몽실 들판.']
        : ['모찌: 몽실 들판이 다시 폭신해졌어!', '별하: 다음 꿈도 같이 가자, 모찌.']
    return this.card('chapter-clear', `챕터 ${n} 클리어!`, `챕터 ${n} · ${CHAPTER_TITLE[n] ?? ''}`, [...lines, next && n < 2 ? `챕터 ${n + 1} "${next}" 열림` : '다음 챕터는 준비 중이야'], [{ text: '좋아!', primary: true, id: 'chapter-clear-ok' }]).then(() => undefined)
  }
}
