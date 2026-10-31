/**
 * Gun elements, one rulebook for every foe (sewer horde and the island's zone foes):
 *  - 서늘 (ice): chilled for 1.6 s, moving at 55% speed.
 *  - 끈적 (candy): gooed for 3 s, taking 30% of the hit per second.
 *  - 반짝 (sparkle): a 1.5 m pop around the hit for 60% of it.
 */
import type { Vector3 } from 'three'
import type { Vfx } from '../core/vfx'
import type { ShotProcs } from './shooter'

export const ELEMENTS = {
  chill: 1.6,
  slow: 0.55,
  goo: 3,
  gooShare: 0.3,
  sparkleRadius: 1.5,
  sparkleShare: 0.6,
}

export interface ElementState {
  chill: number
  goo: number
  gooDps: number
}

export const ELEMENT_COLOR = { ice: 0xbfefff, candy: 0xff9fd2, sparkle: 0xfff2a0 }

/** Lay ice / candy on a foe that survived a hit; returns what took hold (for VFX). */
export function applyProcs(f: ElementState, procs: ShotProcs | undefined, amount: number): { ice: boolean; candy: boolean } {
  const out = { ice: false, candy: false }
  if (!procs) return out
  if (procs.ice) {
    f.chill = Math.max(f.chill, ELEMENTS.chill)
    out.ice = true
  }
  if (procs.candy) {
    f.goo = ELEMENTS.goo
    f.gooDps = Math.max(f.gooDps, amount * ELEMENTS.gooShare)
    out.candy = true
  }
  return out
}

/** Chill from a skill (bombs' slow). */
export function chill(f: ElementState, seconds: number): void {
  if (seconds > 0) f.chill = Math.max(f.chill, seconds)
}

/** Run the timers down; returns the goo damage this step (0 when clean). */
export function tickElements(f: ElementState, dt: number): number {
  if (f.chill > 0) f.chill = Math.max(0, f.chill - dt)
  if (f.goo <= 0) return 0
  const step = Math.min(dt, f.goo)
  f.goo = Math.max(0, f.goo - dt)
  const dmg = f.gooDps * step
  if (f.goo <= 0) f.gooDps = 0
  return dmg
}

/** Share of speed kept right now. */
export function speedMul(f: ElementState): number {
  return f.chill > 0 ? ELEMENTS.slow : 1
}

export function freshElements(): ElementState {
  return { chill: 0, goo: 0, gooDps: 0 }
}

/** The little puffs that show an element took hold. */
export function procBursts(vfx: Vfx, at: Vector3, took: { ice?: boolean; candy?: boolean; sparkle?: boolean }): void {
  if (took.ice) vfx.burst(at, ELEMENT_COLOR.ice, { count: 4, speed: 1.2, up: 0.6, life: 0.4, size: 0.12, gravity: 1, drag: 2 })
  if (took.candy) vfx.burst(at, ELEMENT_COLOR.candy, { count: 3, speed: 0.8, up: 0.4, life: 0.5, size: 0.14, gravity: 3, drag: 2 })
  if (took.sparkle) vfx.burst(at, ELEMENT_COLOR.sparkle, { count: 8, speed: 3, up: 1.2, life: 0.35, size: 0.1, gravity: 2, drag: 2, additive: true })
}
