import { MASTER_DEFAULT } from './feel'

const KEY = 'dream-nyang-3d-master'
const base = import.meta.env.BASE_URL

class Bus {
  master = read()
  private bgm: HTMLAudioElement | null = null
  private last = new Map<string, number>()

  apply(): void {
    if (this.bgm) this.bgm.volume = this.master * 0.34
  }

  setMaster(value: number): void {
    this.master = Math.max(0, Math.min(1, value))
    localStorage.setItem(KEY, String(this.master))
    this.apply()
  }

  start(): void {
    if (this.bgm) return
    const audio = new Audio(`${base}assets/audio/bgm_village.wav`)
    audio.loop = true
    audio.volume = this.master * 0.34
    this.bgm = audio
    void audio.play().catch(() => undefined)
  }

  sfx(name: string): void {
    if (this.master <= 0.001) return
    const now = performance.now()
    const gap = name.startsWith('shoot') ? 70 : 45
    if (now - (this.last.get(name) ?? 0) < gap) return
    this.last.set(name, now)
    const audio = new Audio(`${base}assets/audio/${name}.wav`)
    audio.volume = Math.min(1, this.master * 0.5)
    audio.playbackRate = name === 'ui' ? 1 : 0.96 + Math.random() * 0.08
    void audio.play().catch(() => undefined)
  }
}

function read(): number {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return MASTER_DEFAULT
  const value = Number(raw)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : MASTER_DEFAULT
}

export const audio = new Bus()
