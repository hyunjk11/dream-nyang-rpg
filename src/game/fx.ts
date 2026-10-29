import Phaser from 'phaser'

export function makeFxTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('soft')) return
  const g = scene.add.graphics()
  g.fillStyle(0xffffff, 1)
  g.fillCircle(32, 32, 28)
  g.generateTexture('soft', 64, 64)
  g.clear()
  g.fillStyle(0xffffff, 1)
  g.fillPoints(star(32, 32, 28, 12, 5), true)
  g.generateTexture('star', 64, 64)
  g.destroy()
  glossy(scene, 'drop', '#ffffff', '#b9ecff', '#3aa0f0')
  glossy(scene, 'bubble', '#ffffff', '#eafff8', '#7ddec4')
  glossy(scene, 'spore', '#fff6d8', '#e7c4ff', '#9a6ad4')
  glossy(scene, 'petal', '#fff0f6', '#ffb7d5', '#e36aa8')
  dartTex(scene)
  vignette(scene)
}

function star(cx: number, cy: number, outer: number, inner: number, points: number): Phaser.Math.Vector2[] {
  const out: Phaser.Math.Vector2[] = []
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / points
    out.push(new Phaser.Math.Vector2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius))
  }
  return out
}

function glossy(scene: Phaser.Scene, key: string, hi: string, mid: string, edge: string): void {
  const tex = scene.textures.createCanvas(key, 64, 64)
  if (!tex) return
  const ctx = tex.getContext()
  const grd = ctx.createRadialGradient(24, 22, 2, 32, 34, 28)
  grd.addColorStop(0, hi)
  grd.addColorStop(0.45, mid)
  grd.addColorStop(1, edge)
  ctx.clearRect(0, 0, 64, 64)
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(32, 32, 24, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(70, 42, 84, 0.35)'
  ctx.stroke()
  tex.refresh()
}

function dartTex(scene: Phaser.Scene): void {
  const tex = scene.textures.createCanvas('dart', 64, 32)
  if (!tex) return
  const ctx = tex.getContext()
  ctx.clearRect(0, 0, 64, 32)
  ctx.fillStyle = '#ffe9a8'
  ctx.beginPath()
  ctx.moveTo(58, 16)
  ctx.lineTo(18, 6)
  ctx.lineTo(8, 16)
  ctx.lineTo(18, 26)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ff9ec4'
  ctx.beginPath()
  ctx.moveTo(16, 16)
  ctx.lineTo(4, 7)
  ctx.lineTo(4, 25)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(70, 42, 84, 0.45)'
  ctx.stroke()
  tex.refresh()
}

function vignette(scene: Phaser.Scene): void {
  const tex = scene.textures.createCanvas('vignette', 256, 256)
  if (!tex) return
  const ctx = tex.getContext()
  const grd = ctx.createRadialGradient(128, 128, 60, 128, 128, 150)
  grd.addColorStop(0, 'rgba(18, 8, 32, 0)')
  grd.addColorStop(1, 'rgba(16, 6, 28, 0.78)')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 256, 256)
  tex.refresh()
}

export function burst(scene: Phaser.Scene, x: number, y: number, tint: number, count = 12): void {
  if (!scene.textures.exists('star')) return
  const emitter = scene.add.particles(x, y, 'star', {
    speed: { min: 50, max: 190 },
    lifespan: 480,
    scale: { start: 0.32, end: 0 },
    tint,
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
    angle: { min: 0, max: 360 },
  })
  emitter.explode(count, x, y)
  scene.time.delayedCall(560, () => emitter.destroy())
}
