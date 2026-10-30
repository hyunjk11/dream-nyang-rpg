import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  Object3D,
} from 'three'
import { toonGradient } from '../materials'
import { DREAM, brickTexture, flagTexture, hash } from './dream'
import { CEILING, TILE, Tile, tileCentre, type Maze } from './maze'
import { wallFaces } from './walls'

export { wallFaces }

/** Radius of the vault where each wall curls in to meet the ceiling (an arched brick tunnel). */
export const VAULT = 1.05

/**
 * One wall face: straight up from the floor, then a quarter arc curling 1.05 m into the tunnel
 * to the ceiling. Faces +z, spans x in [-TILE/2, TILE/2]. UVs in brick units.
 */
export function vaultGeometry(segments = 7): BufferGeometry {
  const prof: [number, number, number][] = [] // [z, y, arc length]
  const y0 = CEILING - VAULT
  prof.push([0, 0, 0], [0, y0, y0])
  let len = y0
  let pz = 0
  let py = y0
  for (let i = 1; i <= segments; i += 1) {
    const a = Math.PI - (i / segments) * (Math.PI / 2)
    const z = VAULT + Math.cos(a) * VAULT
    const y = y0 + Math.sin(a) * VAULT
    len += Math.hypot(z - pz, y - py)
    prof.push([z, y, len])
    pz = z
    py = y
  }
  const pos: number[] = []
  const uv: number[] = []
  const h = TILE / 2
  for (let i = 0; i < prof.length - 1; i += 1) {
    const [z0, ya, s0] = prof[i]
    const [z1, yb, s1] = prof[i + 1]
    const quad = [
      [-h, ya, z0, 0, s0],
      [h, ya, z0, 1, s0],
      [h, yb, z1, 1, s1],
      [-h, yb, z1, 0, s1],
    ]
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const q = quad[k]
      pos.push(q[0], q[1], q[2])
      uv.push(q[3] * 1.5, q[4] / 2.4)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  return geo
}

/** Room tint per tile kind, so the start, halls and the boss room read apart. */
const FLOOR_TINT: Record<number, number> = {
  [Tile.Corridor]: 0x8576b0,
  [Tile.Chamber]: 0x6f9eaa,
  [Tile.Start]: 0x8f9ed0,
  [Tile.Boss]: 0xb482ac,
}

/**
 * Tunnel shell: one merged floor, one merged ceiling, and the wall faces as one InstancedMesh.
 * Three draw calls whatever the maze size.
 */
export class Sewer {
  readonly group = new Group()
  readonly maze: Maze

  constructor(maze: Maze) {
    this.maze = maze
    this.group.name = 'sewer'
    this.group.add(this.floor(), this.ceiling(), this.walls())
  }

  private quads(y: number, up: boolean): BufferGeometry {
    const maze = this.maze
    const pos: number[] = []
    const col: number[] = []
    const uv: number[] = []
    const c = new Color()
    const h = TILE / 2
    for (let ty = 0; ty < maze.h; ty += 1) {
      for (let tx = 0; tx < maze.w; tx += 1) {
        const kind = maze.tiles[ty * maze.w + tx]
        if (kind === Tile.Solid) continue
        const { x, z } = tileCentre(maze, tx, ty)
        c.set(FLOOR_TINT[kind] ?? 0x8f7fb8)
        if (!up) c.set(0x4a3870)
        const a = [x - h, y, z - h]
        const b = [x + h, y, z - h]
        const d = [x - h, y, z + h]
        const e = [x + h, y, z + h]
        const tri = up ? [a, d, b, b, d, e] : [a, b, d, b, e, d]
        for (const p of tri) {
          pos.push(p[0], p[1], p[2])
          col.push(c.r, c.g, c.b)
          uv.push(p[0] / TILE, p[2] / TILE)
        }
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  }

  private floor(): Mesh {
    const mesh = new Mesh(this.quads(0, true), new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), map: flagTexture() }))
    mesh.name = 'sewer-floor'
    mesh.receiveShadow = true
    return mesh
  }

  private ceiling(): Mesh {
    const mesh = new Mesh(this.quads(CEILING, false), new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: DoubleSide }))
    mesh.name = 'sewer-ceiling'
    return mesh
  }

  private walls(): InstancedMesh {
    const faces = wallFaces(this.maze)
    const geo = vaultGeometry()
    const mat = new MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: brickTexture(), side: DoubleSide })
    const mesh = new InstancedMesh(geo, mat, faces.length)
    const o = new Object3D()
    const tint = new Color()
    const yawFor = [-Math.PI / 2, Math.PI / 2, Math.PI, 0]
    faces.forEach((f, i) => {
      const { x, z } = tileCentre(this.maze, f.x, f.y)
      const h = TILE / 2
      o.position.set(x + (f.side === 0 ? h : f.side === 1 ? -h : 0), 0, z + (f.side === 2 ? h : f.side === 3 ? -h : 0))
      o.rotation.set(0, yawFor[f.side], 0)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      // Districts of lavender, mint and pink brick, so each part of the maze reads apart.
      const kind = this.maze.tiles[f.y * this.maze.w + f.x]
      const base = kind === Tile.Boss ? DREAM.brick[2] : DREAM.brick[Math.floor(hash(f.x >> 2, f.y >> 2, 1) * DREAM.brick.length)]
      mesh.setColorAt(i, tint.set(base))
    })
    mesh.name = 'sewer-walls'
    mesh.receiveShadow = true
    return mesh
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) m.dispose()
    })
    this.group.removeFromParent()
  }
}
