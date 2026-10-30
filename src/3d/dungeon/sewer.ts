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
  PlaneGeometry,
} from 'three'
import { toonGradient } from '../materials'
import { CEILING, TILE, Tile, tileCentre, type Maze } from './maze'

/** Wall faces between an open tile and a solid one: tile, side (0 +x, 1 -x, 2 +z, 3 -z). */
export function wallFaces(maze: Maze): { x: number; y: number; side: number }[] {
  const out: { x: number; y: number; side: number }[] = []
  const solid = (x: number, y: number) => x < 0 || y < 0 || x >= maze.w || y >= maze.h || maze.tiles[y * maze.w + x] === Tile.Solid
  for (let y = 0; y < maze.h; y += 1) {
    for (let x = 0; x < maze.w; x += 1) {
      if (solid(x, y)) continue
      if (solid(x + 1, y)) out.push({ x, y, side: 0 })
      if (solid(x - 1, y)) out.push({ x, y, side: 1 })
      if (solid(x, y + 1)) out.push({ x, y, side: 2 })
      if (solid(x, y - 1)) out.push({ x, y, side: 3 })
    }
  }
  return out
}

/** Room tint per tile kind, so the start, halls and the boss room read apart. */
const FLOOR_TINT: Record<number, number> = {
  [Tile.Corridor]: 0x8f7fb8,
  [Tile.Chamber]: 0x7fa9b8,
  [Tile.Start]: 0xb8a0c8,
  [Tile.Boss]: 0xb87fa8,
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
        if (!up) c.multiplyScalar(0.7)
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
    const mesh = new Mesh(this.quads(0, true), new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }))
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
    const geo = new PlaneGeometry(TILE, CEILING)
    geo.translate(0, CEILING / 2, 0)
    const mesh = new InstancedMesh(geo, new MeshToonMaterial({ color: 0xa68fd0, gradientMap: toonGradient() }), faces.length)
    const o = new Object3D()
    const yawFor = [-Math.PI / 2, Math.PI / 2, Math.PI, 0]
    faces.forEach((f, i) => {
      const { x, z } = tileCentre(this.maze, f.x, f.y)
      const h = TILE / 2
      o.position.set(x + (f.side === 0 ? h : f.side === 1 ? -h : 0), 0, z + (f.side === 2 ? h : f.side === 3 ? -h : 0))
      o.rotation.set(0, yawFor[f.side], 0)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
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
