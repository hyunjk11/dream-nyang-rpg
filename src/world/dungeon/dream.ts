import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Texture,
} from 'three'
import { toonGradient } from '../../core/materials'
import { CEILING, TILE, Tile, distances, tileCentre, walkable, type Maze } from './maze'
import { wallFaces } from './walls'

/**
 * The dream dressing of the sewer: glowing pastel water that flows toward the boss (the floor
 * trail), candy-striped pipes, star lamps with floor glow, glowing mushrooms, crescent moons and
 * rising bubbles. Every family is one instanced or merged draw call.
 */

/** Dream palette: lavender, mint-teal, candy pink, lemon, sky. */
export const DREAM = {
  lavender: 0xb9a3ff,
  teal: 0x4fe0cc,
  pink: 0xff9fd2,
  lemon: 0xffe58a,
  sky: 0x9ad7ff,
  brick: [0xc7b5f0, 0x9fd8d2, 0xf2b8d8] as const,
}

/** Deterministic per-tile hash in [0,1). */
export function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function canvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c.getContext('2d')
}

function finish(ctx: CanvasRenderingContext2D | null): Texture | null {
  if (!ctx) return null
  const tex = new CanvasTexture(ctx.canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Soft pastel bricks (near white, so per-instance colour tints them). */
export function brickTexture(): Texture | null {
  const ctx = canvas(256, 256)
  if (!ctx) return null
  ctx.fillStyle = '#8f86a8'
  ctx.fillRect(0, 0, 256, 256)
  const rows = 8
  const cols = 4
  const bh = 256 / rows
  const bw = 256 / cols
  for (let r = 0; r < rows; r += 1) {
    for (let c = -1; c < cols; c += 1) {
      const x = c * bw + (r % 2 ? bw / 2 : 0)
      const v = 222 + Math.floor(hash(r, c, 3) * 30)
      const tint = hash(r, c, 5)
      ctx.fillStyle = tint > 0.9 ? `rgb(${v - 18},${v},${v})` : tint > 0.8 ? `rgb(${v},${v - 16},${v})` : `rgb(${v},${v},${v})`
      ctx.beginPath()
      ctx.roundRect(x + 3, r * bh + 3, bw - 6, bh - 6, 6)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(x + 7, r * bh + 5, bw - 16, 3)
    }
  }
  return finish(ctx)
}

/** Big rounded floor flags. */
export function flagTexture(): Texture | null {
  const ctx = canvas(256, 256)
  if (!ctx) return null
  ctx.fillStyle = '#a49cbc'
  ctx.fillRect(0, 0, 256, 256)
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const v = 214 + Math.floor(hash(r, c, 9) * 34)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.beginPath()
      ctx.roundRect(c * 64 + 3, r * 64 + 3, 58, 58, 12)
      ctx.fill()
    }
  }
  return finish(ctx)
}

/** Diagonal candy stripes. */
export function stripeTexture(): Texture | null {
  const ctx = canvas(64, 64)
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#c9c0dc'
  for (let i = -64; i < 128; i += 32) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + 16, 0)
    ctx.lineTo(i + 16 + 64, 64)
    ctx.lineTo(i + 64, 64)
    ctx.fill()
  }
  const tex = finish(ctx)
  tex?.repeat.set(3, 1)
  return tex
}

/** Radial glow (white centre, clear rim). */
export function glowTexture(): Texture | null {
  const ctx = canvas(64, 64)
  if (!ctx) return null
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = finish(ctx)
  return tex
}

/** Five-point star outline. */
export function starShape(outer = 0.22, inner = 0.095): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? inner : outer
    const a = Math.PI / 2 + (i * Math.PI) / 5
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return s
}

/** Crescent moon, horns to the right. */
export function moonShape(r = 0.5): Shape {
  const s = new Shape()
  const n = 20
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI / 2 + (i / n) * Math.PI
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  for (let i = 0; i <= n; i += 1) {
    const a = -Math.PI / 2 + (i / n) * Math.PI
    s.lineTo(-0.42 * r * Math.cos(a), r * Math.sin(a))
  }
  return s
}

const WATER_VERT = /* glsl */ `
attribute float phase;
attribute vec3 tint;
varying float vPhase;
varying vec3 vTint;
varying vec2 vWorld;
#include <common>
#include <fog_pars_vertex>
void main() {
  vPhase = phase;
  vTint = tint;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const WATER_FRAG = /* glsl */ `
uniform float time;
varying float vPhase;
varying vec3 vTint;
varying vec2 vWorld;
#include <common>
#include <fog_pars_fragment>
void main() {
  // Crests run toward lower phase: the water always flows toward the boss chamber.
  float crest = smoothstep(0.78, 1.0, fract(vPhase * 0.42 + time * 0.55));
  float ripple = 0.5 + 0.5 * sin(vWorld.x * 3.1 + vWorld.y * 2.3 + time * 2.0);
  vec3 col = vTint * (0.55 + 0.25 * ripple) + mix(vTint, vec3(1.0), 0.35) * crest * 0.55;
  gl_FragColor = vec4(col * 1.45, 0.96);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

const BUBBLE_VERT = /* glsl */ `
uniform float time;
uniform float scale;
attribute float seed;
varying float vSeed;
#include <common>
#include <fog_pars_vertex>
void main() {
  vSeed = seed;
  vec3 p = position;
  float rise = fract(seed * 7.13 + time * (0.05 + 0.04 * fract(seed * 3.7)));
  p.y = 0.2 + rise * ${(CEILING - 0.4).toFixed(2)};
  p.x += sin(time * 1.3 + seed * 40.0) * 0.18;
  p.z += cos(time * 1.1 + seed * 31.0) * 0.18;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = scale * (0.07 + 0.09 * fract(seed * 13.1)) / -mvPosition.z * (1.0 - smoothstep(0.85, 1.0, rise));
  #include <fog_vertex>
}
`

const BUBBLE_FRAG = /* glsl */ `
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float rim = smoothstep(0.32, 0.5, d) * (1.0 - smoothstep(0.47, 0.5, d));
  float glint = smoothstep(0.12, 0.0, length(c - vec2(-0.14, -0.14)));
  vec3 tint = mix(vec3(0.75, 0.95, 1.0), vec3(1.0, 0.78, 0.95), fract(vSeed * 5.3));
  gl_FragColor = vec4(tint * 1.4 + glint, rim * 0.8 + glint + 0.06);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

interface Lamp {
  at: Vector3
  color: Color
}

/** Dream dressing for one maze. */
export class Decor {
  readonly group = new Group()
  readonly lamps: Lamp[] = []
  /** Nest pipe mouths: where C's hordes pour out (world position + outward direction). */
  readonly mouths: { at: Vector3; dir: Vector3 }[] = []
  private readonly maze: Maze
  private readonly timed: ShaderMaterial[] = []
  private readonly lights: PointLight[] = []
  private lightClock = 0

  constructor(maze: Maze, lightCount = 4) {
    this.maze = maze
    this.group.name = 'sewer-decor'
    this.group.add(this.water(), this.pipes(), ...this.lampMeshes(), ...this.mushrooms(), this.moons(), this.bubbles(), ...this.nestMouths())
    for (let i = 0; i < lightCount; i += 1) {
      const light = new PointLight(0xffffff, 0, 7.5, 1.6)
      light.position.set(0, -50, 0)
      this.lights.push(light)
      this.group.add(light)
    }
  }

  /** Advance shader time; move the few real lights to the lamps nearest her. */
  update(time: number, dt: number, at: Vector3): void {
    for (const m of this.timed) m.uniforms.time.value = time
    this.lightClock -= dt
    if (this.lightClock > 0 || !this.lights.length) return
    this.lightClock = 0.25
    const near = this.lamps
      .map((l) => ({ l, d: l.at.distanceToSquared(at) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lights.length)
    this.lights.forEach((light, i) => {
      const lamp = near[i]?.l
      if (!lamp) {
        light.intensity = 0
        return
      }
      light.position.copy(lamp.at)
      light.color.copy(lamp.color)
      light.intensity = 2.4
    })
  }

  private water(): Mesh {
    const m = this.maze
    const boss = m.bossRoom
    const fromBoss = distances(m.tiles, m.w, m.h, boss.x + Math.floor(boss.w / 2), boss.y + Math.floor(boss.h / 2))
    const pos: number[] = []
    const phase: number[] = []
    const tint: number[] = []
    const y = 0.035
    const half = 0.42
    const colors = [new Color(0x22d8c0), new Color(0xff5fb0), new Color(0x8f6cff), new Color(0x4aaeff)]
    const tintAt = (d: number, out: number[]) => {
      const k = (d / 6) % colors.length
      const a = colors[Math.floor(k)]
      const b = colors[(Math.floor(k) + 1) % colors.length]
      const c = a.clone().lerp(b, k - Math.floor(k))
      out.push(c.r, c.g, c.b)
    }
    const quad = (pts: [number, number, number][]) => {
      // pts: four corners (x, z, phase) in order a b c d (a-b-c-d around)
      for (const i of [0, 3, 1, 1, 3, 2]) {
        const [x, z, ph] = pts[i]
        pos.push(x, y, z)
        phase.push(ph)
        tintAt(ph / TILE, tint)
      }
    }
    for (let ty = 0; ty < m.h; ty += 1) {
      for (let tx = 0; tx < m.w; tx += 1) {
        if (!walkable(m, tx, ty)) continue
        const d = fromBoss[ty * m.w + tx]
        const { x, z } = tileCentre(m, tx, ty)
        const pc = d * TILE
        quad([
          [x - half, z - half, pc],
          [x + half, z - half, pc],
          [x + half, z + half, pc],
          [x - half, z + half, pc],
        ])
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (!walkable(m, tx + dx, ty + dy)) continue
          const dn = fromBoss[(ty + dy) * m.w + tx + dx]
          const pn = dn * TILE
          const pm = (pc + pn) / 2
          // Arm from this pad's edge to the neighbour pad's edge.
          if (dx) {
            quad([
              [x + half, z - half, pc - 0.0001 + (pm - pc) * 0.25],
              [x + TILE - half, z - half, pn + (pm - pn) * 0.25],
              [x + TILE - half, z + half, pn + (pm - pn) * 0.25],
              [x + half, z + half, pc + (pm - pc) * 0.25],
            ])
          } else {
            quad([
              [x + half, z + half, pc + (pm - pc) * 0.25],
              [x + half, z + TILE - half, pn + (pm - pn) * 0.25],
              [x - half, z + TILE - half, pn + (pm - pn) * 0.25],
              [x - half, z + half, pc + (pm - pc) * 0.25],
            ])
          }
        }
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('phase', new BufferAttribute(new Float32Array(phase), 1))
    geo.setAttribute('tint', new BufferAttribute(new Float32Array(tint), 3))
    geo.computeBoundingSphere()
    const mat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { time: { value: 0 } }]),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    this.timed.push(mat)
    const mesh = new Mesh(geo, mat)
    mesh.name = 'sewer-water'
    mesh.renderOrder = 1
    return mesh
  }

  private pipes(): InstancedMesh {
    const faces = wallFaces(this.maze)
    const geo = new CylinderGeometry(1, 1, 1, 12, 1, true)
    const mat = new MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: stripeTexture(), emissive: 0x2a1f3a })
    const list: { x: number; y: number; z: number; rx: number; ry: number; r: number; len: number; c: number }[] = []
    const palette = [DREAM.pink, DREAM.teal, DREAM.lemon, DREAM.lavender]
    for (const f of faces) {
      const { x, z } = tileCentre(this.maze, f.x, f.y)
      const nx = f.side === 0 ? 1 : f.side === 1 ? -1 : 0
      const nz = f.side === 2 ? 1 : f.side === 3 ? -1 : 0
      const h = hash(f.x, f.y, f.side)
      const c = palette[Math.floor(hash(f.x >> 1, f.y >> 1, 7) * palette.length)]
      const wx = x + nx * (TILE / 2 - 0.22)
      const wz = z + nz * (TILE / 2 - 0.22)
      if (h < 0.62) list.push({ x: wx, y: 3.0, z: wz, rx: 1, ry: nx ? Math.PI / 2 : 0, r: 0.15, len: TILE, c })
      if (h > 0.82) list.push({ x: wx + nz * 0.9, y: 1.5, z: wz - nx * 0.9, rx: 0, ry: 0, r: 0.11, len: 3.0, c })
    }
    const mesh = new InstancedMesh(geo, mat, Math.max(1, list.length))
    const o = new Object3D()
    const col = new Color()
    list.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z)
      // Horizontal runs lie along their wall (cylinder axis turned flat, then yawed); risers stand.
      o.rotation.set(0, p.ry, p.rx ? Math.PI / 2 : 0, 'YXZ')
      o.scale.set(p.r, p.len, p.r)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      mesh.setColorAt(i, col.set(p.c))
    })
    mesh.count = list.length
    mesh.name = 'sewer-pipes'
    return mesh
  }

  private lampMeshes(): Mesh[] {
    const faces = wallFaces(this.maze)
    const picks = faces.filter((f) => {
      const kind = this.maze.tiles[f.y * this.maze.w + f.x]
      return hash(f.x, f.y, f.side + 11) < (kind === Tile.Corridor ? 0.2 : 0.45)
    })
    const starGeo = new ExtrudeGeometry(starShape(), { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 })
    const stars = new InstancedMesh(starGeo, new MeshBasicMaterial({ color: 0xffffff }), Math.max(1, picks.length))
    const pools = new InstancedMesh(
      new PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }),
      Math.max(1, picks.length),
    )
    const o = new Object3D()
    const palette = [DREAM.lemon, DREAM.pink, DREAM.sky, DREAM.teal]
    picks.forEach((f, i) => {
      const { x, z } = tileCentre(this.maze, f.x, f.y)
      const nx = f.side === 0 ? 1 : f.side === 1 ? -1 : 0
      const nz = f.side === 2 ? 1 : f.side === 3 ? -1 : 0
      const c = new Color(palette[Math.floor(hash(f.x, f.y, 13) * palette.length)])
      o.position.set(x + nx * (TILE / 2 - 0.05), 2.35, z + nz * (TILE / 2 - 0.05))
      o.rotation.set(0, Math.atan2(-nx, -nz), (hash(f.x, f.y, 17) - 0.5) * 0.6)
      o.scale.setScalar(1)
      o.updateMatrix()
      stars.setMatrixAt(i, o.matrix)
      stars.setColorAt(i, c.clone().multiplyScalar(2.1))
      o.position.set(x + nx * (TILE / 2 - 0.9), 0.04, z + nz * (TILE / 2 - 0.9))
      o.rotation.set(0, 0, 0)
      o.updateMatrix()
      pools.setMatrixAt(i, o.matrix)
      pools.setColorAt(i, c.clone().multiplyScalar(0.7))
      this.lamps.push({ at: new Vector3(x + nx * (TILE / 2 - 1.0), 2.2, z + nz * (TILE / 2 - 0.45)), color: c })
    })
    stars.count = picks.length
    pools.count = picks.length
    stars.name = 'sewer-star-lamps'
    pools.name = 'sewer-lamp-pools'
    pools.renderOrder = 2
    return [stars, pools]
  }

  private mushrooms(): Mesh[] {
    const m = this.maze
    const spots: { x: number; z: number; s: number; c: number }[] = []
    const palette = [DREAM.teal, DREAM.pink, DREAM.lemon, DREAM.sky]
    for (let ty = 1; ty < m.h - 1; ty += 1) {
      for (let tx = 1; tx < m.w - 1; tx += 1) {
        if (!walkable(m, tx, ty)) continue
        const kind = m.tiles[ty * m.w + tx]
        const chance = kind === Tile.Corridor ? 0.22 : 0.6
        if (hash(tx, ty, 21) > chance) continue
        const { x, z } = tileCentre(m, tx, ty)
        // Cluster in a corner that backs onto walls.
        const cx = !walkable(m, tx + 1, ty) ? 1 : !walkable(m, tx - 1, ty) ? -1 : hash(tx, ty, 22) > 0.5 ? 1 : -1
        const cz = !walkable(m, tx, ty + 1) ? 1 : !walkable(m, tx, ty - 1) ? -1 : hash(tx, ty, 23) > 0.5 ? 1 : -1
        const bx = x + cx * (TILE / 2 - 0.45)
        const bz = z + cz * (TILE / 2 - 0.45)
        const c = palette[Math.floor(hash(tx, ty, 24) * palette.length)]
        const n = 2 + Math.floor(hash(tx, ty, 25) * 3)
        for (let i = 0; i < n; i += 1) spots.push({ x: bx + (hash(tx, ty, 30 + i) - 0.5) * 0.7, z: bz + (hash(tx, ty, 40 + i) - 0.5) * 0.7, s: 0.6 + hash(tx, ty, 50 + i) * 0.9, c })
      }
    }
    const stems = new InstancedMesh(new CylinderGeometry(0.045, 0.075, 0.42, 7).translate(0, 0.21, 0), new MeshToonMaterial({ color: 0xf5eefc, gradientMap: toonGradient() }), Math.max(1, spots.length))
    const caps = new InstancedMesh(new SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.38, 0), new MeshBasicMaterial({ color: 0xffffff }), Math.max(1, spots.length))
    const o = new Object3D()
    const col = new Color()
    spots.forEach((s, i) => {
      o.position.set(s.x, 0, s.z)
      o.rotation.set((hash(i, 1, 60) - 0.5) * 0.3, hash(i, 2, 61) * 6, (hash(i, 3, 62) - 0.5) * 0.3)
      o.scale.setScalar(s.s)
      o.updateMatrix()
      stems.setMatrixAt(i, o.matrix)
      caps.setMatrixAt(i, o.matrix)
      caps.setColorAt(i, col.set(s.c).multiplyScalar(1.9))
    })
    stems.count = spots.length
    caps.count = spots.length
    stems.name = 'sewer-mushroom-stems'
    caps.name = 'sewer-mushroom-caps'
    return [stems, caps]
  }

  private moons(): InstancedMesh {
    const m = this.maze
    const faces = wallFaces(m).filter((f) => {
      const kind = m.tiles[f.y * m.w + f.x]
      return (kind === Tile.Chamber || kind === Tile.Boss || kind === Tile.Start) && hash(f.x, f.y, f.side + 70) < 0.4
    })
    const mesh = new InstancedMesh(new ShapeGeometry(moonShape(0.5)), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }), faces.length + 1)
    const o = new Object3D()
    const col = new Color()
    faces.forEach((f, i) => {
      const { x, z } = tileCentre(m, f.x, f.y)
      const nx = f.side === 0 ? 1 : f.side === 1 ? -1 : 0
      const nz = f.side === 2 ? 1 : f.side === 3 ? -1 : 0
      o.position.set(x + nx * (TILE / 2 - 0.03), 3.05, z + nz * (TILE / 2 - 0.03))
      o.rotation.set(0, Math.atan2(-nx, -nz), 0.5)
      o.scale.setScalar(0.7 + hash(f.x, f.y, 71) * 0.5)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      mesh.setColorAt(i, col.set(DREAM.lemon).multiplyScalar(1.8))
    })
    // A great moon hangs over the boss chamber.
    const b = m.bossRoom
    const c = tileCentre(m, b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2))
    o.position.set(c.x, CEILING - 0.6, c.z)
    o.rotation.set(-Math.PI / 2, 0, 0.7)
    o.scale.setScalar(4.2)
    o.updateMatrix()
    mesh.setMatrixAt(faces.length, o.matrix)
    mesh.setColorAt(faces.length, col.set(0xfff0b8).multiplyScalar(2.2))
    mesh.name = 'sewer-moons'
    return mesh
  }

  private bubbles(): Points {
    const m = this.maze
    const open: [number, number][] = []
    for (let ty = 0; ty < m.h; ty += 1) for (let tx = 0; tx < m.w; tx += 1) if (walkable(m, tx, ty)) open.push([tx, ty])
    const n = Math.min(520, open.length * 3)
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      const [tx, ty] = open[i % open.length]
      const { x, z } = tileCentre(m, tx, ty)
      pos[i * 3] = x + (hash(i, 1, 80) - 0.5) * (TILE - 0.6)
      pos[i * 3 + 1] = 1
      pos[i * 3 + 2] = z + (hash(i, 2, 81) - 0.5) * (TILE - 0.6)
      seed[i] = hash(i, 3, 82)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('seed', new BufferAttribute(seed, 1))
    geo.computeBoundingSphere()
    if (geo.boundingSphere) geo.boundingSphere.radius += CEILING
    const mat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { time: { value: 0 }, scale: { value: 720 } }]),
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.timed.push(mat)
    const pts = new Points(geo, mat)
    pts.name = 'sewer-bubbles'
    pts.renderOrder = 3
    return pts
  }

  /** Plug a nest pipe: the dark hole closes and the ring greys out. */
  sealNest(i: number): void {
    const [rings, holes] = this.nestMeshes
    if (!rings || !holes || i < 0 || i >= this.maze.nests.length) return
    const o = new Object3D()
    const mat = new Matrix4()
    holes.getMatrixAt(i, mat)
    mat.decompose(o.position, o.quaternion, o.scale)
    o.scale.setScalar(0.001)
    o.updateMatrix()
    holes.setMatrixAt(i, o.matrix)
    holes.instanceMatrix.needsUpdate = true
    rings.setColorAt(i, new Color(0x8d8798))
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true
  }

  private nestMeshes: InstancedMesh[] = []

  private nestMouths(): Mesh[] {
    const m = this.maze
    const rings = new InstancedMesh(new TorusGeometry(0.95, 0.2, 10, 24), new MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: stripeTexture() }), Math.max(1, m.nests.length))
    const holes = new InstancedMesh(new PlaneGeometry(1.9, 1.9), new MeshBasicMaterial({ color: 0x1a0f2a }), Math.max(1, m.nests.length))
    const o = new Object3D()
    const col = new Color()
    m.nests.forEach((n, i) => {
      const { x, z } = tileCentre(m, n.x, n.y)
      // The mouth sits in the dead end's back wall, opening toward the tunnel.
      const bx = x - n.dx * (TILE / 2 - 0.12)
      const bz = z - n.dy * (TILE / 2 - 0.12)
      o.position.set(bx, 1.25, bz)
      o.rotation.set(0, Math.atan2(n.dx, n.dy), 0)
      o.scale.setScalar(1)
      o.updateMatrix()
      rings.setMatrixAt(i, o.matrix)
      rings.setColorAt(i, col.set(i % 2 ? DREAM.pink : DREAM.teal))
      o.position.set(bx - n.dx * 0.04, 1.25, bz - n.dy * 0.04)
      o.updateMatrix()
      holes.setMatrixAt(i, o.matrix)
      this.mouths.push({ at: new Vector3(bx + n.dx * 0.6, 0, bz + n.dy * 0.6), dir: new Vector3(n.dx, 0, n.dy) })
    })
    rings.count = m.nests.length
    holes.count = m.nests.length
    rings.name = 'sewer-nest-pipes'
    holes.name = 'sewer-nest-holes'
    this.nestMeshes = [rings, holes]
    return [rings, holes]
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.geometry) return
      mesh.geometry.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v && typeof v === 'object' && 'isTexture' in v) (v as Texture).dispose()
        mat.dispose()
      }
    })
    this.group.removeFromParent()
  }
}
