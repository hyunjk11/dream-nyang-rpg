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
import { SwapPool } from './pool'
import { POINT_GUARD, POINT_GUARD_FRAG } from './safeframe'

/** Pure particle step so tests can hold the motion: drag, gravity, then fade by life. */
export function stepParticle(p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; drag: number; gravity: number }, dt: number): boolean {
  p.age += dt
  if (!(p.age < p.life)) return false
  const keep = Math.max(0, 1 - p.drag * dt)
  p.vx *= keep
  p.vz *= keep
  p.vy = p.vy * keep - p.gravity * dt
  p.x += p.vx * dt
  p.y += p.vy * dt
  p.z += p.vz * dt
  // A NaN anywhere (a bad spawn point or velocity) retires the particle instead of drawing it.
  if (!Number.isFinite(p.x + p.y + p.z + p.vx + p.vy + p.vz)) return false
  if (p.y < 0.02) {
    p.y = 0.02
    p.vy = Math.abs(p.vy) * 0.3
  }
  return true
}

/** Alpha over a particle's life: a quick pop in, a long soft fade out. */
export function particleAlpha(age: number, life: number): number {
  if (!(life > 0) || !Number.isFinite(age)) return 0
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

function blankParticle(): Particle {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, drag: 0, gravity: 0, size: 0, grow: 0, r: 1, g: 1, b: 1, shape: 0, additive: true }
}

/** Most shockwave rings alive at once; the oldest is recycled past this. */
export const RING_CAP = 40

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
${POINT_GUARD}
void main() {
  vAlpha = aAlpha;
  vShape = aShape;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Capped size and a near-camera fade: a spark at the lens is no longer a screen-sized square.
  gl_PointSize = guardPoint(aSize * uScale, mv);
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
${POINT_GUARD_FRAG}
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
  float a = mix(dot, star, step(0.5, vShape)) * vAlpha * vNearFade;
  // NaN alpha fails every comparison: discard it too.
  if (!(a >= 0.01)) discard;
  a = min(a, 1.0);
  gl_FragColor = vec4(vColor * (1.0 + step(0.5, vShape) * 0.6), a);
}`

/** One shared pool: hit sparks, death poofs, footstep dust, shockwave and telegraph rings. */
export class Vfx {
  private readonly cap: number
  private readonly parts: SwapPool<Particle>
  /** Particle count multiplier (adaptive quality). */
  density = 1
  private readonly glowPts: Points
  private readonly dustPts: Points
  private readonly rings: Ring[] = []
  private readonly freeRings: Mesh[] = []
  private readonly telegraphs = new Map<object, Mesh>()
  private readonly freeDiscs: Mesh[] = []
  private readonly ringGeo = new RingGeometry(0.86, 1, 48)
  private readonly discGeo = new RingGeometry(0, 1, 48)
  private readonly tmp = new Color()
  private readonly scratch = new Vector3()

  constructor(scene: Scene, lowPower: boolean) {
    this.cap = lowPower ? 220 : 520
    this.parts = new SwapPool(this.cap, blankParticle)
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
    return this.parts.count
  }

  /** Pool readout for QA probes. */
  get stats(): { particles: number; cap: number; recycled: number; rings: number; freeRings: number; telegraphs: number } {
    return { particles: this.parts.count, cap: this.cap, recycled: this.parts.recycled, rings: this.rings.length, freeRings: this.freeRings.length, telegraphs: this.telegraphs.size }
  }

  burst(at: Vector3, color: number, o: BurstOptions = {}): void {
    if (!Number.isFinite(at.x + at.y + at.z)) return
    const want = o.count ?? 10
    // Adaptive quality thins bursts but never drops one entirely.
    const count = this.density >= 1 ? want : Math.max(want > 0 ? 1 : 0, Math.round(want * this.density))
    this.tmp.set(color)
    const speed = o.speed ?? 2.6
    const spread = o.spread ?? 0
    const up = o.up ?? 1.6
    const life = Math.max(0.05, o.life ?? 0.45)
    const size = o.size ?? 0.16
    for (let i = 0; i < count; i += 1) {
      const p = this.parts.spawn()
      const ang = Math.random() * Math.PI * 2
      const sp = speed * (0.55 + Math.random() * 0.6)
      p.x = at.x + (Math.random() - 0.5) * spread
      p.y = at.y + (Math.random() - 0.5) * spread
      p.z = at.z + (Math.random() - 0.5) * spread
      p.vx = Math.cos(ang) * sp
      p.vy = up * (0.5 + Math.random())
      p.vz = Math.sin(ang) * sp
      p.age = 0
      p.life = life * (0.75 + Math.random() * 0.5)
      p.drag = o.drag ?? 3
      p.gravity = o.gravity ?? 5
      p.size = size * (0.7 + Math.random() * 0.6)
      p.grow = o.grow ?? 0
      p.r = this.tmp.r
      p.g = this.tmp.g
      p.b = this.tmp.b
      p.shape = o.shape ?? 0
      p.additive = o.additive ?? true
    }
  }

  /** Small impact: bright stars plus a few droplets of the shot's colour. */
  hit(at: Vector3, color: number, big = false): void {
    this.burst(at, 0xfff6ff, { count: big ? 5 : 3, speed: 1.2, up: 0.6, life: 0.22, size: big ? 0.5 : 0.36, shape: 1, gravity: 0, drag: 6 })
    this.burst(at, color, { count: big ? 12 : 7, speed: 3.2, up: 1.6, life: 0.38, size: 0.12 })
  }

  /** A foe pops back into dream dust: ring on the ground, a star shower and soft puffs. */
  poof(at: Vector3, color: number, scale = 1): void {
    this.ringAt(at.x, 0.04, at.z, color, 0.2, 1.5 * scale, 0.45)
    this.burst(at, 0xfff0a8, { count: Math.round(8 * scale), speed: 2.4, up: 3.2, life: 0.75, size: 0.32, shape: 1, gravity: 6 })
    this.burst(at, color, { count: Math.round(14 * scale), speed: 2, up: 1.2, life: 0.7, size: 0.34, grow: 0.5, gravity: -0.6, drag: 4, spread: 0.4 })
  }

  /** Grass dust kicked up by a footfall or a dash. */
  dust(at: Vector3, amount = 1): void {
    this.scratch.set(at.x, 0.06, at.z)
    this.burst(this.scratch, 0xe9f3d6, { count: Math.round(3 * amount), speed: 0.8, up: 0.5, life: 0.5, size: 0.22, grow: 0.6, gravity: -0.3, drag: 4, additive: false })
  }

  /** Expanding flat ring (shockwave / landing). Meshes come from a pool; at most RING_CAP live. */
  ring(at: Vector3, color: number, from: number, to: number, life: number, alpha = 0.85): void {
    this.ringAt(at.x, at.y, at.z, color, from, to, life, alpha)
  }

  private ringAt(x: number, y: number, z: number, color: number, from: number, to: number, life: number, alpha = 0.85): void {
    if (!Number.isFinite(x + y + z + from + to + life)) return
    // Never a zero scale (a singular matrix) and never a zero life (0/0 opacity).
    from = Math.max(0.01, from)
    to = Math.max(0.01, to)
    life = Math.max(0.05, life)
    let mesh: Mesh
    if (this.rings.length >= RING_CAP) {
      const old = this.rings.shift() as Ring
      mesh = old.mesh
    } else {
      mesh = this.freeRings.pop() ?? this.newRing()
      mesh.visible = true
      if (!mesh.parent) this.scene.add(mesh)
    }
    const mat = mesh.material as MeshBasicMaterial
    mat.color.set(color)
    mat.opacity = alpha
    mesh.position.set(x, y, z)
    mesh.scale.setScalar(from)
    this.rings.push({ mesh, age: 0, life, from, to, alpha })
  }

  private newRing(): Mesh {
    const mesh = new Mesh(this.ringGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: DoubleSide, blending: AdditiveBlending }))
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = 4
    return mesh
  }

  /** Ground warning under a winding-up foe; progress 0..1 fills the disc toward the edge. */
  telegraph(key: object, x: number, z: number, radius: number, progress: number, color = 0xff7ab0): void {
    let disc = this.telegraphs.get(key)
    if (!disc) {
      disc = this.freeDiscs.pop()
      if (!disc) {
        disc = new Mesh(this.discGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending }))
        disc.rotation.x = -Math.PI / 2
        disc.renderOrder = 3
        const edge = new Mesh(this.ringGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending }))
        disc.add(edge)
        this.scene.add(disc)
      }
      ;(disc.material as MeshBasicMaterial).color.set(color)
      ;((disc.children[0] as Mesh).material as MeshBasicMaterial).color.set(color)
      this.telegraphs.set(key, disc)
    }
    disc.visible = true
    disc.position.set(x, 0.035, z)
    const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
    disc.scale.setScalar(radius * (0.25 + 0.75 * p))
    ;(disc.material as MeshBasicMaterial).opacity = 0.16 + 0.24 * p
    const edge = disc.children[0] as Mesh
    edge.scale.setScalar(1 / (0.25 + 0.75 * p))
  }

  endTelegraph(key: object): void {
    const disc = this.telegraphs.get(key)
    if (!disc) return
    // Back to the free list: a foe that never comes back no longer pins its disc forever.
    disc.visible = false
    this.telegraphs.delete(key)
    this.freeDiscs.push(disc)
  }

  update(dt: number): void {
    this.parts.sweep((p) => stepParticle(p, dt))
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
      ring.mesh.visible = false
      this.freeRings.push(ring.mesh)
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
    const items = this.parts.items
    for (let i = 0; i < this.parts.count; i += 1) {
      const p = items[i]
      if (p.additive !== additive) continue
      pos.setXYZ(n, p.x, p.y, p.z)
      col.setXYZ(n, p.r, p.g, p.b)
      size.setX(n, p.size * (1 + p.grow * (p.age / p.life)))
      alpha.setX(n, particleAlpha(p.age, p.life) * (additive ? 1 : 0.7))
      shape.setX(n, p.shape)
      n += 1
    }
    const was = geo.drawRange.count
    geo.setDrawRange(0, n)
    // Nothing to upload when the pool was and stays empty (most quiet frames).
    if (n === 0 && was === 0) return
    pos.needsUpdate = true
    col.needsUpdate = true
    size.needsUpdate = true
    alpha.needsUpdate = true
    shape.needsUpdate = true
  }
}
