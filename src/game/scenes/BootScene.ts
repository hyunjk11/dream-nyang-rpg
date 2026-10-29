import Phaser from 'phaser'
import { AUDIO_FILES, IMAGE_FILES, asset } from '../assets'
import { audio } from '../audio'
import { bus } from '../bus'
import { makeFxTextures } from '../fx'
import { SHEETS } from '../sheets'

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
    for (const sheet of SHEETS) {
      this.load.spritesheet(sheet.key, asset(sheet.file), {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      })
    }
    for (const [key, file] of AUDIO_FILES) this.load.audio(key, asset(file))
  }

  create(): void {
    makeFxTextures(this)
    installAnims(this)
    audio.bind(this)
    bus.emit('boot', undefined)
  }
}

function installAnims(scene: Phaser.Scene): void {
  for (const sheet of SHEETS) {
    if (scene.anims.exists(sheet.key)) continue
    if (!scene.textures.exists(sheet.key)) continue
    const rate = sheet.key.includes('walk')
      ? 11
      : sheet.key.includes('dash')
        ? 16
        : sheet.key.includes('death')
          ? 7
          : sheet.key.includes('hit')
            ? 10
            : 2.4
    scene.anims.create({
      key: sheet.key,
      frames: scene.anims.generateFrameNumbers(sheet.key, { start: 0, end: sheet.frames - 1 }),
      frameRate: rate,
      repeat: sheet.key.includes('death') || sheet.key.includes('hit') ? 0 : -1,
    })
  }
}
