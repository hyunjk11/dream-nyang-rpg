/**
 * When the guide card is open in full and when it folds to a small chip. Pure, so the rules are testable:
 * - a new step opens the card for FULL_MS, progress on the step opens it briefly (PROGRESS_MS)
 * - in a fight the card stays folded (a step that starts mid-fight opens once the fight ends)
 * - the player can open it (J / tap the chip) for MANUAL_MS, or fold it again, or hide it until the next step (X)
 */
export const FULL_MS = 4500
export const PROGRESS_MS = 1800
export const MANUAL_MS = 6000

export type GuideFold = {
  head: string
  count: string
  /** Full card until this time (ms). */
  until: number
  /** Opened by the player: stays open even in a fight. */
  manual: boolean
  /** A step that started mid-fight still owes its open. */
  pending: boolean
  /** X pressed: nothing until the next step (or J). */
  hidden: boolean
}

export type GuideView = 'full' | 'chip' | 'off'

export function freshFold(): GuideFold {
  return { head: '', count: '', until: 0, manual: false, pending: false, hidden: false }
}

/** Feed the current step text and whether a fight is on. */
export function foldStep(s: GuideFold, now: number, head: string, count: string, combat: boolean): GuideFold {
  const out = { ...s }
  if (head !== s.head) {
    out.head = head
    out.count = count
    out.hidden = false
    out.manual = false
    if (combat) {
      out.pending = true
      out.until = 0
    } else {
      out.pending = false
      out.until = now + FULL_MS
    }
    return out
  }
  if (count !== s.count) {
    out.count = count
    if (!combat && !out.hidden) out.until = Math.max(out.until, now + PROGRESS_MS)
  }
  if (combat && !out.manual) out.until = 0
  if (!combat && out.pending) {
    out.pending = false
    out.until = now + FULL_MS
  }
  if (out.manual && now >= out.until) out.manual = false
  return out
}

/** A short line from 별하/모찌 opens the card briefly, like progress. */
export function foldPoke(s: GuideFold, now: number, combat: boolean): GuideFold {
  if (combat || s.hidden) return s
  return { ...s, until: Math.max(s.until, now + PROGRESS_MS * 2) }
}

export function foldView(s: GuideFold, now: number): GuideView {
  if (s.hidden) return 'off'
  return now < s.until ? 'full' : 'chip'
}

/** J or a tap on the chip: open it (even if hidden) or fold it again. */
export function foldToggle(s: GuideFold, now: number): GuideFold {
  if (foldView(s, now) === 'full') return { ...s, until: 0, manual: false, pending: false }
  return { ...s, hidden: false, manual: true, pending: false, until: now + MANUAL_MS }
}

/** X: hide the guide until the next step. */
export function foldHide(s: GuideFold): GuideFold {
  return { ...s, hidden: true, until: 0, manual: false, pending: false }
}

/** Chip text: '가이드 13/13 · 악몽 꽃 쓰러뜨리기' plus the count, kept short. */
export function chipText(head: string, count: string, max = 26): string {
  const short = head.length > max ? `${head.slice(0, max - 1)}…` : head
  return count ? `${short} ${count}` : short
}
