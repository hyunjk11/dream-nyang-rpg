/**
 * HUD layout system. Every HUD piece lives in one of five zones, so pieces stack inside a zone
 * instead of being pinned to magic pixel offsets that collide on other screen sizes:
 *
 *   ┌ top bar (HP · Lv · XP · gold · ⚙) ───────────────────────────────┐
 *   │ tl: tracker / delve   │ tc: wave · boss bar · banners · │ tr: minimap │
 *   │                       │     guide · note · toasts        │  quest HUD  │
 *   │                                                                    │
 *   │ bl: loot toasts       (arena: crosshair, damage numbers, arrows)    │
 *   │     bag · candy                                       br: skills    │
 *   │     stick                                                actions   │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * The run code and the chapter UI append their pieces to #ui as before; a MutationObserver moves
 * any known id into its zone. CSS handles breakpoints (narrow portrait stacks tl/tr over tc) and
 * safe areas; JS only measures the bottom clusters so the top columns stop above them.
 */

export type Zone = 'tl' | 'tc' | 'tr' | 'bl' | 'br' | 'pocket'

/** Which zone each HUD id belongs to (order inside a zone comes from the CSS `order`). */
export const ZONE_OF: Record<string, Zone> = {
  tracker: 'tl',
  delve: 'tl',
  'guide-chip': 'tl',
  wave: 'tc',
  bossbar: 'tc',
  'zone-banner': 'tc',
  levelup: 'tc',
  guide: 'tc',
  note: 'tc',
  toasts: 'tc',
  minimap: 'tr',
  'contract-hud': 'tr',
  waypoint: 'tr',
  'loot-toasts': 'bl',
  stick: 'bl',
  hotbar: 'br',
  actions: 'br',
  'bag-btn': 'pocket',
  candy: 'pocket',
}

/** Zone for an element by id, or null when it floats freely (world tags, arrows, overlays). */
export function zoneFor(el: Element): Zone | null {
  return (el.id && ZONE_OF[el.id]) || null
}

/** Where the bag/candy pocket sits: above the stick on the thumb layout, bottom-right otherwise. */
export function pocketHome(compact: boolean): 'bl' | 'br' {
  return compact ? 'bl' : 'br'
}

/** Rects for the arena (the free middle of the screen) from the zone edges. Pure for tests. */
export function arenaOf(view: { w: number; h: number }, topBottom: number, bottomTop: number, pad = 18): { cx: number; cy: number; rx: number; ry: number } {
  const top = Math.min(Math.max(topBottom, 0) + pad, view.h * 0.45)
  const bottom = Math.max(Math.min(bottomTop, view.h) - pad, view.h * 0.55)
  return { cx: view.w / 2, cy: (top + bottom) / 2, rx: Math.max(40, view.w / 2 - pad - 12), ry: Math.max(30, (bottom - top) / 2) }
}

let zones: Record<'top' | Exclude<Zone, 'pocket'> | 'pocket', HTMLElement> | null = null
let compactNow = false

function make(id: string, parent: HTMLElement): HTMLElement {
  const z = document.createElement('div')
  z.id = id
  z.className = 'hud-zone'
  parent.append(z)
  return z
}

function adopt(el: Element): void {
  if (!zones) return
  const zone = zoneFor(el)
  if (!zone) return
  const home = zone === 'pocket' ? zones.pocket : zones[zone]
  if (el.parentElement !== home) home.append(el)
}

/** Build the zones in #ui and keep pieces in them. Safe to call once. */
export function installLayout(ui: HTMLElement | null): void {
  if (!ui || zones || typeof document === 'undefined') return
  const top = make('hud-top', ui)
  zones = {
    top,
    tl: make('hud-tl', top),
    tc: make('hud-tc', top),
    tr: make('hud-tr', top),
    bl: make('hud-bl', ui),
    br: make('hud-br', ui),
    pocket: document.createElement('div'),
  }
  zones.pocket.id = 'hud-pocket'
  zones.pocket.className = 'hud-zone'
  placePocket(document.body.classList.contains('compact'))
  for (const el of Array.from(ui.children)) adopt(el)
  new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach((n) => n instanceof Element && adopt(n))
  }).observe(ui, { childList: true })
  const measure = () => {
    if (!zones) return
    ui.style.setProperty('--bl-h', `${Math.ceil(zones.bl.getBoundingClientRect().height)}px`)
    ui.style.setProperty('--br-h', `${Math.ceil(zones.br.getBoundingClientRect().height)}px`)
  }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(measure)
    ro.observe(zones.bl)
    ro.observe(zones.br)
  }
  measure()
  // Re-fit when toasts, loot cards, the guide or the quest list change, and a slow safety tick.
  // Text-only changes (wave counter, timers) are frequent in a fight, so fits are rate-limited:
  // at most one every FIT_GAP ms (fitHud reads layout for every HUD piece).
  let queued = false
  let lastFit = -1e9
  const soon = () => {
    if (queued) return
    queued = true
    const wait = Math.max(0, FIT_GAP - (performance.now() - lastFit))
    const run = () => {
      queued = false
      lastFit = performance.now()
      fitHud()
    }
    if (wait <= 0) requestAnimationFrame(run)
    else window.setTimeout(() => requestAnimationFrame(run), wait)
  }
  // A new toast / banner, or the quest popover opening, is fitted before the next paint (the
  // observer runs as a microtask), so it never flashes over the crosshair; text ticks stay throttled.
  const now = () => {
    lastFit = performance.now()
    fitHud()
  }
  const watch = new MutationObserver((records) => {
    if (zones && records.some((r) => urgentFit(r, zones!.tc))) now()
    else soon()
  })
  for (const z of [zones.tc, zones.tl, zones.tr, zones.bl]) watch.observe(z, { childList: true, subtree: true, characterData: true })
  for (const id of ['guide', 'bossbar', 'wave', 'delve', 'tracker', 'contract-hud', 'zone-banner', 'levelup', 'note']) {
    const el = document.getElementById(id)
    if (el) watch.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  }
  window.addEventListener('resize', () => {
    arenaCache.clear()
    soon()
  })
  window.setInterval(soon, 600)
}

/** Least ms between two HUD fits. */
export const FIT_GAP = 150
/** How long a measured arrow arena stays valid (ms); fits and resizes refresh it early. */
export const ARENA_TTL = 250

/** Keeps one computed value for `ttl` ms (pure clock injected, tested). */
export class TtlCache<T> {
  private value: T | null = null
  private at = -1e18
  /** Recomputes so far (tests / QA). */
  misses = 0
  constructor(private readonly ttl: number) {}

  get(now: number, make: () => T): T {
    if (this.value === null || now - this.at >= this.ttl) {
      this.value = make()
      this.at = now
      this.misses += 1
    }
    return this.value
  }

  clear(): void {
    this.value = null
  }
}

const arenaCache = new TtlCache<{ cx: number; cy: number; rx: number; ry: number }>(ARENA_TTL)

export type Box = { left: number; top: number; right: number; bottom: number }

/** Do two boxes overlap by more than `slack` px on both axes? */
export function boxHit(a: Box, b: Box, slack = 2): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > slack && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > slack
}

/**
 * Pull an edge arrow (centre px, half size) toward the arena centre until it clears every HUD box,
 * at most to 40% of the way. Returns where it ended (the last try when nothing is clear).
 */
export function nudgeIn(x: number, y: number, cx: number, cy: number, half: number, boxes: Box[]): { x: number; y: number; clear: boolean } {
  for (let t = 1; t >= 0.4 - 1e-9; t -= 0.06) {
    const px = cx + (x - cx) * t
    const py = cy + (y - cy) * t
    const me = { left: px - half, top: py - half, right: px + half, bottom: py + half }
    if (!boxes.some((b) => boxHit(me, b, 0))) return { x: px, y: py, clear: true }
  }
  return { x: cx + (x - cx) * 0.4, y: cy + (y - cy) * 0.4, clear: false }
}

/**
 * Pick which short-lived pieces to hide when the screen is too small for all of them: given the
 * candidates (lowest priority first) and which of them collide, the lowest-priority colliding one goes.
 */
export function squeezeVictim(order: string[], colliding: Set<string>): string | null {
  for (const id of order) if (colliding.has(id)) return id
  return null
}

/**
 * Keep-out box around the crosshair (screen centre): no HUD piece may sit here, so aiming is never
 * covered. Wider/taller on big screens, never smaller than the crosshair's spread plus a margin.
 */
export function aimZone(w: number, h: number): Box {
  const hw = Math.min(150, Math.max(56, w * 0.12))
  const hh = Math.min(100, Math.max(40, h * 0.1))
  return { left: w / 2 - hw, right: w / 2 + hw, top: h / 2 - hh, bottom: h / 2 + hh }
}

/**
 * The opened quest popover (small screens) must not reach the crosshair keep-out box: shorten it
 * (rows scroll) when there is room above the box, else narrow it to the strip beside the box.
 */
export function popoverFit(r: Box, aim: Box, minHeight = 60, minWidth = 150): { maxHeight: number | null; width: number | null } {
  if (!boxHit(r, aim, 0)) return { maxHeight: null, width: null }
  const beside = Math.floor(r.right - aim.right - 6)
  const above = Math.floor(aim.top - r.top - 6)
  if (beside >= minWidth) return { maxHeight: null, width: beside }
  if (above >= minHeight) return { maxHeight: above, width: null }
  return { maxHeight: Math.max(0, above), width: Math.max(0, beside) }
}

function fitPopover(aim: Box): void {
  const el = document.getElementById('contract-hud')
  if (!el) return
  el.style.maxHeight = ''
  el.style.width = ''
  if (!el.classList.contains('open') || getComputedStyle(el).position !== 'absolute') return
  const fit = popoverFit(el.getBoundingClientRect(), aim)
  if (fit.maxHeight !== null) el.style.maxHeight = `${fit.maxHeight}px`
  if (fit.width !== null) el.style.width = `${fit.width}px`
}

/** Pieces that always stay (fixed HUD). */
const SOLID = ['#ui .top', '#tracker', '#delve', '#wave', '#bossbar', '#guide', '#minimap', '#contract-hud', '#waypoint', '#hud-pocket > *', '#stick', '#hotbar > *', '#actions > button', '#hint', '#relock', '#dialog']
let solidBoxes: Box[] = []

function seen(el: Element): DOMRect | null {
  let n: Element | null = el
  while (n && n !== document.body) {
    const cs = getComputedStyle(n)
    if (cs.display === 'none' || cs.visibility === 'hidden') return null
    n = n.parentElement
  }
  const r = el.getBoundingClientRect()
  return r.width > 1 && r.height > 1 ? r : null
}

type FitRecord = Pick<MutationRecord, 'type' | 'addedNodes' | 'oldValue'> & { target: Node }

/**
 * Mutations that must be fitted before the next paint, so nothing flashes over the crosshair: a
 * toast or banner added to the top-centre column, a top-centre piece coming out of hiding (it
 * pushes the toasts down), or the quest popover opening or closing. Text ticks stay throttled.
 */
export function urgentFit(r: FitRecord, tc: Node): boolean {
  if (r.type === 'childList') return r.addedNodes.length > 0 && tc.contains(r.target)
  if (r.type !== 'attributes') return false
  const el = r.target as Element
  if (el.id === 'contract-hud') return true
  return tc.contains(el) && /\bhidden\b/.test(r.oldValue ?? '') && !el.classList.contains('hidden')
}

/** HUD boxes from the last fit (screen px): edge arrows steer around them. */
export function hudBoxes(): Box[] {
  return solidBoxes
}

/**
 * Small screens: make the guide card tight when it runs into the bottom clusters, then hide the
 * lowest-priority short-lived pieces (old toasts, note, banners, older loot cards) that still collide.
 * Runs in one task, so nothing flashes.
 */
export function fitHud(): void {
  if (!zones || typeof document === 'undefined') return
  const flex = () => [
    ...Array.from(document.querySelectorAll('#toasts > .toast')),
    document.getElementById('note'),
    document.getElementById('zone-banner'),
    document.getElementById('levelup'),
    ...Array.from(document.querySelectorAll('#loot-toasts > *')),
  ].filter((e): e is HTMLElement => !!e)
  const pieces = flex()
  for (const el of pieces) el.classList.remove('squeezed')
  const guide = document.getElementById('guide')
  guide?.classList.remove('tight', 'cramped')
  document.body.classList.remove('guide-cramped')
  const aim = aimZone(window.innerWidth, window.innerHeight)
  fitPopover(aim)
  const solids = () => {
    const out: { el: Element; r: DOMRect }[] = []
    for (const sel of SOLID) document.querySelectorAll(sel).forEach((el) => {
      const r = seen(el)
      if (r) out.push({ el, r })
    })
    return out
  }
  let fixed = solids()
  // The full guide card: tight (no 모찌 line) when it reaches the crosshair or the thumb clusters,
  // folded back to its chip when even that does not fit.
  const guideBlocked = () => {
    const g = fixed.find((f) => f.el === guide)
    return !!g && (boxHit(g.r, aim, 0) || fixed.some((f) => f.el !== guide && f.el.closest('#hud-bl, #hud-br') && boxHit(f.r, g.r)))
  }
  if (guide && guideBlocked()) {
    guide.classList.add('tight')
    fixed = solids()
    if (guideBlocked()) {
      guide.classList.add('cramped')
      document.body.classList.add('guide-cramped')
      fixed = solids()
    }
  }
  solidBoxes = fixed.map((f) => f.r)
  // Priority: oldest toast lowest; loot cards newest-first highest.
  const loot = pieces.filter((e) => e.parentElement?.id === 'loot-toasts')
  const rest = pieces.filter((e) => e.parentElement?.id !== 'loot-toasts')
  const order = [...rest, ...loot]
  const ids = new Map(order.map((e, i) => [e, String(i)]))
  for (let pass = 0; pass < 10; pass++) {
    const live = order.map((el) => ({ el, r: el.classList.contains('squeezed') ? null : seen(el) })).filter((x) => x.r) as { el: HTMLElement; r: DOMRect }[]
    const hits = new Set<string>()
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      if (boxHit(a.r, aim, 0) || fixed.some((f) => boxHit(a.r, f.r))) hits.add(ids.get(a.el) ?? '')
      for (let j = i + 1; j < live.length; j++) {
        // The lower-priority of two colliding flexible pieces loses.
        if (live[j].el.parentElement === a.el.parentElement) continue
        if (boxHit(a.r, live[j].r)) hits.add(ids.get(a.el) ?? '')
      }
    }
    const victim = squeezeVictim(order.map((e) => ids.get(e) ?? ''), hits)
    if (victim === null) break
    order[Number(victim)].classList.add('squeezed')
  }
  for (const el of order) {
    const r = el.classList.contains('squeezed') ? null : seen(el)
    if (r) solidBoxes.push(r)
  }
  arenaCache.clear()
}

/** Move the bag/candy pocket when the thumb layout turns on or off. */
export function placePocket(compact: boolean): void {
  compactNow = compact
  if (!zones) return
  const home = zones[pocketHome(compact)]
  // Thumb layout: the pocket sits between the loot toasts and the stick. Desktop: above the skills.
  const before = compact ? document.getElementById('stick') : home.firstElementChild
  if (zones.pocket.parentElement !== home || zones.pocket.nextElementSibling !== before) home.insertBefore(zones.pocket, before && before.parentElement === home ? before : null)
}

/** The free middle of the screen (screen px) for edge arrows: below the top zone, above the bottom clusters. */
export function hudArena(): { cx: number; cy: number; rx: number; ry: number } {
  // Edge arrows ask every frame; measuring forces a layout, so reuse it for a moment.
  if (!zones) return measureArena()
  return arenaCache.get(performance.now(), measureArena)
}

function measureArena(): { cx: number; cy: number; rx: number; ry: number } {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth
  const h = typeof window === 'undefined' ? 720 : window.innerHeight
  if (!zones) return arenaOf({ w, h }, h * 0.12, h * 0.88)
  let topBottom = 0
  for (const c of Array.from(zones.tc.children)) {
    const r = c.getBoundingClientRect()
    if (r.height > 0 && getComputedStyle(c).display !== 'none') topBottom = Math.max(topBottom, r.bottom)
  }
  topBottom = Math.max(topBottom, (document.querySelector('#ui .top') as HTMLElement | null)?.getBoundingClientRect().bottom ?? 0)
  let bottomTop = h
  for (const z of [zones.bl, zones.br]) {
    for (const c of Array.from(z.children)) {
      const r = c.getBoundingClientRect()
      if (r.height > 0 && r.left < w * 0.7 && r.right > w * 0.3) bottomTop = Math.min(bottomTop, r.top)
    }
  }
  const hot = document.getElementById('hotbar')?.getBoundingClientRect()
  if (hot && hot.height > 0 && !compactNow) bottomTop = Math.min(bottomTop, hot.top)
  return clearOfAim(arenaOf({ w, h }, topBottom, bottomTop), aimZone(w, h))
}

/** Grow the arrow ellipse until the crosshair keep-out box (plus an arrow) sits fully inside it. */
export function clearOfAim(a: { cx: number; cy: number; rx: number; ry: number }, aim: Box, pad = 24): { cx: number; cy: number; rx: number; ry: number } {
  const hw = (aim.right - aim.left) / 2 + pad
  const hh = (aim.bottom - aim.top) / 2 + pad
  const rx = Math.max(a.rx, hw * 1.25)
  const k = 1 - (hw / rx) ** 2
  const ry = Math.max(a.ry, hh / Math.sqrt(Math.max(0.05, k)))
  return { cx: a.cx, cy: (aim.top + aim.bottom) / 2, rx, ry }
}
