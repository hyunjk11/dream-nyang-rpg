/**
 * In-world juice for the full-auto water gun: a star-burst muzzle flash, star and bubble casings
 * that tumble and bounce, and glowing splats that fade where droplets land. Everything is pooled
 * in a few instanced meshes, so 15 shots a second cost no allocations or extra draw calls.
 */
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Shape,
  ShapeGeometry,
  Vector3,
  type Camera,
} from 'three'
import { toonGradient } from '../core/materials'

/** Soft radial star texture (procedural, no canvas so it also builds headless). */
function starTexture(size = 64, points = 6): DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5
      const dy = (y + 0.5) / size - 0.5
      const r = Math.hypot(dx, dy) * 2
      const a = Math.atan2(dy, dx)
      const ray = Math.pow(Math.abs(Math.cos((a * points) / 2)), 8)
      const v = Math.max(0, 1 - r / (0.35 + 0.65 * ray)) ** 1.6 + Math.max(0, 1 - r * 2.6) * 0.8
      const c = Math.min(1, v)
      const i = (y * size + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = Math.round(c * 255)
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat)
  t.needsUpdate = true
  return t
}

/** Splat blob: a lumpy round puddle with a few droplets. */
function splatTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4)
  const drops = [
    [0.78, 0.3, 0.07],
    [0.22, 0.75, 0.06],
    [0.8, 0.72, 0.05],
    [0.18, 0.22, 0.045],
  ]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const a = Math.atan2(v - 0.5, u - 0.5)
      const r = Math.hypot(u - 0.5, v - 0.5) / (0.3 + 0.04 * Math.sin(a * 5) + 0.03 * Math.cos(a * 3))
      let c = Math.max(0, 1 - r) ** 0.6
      for (const [dx, dy, dr] of drops) c = Math.max(c, Math.max(0, 1 - Math.hypot(u - dx, v - dy) / dr) ** 0.5)
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.min(1, c * 1.3) * 255)
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat)
  t.needsUpdate = true
  return t
}

function starShape(outer: number, inner: number): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? inner : outer
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return s
}

interface Casing {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  rx: number
  ry: number
  spin: number
  age: number
  bubble: boolean
}

interface Splat {
  p: Vector3
  q: Quaternion
  size: number
  age: number
  color: Color
}

const CASINGS = 48
const SPLATS = 72
const CASING_LIFE = 1.3
const SPLAT_LIFE = 3.6

export class GunFx {
  readonly group = new Group()
  private readonly flash: Mesh
  private readonly flashCore: Mesh
  private flashT = 0
  private readonly stars: InstancedMesh
  private readonly bubbles: InstancedMesh
  private readonly splats: InstancedMesh
  private readonly casings: Casing[] = []
  private readonly splatList: Splat[] = []
  private readonly m = new Matrix4()
  private readonly e = new Object3D()
  private readonly s = new Vector3()
  private readonly c = new Color()
  private readonly up = new Vector3(0, 0, 1)

  constructor() {
    this.group.name = 'gun-fx'
    const tex = starTexture()
    const flashMat = new MeshBasicMaterial({ map: tex, color: new Color(0xc8f0ff).multiplyScalar(2.2), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
    this.flash = new Mesh(new PlaneGeometry(1, 1), flashMat)
    this.flashCore = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex, color: new Color(0xfff2fa).multiplyScalar(2.6), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
    for (const f of [this.flash, this.flashCore]) {
      f.visible = false
      f.renderOrder = 6
      f.frustumCulled = false
      this.group.add(f)
    }
    this.stars = new InstancedMesh(new ShapeGeometry(starShape(0.055, 0.024)), new MeshToonMaterial({ color: 0xffe07a, emissive: 0x806020, gradientMap: toonGradient(), side: DoubleSide }), CASINGS)
    this.bubbles = new InstancedMesh(
      new IcosahedronGeometry(0.04, 1),
      new MeshBasicMaterial({ color: new Color(0xbfeaff).multiplyScalar(1.4), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }),
      CASINGS,
    )
    const splatGeo = new PlaneGeometry(1, 1)
    this.splats = new InstancedMesh(splatGeo, new MeshBasicMaterial({ map: splatTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SPLATS)
    this.splats.setColorAt(0, new Color(1, 1, 1))
    for (const im of [this.stars, this.bubbles, this.splats]) {
      im.count = 0
      im.frustumCulled = false
      this.group.add(im)
    }
  }

  /** One shot: flash at the muzzle facing the lens, and a casing flicked out to her right. */
  shot(tip: Vector3, dir: Vector3, camera: Camera, n: number): void {
    this.flashT = 0.045
    const sz = 0.38 + Math.random() * 0.22
    for (const [f, k] of [
      [this.flash, 1],
      [this.flashCore, 0.45],
    ] as const) {
      f.visible = true
      f.position.copy(tip).addScaledVector(dir, 0.08)
      f.quaternion.copy(camera.quaternion)
      f.rotateZ(Math.random() * Math.PI)
      f.scale.setScalar(sz * k)
    }
    if (this.casings.length >= CASINGS) this.casings.shift()
    // Right of the barrel and a bit back, like a brass ejection port.
    const rx = dir.z
    const rz = -dir.x
    const rl = Math.hypot(rx, rz) || 1
    const side = 1.6 + Math.random() * 0.8
    this.casings.push({
      x: tip.x - dir.x * 0.12,
      y: tip.y + 0.02,
      z: tip.z - dir.z * 0.12,
      vx: (-rx / rl) * side - dir.x * 0.5 + (Math.random() - 0.5) * 0.4,
      vy: 1.7 + Math.random() * 0.8,
      vz: (-rz / rl) * side - dir.z * 0.5 + (Math.random() - 0.5) * 0.4,
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      spin: 8 + Math.random() * 10,
      age: 0,
      bubble: n % 3 === 2,
    })
  }

  /** A droplet landed: a glowing splat flat on the surface (normal n). */
  splat(at: Vector3, n: { x: number; y: number; z: number }, color: number, size = 0.5): void {
    if (this.splatList.length >= SPLATS) this.splatList.shift()
    const normal = this.s.set(n.x, n.y, n.z)
    const q = new Quaternion().setFromUnitVectors(this.up, normal)
    q.multiply(new Quaternion().setFromAxisAngle(this.up, Math.random() * Math.PI * 2))
    this.splatList.push({ p: at.clone().addScaledVector(normal, 0.012), q, size: size * (0.75 + Math.random() * 0.5), age: 0, color: new Color(color) })
  }

  update(dt: number): void {
    this.flashT -= dt
    const on = this.flashT > 0
    this.flash.visible = on
    this.flashCore.visible = on
    let si = 0
    let bi = 0
    for (let i = this.casings.length - 1; i >= 0; i -= 1) {
      const c = this.casings[i]
      c.age += dt
      if (c.age > CASING_LIFE) {
        this.casings.splice(i, 1)
        continue
      }
      c.vy -= (c.bubble ? 1.2 : 9) * dt
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.z += c.vz * dt
      if (c.y < 0.03) {
        c.y = 0.03
        c.vy = Math.abs(c.vy) * 0.35
        c.vx *= 0.55
        c.vz *= 0.55
        c.spin *= 0.6
      }
      c.rx += c.spin * dt
      c.ry += c.spin * 0.7 * dt
      const fade = Math.min(1, (CASING_LIFE - c.age) / 0.3)
      this.e.position.set(c.x, c.y, c.z)
      this.e.rotation.set(c.rx, c.ry, 0)
      this.e.scale.setScalar(fade * (c.bubble ? 1 + c.age * 0.6 : 1))
      this.e.updateMatrix()
      if (c.bubble) this.bubbles.setMatrixAt(bi++, this.e.matrix)
      else this.stars.setMatrixAt(si++, this.e.matrix)
    }
    this.stars.count = si
    this.bubbles.count = bi
    this.stars.instanceMatrix.needsUpdate = true
    this.bubbles.instanceMatrix.needsUpdate = true
    let k = 0
    for (let i = this.splatList.length - 1; i >= 0; i -= 1) {
      const s = this.splatList[i]
      s.age += dt
      if (s.age > SPLAT_LIFE) {
        this.splatList.splice(i, 1)
        continue
      }
      // Pop in big, settle, then fade (additive: fading the colour to black fades the splat).
      const grow = Math.min(1, s.age / 0.08)
      const fade = 1 - Math.max(0, (s.age - SPLAT_LIFE * 0.45) / (SPLAT_LIFE * 0.55))
      this.m.compose(s.p, s.q, this.s.setScalar(s.size * (0.6 + 0.4 * grow)))
      this.splats.setMatrixAt(k, this.m)
      this.c.copy(s.color).multiplyScalar(0.9 * fade + (1 - grow) * 0.8)
      this.splats.setColorAt(k, this.c)
      k += 1
    }
    this.splats.count = k
    this.splats.instanceMatrix.needsUpdate = true
    if (this.splats.instanceColor) this.splats.instanceColor.needsUpdate = true
  }

  get live(): { casings: number; splats: number } {
    return { casings: this.casings.length, splats: this.splatList.length }
  }

  dispose(): void {
    for (const im of [this.stars, this.bubbles, this.splats]) im.dispose()
    this.group.removeFromParent()
  }
}
