import { INTRO } from '../data/story'
import { questLog } from '../sim/quests'
import type { SaveData } from '../sim/types'
import { MATERIAL_HELP, MATERIAL_KO } from '../data/items'

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
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = text
  layer.append(el)
  window.setTimeout(() => el.classList.add('out'), 2800)
  window.setTimeout(() => el.remove(), 3400)
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
  el.classList.remove('show')
  void el.offsetWidth
  el.classList.add('show')
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
export function openQuestLog(save: SaveData, onClose: () => void): void {
  const el = $('quest-log')
  const body = $('quest-body')
  if (!el || !body) return
  body.innerHTML = questLog(save)
    .map((q) => `<article class="${q.statusKey}"><h3>${q.title}<em>${q.status}</em></h3><p>${q.summary}</p>${q.lines.map((l) => `<span>${l}</span>`).join('')}<small>보상: ${q.reward}</small></article>`)
    .join('')
  el.classList.remove('hidden')
  document.body.classList.add('menu')
  const close = () => {
    el.classList.add('hidden')
    document.body.classList.remove('menu')
    window.removeEventListener('keydown', onKey)
    onClose()
  }
  const onKey = (event: KeyboardEvent) => {
    if (['Escape', 'KeyE', 'Enter', 'Space'].includes(event.code)) {
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
