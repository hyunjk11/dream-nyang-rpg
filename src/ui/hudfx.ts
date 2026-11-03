/**
 * Screen-space hit feedback for the sewer: crosshair bloom, a hit marker (pink X on a kill),
 * pooled floating damage numbers, and a heat ring under the crosshair.
 */
import { Vector3, type Camera } from 'three'

interface Num {
  el: HTMLElement
  at: Vector3
  life: number
  live: boolean
  /** Sideways drift (world m/s) and the pop strength (crits punch harder). */
  vx: number
  punch: number
  tilt: number
}

const NUMS = 28
const NUM_LIFE = 0.62

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
  private lastGap = -1
  private lastHeat = ''
  private lastTarget = -1
  private readonly tallyEl: HTMLElement | null = null
  readonly streak: TallyState = newTally()
  private readonly tallyAt = new Vector3()
  private tallyText = ''

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
      this.nums.push({ el, at: new Vector3(), life: 0, live: false, vx: 0, punch: 0.7, tilt: 0 })
    }
  }

  /** Crosshair gap (px), heat 0..1 and whether the tank is venting. */
  aim(gapPx: number, heat: number, overheated: boolean): void {
    const g = Math.round(gapPx * 2) / 2
    if (this.cross && g !== this.lastGap) {
      this.lastGap = g
      this.cross.style.setProperty('--spread', `${g}px`)
    }
    if (this.heat) {
      const key = `${Math.round(heat * 50)}${overheated}`
      if (key !== this.lastHeat) {
        this.lastHeat = key
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

  /** A droplet connected; kill swaps the white tick for a bigger pink X. */
  hit(kill: boolean, crit: boolean): void {
    if (!this.marker) return
    this.markT = kill ? 0.2 : 0.09
    this.marker.className = kill ? 'on kill' : crit ? 'on crit' : 'on'
  }

  number(amount: number, at: Vector3, kind: NumberKind): void {
    if (!this.nums.length) return
    const n = this.nums[this.next]
    this.next = (this.next + 1) % this.nums.length
    n.at.copy(at)
    n.at.x += (Math.random() - 0.5) * 0.35
    n.at.y += Math.random() * 0.2
    n.life = NUM_LIFE * (kind === 'snipe' ? 1.6 : kind === 'crit' || kind === 'skill' ? 1.25 : 1)
    n.live = true
    n.vx = (Math.random() - 0.5) * 1.4
    n.punch = numberPunch(kind)
    n.tilt = kind === 'crit' ? (Math.random() - 0.5) * 16 : (Math.random() - 0.5) * 6
    n.el.textContent = kind === 'crit' || kind === 'snipe' || kind === 'skill' ? `${amount}!` : String(amount)
    n.el.className = `dmg ${kind}`
    n.el.style.display = 'block'
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
    n.el.textContent = text
    n.el.className = 'dmg word'
    n.el.style.display = 'block'
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
    const text = `${s.total.toLocaleString('ko-KR')}${s.done ? '!' : ''} <small>×${s.hits}</small>`
    if (text !== this.tallyText) {
      this.tallyText = text
      el.innerHTML = text
      el.classList.toggle('done', s.done)
    }
    const pop = s.idle < 0.08 ? 1.12 - s.idle : s.done ? 1.25 : 1
    el.style.display = 'block'
    el.style.opacity = String(s.done ? Math.min(1, (TALLY.hold - s.idle) / 0.3) : 1)
    el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`
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
      const t = Math.max(0, 1 - n.life / NUM_LIFE)
      const pop = t < 0.15 ? 1 + (1 - t / 0.15) * n.punch : 1
      n.el.style.display = 'block'
      n.el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)}) rotate(${n.tilt.toFixed(1)}deg)`
      n.el.style.opacity = String(Math.min(1, n.life / 0.25))
    }
  }

  dispose(): void {
    this.marker?.remove()
    this.heat?.remove()
    this.tallyEl?.remove()
    for (const n of this.nums) n.el.remove()
    this.cross?.style.setProperty('--spread', '7px')
    this.cross?.classList.remove('near', 'on')
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
