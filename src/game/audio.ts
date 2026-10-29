import Phaser from 'phaser'
import { settings } from './session'

class AudioBus {
  private scene: Phaser.Scene | null = null
  private bgm: Phaser.Sound.BaseSound | null = null
  private current = ''

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
    this.scene.sound.play(name, { volume: settings.current.sfx, rate })
  }
}

export const audio = new AudioBus()

export function buzz(pattern: number | number[]): void {
  if (!settings.current.vibration) return
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
}
