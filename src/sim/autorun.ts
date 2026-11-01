/**
 * Auto-run (편의성): R / NumLock toggles it, a double tap on the touch stick toggles it, and any
 * real move input cancels it. Pure so the tap rules are tested headless.
 */

/** Two taps closer than this (ms, release to press) make a double tap. */
export const DOUBLE_TAP_MS = 320
/** A press longer than this (ms) is a hold, not a tap. */
export const TAP_HOLD_MS = 250
/** A press that moved the knob further than this (0..1 of the stick) is a drag, not a tap. */
export const TAP_TRAVEL = 0.5

export type StickRelease = 'tap' | 'double' | 'drag'

/** Keys that toggle auto-run, and keys that cancel it. */
export const AUTO_RUN_KEYS: readonly string[] = ['KeyR', 'NumLock']
export const MOVE_KEYS: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** Remembers the last stick tap and classifies each release. */
export class StickTaps {
  private lastTap = -Infinity

  /** One stick press ended: when it went down, when it came up, and how far the knob went. */
  release(downAt: number, upAt: number, travel: number): StickRelease {
    if (upAt - downAt > TAP_HOLD_MS || travel > TAP_TRAVEL) {
      this.lastTap = -Infinity
      return 'drag'
    }
    if (downAt - this.lastTap <= DOUBLE_TAP_MS) {
      this.lastTap = -Infinity
      return 'double'
    }
    this.lastTap = upAt
    return 'tap'
  }
}

/** The next auto-run state after a key press. */
export function autoRunAfterKey(on: boolean, code: string, repeat: boolean): boolean {
  if (repeat) return on
  if (AUTO_RUN_KEYS.includes(code)) return !on
  if (MOVE_KEYS.includes(code)) return false
  return on
}
