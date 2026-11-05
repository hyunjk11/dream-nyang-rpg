/**
 * H: a help card with every key and what the materials are for. The one-line hint at the bottom
 * used to list twelve keys and vanish for good; now it is short and points here.
 */
import { MATERIAL_HELP, MATERIAL_KO } from '../data/items'

export const HELP_KEYS: [string, string][] = [
  ['WASD', '이동 (Shift 달리기)'],
  ['마우스', '시점 · 클릭으로 사격'],
  ['Space', '대시'],
  ['R', '자동 달리기 켜기 · 끄기 (모바일: 스틱 두 번 톡)'],
  ['V', '자동 사냥 켜기 · 끄기 (전투 지역에서 조준·사격, 마을에서는 쉼)'],
  ['1–4', '스킬'],
  ['Q', '하트 사탕 먹기'],
  ['E', '대화 · 상자 열기'],
  ['G', '방금 주운 장비 바로 입기'],
  ['Alt', '마우스 커서 꺼내기'],
  ['I / Tab', '가방 · 장비'],
  ['K', '스킬 나무'],
  ['M', '큰 지도 (던전)'],
  ['T', '마을로 귀환 (던전)'],
  ['J', '가이드 펼치기 · 접기'],
  ['L', '퀘스트 수첩 (메인 · 이야기 · 의뢰, 고정)'],
  ['H', '이 도움말'],
  ['Esc', '마우스 풀기 · 창 닫기'],
]

/** Convenience features, listed under the keys (H). */
export const HELP_QOL: [string, string][] = [
  ['가방', '정렬 · 좋은 장비 입기(▲ 한 번에) · 판매 모드 · 분해 모드 · 보통 전부 분해 · 매직 이하 전부 판매'],
  ['판매', 'Shift+클릭(S) 판매 · Ctrl+클릭(X) 분해 · C 🔒 잠금 · Z 되돌리기 · 폰은 길게 누르기 · 희귀 이상은 한 번 더'],
  ['⚙', '자동 사탕(체력 30%↓) · 일반 자동 판매 · 자동 조준 · 자동 사냥 · 자동 품질'],
  ['자동 사냥', '위쪽 자동 버튼 또는 V · 가까운 괴물을 따라 조준하고 총을 쏨 · 마을·대화·메뉴에서는 쉼'],
  ['포털', '이야기 순서 (1장 → 2장) · 지난번 간 곳에 "지난번" 표시 · 🔒는 아직 못 가는 곳 · 귀환하면 별문 옆에 돌아가기 포털'],
  ['퀘스트', '퀘스트 줄을 누르면 바닥에 길 안내 · 지도 핀 · 거리'],
  ['조준', '⚙ 자동 조준: 조준선 근처 괴물에게 착 붙어 (모바일 기본)'],
  ['쓰러짐', '3초 뒤 자동으로 다시 일어나'],
]

/** Control hint: lines may wrap only at the " · " separators, never inside "M 지도". */
export function keepHintItems(text: string): string {
  return text
    .split(' · ')
    .map((item) => item.replace(/ /g, '\u00a0'))
    .join(' · ')
}

/** Words that read as a key at the front of a hint item ("I 가방" → <kbd>I</kbd> 가방). */
const HINT_KEY = /^(클릭|WASD|Space|Shift|Tab|Esc|Enter|[A-Z]|[0-9]–[0-9]|[0-9])\s+(.+)$/

/** The control hint as little key chips: one chip per " · " item, a <kbd> for its key. */
export function hintHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(' · ')
    .map((item) => {
      const m = HINT_KEY.exec(item)
      return m ? `<span class="hk"><kbd>${esc(m[1])}</kbd>${esc(m[2]).replace(/ /g, '\u00a0')}</span>` : `<span class="hk">${esc(item).replace(/ /g, '\u00a0')}</span>`
    })
    .join('')
}

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
    const qol = HELP_QOL.map(([k, v]) => `<dt><b>${k}</b></dt><dd>${v}</dd>`).join('')
    const mats = Object.entries(MATERIAL_KO)
      .map(([id, name]) => `<dt><b class="mat mat-${id}">${name}</b></dt><dd>${MATERIAL_HELP[id] ?? ''}</dd>`)
      .join('')
    this.root.innerHTML = `<div class="help-card"><h2>도움말</h2><div class="help-cols"><section><h3>조작</h3><dl>${keys}</dl><h3>편의 기능</h3><dl class="help-qol">${qol}</dl></section><section><h3>재료</h3><dl class="help-mats">${mats}</dl><h3>장비 칸 읽기</h3><p>테두리 색 = 희귀도 (보통 흰색·매직 초록·희귀 파랑·영웅 보라·전설 노랑·유니크 주황). 왼쪽 위 숫자 = 파워, ▲▼ = 입은 장비보다 좋음/나쁨, 오른쪽 아래 iLv = 아이템 레벨 (깊을수록, 층이 높을수록, 엘리트·보스일수록 높아).</p></section></div><button type="button" class="help-close">닫기 (H)</button></div>`
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
