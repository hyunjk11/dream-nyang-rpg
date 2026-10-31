/**
 * H: a help card with every key and what the materials are for. The one-line hint at the bottom
 * used to list twelve keys and vanish for good; now it is short and points here.
 */
import { MATERIAL_HELP, MATERIAL_KO } from '../data/items'

export const HELP_KEYS: [string, string][] = [
  ['WASD', '이동 (Shift 달리기)'],
  ['마우스', '시점 · 클릭으로 사격'],
  ['Space', '대시'],
  ['1–4', '스킬'],
  ['Q', '하트 사탕 먹기'],
  ['E', '대화 · 상자 열기'],
  ['G', '방금 주운 장비 바로 입기'],
  ['I / Tab', '가방 · 장비'],
  ['K', '스킬 나무'],
  ['M', '큰 지도 (던전)'],
  ['T', '마을로 귀환 (던전)'],
  ['H', '이 도움말'],
  ['Esc', '마우스 풀기 · 창 닫기'],
]

export class Help {
  readonly root: HTMLElement
  private shown = false

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'help'
    this.root.className = 'hidden'
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', '도움말')
    const keys = HELP_KEYS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')
    const mats = Object.entries(MATERIAL_KO)
      .map(([id, name]) => `<dt><b class="mat mat-${id}">${name}</b></dt><dd>${MATERIAL_HELP[id] ?? ''}</dd>`)
      .join('')
    this.root.innerHTML = `<div class="help-card"><h2>도움말</h2><div class="help-cols"><section><h3>조작</h3><dl>${keys}</dl></section><section><h3>재료</h3><dl class="help-mats">${mats}</dl><h3>장비 칸 읽기</h3><p>테두리 색 = 희귀도 (일반·고급·희귀·영웅·전설). 왼쪽 위 숫자 = 파워, ▲▼ = 입은 장비보다 좋음/나쁨, 오른쪽 아래 = 아이템 레벨.</p></section></div><button type="button" class="help-close">닫기 (H)</button></div>`
    this.root.querySelector('.help-close')?.addEventListener('click', () => this.toggle(false))
    parent.append(this.root)
    window.addEventListener('keydown', (event) => {
      const t = event.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (event.code === 'KeyH' && !event.repeat) this.toggle()
      else if (event.code === 'Escape' && this.shown) this.toggle(false)
    })
  }

  get isOpen(): boolean {
    return this.shown
  }

  toggle(on = !this.shown): void {
    this.shown = on
    this.root.classList.toggle('hidden', !on)
    if (on && document.pointerLockElement) document.exitPointerLock()
  }
}
