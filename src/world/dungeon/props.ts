import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  OctahedronGeometry,
  Shape,
  ExtrudeGeometry,
} from 'three'
import { toonGradient } from '../../core/materials'
import { CEILING, TILE } from './maze'

/** Explore-floor props: the star door, the cracked wall and the shrine. Cheap procedural meshes. */
abstract class Prop {
  readonly group = new Group()
  protected readonly mats: Material[] = []

  protected toon(color: number, glow = 0): MeshToonMaterial {
    const m = new MeshToonMaterial({ color, gradientMap: toonGradient(), emissive: new Color(color), emissiveIntensity: glow })
    this.mats.push(m)
    return m
  }

  dispose(): void {
    this.group.traverse((o) => (o as Mesh).geometry?.dispose())
    for (const m of this.mats) m.dispose()
    this.group.removeFromParent()
  }
}

function starShape(outer: number, inner: number): Shape {
  const s = new Shape()
  for (let k = 0; k < 10; k += 1) {
    const a = Math.PI / 2 + (k * Math.PI) / 5
    const r = k % 2 ? inner : outer
    if (k) s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return s
}

/** Gold bars across a corridor tile with a big star lock; `along` true = bars run along x. */
export class StarDoor extends Prop {
  private readonly star: Mesh

  constructor(x: number, z: number, alongX: boolean) {
    super()
    const bar = this.toon(0xf2b64c, 0.35)
    const frame = this.toon(0x8a5fc0, 0.1)
    const inner = new Group()
    for (let k = 0; k < 5; k += 1) {
      const b = new Mesh(new CylinderGeometry(0.09, 0.09, CEILING - 0.3, 8), bar)
      b.position.set(-TILE / 2 + 0.35 + (k * (TILE - 0.7)) / 4, (CEILING - 0.3) / 2, 0)
      inner.add(b)
    }
    const top = new Mesh(new BoxGeometry(TILE, 0.3, 0.35), frame)
    top.position.y = CEILING - 0.2
    const low = new Mesh(new BoxGeometry(TILE, 0.22, 0.35), frame)
    low.position.y = 0.11
    this.star = new Mesh(new ExtrudeGeometry(starShape(0.55, 0.24), { depth: 0.14, bevelEnabled: false }), this.toon(0xffe36e, 0.8))
    this.star.position.set(0, 1.7, 0.1)
    inner.add(top, low, this.star)
    if (!alongX) inner.rotation.y = Math.PI / 2
    this.group.add(inner)
    this.group.position.set(x, 0, z)
    this.group.name = 'star-door'
  }

  update(time: number): void {
    this.star.rotation.z = Math.sin(time * 1.4) * 0.15
  }
}

/** A plug of cracked bricks in a dead end; water shots break it. */
export class CrackedWall extends Prop {
  private readonly body: Group = new Group()
  private shake = 0

  constructor(x: number, z: number, faceX: number, faceZ: number) {
    super()
    const brick = this.toon(0x7c64a8, 0.05)
    const crack = new MeshBasicMaterial({ color: 0xffd6f2 })
    this.mats.push(crack)
    const wall = new Mesh(new BoxGeometry(TILE, CEILING, TILE), brick)
    wall.position.y = CEILING / 2
    this.body.add(wall)
    // Glowing cracks on the face she sees.
    const lines: [number, number, number, number][] = [
      [0, 1.6, 0.9, 0.5],
      [0.35, 2.2, 0.7, -0.6],
      [-0.4, 1.2, 0.8, 0.9],
      [0.2, 0.7, 0.6, -0.3],
    ]
    for (const [u, v, len, rot] of lines) {
      const c = new Mesh(new BoxGeometry(len, 0.07, 0.04), crack)
      c.position.set(u, v, TILE / 2 + 0.03)
      c.rotation.z = rot
      this.body.add(c)
    }
    this.body.rotation.y = Math.atan2(faceX, faceZ)
    this.group.add(this.body)
    this.group.position.set(x, 0, z)
    this.group.name = 'cracked-wall'
  }

  hit(): void {
    this.shake = 1
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 5)
    this.body.position.x = Math.sin(this.shake * 40) * 0.04 * this.shake
  }
}

/** A little moon shrine: E for a 30 s blessing. */
export class Shrine extends Prop {
  private readonly gem: Mesh
  private readonly gemMat: MeshToonMaterial
  used = false

  constructor(x: number, z: number) {
    super()
    const stone = this.toon(0xcfc2ff, 0.08)
    this.gemMat = this.toon(0x8fd8ff, 0.9)
    const base = new Mesh(new CylinderGeometry(0.75, 0.9, 0.35, 16), stone)
    base.position.y = 0.17
    const post = new Mesh(new CylinderGeometry(0.28, 0.4, 0.9, 12), stone)
    post.position.y = 0.8
    const bowl = new Mesh(new CylinderGeometry(0.55, 0.3, 0.25, 16), stone)
    bowl.position.y = 1.35
    this.gem = new Mesh(new OctahedronGeometry(0.32, 0), this.gemMat)
    this.gem.position.y = 1.95
    this.group.add(base, post, bowl, this.gem)
    this.group.position.set(x, 0, z)
    this.group.name = 'shrine'
  }

  near(x: number, z: number): boolean {
    return !this.used && Math.hypot(x - this.group.position.x, z - this.group.position.z) < 2
  }

  use(): void {
    this.used = true
    this.gemMat.color.set(0x9b93ad)
    this.gemMat.emissiveIntensity = 0.1
  }

  update(time: number): void {
    this.gem.rotation.y = time * 1.3
    this.gem.position.y = 1.95 + (this.used ? 0 : Math.sin(time * 2) * 0.08)
  }
}
