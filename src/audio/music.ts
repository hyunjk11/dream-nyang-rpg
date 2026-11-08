/**
 * Procedural dungeon / boss music (no files): a soft pad, a music-box arpeggio and, for the boss,
 * a kick + bass pulse. Notes are planned by pure functions (tested) and played by a tiny
 * look-ahead scheduler on the shared AudioContext, so it rides the master volume and mute.
 */

export type Scene = 'town' | 'dungeon' | 'boss'

export interface Track {
  id: string
  bpm: number
  /** Scale degrees as semitones above the root. */
  scale: number[]
  /** MIDI root note. */
  root: number
  /** Chord roots (scale-degree index) per bar, looped. */
  bars: number[]
  /** 0..1 chance an eighth note gets a bell. */
  bell: number
  kick: boolean
  bass: boolean
}

const MINOR = [0, 2, 3, 5, 7, 8, 10]
const DORIAN = [0, 2, 3, 5, 7, 9, 10]
const LYDIAN = [0, 2, 4, 6, 7, 9, 11]

/** Per depth theme (꿈 하수도 / 캔디 동굴 / 별빛 서재), plus the boss pulse. */
export const TRACKS: Record<string, Track> = {
  sewer: { id: 'sewer', bpm: 72, scale: MINOR, root: 50, bars: [0, 5, 3, 4], bell: 0.32, kick: false, bass: false },
  candy: { id: 'candy', bpm: 84, scale: LYDIAN, root: 53, bars: [0, 3, 5, 4], bell: 0.45, kick: false, bass: false },
  library: { id: 'library', bpm: 66, scale: DORIAN, root: 48, bars: [0, 2, 3, 6], bell: 0.28, kick: false, bass: false },
  boss: { id: 'boss', bpm: 132, scale: MINOR, root: 45, bars: [0, 0, 5, 4], bell: 0.5, kick: true, bass: true },
}

const THEME_TRACK = ['sewer', 'candy', 'library']

/** Which procedural track plays (null = the town's recorded beds). */
export function trackFor(scene: Scene, depth: number): Track | null {
  if (scene === 'town') return null
  if (scene === 'boss') return TRACKS.boss
  return TRACKS[THEME_TRACK[(Math.max(1, Math.floor(depth)) - 1) % 3]]
}

export interface Note {
  /** Seconds from the start of the step. */
  at: number
  midi: number
  len: number
  gain: number
  voice: 'pad' | 'bell' | 'kick' | 'bass'
}

/** Tiny deterministic hash so a track's bell line repeats per loop (musical, not noise). */
function rand(step: number, salt: number): number {
  const x = Math.sin(step * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Notes for one eighth-note step (8 per bar). */
export function notesAt(track: Track, step: number): Note[] {
  const eighth = 30 / track.bpm
  const bar = Math.floor(step / 8)
  const beat = step % 8
  const deg = track.bars[bar % track.bars.length]
  const sc = track.scale
  const tone = (d: number, oct = 0) => track.root + sc[((d % sc.length) + sc.length) % sc.length] + 12 * (oct + Math.floor(d / sc.length))
  const out: Note[] = []
  if (beat === 0) {
    const len = eighth * 8
    for (const d of [deg, deg + 2, deg + 4]) out.push({ at: 0, midi: tone(d), len, gain: 0.1, voice: 'pad' })
  }
  const loopStep = step % (track.bars.length * 8)
  if (rand(loopStep, 1) < track.bell || beat === 0) {
    const pick = Math.floor(rand(loopStep, 2) * 5)
    out.push({ at: 0, midi: tone(deg + [0, 2, 4, 7, 9][pick], 1), len: eighth * 3, gain: 0.07, voice: 'bell' })
  }
  if (track.kick && beat % 2 === 0) out.push({ at: 0, midi: 36, len: 0.18, gain: 0.32, voice: 'kick' })
  if (track.bass) out.push({ at: 0, midi: tone(deg, -1), len: eighth * 0.8, gain: beat % 2 ? 0.07 : 0.11, voice: 'bass' })
  return out
}

export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12)

/** How far ahead the procedural scheduler may queue notes (seconds). */
export const SCHEDULE_AHEAD = 0.25

/**
 * Cursor for one scheduler pass. While paused, or after the clock jumps (a backgrounded
 * tab whose timer was throttled), missed steps are dropped instead of flushed at once.
 */
export function nextSchedulerAt(nextAt: number, now: number, running: boolean): { at: number; play: boolean } {
  if (!running) return { at: now + 0.05, play: false }
  if (nextAt < now - 0.5) return { at: now + 0.05, play: true }
  return { at: nextAt, play: true }
}

/** How many steps one pass would voice. A long stall stays inside the look-ahead. */
export function stepsInLookahead(nextAt: number, now: number, eighth: number, running: boolean): number {
  const cursor = nextSchedulerAt(nextAt, now, running)
  if (!cursor.play) return 0
  let at = cursor.at
  let steps = 0
  while (at < now + SCHEDULE_AHEAD) {
    steps += 1
    at += eighth
    if (steps > 10000) break
  }
  return steps
}

/** Look-ahead player: schedules ~0.25 s ahead from a 100 ms timer; cheap oscillators only. */
export class ProcMusic {
  private track: Track | null = null
  private step = 0
  private nextAt = 0
  private held = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly gain: GainNode

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.gain.connect(out)
  }

  get playing(): string | null {
    return this.track?.id ?? null
  }

  /** Tab hidden: stop queueing notes. Time spent away is not played back later. */
  hold(on: boolean): void {
    this.held = on
    this.nextAt = this.ctx.currentTime + 0.05
  }

  play(track: Track | null): void {
    if (track?.id === this.track?.id) return
    const now = this.ctx.currentTime
    this.gain.gain.cancelScheduledValues(now)
    this.gain.gain.setTargetAtTime(track ? 1 : 0, now, track ? 0.6 : 0.25)
    this.track = track
    this.step = 0
    this.nextAt = now + 0.08
    if (track && !this.timer) this.timer = setInterval(() => this.pump(), 100)
    if (!track && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private pump(): void {
    const t = this.track
    const running = !!t && !this.held && this.ctx.state === 'running'
    const cursor = nextSchedulerAt(this.nextAt, this.ctx.currentTime, running)
    this.nextAt = cursor.at
    if (!cursor.play || !t) return
    const eighth = 30 / t.bpm
    while (this.nextAt < this.ctx.currentTime + SCHEDULE_AHEAD) {
      for (const n of notesAt(t, this.step)) this.voice(n, this.nextAt + n.at)
      this.step += 1
      this.nextAt += eighth
    }
  }

  private voice(n: Note, at: number): void {
    const ctx = this.ctx
    const g = ctx.createGain()
    const o = ctx.createOscillator()
    g.connect(this.gain)
    if (n.voice === 'kick') {
      o.type = 'sine'
      o.frequency.setValueAtTime(140, at)
      o.frequency.exponentialRampToValueAtTime(42, at + 0.14)
      g.gain.setValueAtTime(n.gain, at)
      g.gain.exponentialRampToValueAtTime(0.001, at + n.len)
    } else if (n.voice === 'pad') {
      o.type = 'triangle'
      o.detune.value = (n.midi % 2 ? 6 : -6)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(n.gain, at + n.len * 0.3)
      g.gain.linearRampToValueAtTime(0, at + n.len)
    } else if (n.voice === 'bass') {
      o.type = 'square'
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 420
      o.connect(lp)
      lp.connect(g)
      g.gain.setValueAtTime(n.gain, at)
      g.gain.exponentialRampToValueAtTime(0.001, at + n.len)
    } else {
      o.type = 'sine'
      g.gain.setValueAtTime(n.gain, at)
      g.gain.exponentialRampToValueAtTime(0.001, at + n.len)
    }
    if (n.voice !== 'kick') o.frequency.value = midiHz(n.midi)
    if (n.voice !== 'bass') o.connect(g)
    o.start(at)
    o.stop(at + n.len + 0.05)
    o.onended = () => g.disconnect()
  }
}
