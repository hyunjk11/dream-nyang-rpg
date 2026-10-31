/** The run summary card shown in the village after a trip down the dream sewer. */
import { formatTime, floorLabel, type DelveSummary } from '../sim/delve'
import { RARITY_COLOR, type Rarity } from '../sim/types'

const TITLE: Record<DelveSummary['end'], string> = {
  clear: '탐험 완료!',
  recall: '무사히 귀환',
  down: '꿈에서 깼어…',
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** Stacks repeats ("꿈가루 ×2" + "꿈가루 ×1" → "꿈가루 ×3", three 하트 사탕 → "하트 사탕 ×3"), gear first. */
export function groupLoot(loot: DelveSummary['loot']): DelveSummary['loot'] {
  const map = new Map<string, { name: string; rarity: string; n: number }>()
  for (const l of loot) {
    const m = /^(.*) ×(\d+)$/.exec(l.name)
    const base = m ? m[1] : l.name
    const key = `${l.rarity}|${base}`
    const cur = map.get(key) ?? { name: base, rarity: l.rarity, n: 0 }
    cur.n += m ? Number(m[2]) : 1
    map.set(key, cur)
  }
  const rank = (r: string) => (r === 'material' ? 2 : r === 'potion' ? 1 : 0)
  return [...map.values()]
    .sort((a, b) => rank(a.rarity) - rank(b.rarity))
    .map((g) => ({ name: g.n > 1 ? `${g.name} ×${g.n}` : g.name, rarity: g.rarity }) as DelveSummary['loot'][number])
}

/** Plain-text lines (also what the QA reads). */
export function summaryLines(s: DelveSummary): { sub: string; stats: [string, string, string?][] } {
  const where = floorLabel(s.depth, s.floor)
  const sub =
    s.end === 'clear'
      ? s.unlocked
        ? `깊이 ${s.depth}의 악몽 꽃을 쓰러뜨렸어! 이제 별문에서 깊이 ${s.unlocked}로 갈 수 있어.`
        : `깊이 ${s.depth}의 악몽 꽃을 다시 쓰러뜨렸어!`
      : s.end === 'recall'
        ? `${where}에서 돌아왔어. 별문에서 이어서 갈 수 있어.`
        : `${where}에서 쓰러졌어. 골드를 조금 흘렸지만 물건은 다 챙겼어.`
  const stats: [string, string, string?][] = [
    ['도달', where],
    ['지난 층', `${s.floorsCleared}층`],
    ['처치', s.elites ? `${s.kills}마리 (정예 ${s.elites})` : `${s.kills}마리`],
    ['시간', formatTime(s.seconds)],
    ['골드', `+${s.gold}`],
  ]
  if (s.xp) stats.push(['경험치', `+${s.xp}${s.level ? ` (Lv ${s.level})` : ''}`])
  if (s.lost) stats.push(['흘린 골드', `-${s.lost}`, 'lost'])
  return { sub, stats }
}

export function showSummary(s: DelveSummary, onClose: () => void): void {
  const el = document.getElementById('summary')
  if (!el) {
    onClose()
    return
  }
  const { sub, stats } = summaryLines(s)
  const set = (id: string, html: string) => {
    const n = document.getElementById(id)
    if (n) n.innerHTML = html
  }
  set('summary-title', TITLE[s.end])
  set('summary-sub', esc(sub))
  set('summary-stats', stats.map(([k, v, cls]) => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(v)}</dd>`).join(''))
  const loot = s.loot.length
    ? groupLoot(s.loot)
        .map((l) => {
          const color = l.rarity === 'potion' ? '#ffb8d6' : l.rarity === 'material' ? '#b8f0ff' : RARITY_COLOR[l.rarity as Rarity]
          return `<li style="color:${color}">${esc(l.name)}</li>`
        })
        .join('')
    : '<li class="none">이번엔 빈손이야. 다음엔 꼭!</li>'
  set('summary-loot', loot)
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
  const btn = document.getElementById('summary-close')
  if (btn) btn.onclick = close
  window.setTimeout(() => window.addEventListener('keydown', onKey), 300)
}
