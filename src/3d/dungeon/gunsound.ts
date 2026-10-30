/**
 * Rapid-fire water-gun sound that never clips: short synthesised layers (thump + spritz, a bubbly
 * tail every few shots), a small voice pool that fades out the oldest instead of piling up, and
 * a compressor on the gun bus. Hit ticks, kill pops, elite thunks and the overheat hiss share it.
 */

export type GunCue = 'shot' | 'tail' | 'tick' | 'crit' | 'pop' | 'thunk' | 'hiss'

/** Tiny seeded noise so every variant is stable between runs. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

/** Mono samples for one cue variant at `rate` Hz, peak-normalised to `peak` (< 1, no clipping). */
export function synth(cue: GunCue, rate: number, variant = 0, peak = 0.8): Float32Array {
  const len: Record<GunCue, number> = { shot: 0.085, tail: 0.18, tick: 0.045, crit: 0.07, pop: 0.11, thunk: 0.16, hiss: 0.6 }
  const n = Math.round(len[cue] * rate)
  const out = new Float32Array(n)
  const rnd = noise(1234 + variant * 977 + cue.length * 31)
  let lp = 0
  let bp = 0
  let phase = 0
  const v = 1 + (variant - 1.5) * 0.04
  for (let i = 0; i < n; i += 1) {
    const t = i / rate
    let s = 0
    if (cue === 'shot') {
      // Low "dut" thump with a fast pitch drop, plus a band of noise for the water spritz.
      const f = (70 + 190 * Math.exp(-t * 60)) * v
      phase += (2 * Math.PI * f) / rate
      const body = Math.sin(phase) * Math.exp(-t * 45)
      const w = rnd()
      lp += (w - lp) * 0.35
      bp += (lp - bp) * 0.12
      const spritz = (lp - bp) * 2.2 * Math.exp(-t * 70)
      const click = i < rate * 0.002 ? (1 - i / (rate * 0.002)) * 0.8 : 0
      s = body * 0.85 + spritz * 0.7 + click
    } else if (cue === 'tail') {
      // Bubbly trail: a few quick rising blips.
      const f = 520 * v + 380 * Math.sin(t * 90)
      phase += (2 * Math.PI * f) / rate
      s = Math.sin(phase) * Math.exp(-t * 18) * (0.5 + 0.5 * Math.sin(t * 160))
    } else if (cue === 'tick' || cue === 'crit') {
      const f = (cue === 'crit' ? 3100 : 2300) * v
      phase += (2 * Math.PI * f) / rate
      s = (Math.sin(phase) + 0.4 * Math.sin(phase * 1.5)) * Math.exp(-t * (cue === 'crit' ? 55 : 80))
    } else if (cue === 'pop') {
      // Soap-bubble pop: an upward sweep and a puff.
      const f = 380 + 2200 * Math.min(1, t / 0.05)
      phase += (2 * Math.PI * f * v) / rate
      lp += (rnd() - lp) * 0.5
      s = Math.sin(phase) * Math.exp(-t * 30) + lp * 0.5 * Math.exp(-t * 60)
    } else if (cue === 'thunk') {
      const f = (60 + 110 * Math.exp(-t * 25)) * v
      phase += (2 * Math.PI * f) / rate
      s = Math.sin(phase) * Math.exp(-t * 16)
    } else {
      // Kettle hiss: high-passed noise swelling then easing off.
      const w = rnd()
      lp += (w - lp) * 0.2
      s = (w - lp) * Math.min(1, t / 0.04) * Math.exp(-t * 4)
    }
    out[i] = s
  }
  let max = 0
  for (const s of out) max = Math.max(max, Math.abs(s))
  const k = max > 0 ? peak / max : 0
  for (let i = 0; i < n; i += 1) out[i] *= k
  // 2 ms fade-out so the cut never pops.
  const fade = Math.min(n, Math.round(rate * 0.002))
  for (let i = 0; i < fade; i += 1) out[n - 1 - i] *= i / fade
  return out
}

/** Bounded set of live voices; when full the oldest is handed back to be faded out. */
export class VoicePool<T> {
  private readonly live: { voice: T; end: number }[] = []
  constructor(readonly max: number) {}

  /** Register a voice ending at `end`; returns voices to retire (finished ones are dropped). */
  add(voice: T, now: number, end: number): T[] {
    for (let i = this.live.length - 1; i >= 0; i -= 1) if (this.live[i].end <= now) this.live.splice(i, 1)
    const steal: T[] = []
    while (this.live.length >= this.max) steal.push((this.live.shift() as { voice: T }).voice)
    this.live.push({ voice, end })
    return steal
  }

  get size(): number {
    return this.live.length
  }
}

const VARIANTS: Record<GunCue, number> = { shot: 4, tail: 2, tick: 2, crit: 1, pop: 3, thunk: 1, hiss: 1 }
const LEVEL: Record<GunCue, number> = { shot: 0.34, tail: 0.16, tick: 0.22, crit: 0.26, pop: 0.3, thunk: 0.42, hiss: 0.2 }

interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
}

export class GunSound {
  private readonly bufs = new Map<GunCue, AudioBuffer[]>()
  private readonly pool = new VoicePool<Voice>(9)
  private readonly bus: GainNode
  private lastVariant = -1

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 8
    comp.ratio.value = 6
    comp.attack.value = 0.002
    comp.release.value = 0.09
    this.bus = ctx.createGain()
    this.bus.gain.value = 1
    this.bus.connect(comp).connect(out)
    for (const cue of Object.keys(VARIANTS) as GunCue[]) {
      const list: AudioBuffer[] = []
      for (let v = 0; v < VARIANTS[cue]; v += 1) {
        const data = synth(cue, ctx.sampleRate, v)
        const buf = ctx.createBuffer(1, data.length, ctx.sampleRate)
        buf.copyToChannel(data, 0)
        list.push(buf)
      }
      this.bufs.set(cue, list)
    }
  }

  /** `pitch` nudges playback rate (heat makes the gun sing a little higher). */
  play(cue: GunCue, gain = 1, pitch = 0): void {
    if (this.ctx.state !== 'running') return
    const list = this.bufs.get(cue) as AudioBuffer[]
    let v = Math.floor(Math.random() * list.length)
    if (cue === 'shot' && list.length > 1 && v === this.lastVariant) v = (v + 1) % list.length
    if (cue === 'shot') this.lastVariant = v
    const now = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = list[v]
    src.playbackRate.value = 1 + pitch + (Math.random() * 2 - 1) * 0.035
    const g = this.ctx.createGain()
    g.gain.value = LEVEL[cue] * gain
    src.connect(g).connect(this.bus)
    src.start(now)
    const end = now + (list[v].duration / src.playbackRate.value)
    for (const old of this.pool.add({ src, gain: g }, now, end)) {
      old.gain.gain.cancelScheduledValues(now)
      old.gain.gain.setTargetAtTime(0, now, 0.006)
      try {
        old.src.stop(now + 0.03)
      } catch {
        // already ended
      }
    }
  }
}
