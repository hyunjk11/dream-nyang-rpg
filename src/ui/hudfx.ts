/**
 * Screen-space hit feedback for the sewer: crosshair bloom, a hit marker (pink X on a kill),
 * pooled floating damage numbers, and a heat ring under the crosshair.
 */
import { Vector3, type Camera } from 'three'
import type { HoldType } from '../actors/holds'

interface Num {
  el: HTMLElement
  at: Vector3
  life: number
  live: boolean
  /** Sideways drift (world m/s) and the pop strength (crits punch harder). */
  vx: number
  punch: number
  tilt: number
  /** Full lifetime (crit / skill / snipe live longer), the running amount and its kind. */
  max: number
  amount: number
  kind: NumberKind
  /** Unscaled box (px), measured once per text change; 0 = not measured yet. */
  bw: number
  bh: number
}

/** Pool size = the most numbers on screen at once (oldest recycled first). */
export const NUMS = 16
const NUM_LIFE = 0.62

/**
 * Screen-space limits for a damage number, whatever the camera does: at most NUM_CLAMP.h of the
 * viewport height (bigH for crit / skill / snipe), NUM_CLAMP.w of its width, pop peak NUM_CLAMP.pop.
 * Closer than near m to the camera it is hidden, fading in up to fade m.
 */
export const NUM_CLAMP = { h: 0.06, bigH: 0.09, w: 0.3, pop: 1.3, near: 1.2, fade: 2.0, mergeGap: 0.3, mergeDist: 0.9 }

/** Compact Korean damage text: 860 · 4.8천 · 1.2만 · 123만 · 1.2억 (no digit wall, fixed width). */
export function formatDamage(amount: number): string {
  const n = Math.max(0, Math.round(amount))
  const one = (v: number, unit: string): string => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${unit}`
  if (n < 1000) return String(n)
  if (n < 10_000) return one(n / 1000, '천')
  if (n < 100_000_000) return one(n / 10_000, '만')
  return one(n / 100_000_000, '억')
}

/** Big kinds get the 9% height allowance; the rest 6%. */
export function bigNumber(kind: NumberKind): boolean {
  return kind === 'crit' || kind === 'skill' || kind === 'snipe' || kind === 'word'
}

/** Largest scale that keeps a w×h px box inside the screen clamp for viewport vw×vh. */
export function numberScaleCap(w: number, h: number, vw: number, vh: number, big: boolean): number {
  if (!(w > 0) || !(h > 0)) return 1
  return Math.min((vh * (big ? NUM_CLAMP.bigH : NUM_CLAMP.h)) / h, (vw * NUM_CLAMP.w) / w)
}

/** Pop-in scale at age t (0..1 of its life): a short punch, never above NUM_CLAMP.pop. */
export function numberPop(t: number, punch: number): number {
  const p = t < 0.15 ? 1 + (1 - t / 0.15) * punch : 1
  return Math.min(NUM_CLAMP.pop, p)
}

/** Opacity from the camera distance: hidden right at the lens, faded in by NUM_CLAMP.fade m. */
export function nearFade(dist: number): number {
  if (dist <= NUM_CLAMP.near) return 0
  return Math.min(1, (dist - NUM_CLAMP.near) / (NUM_CLAMP.fade - NUM_CLAMP.near))
}

/**
 * Running damage tally: droplets on the same foe within TALLY.gap s of each other stack into one
 * big total floating over it (with a hit count), so holding the trigger reads as 두두두두두 → 1,284!
 */
export const TALLY = { gap: 0.7, minHits: 3, hold: 0.9 }

export interface TallyState {
  ref: object | null
  total: number
  hits: number
  /** Seconds since the last hit landed. */
  idle: number
  /** The target went down: the total is final (shown a moment longer, then cleared). */
  done: boolean
}

export function newTally(): TallyState {
  return { ref: null, total: 0, hits: 0, idle: Infinity, done: false }
}

/** Fold one hit into the tally: a new target, a finished streak or a long pause starts over. */
export function addTally(s: TallyState, amount: number, ref: object | null, kill: boolean): TallyState {
  if (s.done || s.idle > TALLY.gap || ref !== s.ref || ref === null) {
    s.ref = ref
    s.total = 0
    s.hits = 0
  }
  s.total += amount
  s.hits += 1
  s.idle = 0
  s.done = kill
  return s
}

/** Whether the tally is worth showing right now (a lone droplet is not a streak). */
export function tallyVisible(s: TallyState): boolean {
  return s.hits >= TALLY.minHits && s.idle <= (s.done ? TALLY.hold : TALLY.gap)
}

export class HudFx {
  private readonly cross: HTMLElement | null
  private readonly marker: HTMLElement | null = null
  private readonly heat: HTMLElement | null = null
  private readonly nums: Num[] = []
  private next = 0
  private markT = 0
  private readonly tmp = new Vector3()
  private lastGap = ''
  private lastHeat = ''
  private lastTarget = -1
  private lastHold = ''
  private readonly tallyEl: HTMLElement | null = null
  readonly streak: TallyState = newTally()
  private readonly tallyAt = new Vector3()
  private tallyText = ''
  private readonly tallyBox: { el: HTMLElement; bw: number; bh: number } = { el: null as unknown as HTMLElement, bw: 0, bh: 0 }

  constructor(hud: HTMLElement | null) {
    this.cross = (hud?.querySelector('#crosshair') as HTMLElement | null) ?? null
    if (!hud || typeof document === 'undefined') return
    this.marker = document.createElement('div')
    this.marker.id = 'hitmark'
    this.marker.innerHTML = '<i></i><i></i><i></i><i></i>'
    this.heat = document.createElement('div')
    this.heat.id = 'heat'
    this.heat.innerHTML = '<b></b><span>과열!</span>'
    this.tallyEl = document.createElement('div')
    this.tallyEl.className = 'dmg tally'
    this.tallyEl.style.display = 'none'
    hud.append(this.marker, this.heat, this.tallyEl)
    for (let i = 0; i < NUMS; i += 1) {
      const el = document.createElement('div')
      el.className = 'dmg'
      el.style.display = 'none'
      hud.append(el)
      this.nums.push({ el, at: new Vector3(), life: 0, live: false, vx: 0, punch: 0.7, tilt: 0, max: NUM_LIFE, amount: 0, kind: 'n', bw: 0, bh: 0 })
    }
  }

  /**
   * Bracket gap (px) for the horizontal and vertical cone edges, heat 0..1, and whether
   * the tank is venting. The gap is the aim cone: wide for 쌍권총, a pin for the sniper.
   * `hold` picks the bracket's own look (thickness, tint, arm length).
   */
  aim(spreadX: number, spreadY: number, heat: number, overheated: boolean, hold: HoldType = 'pistol'): void {
    const x = Math.round(spreadX * 2) / 2
    const y = Math.round(spreadY * 2) / 2
    const key = `${x},${y},${hold}`
    if (this.cross && key !== this.lastGap) {
      this.lastGap = key
      this.cross.style.setProperty('--spread-x', `${x}px`)
      this.cross.style.setProperty('--spread-y', `${y}px`)
      this.cross.style.setProperty('--spread', `${Math.max(x, y)}px`)
      const arm = hold === 'sniper' ? 18 : hold === 'rifle' ? 13 : hold === 'shotgun' ? 9 : hold === 'dual' ? 10 : 12
      const thick = hold === 'shotgun' || hold === 'dual' ? 3.5 : hold === 'sniper' ? 1.5 : 2.5
      this.cross.style.setProperty('--arm', `${arm}px`)
      this.cross.style.setProperty('--thick', `${thick}px`)
      this.cross.classList.toggle('wide', x > y * 1.4 || hold === 'dual' || hold === 'shotgun')
      this.cross.classList.toggle('pin', hold === 'sniper' || (x <= 4 && y <= 4))
      if (hold !== this.lastHold) {
        this.lastHold = hold
        this.cross.dataset.hold = hold
      }
    }
    if (this.heat) {
      const heatKey = `${Math.round(heat * 50)}${overheated}`
      if (heatKey !== this.lastHeat) {
        this.lastHeat = heatKey
        this.heat.style.setProperty('--heat', heat.toFixed(2))
        this.heat.classList.toggle('on', heat > 0.06)
        this.heat.classList.toggle('vent', overheated)
      }
    }
  }

  /** Crosshair state: 0 nothing, 1 a foe in the assist cone, 2 right on a foe (turns pink). */
  target(level: 0 | 1 | 2): void {
    if (!this.cross || level === this.lastTarget) return
    this.lastTarget = level
    this.cross.classList.toggle('near', level === 1)
    this.cross.classList.toggle('on', level === 2)
  }

  /** A droplet connected; the brackets tick, and a kill swaps the white mark for a bigger pink X. */
  hit(kill: boolean, crit: boolean): void {
    if (this.marker) {
      this.markT = kill ? 0.2 : 0.09
      this.marker.className = kill ? 'on kill' : crit ? 'on crit' : 'on'
    }
    this.flash(kill ? 'flash-kill' : crit ? 'flash-crit' : 'flash')
  }

  /** Brackets dip and brighten for a weapon swap. */
  pulse(): void {
    this.flash('swapping')
  }

  private flash(kind: string): void {
    const el = this.cross
    if (!el) return
    el.classList.remove('flash', 'flash-crit', 'flash-kill', 'swapping')
    void el.offsetWidth
    el.classList.add(kind)
  }

  number(amount: number, at: Vector3, kind: NumberKind): void {
    if (!this.nums.length) return
    // Rapid hits of one kind on the same spot (a skill's ticks, a pellet spread) roll into one number.
    for (const m of this.nums) {
      if (!m.live || m.kind !== kind || m.max - m.life > NUM_CLAMP.mergeGap) continue
      if (Math.hypot(m.at.x - at.x, m.at.z - at.z) > NUM_CLAMP.mergeDist) continue
      m.amount += amount
      m.life = m.max
      this.setNumText(m)
      return
    }
    const n = this.nums[this.next]
    this.next = (this.next + 1) % this.nums.length
    n.at.copy(at)
    n.at.x += (Math.random() - 0.5) * 0.35
    n.at.y += Math.random() * 0.2
    n.max = NUM_LIFE * (kind === 'snipe' ? 1.6 : kind === 'crit' || kind === 'skill' ? 1.25 : 1)
    n.life = n.max
    n.live = true
    n.vx = (Math.random() - 0.5) * 1.4
    n.punch = numberPunch(kind)
    n.tilt = kind === 'crit' ? (Math.random() - 0.5) * 16 : (Math.random() - 0.5) * 6
    n.amount = amount
    n.kind = kind
    // Kind classes are prefixed (k-skill, not skill): the skill tree's .skill card rule once
    // matched these and stretched every skill number into a full-width white bar.
    n.el.className = `dmg k-${kind}`
    n.el.style.display = 'block'
    this.setNumText(n)
  }

  private setNumText(n: Num): void {
    const text = formatDamage(n.amount)
    n.el.textContent = n.kind === 'crit' || n.kind === 'snipe' || n.kind === 'skill' ? `${text}!` : text
    n.bw = 0
    n.bh = 0
  }

  /** The number's unscaled box, measured lazily once per text (offset* ignores the transform). */
  private measure(n: { el: HTMLElement; bw: number; bh: number }): void {
    if (n.bw > 0) return
    n.bw = n.el.offsetWidth
    n.bh = n.el.offsetHeight
  }

  /** A shot word (탕!) floating up from `at`, drawn like a damage number. */
  word(text: string, at: Vector3): void {
    if (!this.nums.length) return
    const n = this.nums[this.next]
    this.next = (this.next + 1) % this.nums.length
    n.at.copy(at)
    n.at.y += 0.25
    n.life = NUM_LIFE * 0.9
    n.live = true
    n.vx = 0
    n.punch = numberPunch('word')
    n.tilt = -8
    n.max = n.life
    n.kind = 'word'
    n.amount = 0
    n.el.textContent = text
    n.el.className = 'dmg k-word'
    n.el.style.display = 'block'
    n.bw = 0
    n.bh = 0
  }

  /** Stack a landed hit into the running total over its target. */
  tally(amount: number, at: Vector3, ref: object | null, kill: boolean): void {
    addTally(this.streak, amount, ref, kill)
    this.tallyAt.copy(at)
    this.tallyAt.y += 1.6
  }

  private drawTally(dt: number, camera: Camera, w: number, h: number): void {
    const s = this.streak
    s.idle += dt
    const el = this.tallyEl
    if (!el) return
    if (!tallyVisible(s)) {
      if (el.style.display !== 'none') el.style.display = 'none'
      return
    }
    this.tmp.copy(this.tallyAt).project(camera)
    if (this.tmp.z > 1) {
      el.style.display = 'none'
      return
    }
    const text = `${formatDamage(s.total)}${s.done ? '!' : ''} <small>×${s.hits}</small>`
    if (text !== this.tallyText) {
      this.tallyText = text
      el.innerHTML = text
      el.classList.toggle('done', s.done)
      this.tallyBox.bw = 0
    }
    const pop = s.idle < 0.08 ? 1.12 - s.idle : s.done ? 1.25 : 1
    el.style.display = 'block'
    const fade = nearFade(camera.position.distanceTo(this.tallyAt))
    el.style.opacity = String(fade * (s.done ? Math.min(1, (TALLY.hold - s.idle) / 0.3) : 1))
    this.tallyBox.el = el
    this.measure(this.tallyBox)
    const scale = Math.min(pop, numberScaleCap(this.tallyBox.bw, this.tallyBox.bh, w, h, true))
    el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`
  }

  update(dt: number, camera: Camera): void {
    if (this.markT > 0) {
      this.markT -= dt
      if (this.markT <= 0 && this.marker) this.marker.className = ''
    }
    const w = window.innerWidth
    const h = window.innerHeight
    this.drawTally(dt, camera, w, h)
    for (const n of this.nums) {
      if (!n.live) continue
      n.life -= dt
      if (n.life <= 0) {
        n.live = false
        n.el.style.display = 'none'
        continue
      }
      n.at.y += dt * 1.1
      n.at.x += n.vx * dt
      n.vx *= Math.exp(-dt * 4)
      this.tmp.copy(n.at).project(camera)
      if (this.tmp.z > 1) {
        n.el.style.display = 'none'
        continue
      }
      const fade = nearFade(camera.position.distanceTo(n.at))
      if (fade <= 0) {
        n.el.style.display = 'none'
        continue
      }
      const t = Math.max(0, 1 - n.life / n.max)
      n.el.style.display = 'block'
      this.measure(n)
      const scale = Math.min(numberPop(t, n.punch), numberScaleCap(n.bw, n.bh, w, h, bigNumber(n.kind)))
      n.el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(2)}) rotate(${n.tilt.toFixed(1)}deg)`
      n.el.style.opacity = String(fade * Math.min(1, n.life / 0.25))
    }
  }

  dispose(): void {
    this.marker?.remove()
    this.heat?.remove()
    this.tallyEl?.remove()
    for (const n of this.nums) n.el.remove()
    this.cross?.style.setProperty('--spread', '7px')
    this.cross?.style.setProperty('--spread-x', '7px')
    this.cross?.style.setProperty('--spread-y', '7px')
    this.cross?.classList.remove('near', 'on', 'wide', 'pin', 'flash', 'flash-crit', 'flash-kill', 'swapping')
    if (this.cross) delete this.cross.dataset.hold
  }
}

/** How hard a damage number pops in: crits slam, elite/boss hits thump, chip damage ticks. */
/** Damage number looks: normal, crit, elite, boss, ricochet star, candy cloud tick. */
/** snipe: the sniper's huge number; skill: a skill hit (big, own colour); word: a shot word like 탕!. */
export type NumberKind = 'n' | 'crit' | 'elite' | 'boss' | 'star' | 'candy' | 'snipe' | 'skill' | 'word'

export function numberPunch(kind: NumberKind): number {
  if (kind === 'snipe') return 1.7
  if (kind === 'word') return 1.4
  if (kind === 'skill') return 1.35
  return kind === 'crit' ? 1.25 : kind === 'elite' || kind === 'boss' || kind === 'star' ? 0.9 : kind === 'candy' ? 0.45 : 0.6
}
