/**
 * Adaptive quality: when the frame rate sags (a big fight on a weak GPU), step detail down — render
 * resolution, bloom, shadow refresh, particle density — and step back up once it is smooth again.
 * Pure (tested); the stage applies a level with Stage.setDetail.
 */
export interface Detail {
  /** Multiplier on the starting pixel ratio. */
  pr: number
  bloom: boolean
  /** Redraw the sun's shadow map every N frames (1 = every frame). */
  shadowEvery: number
  /** Multiplier on spark/poof particle counts. */
  particles: number
}

export const DETAIL: readonly Detail[] = [
  { pr: 1, bloom: true, shadowEvery: 1, particles: 1 },
  { pr: 0.85, bloom: true, shadowEvery: 2, particles: 0.8 },
  { pr: 0.7, bloom: false, shadowEvery: 3, particles: 0.6 },
  { pr: 0.55, bloom: false, shadowEvery: 4, particles: 0.45 },
]

/** Seconds per measuring window. */
export const WINDOW = 2
/** Step down below this FPS (averaged over a window). */
export const LOW_FPS = 42
/** Step up above this FPS … */
export const HIGH_FPS = 56
/** … after this many smooth windows in a row. */
export const UP_AFTER = 4

export interface QualityState {
  level: number
  time: number
  frames: number
  good: number
  /** Level changes so far (QA readout). */
  changes: number
}

export function freshQuality(): QualityState {
  return { level: 0, time: 0, frames: 0, good: 0, changes: 0 }
}

/**
 * Feed one frame's real duration (seconds). Returns the new state; `level` changes at most once
 * per window. A hitch frame (tab switch, load) longer than 0.5 s is ignored.
 */
export function qualityStep(s: QualityState, raw: number): QualityState {
  if (!(raw > 0) || raw > 0.5) return s
  const out = { ...s, time: s.time + raw, frames: s.frames + 1 }
  if (out.time < WINDOW) return out
  const fps = out.frames / out.time
  out.time = 0
  out.frames = 0
  if (fps < LOW_FPS) {
    out.good = 0
    if (out.level < DETAIL.length - 1) {
      out.level += 1
      out.changes += 1
    }
  } else if (fps > HIGH_FPS) {
    out.good += 1
    if (out.good >= UP_AFTER && out.level > 0) {
      out.level -= 1
      out.good = 0
      out.changes += 1
    }
  } else out.good = 0
  return out
}

/** Small wrapper the game keeps: feeds frames, calls `apply` when the level moves. */
export class Quality {
  state = freshQuality()
  enabled = true
  constructor(private readonly apply: (level: number) => void) {}

  frame(raw: number): void {
    if (!this.enabled) return
    const before = this.state.level
    this.state = qualityStep(this.state, raw)
    if (this.state.level !== before) this.apply(this.state.level)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on && this.state.level !== 0) {
      this.state = { ...freshQuality(), changes: this.state.changes }
      this.apply(0)
    }
  }

  get level(): number {
    return this.state.level
  }
}
