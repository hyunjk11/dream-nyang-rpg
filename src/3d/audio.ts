import { MASTER_DEFAULT } from './feel'
import { CUES, MUSIC, musicGains, pickVariant, stepMusic, type CueName, type MusicState } from './soundplan'

const KEY = 'dream-nyang-3d-master'
const base = import.meta.env.BASE_URL

/**
 * Web Audio bus: decoded buffers (no per-shot <audio> elements), random variants and pitch,
 * and two looping music beds that crossfade between village calm and battle.
 */
class Bus {
  master = read()
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private sfxBus: GainNode | null = null
  private beds: { village: GainNode; battle: GainNode } | null = null
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>()
  private readonly last = new Map<string, number>()
  private readonly lastVariant = new Map<string, number>()
  private music: MusicState = { mix: 0, calm: MUSIC.calm }

  apply(): void {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.master, this.ctx.currentTime, 0.05)
  }

  setMaster(value: number): void {
    this.master = Math.max(0, Math.min(1, value))
    localStorage.setItem(KEY, String(this.master))
    this.apply()
  }

  /** Create the context; browsers keep it suspended until the first tap or key. */
  start(): void {
    if (this.ctx) return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = this.master
    this.out.connect(ctx.destination)
    this.sfxBus = ctx.createGain()
    this.sfxBus.connect(this.out)
    const village = ctx.createGain()
    const battle = ctx.createGain()
    village.gain.value = MUSIC.level
    battle.gain.value = 0
    village.connect(this.out)
    battle.connect(this.out)
    this.beds = { village, battle }
    const unlock = () => void ctx.resume()
    for (const type of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, unlock, { passive: true })
    void this.loop(MUSIC.village, village)
    void this.loop(MUSIC.battle, battle)
    for (const cue of Object.values(CUES)) for (const file of cue.files) void this.buffer(file)
  }

  /** Call every frame with whether a foe is near; drives the crossfade. */
  update(dt: number, threat: boolean): void {
    this.music = stepMusic(this.music, dt, threat)
    if (!this.beds || !this.ctx) return
    const gains = musicGains(this.music.mix)
    const now = this.ctx.currentTime
    this.beds.village.gain.setTargetAtTime(gains.village * MUSIC.level, now, 0.08)
    this.beds.battle.gain.setTargetAtTime(gains.battle * MUSIC.level, now, 0.08)
  }

  /** Live context + sfx bus for synthesised sounds (null until audio has started). */
  context(): { ctx: AudioContext; bus: GainNode } | null {
    return this.ctx && this.sfxBus ? { ctx: this.ctx, bus: this.sfxBus } : null
  }

  get battleMix(): number {
    return this.music.mix
  }

  sfx(name: CueName, gain = 1): void {
    if (this.master <= 0.001 || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return
    const cue = CUES[name]
    const now = performance.now()
    if (now - (this.last.get(name) ?? -1e9) < cue.gap) return
    this.last.set(name, now)
    const index = pickVariant(cue.files.length, this.lastVariant.get(name) ?? -1, Math.random())
    this.lastVariant.set(name, index)
    const ctx = this.ctx
    const bus = this.sfxBus
    void this.buffer(cue.files[index]).then((buffer) => {
      if (!buffer) return
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * cue.pitch
      const g = ctx.createGain()
      g.gain.value = cue.volume * gain
      src.connect(g).connect(bus)
      src.start()
    })
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let job = this.buffers.get(file)
    if (!job) {
      const ctx = this.ctx
      job = ctx
        ? fetch(`${base}assets/${file}`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(file))))
            .then((data) => ctx.decodeAudioData(data))
            .catch(() => null)
        : Promise.resolve(null)
      this.buffers.set(file, job)
    }
    return job
  }

  private async loop(file: string, bed: GainNode): Promise<void> {
    const buffer = await this.buffer(file)
    if (!buffer || !this.ctx) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.connect(bed)
    src.start()
  }
}

function read(): number {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return MASTER_DEFAULT
  const value = Number(raw)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : MASTER_DEFAULT
}

export const audio = new Bus()
