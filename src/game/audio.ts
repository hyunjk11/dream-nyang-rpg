import Phaser from 'phaser'
import { settings } from './session'

const GAP_MS: Record<string, number> = {
  shoot_water: 55,
  shoot_bubble: 80,
  shoot_dart: 70,
  hit: 42,
  crit: 50,
  coin: 65,
  explode: 90,
  pickup: 55,
  hurt: 110,
  ui: 45,
  dash: 80,
  boss: 200,
}

const VOICE_CAP: Record<string, number> = {
  shoot_water: 3,
  shoot_bubble: 2,
  shoot_dart: 2,
  hit: 3,
  crit: 2,
  explode: 2,
  coin: 3,
  pickup: 2,
}

const STEADY = new Set(['ui', 'quest', 'levelup', 'deny', 'boss', 'heal', 'potion'])

class AudioBus {
  private scene: Phaser.Scene | null = null
  private bgm: Phaser.Sound.BaseSound | null = null
  private current = ''
  private last = new Map<string, number>()

  bind(scene: Phaser.Scene): void {
    this.scene = scene
    this.apply()
  }

  apply(): void {
    if (!this.scene) return
    this.scene.sound.volume = settings.current.master
    if (this.bgm && 'setVolume' in this.bgm) {
      ;(this.bgm as Phaser.Sound.WebAudioSound).setVolume(settings.current.bgm)
    }
  }

  playBgm(kind: 'village' | 'battle'): void {
    if (!this.scene) return
    const key = kind === 'battle' ? 'bgm_battle' : 'bgm_village'
    if (this.current === key && this.bgm?.isPlaying) {
      this.apply()
      return
    }
    this.bgm?.stop()
    if (!this.scene.cache.audio.exists(key)) return
    this.bgm = this.scene.sound.add(key, { loop: true, volume: settings.current.bgm })
    this.bgm.play()
    this.current = key
    this.apply()
  }

  sfx(name: string, rate = 1): void {
    if (!this.scene) return
    if (settings.current.master <= 0 || settings.current.sfx <= 0) return
    if (!this.scene.cache.audio.exists(name)) return
    const now = this.scene.time.now
    const gap = GAP_MS[name] ?? 35
    if (now - (this.last.get(name) ?? -1e9) < gap) return
    const cap = VOICE_CAP[name] ?? 4
    const playing = this.scene.sound.getAllPlaying().filter((sound) => sound.key === name)
    if (playing.length >= cap) return
    this.last.set(name, now)
    const varied = STEADY.has(name) ? rate : rate * (0.97 + Math.random() * 0.06)
    this.scene.sound.play(name, { volume: settings.current.sfx, rate: Phaser.Math.Clamp(varied, 0.5, 1.65) })
  }
}

export const audio = new AudioBus()

export function buzz(pattern: number | number[]): void {
  if (!settings.current.vibration) return
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
}
