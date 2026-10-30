import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Mesh,
  MeshToonMaterial,
  Object3D,
  OctahedronGeometry,
  Points,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ISLAND_RADIUS, PATH_WIDTH, islandBudget, islandPaths, mulberry32, rimRadius, scatterSpots, type Spot } from './island'
import { outlineInstanced, toon, toonGradient } from './materials'

/**
 * Dreamy pastel toon island. Every decoration family is one InstancedMesh (or one Points),
 * so the whole island costs about a dozen draw calls. Low power halves counts and texture size.
 */
/** The cloud sea sits this far below the ground and starts this far outside the island. */
export const CLOUD_SEA_Y = -7.5
export const CLOUD_SEA_INNER = ISLAND_RADIUS + 1.5

export function buildIsland(scene: Scene, lowPower: boolean): { tick: (time: number) => void; drawCalls: number } {
  const budget = islandBudget(lowPower)
  const paths = islandPaths()
  const time = { value: 0 }
  const root = new Group()
  root.name = 'island'
  scene.add(root)

  root.add(skyDome())

  const ground = new Mesh(groundGeometry(), groundMaterial(budget.texture, paths))
  ground.receiveShadow = !lowPower
  ground.name = 'ground'
  root.add(ground)

  const cliff = new Mesh(cliffGeometry(1, 0.0, 1234), toonVertex())
  cliff.name = 'cliff'
  root.add(cliff)

  // Grass tufts: three bent blades, swaying in the vertex shader.
  const grassSpots = scatterSpots({ count: budget.grass, minR: 0.6, maxR: ISLAND_RADIUS - 0.5, clearPath: 0.08, clearCenter: 0, scale: [0.7, 1.35], clumps: 26, seed: 11 }, paths)
  const grass = instanced(tuftGeometry(), sway(toonVertex(true), time, 1), grassSpots, (spot, color) => {
    color.setHSL(0.27 + spot.tint * 0.12, 0.45 + spot.tint * 0.15, 0.46 + spot.tint * 0.12)
  })
  grass.name = 'grass'
  root.add(grass)

  const flowerSpots = scatterSpots({ count: budget.flowers, minR: 1.2, maxR: ISLAND_RADIUS - 0.8, clearPath: 0.15, clearCenter: 1.2, scale: [0.8, 1.3], clumps: 18, seed: 23 }, paths)
  const petals = [0xffb7d5, 0xffffff, 0xcab8ff, 0xffe08a, 0xa8dcff, 0xff9ec4]
  const flowers = instanced(flowerGeometry(), sway(tintable(toonVertex()), time, 0.5), flowerSpots, (spot, color) => {
    color.set(petals[Math.floor(spot.tint * petals.length) % petals.length])
  })
  flowers.name = 'flowers'
  root.add(flowers)

  const pebbleSpots = scatterSpots({ count: budget.pebbles, minR: 0.8, maxR: ISLAND_RADIUS - 0.4, clearPath: -0.9, clearCenter: 1, scale: [0.5, 1.2], clumps: 14, seed: 37 }, paths)
  const pebbles = instanced(pebbleGeometry(), toon(0xffffff), pebbleSpots, (spot, color) => {
    color.setHSL(0.78 + spot.tint * 0.15, 0.25, 0.8 + spot.tint * 0.1)
  }, (spot, dummy) => {
    dummy.scale.set(spot.scale * 1.2, spot.scale * 0.5, spot.scale)
  })
  pebbles.name = 'pebbles'
  root.add(pebbles)

  const crystalSpots = scatterSpots({ count: budget.crystals, minR: 2.4, maxR: ISLAND_RADIUS - 1.0, clearPath: 0.45, clearCenter: 2.4, scale: [0.8, 1.6], clumps: 6, seed: 41 }, paths)
  const crystalTints = [0xffb7ea, 0xb7d6ff, 0xd9b8ff, 0xb8fff0]
  const crystalMat = toon(0xffffff, 0xffe6f6, lowPower ? 0.5 : 0.32)
  const crystals = instanced(crystalGeometry(), crystalMat, crystalSpots, (spot, color) => {
    color.set(crystalTints[Math.floor(spot.tint * crystalTints.length) % crystalTints.length])
  })
  crystals.castShadow = !lowPower
  crystals.name = 'crystals'
  root.add(crystals)
  if (!lowPower) root.add(outlineInstanced(crystals, 0.03))

  const mushroomSpots = scatterSpots({ count: budget.mushrooms, minR: 1.8, maxR: ISLAND_RADIUS - 1, clearPath: 0.3, clearCenter: 1.8, scale: [0.6, 1.4], clumps: 7, seed: 53 }, paths)
  const caps = [0xff8fb4, 0xc9a4ff, 0xffa77a, 0x8fd0ff]
  const mushrooms = instanced(mushroomGeometry(), tintable(toonVertex()), mushroomSpots, (spot, color) => {
    color.set(caps[Math.floor(spot.tint * caps.length) % caps.length])
  })
  mushrooms.castShadow = !lowPower
  mushrooms.name = 'mushrooms'
  root.add(mushrooms)
  if (!lowPower) root.add(outlineInstanced(mushrooms, 0.025))

  // A soft sea of clouds far below the rim. The old instanced puffs hugged the cliff at
  // -1.5..-4.7 m and read as flat pastel blobs in front of the camera at the island edge.
  root.add(cloudSea(time))

  // A few tiny islands far away so the edge reads as "floating in a dream".
  const far = new InstancedMesh(cliffGeometry(0.16, 0.0, 99), toonVertex(), 5)
  const dummy = new Object3D()
  const farSpots = [
    [-24, -2.5, -16, 1.1], [26, -4, -10, 0.8], [18, 1.5, -28, 1.3], [-30, 2.5, 6, 0.9], [8, -6, 30, 1.2],
  ]
  farSpots.forEach(([x, y, z, s], i) => {
    dummy.position.set(x, y, z)
    dummy.scale.setScalar(s)
    dummy.rotation.y = i
    dummy.updateMatrix()
    far.setMatrixAt(i, dummy.matrix)
  })
  far.name = 'far-islands'
  root.add(far)

  const motes = glowMotes(budget.motes, time)
  root.add(motes)

  let calls = 0
  root.traverse((obj) => {
    if ((obj as Mesh).isMesh || (obj as Points).isPoints) calls += 1
  })
  return {
    drawCalls: calls,
    tick: (t) => {
      time.value = t
    },
  }
}

function groundGeometry(): BufferGeometry {
  const rings = 14
  const segments = 96
  const pos: number[] = [0, 0.02, 0]
  const uv: number[] = [0.5, 0.5]
  const span = ISLAND_RADIUS + 1
  for (let r = 1; r <= rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const ang = (s / segments) * Math.PI * 2
      const rad = (r / rings) * rimRadius(ang)
      const x = Math.cos(ang) * rad
      const z = Math.sin(ang) * rad
      pos.push(x, 0.02, z)
      uv.push(0.5 + x / (2 * span), 0.5 - z / (2 * span))
    }
  }
  const index: number[] = []
  for (let s = 0; s < segments; s += 1) index.push(0, 1 + ((s + 1) % segments), 1 + s)
  for (let r = 1; r < rings; r += 1) {
    const a = 1 + (r - 1) * segments
    const b = 1 + r * segments
    for (let s = 0; s < segments; s += 1) {
      const s1 = (s + 1) % segments
      index.push(a + s, a + s1, b + s, a + s1, b + s1, b + s)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geo.setAttribute('normal', new Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3))
  geo.setIndex(index)
  return geo
}

/** Hand-painted look baked once into a canvas: grass variation, paths, stepping stones, specks. */
function groundMaterial(size: number, paths: ReturnType<typeof islandPaths>): MeshToonMaterial {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const mat = toon(0xffffff)
  if (!ctx) {
    mat.color.set(0x7cbf86)
    return mat
  }
  const span = ISLAND_RADIUS + 1
  const ppm = size / (2 * span)
  const px = (x: number) => (x / (2 * span) + 0.5) * size
  const pz = (z: number) => (z / (2 * span) + 0.5) * size
  const rand = mulberry32(5)
  ctx.fillStyle = '#78bd80'
  ctx.fillRect(0, 0, size, size)
  const blobs = ['#6cb37a', '#8fcb88', '#7fc49a', '#a3cf84', '#68b090', '#93cf96', '#b9acdc', '#e2b4cc']
  for (let i = 0; i < 90; i += 1) {
    const x = rand() * size
    const y = rand() * size
    const r = (1.2 + rand() * 3.6) * ppm * (i > 70 ? 0.45 : 1)
    const color = i > 70 ? blobs[6 + (i % 2)] : blobs[i % 6]
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, `${color}00`)
    ctx.globalAlpha = i > 70 ? 0.55 : 0.75
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.5), rand() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // Painted blades for texture up close.
  ctx.lineCap = 'round'
  const blades = Math.round(size * size * 0.0016)
  for (let i = 0; i < blades; i += 1) {
    const x = rand() * size
    const y = rand() * size
    const len = (0.06 + rand() * 0.1) * ppm
    ctx.globalAlpha = 0.18 + rand() * 0.2
    ctx.strokeStyle = rand() > 0.5 ? '#4f9a66' : '#b4e0a0'
    ctx.lineWidth = Math.max(1, ppm * 0.018)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * len * 0.6, y - len)
    ctx.stroke()
  }
  // Paths: soft rim, cream fill, light centre.
  const stroke = (path: { x: number; z: number }[], width: number, color: string, alpha: number) => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = width * ppm
    ctx.lineJoin = 'round'
    ctx.beginPath()
    path.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))))
    ctx.stroke()
  }
  paths.forEach((path, k) => stroke(path, PATH_WIDTH[k] * 2 + 0.5, '#4f8f6a', 0.4))
  paths.forEach((path, k) => stroke(path, PATH_WIDTH[k] * 2 + 0.18, '#c58aa8', 1))
  paths.forEach((path, k) => stroke(path, PATH_WIDTH[k] * 2, '#deb2c2', 1))
  paths.forEach((path, k) => stroke(path, PATH_WIDTH[k] * 1.1, '#ebc8d2', 0.5))
  // Stepping stones and sand specks on the paths.
  for (const [k, path] of paths.entries()) {
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1]
      const b = path[i]
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const steps = Math.max(1, Math.round(len / 0.55))
      for (let j = 0; j < steps; j += 1) {
        if (rand() > 0.35) continue
        const t = j / steps
        const off = (rand() - 0.5) * PATH_WIDTH[k] * 1.2
        const nx = -(b.z - a.z) / (len || 1)
        const nz = (b.x - a.x) / (len || 1)
        const x = a.x + (b.x - a.x) * t + nx * off
        const z = a.z + (b.z - a.z) * t + nz * off
        const r = (0.08 + rand() * 0.1) * ppm
        ctx.globalAlpha = 0.9
        ctx.fillStyle = rand() > 0.5 ? '#fff6f8' : '#f1e6fa'
        ctx.beginPath()
        ctx.ellipse(px(x), pz(z), r, r * 0.75, rand() * 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.35
        ctx.strokeStyle = '#d9b3c4'
        ctx.lineWidth = Math.max(1, ppm * 0.02)
        ctx.stroke()
      }
    }
  }
  // Tiny flower specks in the grass.
  const specks = ['#ffffff', '#ffd1e4', '#fff0a8', '#d8c8ff']
  for (let i = 0; i < size * 0.9; i += 1) {
    const x = rand() * size
    const y = rand() * size
    ctx.globalAlpha = 0.85
    ctx.fillStyle = specks[i % specks.length]
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1, ppm * (0.025 + rand() * 0.03)), 0, Math.PI * 2)
    ctx.fill()
  }
  // Darker lip near the cliff so the edge reads.
  const cx = size / 2
  const edge = ctx.createRadialGradient(cx, cx, (ISLAND_RADIUS - 1.6) * ppm, cx, cx, (ISLAND_RADIUS + 0.6) * ppm)
  edge.addColorStop(0, 'rgba(110,170,120,0)')
  edge.addColorStop(1, 'rgba(110,170,120,0.55)')
  ctx.globalAlpha = 1
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, size, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.minFilter = LinearMipmapLinearFilter
  mat.map = tex
  return mat
}

/** Rim + layered cliff tapering to a point, coloured with vertex bands. */
function cliffGeometry(scale: number, _y: number, seed: number): BufferGeometry {
  const rand = mulberry32(seed)
  const segments = scale < 0.5 ? 18 : 72
  const bands = [
    { y: 0.03, r: 1.0, c: [0.62, 0.84, 0.58] },
    { y: -0.22, r: 1.012, c: [0.53, 0.77, 0.55] },
    { y: -0.5, r: 0.985, c: [0.96, 0.78, 0.86] },
    { y: -1.3, r: 0.95, c: [0.86, 0.7, 0.9] },
    { y: -2.3, r: 0.82, c: [0.95, 0.75, 0.82] },
    { y: -3.6, r: 0.6, c: [0.76, 0.6, 0.86] },
    { y: -5.0, r: 0.34, c: [0.66, 0.52, 0.8] },
    { y: -6.4, r: 0.1, c: [0.56, 0.44, 0.74] },
  ]
  const pos: number[] = []
  const col: number[] = []
  const jitter: number[] = []
  for (let s = 0; s < segments; s += 1) jitter.push(rand())
  for (let b = 0; b < bands.length; b += 1) {
    for (let s = 0; s <= segments; s += 1) {
      const ang = (s / segments) * Math.PI * 2
      const base = scale < 0.5 ? ISLAND_RADIUS : rimRadius(ang)
      const j = jitter[s % segments]
      const wobble = b > 1 ? 1 + (j - 0.5) * 0.12 : 1
      const r = base * bands[b].r * wobble * scale
      pos.push(Math.cos(ang) * r, bands[b].y * (scale < 0.5 ? scale * 2.2 : 1) + (b > 1 ? (j - 0.5) * 0.25 : 0), Math.sin(ang) * r)
      const shade = 0.92 + j * 0.12
      col.push(bands[b].c[0] * shade, bands[b].c[1] * shade, bands[b].c[2] * shade)
    }
  }
  const index: number[] = []
  const row = segments + 1
  for (let b = 0; b < bands.length - 1; b += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = b * row + s
      const c = (b + 1) * row + s
      index.push(a, a + 1, c, a + 1, c + 1, c)
    }
  }
  let geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new Float32BufferAttribute(col, 3))
  geo.setIndex(index)
  if (scale < 0.5) {
    // Small far islands get a grassy cap.
    const cap = new CylinderGeometry(ISLAND_RADIUS * scale, ISLAND_RADIUS * scale, 0.04, segments, 1)
    paint(cap, [0.66, 0.87, 0.62])
    for (const name of ['normal', 'uv', 'tint']) cap.deleteAttribute(name)
    geo = mergeGeometries([geo.toNonIndexed(), cap.toNonIndexed()]) ?? geo
  } else {
    geo = geo.toNonIndexed()
  }
  geo.computeVertexNormals()
  return geo
}

function tuftGeometry(): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const blades = 4
  for (let i = 0; i < blades; i += 1) {
    const ang = (i / blades) * Math.PI + i * 0.4
    const lean = 0.05 + (i % 2) * 0.04
    const h = 0.13 + (i % 3) * 0.04
    const w = 0.026
    const cx = Math.cos(ang)
    const cz = Math.sin(ang)
    const ox = (i - 1.5) * 0.025
    // Two-segment blade, bending outward.
    const p0 = [ox - cx * w, 0, -cz * w + ox * 0.3]
    const p1 = [ox + cx * w, 0, cz * w + ox * 0.3]
    const m0 = [ox - cx * w * 0.6 + lean * 0.4 * cz, h * 0.55, -cz * w * 0.6 - lean * 0.4 * cx]
    const m1 = [ox + cx * w * 0.6 + lean * 0.4 * cz, h * 0.55, cz * w * 0.6 - lean * 0.4 * cx]
    const tip = [ox + lean * cz, h, -lean * cx]
    pos.push(...p0, ...p1, ...m0, ...p1, ...m1, ...m0, ...m0, ...m1, ...tip)
    const dark = [0.78, 0.8, 0.78]
    const mid = [0.94, 0.95, 0.92]
    const light = [1.1, 1.1, 1.02]
    col.push(...dark, ...dark, ...mid, ...dark, ...mid, ...mid, ...mid, ...mid, ...light)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new Float32BufferAttribute(col, 3))
  geo.computeVertexNormals()
  // Point normals up so tufts shade like the lawn instead of flickering.
  const n = geo.attributes.normal as BufferAttribute
  for (let i = 0; i < n.count; i += 1) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3)
  return geo
}

function flowerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const stem = new CylinderGeometry(0.008, 0.011, 0.16, 4)
  stem.translate(0, 0.08, 0)
  paint(stem, [0.45, 0.72, 0.45], 0)
  parts.push(stem)
  for (let i = 0; i < 5; i += 1) {
    const petal = new SphereGeometry(0.03, 6, 4)
    petal.scale(1, 0.35, 0.6)
    petal.translate(0.032, 0.165, 0)
    petal.rotateY((i / 5) * Math.PI * 2)
    paint(petal, [1, 1, 1], 1)
    parts.push(petal)
  }
  const centre = new SphereGeometry(0.018, 6, 4)
  centre.translate(0, 0.172, 0)
  paint(centre, [1, 0.86, 0.42], 0)
  parts.push(centre)
  return mergeAll(parts)
}

function mushroomGeometry(): BufferGeometry {
  const stem = new CylinderGeometry(0.065, 0.09, 0.3, 7)
  stem.translate(0, 0.15, 0)
  paint(stem, [1, 0.96, 0.9], 0)
  const cap = new SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  cap.scale(1, 0.75, 1)
  cap.translate(0, 0.27, 0)
  paint(cap, [1, 1, 1], 1)
  const under = new ConeGeometry(0.2, 0.05, 10, 1, true)
  under.rotateX(Math.PI)
  under.translate(0, 0.255, 0)
  paint(under, [0.98, 0.88, 0.88], 0)
  const spots: BufferGeometry[] = []
  for (let i = 0; i < 5; i += 1) {
    const spot = new SphereGeometry(0.035, 5, 3)
    spot.scale(1, 0.4, 1)
    const ang = i * 1.3
    const tilt = 0.5 + (i % 2) * 0.35
    spot.translate(Math.sin(tilt) * 0.2 * Math.cos(ang), 0.27 + Math.cos(tilt) * 0.155, Math.sin(tilt) * 0.2 * Math.sin(ang))
    paint(spot, [1, 1, 1], 0)
    spots.push(spot)
  }
  return mergeAll([stem, cap, under, ...spots])
}

function crystalGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const shards = [
    [0, 0, 0.55, 0.13, 0],
    [0.14, 0.05, 0.35, 0.09, 0.45],
    [-0.12, -0.04, 0.3, 0.08, -0.5],
  ]
  for (const [x, z, h, r, lean] of shards) {
    const g = new OctahedronGeometry(r, 0)
    g.scale(1, h / r, 1)
    g.translate(0, h * 0.8, 0)
    g.rotateZ(lean * 0.6)
    g.rotateX(lean * 0.3)
    g.translate(x, 0, z)
    parts.push(g)
  }
  const merged = mergeAll(parts.map((g) => paint(g, [1, 1, 1], 1)))
  merged.computeVertexNormals()
  return merged
}

function pebbleGeometry(): BufferGeometry {
  const g = new DodecahedronGeometry(0.07, 0)
  g.translate(0, 0.03, 0)
  return g
}


function cloudSea(time: { value: number }): Mesh {
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: time,
      uLow: { value: new Color(0x8a68c0) },
      uHigh: { value: new Color(0xffd6ee) },
      uInner: { value: CLOUD_SEA_INNER },
    },
    vertexShader: 'varying vec2 vXZ; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; uniform vec3 uLow; uniform vec3 uHigh; uniform float uInner; varying vec2 vXZ;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int k = 0; k < 4; k++){ v += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
      void main(){
        vec2 p = vXZ * 0.07 + vec2(uTime * 0.012, uTime * 0.007);
        float c = fbm(p);
        float r = length(vXZ);
        float alpha = smoothstep(0.38, 0.72, c) * smoothstep(uInner, uInner + 5.0, r) * (1.0 - smoothstep(42.0, 56.0, r));
        vec3 col = mix(uLow, uHigh, smoothstep(0.45, 0.85, c));
        gl_FragColor = vec4(col, alpha * 0.85);
        #include <colorspace_fragment>
      }`,
  })
  const sea = new Mesh(new RingGeometry(ISLAND_RADIUS - 1, 58, 128, 2), mat)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = CLOUD_SEA_Y
  sea.name = 'cloud-sea'
  sea.renderOrder = -0.5
  return sea
}

function skyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(0x1c1240) },
      mid: { value: new Color(0x6a4a9e) },
      horizon: { value: new Color(0xf2b8d8) },
      bottom: { value: new Color(0x2a1a4a) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(horizon, mix(mid, top, smoothstep(0.25, 0.9, y)), smoothstep(0.0, 0.3, y)) : mix(horizon, bottom, smoothstep(0.0, 0.45, -y));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  })
  const sky = new Mesh(new SphereGeometry(60, 24, 16), mat)
  sky.name = 'sky'
  sky.renderOrder = -1
  return sky
}

function glowMotes(count: number, time: { value: number }): Points {
  const rand = mulberry32(83)
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const ang = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * (ISLAND_RADIUS + 2)
    pos[i * 3] = Math.cos(ang) * r
    pos[i * 3 + 1] = 0.25 + rand() * 2.2
    pos[i * 3 + 2] = Math.sin(ang) * r
    seed[i] = rand() * 100
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('seed', new BufferAttribute(seed, 1))
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: time, uScale: { value: Math.min(window.devicePixelRatio || 1, 1.6) * 220 } },
    vertexShader: `attribute float seed; uniform float uTime; uniform float uScale; varying float vA; varying float vHue;
      void main(){ vec3 p = position; float t = uTime * 0.6 + seed;
        p.x += sin(t * 0.7) * 0.35; p.z += cos(t * 0.5) * 0.35; p.y += sin(t * 1.3) * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = 0.55 + 0.45 * sin(uTime * 2.2 + seed * 3.0); vHue = fract(seed * 0.37);
        gl_PointSize = uScale * (0.05 + 0.03 * vA) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying float vHue;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r);
        vec3 c = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.78, 0.92), vHue); gl_FragColor = vec4(c * a * vA, a * vA); }`,
  })
  const points = new Points(geo, mat)
  points.name = 'motes'
  points.frustumCulled = false
  return points
}

function instanced(
  geometry: BufferGeometry,
  material: MeshToonMaterial,
  spots: Spot[],
  tint: (spot: Spot, color: Color) => void,
  shape?: (spot: Spot, dummy: Object3D) => void,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, spots.length))
  mesh.count = spots.length
  const dummy = new Object3D()
  const color = new Color()
  spots.forEach((spot, i) => {
    dummy.position.set(spot.x, 0.02, spot.z)
    dummy.rotation.set(0, spot.turn, 0)
    dummy.scale.setScalar(spot.scale)
    shape?.(spot, dummy)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    tint(spot, color)
    mesh.setColorAt(i, color)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

function toonVertex(doubleSide = false): MeshToonMaterial {
  const mat = new MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() })
  if (doubleSide) mat.side = 2
  return mat
}

/** Only vertices with tint = 1 take the per-instance colour (petals, caps), the rest keep their own. */
function tintable(mat: MeshToonMaterial): MeshToonMaterial {
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;')
      .replace('#include <color_vertex>', `vColor = vec3(1.0);\n#ifdef USE_COLOR\nvColor *= color;\n#endif\n#ifdef USE_INSTANCING_COLOR\nvColor *= mix(vec3(1.0), instanceColor.xyz, tint);\n#endif`)
  }
  mat.customProgramCacheKey = () => 'tintable'
  return mat
}

/** Wind: tips sway, roots stay planted. */
function sway(mat: MeshToonMaterial, time: { value: number }, amount: number): MeshToonMaterial {
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer)
    shader.uniforms.uTime = time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 root = instanceMatrix[3].xyz;
float bend = transformed.y * ${amount.toFixed(2)};
float gust = sin(uTime * 1.7 + root.x * 0.45 + root.z * 0.3) * 0.6 + sin(uTime * 3.1 + root.z * 1.3) * 0.25;
transformed.x += gust * bend * 0.35;
transformed.z += cos(uTime * 1.3 + root.x * 0.8) * bend * 0.12;
#endif`,
      )
  }
  mat.customProgramCacheKey = () => `sway-${amount}-${mat.onBeforeCompile.length}`
  return mat
}


function paint(geo: BufferGeometry, rgb: number[], tint = 0): BufferGeometry {
  const count = geo.attributes.position.count
  const col = new Float32Array(count * 3)
  const mask = new Float32Array(count).fill(tint)
  for (let i = 0; i < count; i += 1) col.set(rgb, i * 3)
  geo.setAttribute('color', new BufferAttribute(col, 3))
  geo.setAttribute('tint', new BufferAttribute(mask, 1))
  return geo
}

function mergeAll(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g
    if (!n.attributes.uv) n.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2))
    if (!n.attributes.normal) n.computeVertexNormals()
    return n
  })
  const merged = mergeGeometries(flat)
  if (!merged) throw new Error('decor merge failed')
  return merged
}
