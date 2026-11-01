import { MASTER_DEFAULT } from '../core/feel'
import { ProcMusic, trackFor, type Scene } from './music'
import { CUES, MUSIC, musicGains, pickVariant, stepMusic, type CueName, type MusicState } from './soundplan'

const KEY = 'dream-nyang-3d-master'
const BGM_KEY = 'dnr3d.bgm'
const base = import.meta.env.BASE_URL

/**
 * Web Audio bus: decoded buffers (no per-shot <audio> elements), random variants and pitch,
 * and two looping music beds that crossfade between village calm and battle.
 */
class Bus {
  master = read()
  /** Music-only level (배경음 slider), under the master. */
  bgm = readBgm()
  private musicBus: GainNode | null = null
  private proc: ProcMusic | null = null
  private scene: Scene = 'town'
  private depth = 1
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

  setBgm(value: number): void {
    this.bgm = Math.max(0, Math.min(1, value))
    try {
      localStorage.setItem(BGM_KEY, String(this.bgm))
    } catch {
      /* private mode */
    }
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(this.bgm, this.ctx.currentTime, 0.05)
  }

  /** Town = recorded beds; dungeon (per depth theme) / boss = procedural tracks. */
  setScene(scene: Scene, depth = 1): void {
    this.scene = scene
    this.depth = depth
    this.proc?.play(trackFor(scene, depth))
  }

  get musicScene(): { scene: Scene; track: string | null } {
    return { scene: this.scene, track: this.proc?.playing ?? null }
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
    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = this.bgm
    this.musicBus.connect(this.out)
    village.connect(this.musicBus)
    battle.connect(this.musicBus)
    this.proc = new ProcMusic(ctx, this.musicBus)
    this.proc.play(trackFor(this.scene, this.depth))
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
    // Below ground the procedural track replaces the village bed; the battle bed still swells
    // in on a fight (and sits low under the boss pulse).
    const town = this.scene === 'town'
    const village = town ? gains.village : 0
    const battle = this.scene === 'boss' ? 0.35 : town ? gains.battle : gains.battle * 0.8
    this.beds.village.gain.setTargetAtTime(village * MUSIC.level, now, 0.08)
    this.beds.battle.gain.setTargetAtTime(battle * MUSIC.level, now, 0.08)
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
      // Unhook when done so a long fight does not pile finished nodes onto the bus.
      src.onended = () => {
        src.disconnect()
        g.disconnect()
      }
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

function readBgm(): number {
  try {
    const v = Number(localStorage.getItem(BGM_KEY))
    return localStorage.getItem(BGM_KEY) !== null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8
  } catch {
    return 0.8
  }
}
