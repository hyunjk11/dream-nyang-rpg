/**
 * 몽실 들판's dressing (2026-11): round pastel toon trees on the grove tiles and in a ring round the
 * edge, a winding river with a flowing ripple texture and pebble banks, two wooden bridges and a
 * stepping-stone ford, and flowers, bushes and rocks over the grass. Everything is instanced (a
 * handful of draw calls); the river's look is one scrolled texture. Only the grove tiles and the
 * river block anyone (see Tile.Water); flowers, bushes and rocks are dressing you walk through.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  RepeatWrapping,
  SphereGeometry,
  type Material,
} from 'three'
import { toonGradient } from '../../core/materials'
import { TILE, Tile, rng, tileCentre, type Crossing, type Maze } from './maze'

/** Instance budgets (desktop, mobile). */
export const MEADOW = {
  flowers: [420, 200] as const,
  bushes: [90, 50] as const,
  rocks: [46, 26] as const,
  /** Outer tree ring past the border (desktop only: it is just depth). */
  outerRing: true,
  /** Pastel crowns. */
  crowns: [0xff9ec8, 0x9fd88a, 0x8cc4ff, 0xc9a8ff, 0xffc98a, 0x7fd4b0],
  flowerColors: [0xfff3a0, 0xffb0d0, 0xffffff, 0xc8b0ff, 0xa0d8ff, 0xffc890],
  grass: [0xaedcae, 0xbfe6b4, 0xa4d4b0, 0xc8ecc0],
  /** Fog / sky for the field. */
  sky: 0xc4e2f4,
} as const

const toon = (color: number, lift = 0.16) => new MeshToonMaterial({ color, gradientMap: toonGradient(), emissive: color, emissiveIntensity: lift })
/** For per-instance colours: the emissive lift must carry the instance tint too, so none (a white lift washed the pastels grey). */
const tinted = () => new MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() })

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Smooth value noise (0..1) over world metres: soft patches of lighter and darker grass. */
function noise(x: number, z: number, scale: number): number {
  const gx = x / scale
  const gz = z / scale
  const ix = Math.floor(gx)
  const iz = Math.floor(gz)
  const fx = gx - ix
  const fz = gz - iz
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}

/** Tree spots: grove tiles inside the field and the border ring (plus an outer ring for depth). */
export function treeSpots(maze: Maze, outer: boolean): { x: number; z: number; s: number; border: boolean }[] {
  const out: { x: number; z: number; s: number; border: boolean }[] = []
  const rand = rng(maze.seed ^ 0x7ee5)
  for (let ty = 0; ty < maze.h; ty += 1) {
    for (let tx = 0; tx < maze.w; tx += 1) {
      if (maze.tiles[ty * maze.w + tx] !== Tile.Solid) continue
      const c = tileCentre(maze, tx, ty)
      const border = tx === 0 || ty === 0 || tx === maze.w - 1 || ty === maze.h - 1
      const j = border ? 0.5 : 0.35
      out.push({ x: c.x + (rand() - 0.5) * j * TILE, z: c.z + (rand() - 0.5) * j * TILE, s: (border ? 1.15 : 0.95) + rand() * 0.35, border })
    }
  }
  if (outer) {
    for (let k = -1; k <= maze.w; k += 1) {
      for (const side of [0, 1, 2, 3]) {
        const tx = side < 2 ? k : side === 2 ? -1.7 : maze.w + 0.7
        const ty = side < 2 ? (side === 0 ? -1.7 : maze.h + 0.7) : k
        if (side >= 2 && (k < 0 || k >= maze.h)) continue
        const c = tileCentre(maze, tx, ty)
        out.push({ x: c.x + (rand() - 0.5) * TILE * 0.6, z: c.z + (rand() - 0.5) * TILE * 0.6, s: 1.4 + rand() * 0.5, border: true })
      }
    }
  }
  return out
}

/** Tiles where dressing (flowers, bushes, rocks) may go: open grass, not the river, crossings or the portal pocket. */
export function grassTiles(maze: Maze): number[] {
  const out: number[] = []
  for (let i = 0; i < maze.tiles.length; i += 1) if (maze.tiles[i] === Tile.Chamber) out.push(i)
  return out
}

function rippleTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 64, 64)
  g.strokeStyle = 'rgba(150, 190, 255, 0.55)'
  g.lineWidth = 3
  for (let k = 0; k < 4; k += 1) {
    g.beginPath()
    for (let x = 0; x <= 64; x += 4) {
      const y = k * 16 + 6 + Math.sin((x / 64) * Math.PI * 2 + k) * 3
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.9)'
  for (let k = 0; k < 10; k += 1) g.fillRect((k * 23) % 64, (k * 37) % 64, 3, 2)
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  return t
}

export class MeadowScenery {
  readonly group = new Group()
  private readonly maze: Maze
  private readonly ripple: CanvasTexture | null
  private readonly crossings: Crossing[]

  constructor(maze: Maze, mobile: boolean) {
    this.maze = maze
    this.group.name = 'meadow'
    this.crossings = maze.river?.crossings ?? []
    const rand = rng(maze.seed ^ 0x3ad0)
    this.trees(mobile)
    this.ripple = typeof document !== 'undefined' ? rippleTexture() : null
    this.river()
    this.banks()
    for (const c of this.crossings) this.group.add(c.kind === 'bridge' ? this.bridge(c) : this.stones(c, rand))
    this.scatter(mobile, rand)
  }

  /** Grass colours on the run's floor mesh (smooth patches; the river bed, paths and portal pocket). */
  paintFloor(floor: Mesh): void {
    const color = floor.geometry.getAttribute('color')
    const pos = floor.geometry.getAttribute('position')
    if (!color || !pos) return
    const maze = this.maze
    const grass = MEADOW.grass.map((g) => new Color(g))
    const bed = new Color(0x9cc8e8)
    const path = new Color(0xf0e0c4)
    const c = new Color()
    let v = 0
    for (let ty = 0; ty < maze.h; ty += 1) {
      for (let tx = 0; tx < maze.w; tx += 1) {
        const kind = maze.tiles[ty * maze.w + tx]
        if (kind === Tile.Solid) continue
        for (let k = 0; k < 6; k += 1) {
          const x = pos.getX(v)
          const z = pos.getZ(v)
          if (kind === Tile.Water) c.copy(bed)
          else if (kind === Tile.Corridor || kind === Tile.Start) c.copy(path)
          else {
            const n = noise(x, z, 9)
            const m = noise(x + 50, z - 30, 3.5)
            const i = Math.min(grass.length - 1, Math.floor(n * grass.length))
            c.copy(grass[i]).lerp(grass[(i + 1) % grass.length], m * 0.5)
            if (kind === Tile.Boss) c.lerp(new Color(0xf2c4dc), 0.35)
          }
          color.setXYZ(v, c.r, c.g, c.b)
          v += 1
        }
      }
    }
    color.needsUpdate = true
    // Flagstones don't belong on a lawn.
    const mat = floor.material as MeshToonMaterial
    if (mat && 'map' in mat) {
      mat.map = null
      mat.needsUpdate = true
    }
  }

  private trees(mobile: boolean): void {
    const spots = treeSpots(this.maze, MEADOW.outerRing && !mobile)
    const n = spots.length
    const trunk = new InstancedMesh(new CylinderGeometry(0.22, 0.32, 1, 7), toon(0xb08868, 0.12), n)
    trunk.name = 'meadow-trunks'
    const crownGeo = new IcosahedronGeometry(1, mobile ? 0 : 1)
    const crown = new InstancedMesh(crownGeo, tinted(), n * 2)
    crown.name = 'meadow-crowns'
    const blob = new InstancedMesh(new CircleGeometry(1, 16), new MeshBasicMaterial({ color: 0x3a4a5a, transparent: true, opacity: 0.16, depthWrite: false }), n)
    blob.name = 'meadow-tree-shadows'
    const o = new Object3D()
    const col = new Color()
    const rand = rng(this.maze.seed ^ 0x51a7)
    spots.forEach((t, i) => {
      const h = 1.5 * t.s
      o.position.set(t.x, h / 2, t.z)
      o.rotation.set(0, 0, 0)
      o.scale.set(t.s, h, t.s)
      o.updateMatrix()
      trunk.setMatrixAt(i, o.matrix)
      const r = 1.55 * t.s
      for (let k = 0; k < 2; k += 1) {
        const rr = k ? r * 0.68 : r
        o.position.set(t.x + (k ? (rand() - 0.5) * 0.6 : 0), h + rr * (k ? 1.45 : 0.75), t.z + (k ? (rand() - 0.5) * 0.6 : 0))
        o.rotation.set(rand(), rand() * Math.PI, 0)
        o.scale.set(rr, rr * 0.92, rr)
        o.updateMatrix()
        crown.setMatrixAt(i * 2 + k, o.matrix)
        col.set(MEADOW.crowns[Math.floor(rand() * MEADOW.crowns.length)])
        if (k) col.offsetHSL(0, 0, 0.05)
        crown.setColorAt(i * 2 + k, col)
      }
      o.position.set(t.x, 0.03, t.z)
      o.rotation.set(-Math.PI / 2, 0, 0)
      o.scale.set(r * 0.95, r * 0.95, 1)
      o.updateMatrix()
      blob.setMatrixAt(i, o.matrix)
    })
    for (const m of [trunk, crown, blob]) {
      m.instanceMatrix.needsUpdate = true
      m.computeBoundingSphere()
      this.group.add(m)
    }
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true
  }

  /** One mesh of quads over the water tiles (crossings: the ford stays water, bridges don't need it). */
  private river(): void {
    const maze = this.maze
    const pos: number[] = []
    const uv: number[] = []
    const h = TILE / 2
    const ford = (tx: number, ty: number) => this.crossings.some((c) => c.kind === 'stones' && tx >= c.x && tx < c.x + c.len && ty >= c.y && ty <= c.y + 1)
    for (let ty = 0; ty < maze.h; ty += 1) {
      for (let tx = 0; tx < maze.w; tx += 1) {
        const t = maze.tiles[ty * maze.w + tx]
        if (t !== Tile.Water && !ford(tx, ty)) continue
        const { x, z } = tileCentre(maze, tx, ty)
        const y = 0.05
        const quad = [
          [x - h, z - h],
          [x - h, z + h],
          [x + h, z - h],
          [x + h, z - h],
          [x - h, z + h],
          [x + h, z + h],
        ]
        for (const [px, pz] of quad) {
          pos.push(px, y, pz)
          uv.push(px / (TILE * 1.6), pz / (TILE * 1.6))
        }
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    const mat = new MeshBasicMaterial({ color: new Color(0x8ec8ff), map: this.ripple })
    const mesh = new Mesh(geo, mat)
    mesh.name = 'meadow-river'
    this.group.add(mesh)
  }

  /** Pebbles and grass tufts along every water edge that meets grass. */
  private banks(): void {
    const maze = this.maze
    const spots: { x: number; z: number; r: number }[] = []
    const rand = rng(maze.seed ^ 0xba7c)
    const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < maze.w && y < maze.h && maze.tiles[y * maze.w + x] === Tile.Water
    const open = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= maze.w || y >= maze.h) return false
      const t = maze.tiles[y * maze.w + x]
      return t === Tile.Chamber || t === Tile.Boss || t === Tile.Start
    }
    for (let ty = 0; ty < maze.h; ty += 1) {
      for (let tx = 0; tx < maze.w; tx += 1) {
        if (!isWater(tx, ty)) continue
        const c = tileCentre(maze, tx, ty)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!open(tx + dx, ty + dy)) continue
          for (let k = 0; k < 3; k += 1) {
            const along = (k / 2 - 0.5) * TILE * 0.85 + (rand() - 0.5) * 0.5
            spots.push({ x: c.x + dx * TILE * 0.5 + (dy ? along : 0), z: c.z + dy * TILE * 0.5 + (dx ? along : 0), r: 0.32 + rand() * 0.3 })
          }
        }
      }
    }
    const pebbles = new InstancedMesh(new DodecahedronGeometry(1, 0), tinted(), spots.length)
    pebbles.name = 'meadow-banks'
    const o = new Object3D()
    const col = new Color()
    spots.forEach((s, i) => {
      o.position.set(s.x, 0.05, s.z)
      o.rotation.set(rand(), rand() * 3, rand())
      o.scale.set(s.r, s.r * 0.55, s.r)
      o.updateMatrix()
      pebbles.setMatrixAt(i, o.matrix)
      col.set(rand() < 0.5 ? 0xd8d0e8 : 0xe8e0d0)
      pebbles.setColorAt(i, col)
    })
    pebbles.instanceMatrix.needsUpdate = true
    if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true
    pebbles.computeBoundingSphere()
    this.group.add(pebbles)
  }

  /** A wooden bridge over a crossing (deck of planks, two rails with posts), a tile of ramp each side. */
  private bridge(c: Crossing): Group {
    const g = new Group()
    g.name = 'meadow-bridge'
    const a = tileCentre(this.maze, c.x, c.y)
    const b = tileCentre(this.maze, c.x + c.len - 1, c.y + 1)
    const cx = (a.x + b.x) / 2
    const cz = (a.z + b.z) / 2
    const length = c.len * TILE + 1.2
    const width = TILE * 2 - 1.1
    const planks = Math.round(length / 0.5)
    const plank = new InstancedMesh(new BoxGeometry(0.44, 0.12, width), toon(0xe0b88a, 0.16), planks)
    const o = new Object3D()
    for (let i = 0; i < planks; i += 1) {
      const x = cx - length / 2 + (i + 0.5) * (length / planks)
      // A gentle hump over the middle.
      const t = (x - cx) / (length / 2)
      o.position.set(x, 0.07 + 0.08 * (1 - t * t), cz)
      o.rotation.set(0, (hash2(i, c.y) - 0.5) * 0.04, 0)
      o.updateMatrix()
      plank.setMatrixAt(i, o.matrix)
    }
    plank.instanceMatrix.needsUpdate = true
    plank.computeBoundingSphere()
    g.add(plank)
    const wood = toon(0xc89a70, 0.14)
    for (const side of [-1, 1]) {
      const rail = new Mesh(new BoxGeometry(length, 0.12, 0.14), wood)
      rail.position.set(cx, 0.95, cz + side * (width / 2 - 0.05))
      g.add(rail)
      const posts = Math.max(3, c.len + 2)
      const post = new InstancedMesh(new CylinderGeometry(0.08, 0.1, 0.9, 6), wood, posts)
      for (let i = 0; i < posts; i += 1) {
        o.position.set(cx - length / 2 + 0.2 + (i * (length - 0.4)) / (posts - 1), 0.5, cz + side * (width / 2 - 0.05))
        o.rotation.set(0, 0, 0)
        o.updateMatrix()
        post.setMatrixAt(i, o.matrix)
      }
      post.instanceMatrix.needsUpdate = true
      post.computeBoundingSphere()
      g.add(post)
    }
    return g
  }

  /** Stepping stones over a shallow ford. */
  private stones(c: Crossing, rand: () => number): InstancedMesh {
    const a = tileCentre(this.maze, c.x, c.y)
    const b = tileCentre(this.maze, c.x + c.len - 1, c.y + 1)
    const x0 = a.x - TILE / 2
    const x1 = b.x + TILE / 2
    const z0 = a.z - TILE / 2
    const z1 = b.z + TILE / 2
    const cols = Math.max(3, Math.round((x1 - x0) / 1.1))
    const rows = 4
    const n = cols * rows
    const mesh = new InstancedMesh(new CylinderGeometry(1, 1.1, 1, 9), toon(0xe4dcec, 0.16), n)
    mesh.name = 'meadow-stones'
    const o = new Object3D()
    let i = 0
    for (let r = 0; r < rows; r += 1) {
      for (let k = 0; k < cols; k += 1) {
        const x = x0 + ((k + 0.5 + (r % 2) * 0.4) / cols) * (x1 - x0)
        const z = z0 + ((r + 0.5) / rows) * (z1 - z0) + (rand() - 0.5) * 0.3
        const s = 0.42 + rand() * 0.14
        o.position.set(Math.min(x1 - 0.3, x), 0.09, z)
        o.rotation.set(0, rand() * 3, 0)
        o.scale.set(s, 0.14, s * (0.8 + rand() * 0.3))
        o.updateMatrix()
        mesh.setMatrixAt(i++, o.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return mesh
  }

  /** Flowers, bushes and rocks over the grass (dressing: none of them block). */
  private scatter(mobile: boolean, rand: () => number): void {
    const maze = this.maze
    const grass = grassTiles(maze)
    const pick = () => {
      const i = grass[Math.floor(rand() * grass.length)]
      const c = tileCentre(maze, i % maze.w, Math.floor(i / maze.w))
      return { x: c.x + (rand() - 0.5) * TILE * 0.9, z: c.z + (rand() - 0.5) * TILE * 0.9 }
    }
    const q = mobile ? 1 : 0
    const o = new Object3D()
    const col = new Color()
    // Flowers: little clusters (a few heads round one spot), pastel colours.
    const nf = MEADOW.flowers[q]
    const flowers = new InstancedMesh(new IcosahedronGeometry(0.13, 0), new MeshBasicMaterial({ color: 0xffffff }), nf)
    flowers.name = 'meadow-flowers'
    let at = pick()
    for (let i = 0; i < nf; i += 1) {
      if (i % 6 === 0) at = pick()
      o.position.set(at.x + (rand() - 0.5) * 1.6, 0.14 + rand() * 0.12, at.z + (rand() - 0.5) * 1.6)
      o.rotation.set(rand(), rand(), 0)
      const s = 0.8 + rand() * 0.6
      o.scale.set(s, s * 0.7, s)
      o.updateMatrix()
      flowers.setMatrixAt(i, o.matrix)
      col.set(MEADOW.flowerColors[Math.floor(rand() * MEADOW.flowerColors.length)])
      flowers.setColorAt(i, col)
    }
    // Bushes: two or three overlapping balls.
    const nb = MEADOW.bushes[q]
    const bushes = new InstancedMesh(new SphereGeometry(1, mobile ? 7 : 10, mobile ? 5 : 7), tinted(), nb * 3)
    bushes.name = 'meadow-bushes'
    for (let i = 0; i < nb; i += 1) {
      const p = pick()
      const base = 0.45 + rand() * 0.35
      const tint = [0x98d4a0, 0xa8dcb0, 0xb8e0a8, 0xd0e8b0][Math.floor(rand() * 4)]
      for (let k = 0; k < 3; k += 1) {
        const s = base * (k ? 0.75 : 1)
        o.position.set(p.x + (k ? (rand() - 0.5) * base * 1.6 : 0), s * 0.6, p.z + (k ? (rand() - 0.5) * base * 1.6 : 0))
        o.rotation.set(0, 0, 0)
        o.scale.set(s, s * 0.8, s)
        o.updateMatrix()
        bushes.setMatrixAt(i * 3 + k, o.matrix)
        col.set(tint)
        if (k) col.offsetHSL(0, 0, 0.04)
        bushes.setColorAt(i * 3 + k, col)
      }
    }
    // Rocks: round, soft lilac-grey.
    const nr = MEADOW.rocks[q]
    const rocks = new InstancedMesh(new DodecahedronGeometry(1, 0), toon(0xd4cce0, 0.14), nr)
    rocks.name = 'meadow-rocks'
    for (let i = 0; i < nr; i += 1) {
      const p = pick()
      const s = 0.25 + rand() * 0.45
      o.position.set(p.x, s * 0.35, p.z)
      o.rotation.set(rand(), rand() * 3, rand())
      o.scale.set(s * 1.2, s * 0.7, s)
      o.updateMatrix()
      rocks.setMatrixAt(i, o.matrix)
    }
    for (const m of [flowers, bushes, rocks]) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
      this.group.add(m)
    }
  }

  /** The river flows south (a scrolled ripple texture). */
  update(dt: number): void {
    if (this.ripple) {
      this.ripple.offset.y -= dt * 0.22
      this.ripple.offset.x = Math.sin(this.ripple.offset.y * 3) * 0.04
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh
      m.geometry?.dispose()
      const mat = m.material as Material | Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.ripple?.dispose()
  }
}
