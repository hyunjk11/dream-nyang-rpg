/** The boss floor's reward chest: a chubby lavender box with gold bands; the lid pops open. */
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, SphereGeometry, type Material } from 'three'
import { toonGradient } from '../../core/materials'

export class Chest {
  readonly group = new Group()
  /** 0 shut .. 1 wide open. */
  private lidT = 0
  opened = false
  private readonly lid = new Group()
  private readonly glow: Mesh
  private readonly mats: Material[] = []

  constructor(x: number, z: number, tint = 0xc7a6ff) {
    const body = new MeshToonMaterial({ color: tint, gradientMap: toonGradient() })
    const band = new MeshToonMaterial({ color: 0xffd36b, emissive: new Color(0xffc24a), emissiveIntensity: 0.35, gradientMap: toonGradient() })
    const glowMat = new MeshBasicMaterial({ color: new Color(0xfff0b0).multiplyScalar(1.6), transparent: true, opacity: 0 })
    this.mats.push(body, band, glowMat)
    const base = new Mesh(new BoxGeometry(1.2, 0.7, 0.85), body)
    base.position.y = 0.35
    const strap = new Mesh(new BoxGeometry(0.2, 0.72, 0.88), band)
    strap.position.y = 0.36
    const lidBox = new Mesh(new BoxGeometry(1.24, 0.36, 0.9), body)
    lidBox.position.set(0, 0.18, 0.45)
    const lidStrap = new Mesh(new BoxGeometry(0.2, 0.38, 0.93), band)
    lidStrap.position.set(0, 0.18, 0.45)
    const lock = new Mesh(new SphereGeometry(0.11, 10, 8), band)
    lock.position.set(0, 0.05, 0.92)
    this.lid.add(lidBox, lidStrap, lock)
    this.lid.position.set(0, 0.7, -0.45)
    this.glow = new Mesh(new SphereGeometry(0.5, 14, 10), glowMat)
    this.glow.position.y = 0.8
    this.group.add(base, strap, this.lid, this.glow)
    this.group.position.set(x, 0, z)
    this.group.name = 'sewer-chest'
  }

  open(): void {
    this.opened = true
  }

  /** She is close enough to open it. */
  near(x: number, z: number): boolean {
    return this.group.visible && !this.opened && Math.hypot(x - this.group.position.x, z - this.group.position.z) < 1.9
  }

  update(dt: number, time: number): void {
    if (!this.opened) {
      this.group.scale.setScalar(1 + Math.sin(time * 3) * 0.03)
      return
    }
    this.lidT = Math.min(1, this.lidT + dt * 3)
    this.lid.rotation.x = -this.lidT * 1.9
    ;(this.glow.material as MeshBasicMaterial).opacity = Math.max(0, 0.7 * (1 - this.lidT * 0.6))
  }

  dispose(): void {
    this.group.traverse((o) => (o as Mesh).geometry?.dispose())
    for (const m of this.mats) m.dispose()
    this.group.removeFromParent()
  }
}
