import { MASTER_DEFAULT } from '../core/feel'
import { ProcMusic, trackFor, type Scene } from './music'
import { CUES, MUSIC, musicGains, pickVariant, stepMusic, type CueName, type MusicState } from './soundplan'
import { AudioFocus, watchPage, type PageDoc, type PageWin } from './tabgate'

const KEY = 'dream-nyang-3d-master'
const BGM_KEY = 'dnr3d.bgm'
const base = import.meta.env.BASE_URL

type Store = Pick<Storage, 'getItem' | 'setItem'>

export interface LiveVoices {
  cut(): void
  retarget(out: AudioNode): void
}

export interface AudioBusOptions {
  storage?: Store | null
  document?: PageDoc | null
  window?: PageWin | null
  context?: () => AudioContext
}

/**
 * Web Audio bus: decoded buffers (no per-shot <audio> elements), random variants and pitch,
 * and two looping music beds that crossfade between village calm and battle.
 * A hidden tab silences the master output immediately. Music beds stay armed so they
 * continue on return; one-shots already in the air are left on a muted bus and never replay.
 */
export class AudioBus {
  master: number
  /** Music-only level (배경음 slider), under the master. */
  bgm: number
  private readonly storage: Store | null
  private readonly focus = new AudioFocus()
  private musicBus: GainNode | null = null
  private proc: ProcMusic | null = null
  private scene: Scene = 'town'
  private depth = 1
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private sfxBus: GainNode | null = null
  private beds: { village: GainNode; battle: GainNode } | null = null
  private voices: LiveVoices | null = null
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>()
  private readonly last = new Map<string, number>()
  private readonly lastVariant = new Map<string, number>()
  private music: MusicState = { mix: 0, calm: MUSIC.calm }
  private readonly makeContext: (() => AudioContext) | null
  private readonly win: PageWin | null

  constructor(options: AudioBusOptions = {}) {
    this.storage = options.storage === undefined ? safeStorage() : options.storage
    this.master = readMaster(this.storage)
    this.bgm = readBgm(this.storage)
    this.makeContext = options.context ?? null
    const doc = options.document === undefined ? (typeof document === 'undefined' ? null : document) : options.document
    this.win = options.window === undefined ? (typeof window === 'undefined' ? null : window) : options.window
    if (doc && this.win) watchPage(doc, this.win, (on) => this.setPageAudible(on))
  }

  /** False while the tab, mobile app, or frozen page is in the background. */
  get pageAudible(): boolean {
    return this.focus.pageOn
  }

  /** Resolves when a visibility suspend/resume has landed. */
  settled(): Promise<void> {
    return this.focus.settled()
  }

  /** Synth gun voices, so a hidden tab can cut them and move later shots to a live bus. */
  attachVoices(voices: LiveVoices): void {
    this.voices = voices
  }

  private setPageAudible(on: boolean): void {
    if (this.focus.pageOn === on) return
    this.focus.setPageOn(on)
    if (!on) {
      this.proc?.hold(true)
      this.apply()
      this.hushShots()
    } else {
      this.proc?.hold(false)
      this.apply()
    }
    if (this.ctx) void this.focus.request(this.ctx)
  }

  /** Drop one-shots that are already sounding. Looping beds stay on the music bus. */
  private hushShots(): void {
    if (!this.ctx || !this.out || !this.sfxBus) return
    const now = this.ctx.currentTime
    const old = this.sfxBus
    old.gain.cancelScheduledValues(now)
    old.gain.setValueAtTime(0, now)
    const next = this.ctx.createGain()
    next.connect(this.out)
    this.sfxBus = next
    this.voices?.cut()
    this.voices?.retarget(next)
  }

  apply(): void {
    if (!this.out || !this.ctx) return
    const level = this.focus.pageOn ? this.master : 0
    const now = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(now)
    if (!this.focus.pageOn) this.out.gain.setValueAtTime(0, now)
    else this.out.gain.setTargetAtTime(level, now, 0.05)
  }

  setMaster(value: number): void {
    this.master = Math.max(0, Math.min(1, value))
    this.write(KEY, String(this.master))
    this.apply()
  }

  setBgm(value: number): void {
    this.bgm = Math.max(0, Math.min(1, value))
    this.write(BGM_KEY, String(this.bgm))
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
    const ctx = this.openContext()
    if (!ctx) return
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = this.focus.pageOn ? this.master : 0
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
    if (!this.focus.pageOn) this.proc.hold(true)
    this.beds = { village, battle }
    const unlock = () => {
      this.focus.unlock()
      // Hidden: remember the gesture, but do not resume until the page is visible.
      if (this.ctx) void this.focus.request(this.ctx)
    }
    if (this.win) {
      for (const type of ['pointerdown', 'keydown', 'touchstart']) this.win.addEventListener(type, unlock, { passive: true })
    }
    void this.loop(MUSIC.village, village)
    void this.loop(MUSIC.battle, battle)
    for (const cue of Object.values(CUES)) for (const file of cue.files) void this.buffer(file)
    void this.focus.request(ctx)
  }

  private openContext(): AudioContext | null {
    if (this.makeContext) return this.makeContext()
    const w = typeof window === 'undefined' ? null : window
    const Ctx = w?.AudioContext ?? (w as unknown as { webkitAudioContext?: typeof AudioContext } | null)?.webkitAudioContext
    if (!Ctx) return null
    return new Ctx()
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

  /** Live context + sfx bus for synthesised sounds (null until audio has started, or while hidden). */
  context(): { ctx: AudioContext; bus: GainNode } | null {
    if (!this.focus.pageOn || !this.ctx || !this.sfxBus) return null
    return { ctx: this.ctx, bus: this.sfxBus }
  }

  get battleMix(): number {
    return this.music.mix
  }

  sfx(name: CueName, gain = 1): void {
    // Dropped, not queued: a fight that kept going in a hidden tab must not dump its sounds on return.
    if (!this.focus.pageOn || this.master <= 0.001 || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return
    const cue = CUES[name]
    const nowMs = performance.now()
    if (nowMs - (this.last.get(name) ?? -1e9) < cue.gap) return
    this.last.set(name, nowMs)
    const index = pickVariant(cue.files.length, this.lastVariant.get(name) ?? -1, Math.random())
    this.lastVariant.set(name, index)
    const ctx = this.ctx
    const bus = this.sfxBus
    void this.buffer(cue.files[index]).then((buffer) => {
      if (!buffer || !this.focus.pageOn || this.sfxBus !== bus || ctx.state !== 'running') return
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

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value)
    } catch {
      /* private mode */
    }
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

function safeStorage(): Store | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function readMaster(storage: Store | null): number {
  try {
    const raw = storage?.getItem(KEY) ?? null
    if (raw === null) return MASTER_DEFAULT
    const value = Number(raw)
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : MASTER_DEFAULT
  } catch {
    return MASTER_DEFAULT
  }
}

function readBgm(storage: Store | null): number {
  try {
    if (!storage || storage.getItem(BGM_KEY) === null) return 0.8
    const v = Number(storage.getItem(BGM_KEY))
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8
  } catch {
    return 0.8
  }
}

export const audio = new AudioBus()
