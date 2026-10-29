import Phaser from 'phaser'
import { AUDIO_FILES, IMAGE_FILES, asset } from '../assets'
import { audio } from '../audio'
import { bus } from '../bus'
import { makeFxTextures } from '../fx'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  preload(): void {
    if (this.textures.exists('byeolha')) return
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn('asset failed', file.key)
    })
    for (const [key, file] of IMAGE_FILES) this.load.image(key, asset(file))
    for (const [key, file] of AUDIO_FILES) this.load.audio(key, asset(file))
  }

  create(): void {
    makeFxTextures(this)
    audio.bind(this)
    bus.emit('boot', undefined)
  }
}
