/**
 * Hit-stop (the tiny world freeze on a meaty hit) with a budget, so a fast gun with crits, ricochet
 * stars and kills can never chain freezes into a slowed-down game. Pure (no Three.js), tested.
 *
 * - A freeze runs the world at FREEZE_SCALE for its length (real time), then time is back to 1.
 * - Freezes never stack: a new one only extends to the longer of the two, capped at MAX_STOP.
 * - Small freezes (regular foes) need a gap after the last one and fit a leaky budget (~8% of
 *   real time at most), so a fight keeps its pace. Heavy ones (elite/boss kills) always land.
 */
export const FREEZE_SCALE = 0.08
export const MAX_STOP = 0.2
/** A freeze this long or longer is "heavy" (elite/boss kill) and ignores the budget. */
export const HEAVY = 0.07
/** Real seconds after a freeze ends before another small one may start. */
export const GAP = 0.3
/** Leaky budget: small freezes stop once this much freeze time is "owed"… */
export const BUDGET = 0.06
/** …and the debt drains at this rate (freeze seconds per real second). */
export const DRAIN = 0.08
/** Slow-mo on elite and boss kills: world speed at its deepest, and the longest it may run (real s). */
export const SLOW_SCALE = 0.3
export const MAX_SLOW = 0.6

export class HitStop {
  /** Freeze seconds left (real time). */
  left = 0
  private debt = 0
  private sinceEnd = 1e9
  /** Freeze seconds actually served (QA / tests). */
  served = 0
  /** Slow-mo left (real s) and its full length, for the ease back to normal speed. */
  slowLeft = 0
  private slowLen = 0
  private slowScale = 1

  get active(): boolean {
    return this.left > 0
  }

  /** Ask for a freeze of `seconds`; small ones may be dropped to keep the pace. Returns whether it ran. */
  request(seconds: number): boolean {
    if (!(seconds > 0)) return false
    const heavy = seconds >= HEAVY
    // A small hit during a freeze is absorbed by it (re-arming every frame would chain freezes forever).
    if (!heavy && this.active) return false
    if (!heavy && (this.sinceEnd < GAP || this.debt >= BUDGET)) return false
    this.left = Math.min(MAX_STOP, Math.max(this.left, seconds))
    return true
  }

  /**
   * A short slow-motion beat (elite / boss kill): the world runs at `scale`, easing back to 1 over
   * the last half. Never stacks past MAX_SLOW; a deeper/longer request wins.
   */
  slow(seconds: number, scale = SLOW_SCALE): void {
    if (!(seconds > 0)) return
    const len = Math.min(MAX_SLOW, seconds)
    const want = Math.max(0.05, Math.min(1, scale))
    const active = this.slowLeft > 0
    if (len > this.slowLeft) {
      this.slowLeft = len
      this.slowLen = len
    }
    this.slowScale = active ? Math.min(this.slowScale, want) : want
  }

  /** World speed from the slow-mo alone right now (1 when none). */
  get slowNow(): number {
    if (this.slowLeft <= 0) return 1
    const ease = Math.min(1, this.slowLeft / (this.slowLen * 0.5))
    return 1 - (1 - this.slowScale) * ease
  }

  /** Advance by a real-time step; returns the world time scale for this frame (1 when free). */
  step(raw: number): number {
    const slow = this.slowNow
    if (this.slowLeft > 0) {
      this.slowLeft = Math.max(0, this.slowLeft - Math.max(0, raw))
      if (this.slowLeft <= 0) this.slowScale = 1
    }
    return this.freezeStep(raw) * slow
  }

  private freezeStep(raw: number): number {
    const dt = Math.max(0, raw)
    this.debt = Math.max(0, this.debt - dt * DRAIN)
    if (this.left <= 0) {
      this.sinceEnd += dt
      return 1
    }
    const used = Math.min(this.left, dt)
    this.left -= dt
    this.served += used
    this.debt += used
    if (this.left <= 0) {
      this.left = 0
      this.sinceEnd = 0
    }
    // Only the frozen part of this frame runs slow.
    return dt > 0 ? (used * FREEZE_SCALE + (dt - used)) / dt : 1
  }

  /** Drop any freeze (menus, floor changes, death). */
  clear(): void {
    this.slowLeft = 0
    this.slowScale = 1
    this.left = 0
    this.debt = 0
    this.sinceEnd = 1e9
  }
}
