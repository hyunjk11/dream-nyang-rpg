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
}

const NUMS = 28
const NUM_LIFE = 0.62

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

  constructor(hud: HTMLElement | null) {
    this.cross = (hud?.querySelector('#crosshair') as HTMLElement | null) ?? null
    if (!hud || typeof document === 'undefined') return
    this.marker = document.createElement('div')
    this.marker.id = 'hitmark'
    this.marker.innerHTML = '<i></i><i></i><i></i><i></i>'
    this.heat = document.createElement('div')
    this.heat.id = 'heat'
    this.heat.innerHTML = '<b></b><span>과열!</span>'
    hud.append(this.marker, this.heat)
    for (let i = 0; i < NUMS; i += 1) {
      const el = document.createElement('div')
      el.className = 'dmg'
      el.style.display = 'none'
      hud.append(el)
      this.nums.push({ el, at: new Vector3(), life: 0, live: false })
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

  /** A droplet connected; kill swaps the white tick for a bigger pink X. */
  hit(kill: boolean, crit: boolean): void {
    if (!this.marker) return
    this.markT = kill ? 0.2 : 0.09
    this.marker.className = kill ? 'on kill' : crit ? 'on crit' : 'on'
  }

  number(amount: number, at: Vector3, kind: 'n' | 'crit' | 'elite' | 'boss'): void {
    if (!this.nums.length) return
    const n = this.nums[this.next]
    this.next = (this.next + 1) % this.nums.length
    n.at.copy(at)
    n.at.x += (Math.random() - 0.5) * 0.35
    n.at.y += Math.random() * 0.2
    n.life = NUM_LIFE
    n.live = true
    n.el.textContent = String(amount)
    n.el.className = `dmg ${kind}`
    n.el.style.display = 'block'
  }

  update(dt: number, camera: Camera): void {
    if (this.markT > 0) {
      this.markT -= dt
      if (this.markT <= 0 && this.marker) this.marker.className = ''
    }
    const w = window.innerWidth
    const h = window.innerHeight
    for (const n of this.nums) {
      if (!n.live) continue
      n.life -= dt
      if (n.life <= 0) {
        n.live = false
        n.el.style.display = 'none'
        continue
      }
      n.at.y += dt * 1.1
      this.tmp.copy(n.at).project(camera)
      if (this.tmp.z > 1) {
        n.el.style.display = 'none'
        continue
      }
      const t = 1 - n.life / NUM_LIFE
      const pop = t < 0.15 ? 1 + (1 - t / 0.15) * 0.7 : 1
      n.el.style.display = 'block'
      n.el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`
      n.el.style.opacity = String(Math.min(1, n.life / 0.25))
    }
  }

  dispose(): void {
    this.marker?.remove()
    this.heat?.remove()
    for (const n of this.nums) n.el.remove()
    this.cross?.style.setProperty('--spread', '7px')
  }
}
