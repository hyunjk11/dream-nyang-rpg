import { BoxGeometry, Color, ConeGeometry, Group, InstancedMesh, MeshToonMaterial, Object3D, type BufferGeometry } from 'three'
import { toonGradient } from '../../core/materials'
import { DREAM, hash } from './dream'
import { TILE, Tile, tileCentre, type Maze } from './maze'
import { wallFaces } from './walls'

/**
 * Dungeon looks that rotate with depth: 꿈 하수도 (1, 4, 7…), 캔디 동굴 (2, 5…), 별빛 서재 (3, 6…).
 * Each one is a palette (fog, sky light, brick districts, floor/ceiling tints, lamp colours) plus
 * one cheap family of props along the walls (one or two instanced draw calls).
 */
export type ThemeId = 'sewer' | 'candy' | 'library'

export interface DungeonTheme {
  id: ThemeId
  name: string
  fog: number
  /** Hemisphere sky colour (the soft fill light). */
  sky: number
  /** Brick districts (wall tint per 4×4 tile block); [2] is also the boss room. */
  brick: readonly [number, number, number]
  /** Floor tint per tile kind. */
  floor: { corridor: number; chamber: number; start: number; boss: number }
  ceiling: number
  /** Star lamps and their floor glow. */
  lamps: readonly number[]
  /** Pipe stripes. */
  pipes: readonly number[]
  /** Props along the walls: none, candy crystals, or bookshelves. */
  props: 'none' | 'crystals' | 'shelves'
}

export const THEMES: Record<ThemeId, DungeonTheme> = {
  sewer: {
    id: 'sewer',
    name: '꿈 하수도',
    fog: 0x55407e,
    sky: 0xe6d8ff,
    brick: DREAM.brick,
    floor: { corridor: 0x8576b0, chamber: 0x6f9eaa, start: 0x8f9ed0, boss: 0xb482ac },
    ceiling: 0x4a3870,
    lamps: [DREAM.lemon, DREAM.pink, DREAM.sky, DREAM.teal],
    pipes: [DREAM.pink, DREAM.teal, DREAM.lemon, DREAM.lavender],
    props: 'none',
  },
  candy: {
    id: 'candy',
    name: '캔디 동굴',
    fog: 0x7a3a5e,
    sky: 0xffdcea,
    brick: [0xffb8cf, 0xffd6a8, 0xf6c2ff],
    floor: { corridor: 0xb07a96, chamber: 0xc49a7e, start: 0xc08fb6, boss: 0xd07a9a },
    ceiling: 0x5e2a4a,
    lamps: [0xffe58a, 0xff8fc8, 0xffb36b, 0xfff0a8],
    pipes: [0xff8fc8, 0xfff0a8, 0x9fe8d8, 0xffb36b],
    props: 'crystals',
  },
  library: {
    id: 'library',
    name: '별빛 서재',
    fog: 0x283466,
    sky: 0xc9d6ff,
    brick: [0x9aa8e0, 0xc4b0e8, 0xd9c9a6],
    floor: { corridor: 0x6a6a9e, chamber: 0x7a6a8e, start: 0x7c8cc0, boss: 0x8a6aa0 },
    ceiling: 0x1e2450,
    lamps: [0xffe9a0, 0xbcd4ff, 0xffd27a, 0xe0c8ff],
    pipes: [0xbcd4ff, 0xd9c9a6, 0xe0c8ff, 0xffe9a0],
    props: 'shelves',
  },
}

const ORDER: ThemeId[] = ['sewer', 'candy', 'library']

export function themeFor(depth: number): DungeonTheme {
  return THEMES[ORDER[(Math.max(1, Math.floor(depth)) - 1) % ORDER.length]]
}

export function floorTint(theme: DungeonTheme, kind: number): number {
  if (kind === Tile.Chamber) return theme.floor.chamber
  if (kind === Tile.Start) return theme.floor.start
  if (kind === Tile.Boss) return theme.floor.boss
  return theme.floor.corridor
}

/** Most prop instances per floor (mobile budget). */
export const PROP_CAP = 220

/**
 * The theme's wall props: candy crystal clusters at the foot of the walls (캔디 동굴), or tall
 * bookshelves with a row of coloured books (별빛 서재). Skips corridors' every other face so
 * paths stay readable. Empty group for the sewer.
 */
export function themeProps(maze: Maze, theme: DungeonTheme): Group {
  const group = new Group()
  group.name = `theme-${theme.id}`
  if (theme.props === 'none') return group
  const faces = wallFaces(maze).filter((f) => {
    const kind = maze.tiles[f.y * maze.w + f.x]
    return hash(f.x, f.y, f.side + 31) < (kind === Tile.Corridor ? 0.22 : 0.5)
  }).slice(0, PROP_CAP)
  const o = new Object3D()
  const col = new Color()
  const make = (geo: BufferGeometry, n: number, emissive: number, lift: number) => {
    const mat = new MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive, emissiveIntensity: lift })
    const mesh = new InstancedMesh(geo, mat, Math.max(1, n))
    mesh.count = 0
    group.add(mesh)
    return mesh
  }
  if (theme.props === 'crystals') {
    const mesh = make(new ConeGeometry(0.22, 1, 5).translate(0, 0.5, 0), faces.length * 3, 0xff8fc8, 0.35)
    mesh.name = 'theme-crystals'
    const colours = [0xff9fd2, 0xffe58a, 0x9fe8d8, 0xd8b8ff]
    let i = 0
    for (const f of faces) {
      const { x, z } = tileCentre(maze, f.x, f.y)
      const nx = f.side === 0 ? 1 : f.side === 1 ? -1 : 0
      const nz = f.side === 2 ? 1 : f.side === 3 ? -1 : 0
      for (let k = 0; k < 3; k += 1) {
        const along = (hash(f.x, f.y, 40 + k) - 0.5) * TILE * 0.8
        const h = 0.5 + hash(f.x, f.y, 50 + k) * 1.1
        o.position.set(x + nx * (TILE / 2 - 0.28) + nz * along, 0, z + nz * (TILE / 2 - 0.28) - nx * along)
        o.rotation.set((hash(f.x, f.y, 60 + k) - 0.5) * 0.7, hash(f.x, f.y, 70 + k) * 6.28, (hash(f.x, f.y, 80 + k) - 0.5) * 0.7)
        o.scale.set(0.8 + h * 0.3, h, 0.8 + h * 0.3)
        o.updateMatrix()
        mesh.setMatrixAt(i, o.matrix)
        mesh.setColorAt(i, col.set(colours[Math.floor(hash(f.x, f.y, 90 + k) * colours.length)]))
        i += 1
      }
    }
    mesh.count = i
  } else {
    const shelves = make(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), faces.length, 0x1a1230, 0.4)
    shelves.name = 'theme-shelves'
    const books = make(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), faces.length * 3, 0x302050, 0.45)
    books.name = 'theme-books'
    const spines = [0xff9fd2, 0x9ad7ff, 0xffe58a, 0xb9a3ff, 0x7be0a8, 0xffb36b]
    let b = 0
    faces.forEach((f, i) => {
      const { x, z } = tileCentre(maze, f.x, f.y)
      const nx = f.side === 0 ? 1 : f.side === 1 ? -1 : 0
      const nz = f.side === 2 ? 1 : f.side === 3 ? -1 : 0
      const yaw = Math.atan2(-nx, -nz)
      const w = 1.7
      const cx = x + nx * (TILE / 2 - 0.32)
      const cz = z + nz * (TILE / 2 - 0.32)
      o.position.set(cx, 0, cz)
      o.rotation.set(0, yaw, 0)
      o.scale.set(w, 2.2, 0.5)
      o.updateMatrix()
      shelves.setMatrixAt(i, o.matrix)
      shelves.setColorAt(i, col.set(hash(f.x, f.y, 33) < 0.5 ? 0x6a4a6e : 0x5a4a7e))
      // Three shelves of books: one coloured slab per shelf, poking out of the case.
      for (let k = 0; k < 3; k += 1) {
        o.position.set(cx - nx * 0.08, 0.2 + k * 0.68, cz - nz * 0.08)
        o.scale.set(w * 0.86, 0.46, 0.42)
        o.updateMatrix()
        books.setMatrixAt(b, o.matrix)
        books.setColorAt(b, col.set(spines[Math.floor(hash(f.x, f.y, 100 + k) * spines.length)]))
        b += 1
      }
    })
    shelves.count = faces.length
    books.count = b
  }
  return group
}
