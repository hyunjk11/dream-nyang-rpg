import { INTRO } from '../data/story'
import { GROUP_KO, TRACK_CAP, pinsOf, questArchive, questBook, type QuestGroup } from '../sim/questbook'
import type { SaveData } from '../sim/types'
import { MATERIAL_HELP, MATERIAL_KO } from '../data/items'
import { diffMode, setDiffMode, type DiffMode } from '../combat/difficulty'

const $ = (id: string) => document.getElementById(id)

/** Title card over the key art: new game and continue. */
export function showTitle(base: string, canContinue: boolean, handlers: { fresh: () => void; resume: () => void }): void {
  const layer = $('title')
  if (!layer) return
  layer.style.backgroundImage = `url(${base}assets/title_bg.jpg)`
  layer.classList.remove('hidden')
  document.body.classList.add('menu')
  const cont = $('btn-continue') as HTMLButtonElement | null
  if (cont) cont.disabled = !canContinue
  const fresh = $('btn-new')
  if (fresh) fresh.onclick = () => handlers.fresh()
  if (cont) cont.onclick = () => canContinue && handlers.resume()
  wireDiffPick()
}

/** 쉬움 / 보통 / 어려움 on the title card (saved; foes spawned after a change use it). */
export function wireDiffPick(root: ParentNode = document): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('#diff-pick [data-diff]'))
  const paint = () => {
    for (const b of buttons) {
      const on = b.dataset.diff === diffMode()
      b.classList.toggle('on', on)
      b.setAttribute('aria-checked', String(on))
      b.setAttribute('role', 'radio')
    }
  }
  for (const b of buttons) b.onclick = () => {
    setDiffMode(b.dataset.diff as DiffMode)
    paint()
  }
  paint()
}

export function titleReady(ready: boolean, text: string): void {
  const status = $('title-status')
  if (status) status.textContent = text
  for (const id of ['btn-new', 'btn-continue']) {
    const b = $(id) as HTMLButtonElement | null
    if (b && id === 'btn-new') b.disabled = !ready
    if (b) b.classList.toggle('waiting', !ready)
  }
}

export function hideTitle(): void {
  $('title')?.classList.add('hidden')
}

/** The prologue: three painted slides, then she wakes on the island. */
export function playIntro(base: string, done: () => void): void {
  const layer = $('intro')
  const text = $('intro-text')
  const next = $('intro-next')
  const skip = $('intro-skip')
  if (!layer || !text || !next || !skip) {
    done()
    return
  }
  let index = 0
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    window.removeEventListener('keydown', onKey)
    layer.classList.add('hidden')
    document.body.classList.remove('menu')
    done()
  }
  const paint = () => {
    const slide = INTRO[index]
    layer.style.backgroundImage = `url(${base}assets/${slide.image}.jpg)`
    text.innerHTML = slide.text.replaceAll('\n', '<br>')
    next.textContent = index === INTRO.length - 1 ? '눈을 뜬다' : '다음'
    layer.classList.remove('fade-in')
    void layer.offsetWidth
    layer.classList.add('fade-in')
  }
  const step = () => {
    index += 1
    if (index >= INTRO.length) finish()
    else paint()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'Space' || event.code === 'Enter' || event.code === 'KeyE') {
      event.preventDefault()
      step()
    } else if (event.code === 'Escape') finish()
  }
  next.onclick = step
  skip.onclick = finish
  window.addEventListener('keydown', onKey)
  layer.classList.remove('hidden')
  paint()
}

/** Little stacked notices: quest updates, rewards, level ups. */
export function toast(text: string, kind: 'quest' | 'reward' | 'info' = 'info'): void {
  const layer = $('toasts')
  if (!layer) return
  // Completions coming in together fold into one toast ("… 외 2개") instead of a stack.
  const finished = kind === 'quest' && /완료!|달성!/.test(text)
  const live = finished ? layer.querySelector<HTMLElement>('.toast.quest.fin:not(.out)') : null
  if (live) {
    const n = Number(live.dataset.n ?? '1') + 1
    live.dataset.n = String(n)
    live.textContent = `${live.dataset.first ?? text} 외 ${n - 1}개`
    window.clearTimeout(Number(live.dataset.t1))
    window.clearTimeout(Number(live.dataset.t2))
    live.dataset.t1 = String(window.setTimeout(() => live.classList.add('out'), 2800))
    live.dataset.t2 = String(window.setTimeout(() => live.remove(), 3400))
    return
  }
  const el = document.createElement('div')
  el.className = `toast ${kind}${finished ? ' fin' : ''}`
  el.textContent = text
  if (finished) {
    el.dataset.first = text
    el.dataset.n = '1'
  }
  layer.append(el)
  el.dataset.t1 = String(window.setTimeout(() => el.classList.add('out'), 2800))
  el.dataset.t2 = String(window.setTimeout(() => el.remove(), 3400))
  while (layer.children.length > 4) layer.firstElementChild?.remove()
}

export function paintTracker(rows: { title: string; lines: string[] }[]): void {
  const el = $('tracker')
  if (!el) return
  el.innerHTML = rows.map((r) => `<b>${r.title}</b>${r.lines.map((l) => `<span>${l}</span>`).join('')}`).join('')
  el.classList.toggle('hidden', rows.length === 0)
}

const MAT_IDS = ['dream_dust', 'toy_part', 'star_shard']
const MAT_SHORT: Record<string, string> = { dream_dust: '꿈가루', toy_part: '부품', star_shard: '별조각' }

export function paintStats(save: SaveData): void {
  const gold = $('dust')
  if (gold) gold.textContent = `골드 ${save.gold}`
  const lv = $('lv')
  if (lv) lv.textContent = `Lv ${save.level}`
  const mats = $('mats')
  if (mats) {
    mats.innerHTML = MAT_IDS.map((id) => `<span title="${MATERIAL_KO[id]}: ${MATERIAL_HELP[id]}">${MAT_SHORT[id]} ${save.materials[id] ?? 0}</span>`).join(' · ')
  }
}

export function zoneBanner(name: string, sub: string): void {
  const el = $('zone-banner')
  if (!el) return
  el.innerHTML = `<b>${name}</b><small>${sub}</small>`
  playOnce(el, BANNER_MS)
}

/** Matches the 2.8 s `banner` animation in style.css (plus a frame). */
export const BANNER_MS = 2900
/** Matches the 2.6 s `lvl-pop` animation in style.css (plus a frame). */
export const LEVELUP_MS = 2700
const onceTimers = new WeakMap<HTMLElement, number>()

/**
 * Restart a one-shot `.show` animation (zone banner, level-up card) and drop `.show` when it ends.
 * The animations end at opacity 0, but a shown piece still takes room in the top-centre column and
 * gets re-measured by every HUD refit, which squeezed later toasts and replayed the pop.
 */
export function playOnce(el: HTMLElement, ms: number): void {
  el.classList.remove('show', 'squeezed')
  void el.offsetWidth
  el.classList.add('show')
  window.clearTimeout(onceTimers.get(el))
  onceTimers.set(el, window.setTimeout(() => el.classList.remove('show'), ms))
}

/** White dream-fade for portal hops: covers, runs the swap, then clears. */
export function fadeThrough(swap: () => void): Promise<void> {
  const el = $('fade')
  if (!el) {
    swap()
    return Promise.resolve()
  }
  el.classList.add('on')
  return new Promise((resolve) => {
    window.setTimeout(() => {
      swap()
      window.setTimeout(() => {
        el.classList.remove('on')
        resolve()
      }, 120)
    }, 420)
  })
}

/** The board's quest log (the open-quests action). */
const escHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/**
 * 퀘스트 수첩 (L, or the board's button): tabs 메인 / 이야기 / 의뢰. Each card: short title, one objective
 * line + count, where to turn it in, the reward, a 📌 to pin it on the HUD. Finished ones fold away.
 */
export function openQuestLog(save: SaveData, onClose: () => void, onPin?: (id: string) => boolean, tab?: QuestGroup): void {
  const el = $('quest-log')
  const body = $('quest-body')
  if (!el || !body) return
  let at: QuestGroup = tab ?? 'main'
  const paint = () => {
    const book = questBook(save)
    const done = questArchive(save)
    const pins = pinsOf(save)
    const groups: QuestGroup[] = ['main', 'story', 'bounty']
    const tabs = groups
      .map((g) => {
        const n = book.filter((q) => q.group === g).length
        return `<button type="button" role="tab" class="qtab${g === at ? ' on' : ''}" data-tab="${g}" aria-selected="${g === at}">${GROUP_KO[g]}${n ? ` <i>${n}</i>` : ''}</button>`
      })
      .join('')
    const live = book.filter((q) => q.group === at)
    const cards = live
      .map((q) => {
        const pin = q.group === 'main' ? '' : `<button type="button" class="qpin${pins.includes(q.id) ? ' on' : ''}" data-pin="${escHtml(q.id)}" aria-pressed="${pins.includes(q.id)}">${pins.includes(q.id) ? '📌 고정됨' : '📌 고정'}</button>`
        const state = q.ready ? `<em class="qready">완료 · ${escHtml(q.turnIn)}</em>` : q.prog ? `<em>${escHtml(q.prog)}</em>` : ''
        return `<article class="q ${q.group}${q.ready ? ' done' : ''}"><h3>${escHtml(q.title)}${pin}</h3><p>${escHtml(q.line)}${state}</p>${q.reward ? `<small>보상: ${escHtml(q.reward)}</small>` : ''}${!q.ready && q.turnIn ? `<small class="qturn">${escHtml(q.turnIn)}</small>` : ''}</article>`
      })
      .join('')
    const old = done.filter((d) => d.group === at)
    const archive = old.length ? `<details class="qdone"><summary>완료한 퀘스트 ${old.length}개</summary>${old.map((d) => `<div><b>${escHtml(d.title)}</b><small>${escHtml(d.note)}</small></div>`).join('')}</details>` : ''
    const empty = live.length ? '' : `<p class="qempty">${at === 'bounty' ? '맡은 의뢰가 없어. 마을 게시판에서 받아 봐.' : '지금 진행 중인 이야기가 없어.'}</p>`
    body.innerHTML = `<div class="qtabs" role="tablist">${tabs}</div><div class="qlist" role="tabpanel">${cards}${empty}${archive}</div><small class="qfoot">HUD에는 메인 + 고정·완료한 것 최대 ${TRACK_CAP}개가 보여</small>`
  }
  paint()
  body.onclick = (e) => {
    const t = e.target as HTMLElement
    const tb = t.closest<HTMLElement>('[data-tab]')
    if (tb) {
      at = tb.dataset.tab as QuestGroup
      paint()
      return
    }
    const pb = t.closest<HTMLElement>('[data-pin]')
    if (pb && onPin) {
      onPin(pb.dataset.pin ?? '')
      paint()
    }
  }
  el.classList.remove('hidden')
  document.body.classList.add('menu')
  const close = () => {
    el.classList.add('hidden')
    document.body.classList.remove('menu')
    window.removeEventListener('keydown', onKey)
    body.onclick = null
    onClose()
  }
  const onKey = (event: KeyboardEvent) => {
    if (['Escape', 'KeyE', 'KeyL', 'Enter'].includes(event.code)) {
      event.preventDefault()
      close()
    }
  }
  const btn = $('quest-close')
  if (btn) btn.onclick = close
  window.setTimeout(() => window.addEventListener('keydown', onKey), 50)
}

/** The night's end card after reporting the bloom to Luna. */
export function showEnding(save: SaveData, onContinue: () => void): void {
  const el = $('ending')
  const stats = $('ending-stats')
  if (!el) return
  const minutes = Math.max(1, Math.round(save.playSeconds / 60))
  if (stats) stats.textContent = `Lv ${save.level} · 골드 ${save.gold} · 꿈을 걸은 시간 ${minutes}분`
  el.classList.remove('hidden')
  document.body.classList.add('menu')
  const btn = $('ending-continue')
  if (btn)
    btn.onclick = () => {
      el.classList.add('hidden')
      document.body.classList.remove('menu')
      onContinue()
    }
}
