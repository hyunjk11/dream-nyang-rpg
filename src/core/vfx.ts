import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three'

/** Pure particle step so tests can hold the motion: drag, gravity, then fade by life. */
export function stepParticle(p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; drag: number; gravity: number }, dt: number): boolean {
  p.age += dt
  if (p.age >= p.life) return false
  const keep = Math.max(0, 1 - p.drag * dt)
  p.vx *= keep
  p.vz *= keep
  p.vy = p.vy * keep - p.gravity * dt
  p.x += p.vx * dt
  p.y += p.vy * dt
  p.z += p.vz * dt
  if (p.y < 0.02) {
    p.y = 0.02
    p.vy = Math.abs(p.vy) * 0.3
  }
  return true
}

/** Alpha over a particle's life: a quick pop in, a long soft fade out. */
export function particleAlpha(age: number, life: number): number {
  const t = Math.min(1, Math.max(0, age / life))
  return Math.min(1, t * 10) * (1 - t) * (1 - t)
}

export type Shape = 0 | 1 // 0 = soft dot, 1 = four-point star

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  drag: number
  gravity: number
  size: number
  grow: number
  r: number
  g: number
  b: number
  shape: Shape
  additive: boolean
}

export interface BurstOptions {
  count?: number
  speed?: number
  up?: number
  life?: number
  size?: number
  grow?: number
  gravity?: number
  drag?: number
  shape?: Shape
  spread?: number
  additive?: boolean
}

interface Ring {
  mesh: Mesh
  age: number
  life: number
  from: number
  to: number
  alpha: number
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
attribute vec3 aColor;
varying float vAlpha;
varying float vShape;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vShape = aShape;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
varying float vAlpha;
varying float vShape;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  float dot = smoothstep(1.0, 0.25, d);
  // Four-point star: thin cross plus a bright core.
  float star = max(smoothstep(0.22, 0.0, abs(p.x) * (0.4 + abs(p.y) * 3.0)), smoothstep(0.22, 0.0, abs(p.y) * (0.4 + abs(p.x) * 3.0)));
  star = max(star, smoothstep(0.45, 0.0, d));
  float a = mix(dot, star, step(0.5, vShape)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * (1.0 + step(0.5, vShape) * 0.6), a);
}`

/** One shared pool: hit sparks, death poofs, footstep dust, shockwave and telegraph rings. */
export class Vfx {
  private readonly cap: number
  private readonly parts: Particle[] = []
  private readonly glowPts: Points
  private readonly dustPts: Points
  private readonly rings: Ring[] = []
  private readonly telegraphs = new Map<object, Mesh>()
  private readonly ringGeo = new RingGeometry(0.86, 1, 48)
  private readonly discGeo = new RingGeometry(0, 1, 48)
  private readonly tmp = new Color()

  constructor(scene: Scene, lowPower: boolean) {
    this.cap = lowPower ? 220 : 520
    this.glowPts = this.points(AdditiveBlending)
    this.dustPts = this.points(NormalBlending)
    scene.add(this.glowPts, this.dustPts)
    this.scene = scene
  }

  private readonly scene: Scene

  private points(blending: typeof AdditiveBlending | typeof NormalBlending): Points {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.cap * 3), 3))
    geo.setAttribute('aColor', new BufferAttribute(new Float32Array(this.cap * 3), 3))
    geo.setAttribute('aSize', new BufferAttribute(new Float32Array(this.cap), 1))
    geo.setAttribute('aAlpha', new BufferAttribute(new Float32Array(this.cap), 1))
    geo.setAttribute('aShape', new BufferAttribute(new Float32Array(this.cap), 1))
    geo.setDrawRange(0, 0)
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 420 } },
      transparent: true,
      depthWrite: false,
      blending,
    })
    const pts = new Points(geo, mat)
    pts.frustumCulled = false
    pts.renderOrder = 5
    return pts
  }

  /** Scale point sizes with the canvas height so sparks read the same on phone and desktop. */
  resize(height: number): void {
    for (const pts of [this.glowPts, this.dustPts]) (pts.material as ShaderMaterial).uniforms.uScale.value = height * 0.6
  }

  get live(): number {
    return this.parts.length
  }

  burst(at: Vector3, color: number, o: BurstOptions = {}): void {
    const count = o.count ?? 10
    this.tmp.set(color)
    for (let i = 0; i < count; i += 1) {
      if (this.parts.length >= this.cap) this.parts.shift()
      const ang = Math.random() * Math.PI * 2
      const sp = (o.speed ?? 2.6) * (0.55 + Math.random() * 0.6)
      const spread = o.spread ?? 0
      this.parts.push({
        x: at.x + (Math.random() - 0.5) * spread,
        y: at.y + (Math.random() - 0.5) * spread,
        z: at.z + (Math.random() - 0.5) * spread,
        vx: Math.cos(ang) * sp,
        vy: (o.up ?? 1.6) * (0.5 + Math.random()),
        vz: Math.sin(ang) * sp,
        age: 0,
        life: (o.life ?? 0.45) * (0.75 + Math.random() * 0.5),
        drag: o.drag ?? 3,
        gravity: o.gravity ?? 5,
        size: (o.size ?? 0.16) * (0.7 + Math.random() * 0.6),
        grow: o.grow ?? 0,
        r: this.tmp.r,
        g: this.tmp.g,
        b: this.tmp.b,
        shape: o.shape ?? 0,
        additive: o.additive ?? true,
      })
    }
  }

  /** Small impact: bright stars plus a few droplets of the shot's colour. */
  hit(at: Vector3, color: number, big = false): void {
    this.burst(at, 0xfff6ff, { count: big ? 5 : 3, speed: 1.2, up: 0.6, life: 0.22, size: big ? 0.5 : 0.36, shape: 1, gravity: 0, drag: 6 })
    this.burst(at, color, { count: big ? 12 : 7, speed: 3.2, up: 1.6, life: 0.38, size: 0.12 })
  }

  /** A foe pops back into dream dust: ring on the ground, a star shower and soft puffs. */
  poof(at: Vector3, color: number, scale = 1): void {
    this.ring(new Vector3(at.x, 0.04, at.z), color, 0.2, 1.5 * scale, 0.45)
    this.burst(at, 0xfff0a8, { count: Math.round(8 * scale), speed: 2.4, up: 3.2, life: 0.75, size: 0.32, shape: 1, gravity: 6 })
    this.burst(at, color, { count: Math.round(14 * scale), speed: 2, up: 1.2, life: 0.7, size: 0.34, grow: 0.5, gravity: -0.6, drag: 4, spread: 0.4 })
  }

  /** Grass dust kicked up by a footfall or a dash. */
  dust(at: Vector3, amount = 1): void {
    this.burst(new Vector3(at.x, 0.06, at.z), 0xe9f3d6, { count: Math.round(3 * amount), speed: 0.8, up: 0.5, life: 0.5, size: 0.22, grow: 0.6, gravity: -0.3, drag: 4, additive: false })
  }

  /** Expanding flat ring (shockwave / landing). */
  ring(at: Vector3, color: number, from: number, to: number, life: number, alpha = 0.85): void {
    const mesh = new Mesh(this.ringGeo, new MeshBasicMaterial({ color, transparent: true, opacity: alpha, depthWrite: false, side: DoubleSide, blending: AdditiveBlending }))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(at)
    mesh.scale.setScalar(from)
    mesh.renderOrder = 4
    this.scene.add(mesh)
    this.rings.push({ mesh, age: 0, life, from, to, alpha })
  }

  /** Ground warning under a winding-up foe; progress 0..1 fills the disc toward the edge. */
  telegraph(key: object, x: number, z: number, radius: number, progress: number, color = 0xff7ab0): void {
    let disc = this.telegraphs.get(key)
    if (!disc) {
      disc = new Mesh(this.discGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending }))
      disc.rotation.x = -Math.PI / 2
      disc.renderOrder = 3
      const edge = new Mesh(this.ringGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending }))
      disc.add(edge)
      this.scene.add(disc)
      this.telegraphs.set(key, disc)
    }
    disc.visible = true
    disc.position.set(x, 0.035, z)
    const p = Math.min(1, Math.max(0, progress))
    disc.scale.setScalar(radius * (0.25 + 0.75 * p))
    ;(disc.material as MeshBasicMaterial).opacity = 0.16 + 0.24 * p
    const edge = disc.children[0] as Mesh
    edge.scale.setScalar(1 / (0.25 + 0.75 * p))
  }

  endTelegraph(key: object): void {
    const disc = this.telegraphs.get(key)
    if (disc) disc.visible = false
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i -= 1) if (!stepParticle(this.parts[i], dt)) this.parts.splice(i, 1)
    this.write(this.glowPts, true)
    this.write(this.dustPts, false)
    for (const ring of this.rings) {
      ring.age += dt
      const t = Math.min(1, ring.age / ring.life)
      ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * (1 - (1 - t) * (1 - t)))
      ;(ring.mesh.material as MeshBasicMaterial).opacity = ring.alpha * (1 - t)
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      if (this.rings[i].age < this.rings[i].life) continue
      const ring = this.rings[i]
      ring.mesh.removeFromParent()
      ;(ring.mesh.material as MeshBasicMaterial).dispose()
      this.rings.splice(i, 1)
    }
  }

  private write(pts: Points, additive: boolean): void {
    const geo = pts.geometry
    const pos = geo.getAttribute('position') as BufferAttribute
    const col = geo.getAttribute('aColor') as BufferAttribute
    const size = geo.getAttribute('aSize') as BufferAttribute
    const alpha = geo.getAttribute('aAlpha') as BufferAttribute
    const shape = geo.getAttribute('aShape') as BufferAttribute
    let n = 0
    for (const p of this.parts) {
      if (p.additive !== additive) continue
      pos.setXYZ(n, p.x, p.y, p.z)
      col.setXYZ(n, p.r, p.g, p.b)
      size.setX(n, p.size * (1 + p.grow * (p.age / p.life)))
      alpha.setX(n, particleAlpha(p.age, p.life) * (additive ? 1 : 0.7))
      shape.setX(n, p.shape)
      n += 1
    }
    geo.setDrawRange(0, n)
    for (const a of [pos, col, size, alpha, shape]) a.needsUpdate = true
  }
}
