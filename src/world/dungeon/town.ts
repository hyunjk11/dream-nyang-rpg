/**
 * 몽실 마을 (챕터 2): the cloud-sheep night market past the 꿈 미로. Built the same way as the
 * field (one open "maze" of chamber tiles inside a wall), then dressed procedurally: striped
 * stalls along the walls, lantern strings across the square, cloud puffs over the wall tops, a
 * big moon, and the townsfolk (몽이, 솜솜, 볼트, 토토) as little toon figures. No foes live here.
 *
 * Also the small quest props the run places in the maze (a dream fragment, 뭉게 caught in a web).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { toonGradient } from '../../core/materials'
import { Tile, rng, tileCentre, type Maze, type Rect } from './maze'

/** Town square size in tiles (odd; border ring included): small, so every door is a few steps away. */
export const TOWN_SIZE = 11

export type TownNpcId = 'mongi' | 'somsom' | 'bolt' | 'toto' | 'board' | 'gate'

export interface TownSpot {
  id: TownNpcId
  name: string
  /** E hint ("몽이와 대화"). */
  hint: string
  tile: { x: number; y: number }
}

export const TOWN_SPOTS: TownSpot[] = [
  { id: 'mongi', name: '이장 몽이', hint: '몽이와 대화 (이야기 퀘스트)', tile: { x: 5, y: 5 } },
  { id: 'somsom', name: '솜솜 상점', hint: '솜솜 상점', tile: { x: 2, y: 4 } },
  { id: 'toto', name: '토토 창고', hint: '토토 창고', tile: { x: 2, y: 6 } },
  { id: 'bolt', name: '총포상 볼트', hint: '볼트 총포상', tile: { x: 8, y: 4 } },
  { id: 'board', name: '구름 게시판', hint: '들판 퀘스트 게시판', tile: { x: 8, y: 6 } },
  { id: 'gate', name: '별문', hint: '별문 (이동)', tile: { x: 5, y: 2 } },
]

/** The square: a wall ring round open ground; she arrives at the south end, the 별문 is north. */
export function townMaze(seed: number, size = TOWN_SIZE): Maze {
  const w = size % 2 ? size : size + 1
  const h = w
  const tiles = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) tiles[y * w + x] = Tile.Chamber
  const mid = Math.floor(w / 2)
  const startRoom: Rect = { x: mid - 1, y: h - 4, w: 3, h: 3 }
  const bossRoom: Rect = { x: mid - 1, y: 1, w: 3, h: 3 }
  for (let y = startRoom.y; y < startRoom.y + startRoom.h; y += 1) for (let x = startRoom.x; x < startRoom.x + startRoom.w; x += 1) tiles[y * w + x] = Tile.Start
  return { seed, w, h, tiles, start: { x: mid, y: h - 3 }, startRoom, bossRoom, chambers: [], nests: [] }
}

const toon = (color: number, lift = 0.18, emissive?: number) =>
  new MeshToonMaterial({ color, gradientMap: toonGradient(), emissive: emissive ?? color, emissiveIntensity: lift })

/** Awning colours of each keeper's stall. */
const STALL_ROOF: Record<Exclude<TownNpcId, 'gate' | 'mongi'>, [number, number]> = {
  somsom: [0xff9fd2, 0xfff4fa],
  toto: [0xb9a3ff, 0xfff4fa],
  bolt: [0x9fe8d8, 0xfff4fa],
  board: [0xffe08a, 0xfff4fa],
}

/** A cheap per-tile hash in [0, 1). */
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return h - Math.floor(h)
}

/** A round blocker for the run's extra collision (stall counters, figures). */
export interface Blocker {
  x: number
  z: number
  r: number
}

/** Little townsperson figures. Each is a Group facing +z. */
export function townFigure(id: TownNpcId | 'mungge' | 'frag'): Group {
  const g = new Group()
  g.name = `figure-${id}`
  const add = (mesh: Mesh, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx) => {
    mesh.position.set(x, y, z)
    mesh.scale.set(sx, sy, sz)
    g.add(mesh)
    return mesh
  }
  const sheep = (wool: number, face: number, scale = 1) => {
    const woolM = toon(wool, 0.32)
    const faceM = toon(face, 0.14)
    const s = scale
    add(new Mesh(new IcosahedronGeometry(0.5, 1), woolM), 0, 0.72 * s, 0, 1.05 * s, 0.86 * s, 1.1 * s)
    for (const [x, z] of [[-0.3, 0.3], [0.32, 0.26], [0, -0.36], [-0.28, -0.22], [0.3, -0.24]] as const) add(new Mesh(new IcosahedronGeometry(0.24, 1), woolM), x * s, 0.95 * s, z * s, s)
    add(new Mesh(new SphereGeometry(0.26, 14, 10), faceM), 0, 0.98 * s, 0.5 * s, s, 0.92 * s, 0.9 * s)
    add(new Mesh(new IcosahedronGeometry(0.16, 1), woolM), 0, 1.2 * s, 0.46 * s, s)
    for (const sx of [-1, 1]) {
      const ear = add(new Mesh(new SphereGeometry(0.1, 8, 6), faceM), sx * 0.28 * s, 1.04 * s, 0.44 * s, 1.4 * s, 0.6 * s, 0.8 * s)
      ear.rotation.z = sx * 0.6
      add(new Mesh(new SphereGeometry(0.035, 6, 5), toon(0x2a2040, 0.05)), sx * 0.1 * s, 1.02 * s, 0.73 * s, s)
    }
    for (const [x, z] of [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]] as const) add(new Mesh(new CylinderGeometry(0.07, 0.07, 0.4, 8), faceM), x * s, 0.2 * s, z * s, s)
  }
  if (id === 'mongi') {
    sheep(0xfff8ff, 0x6a5a8a, 1.15)
    // The elder's little lantern staff and night cap.
    add(new Mesh(new ConeGeometry(0.2, 0.42, 12), toon(0x9a8ae0, 0.2)), 0.05, 1.56, 0.48).rotation.x = -0.3
    add(new Mesh(new CylinderGeometry(0.03, 0.03, 1.5, 6), toon(0x8a6a4a, 0.1)), 0.5, 0.78, 0.36)
    add(new Mesh(new SphereGeometry(0.14, 10, 8), new MeshBasicMaterial({ color: new Color(0xffe08a).multiplyScalar(1.6) })), 0.5, 1.6, 0.36)
  } else if (id === 'somsom') {
    sheep(0xffd6ec, 0x8a5a7a, 1)
    add(new Mesh(new BoxGeometry(0.5, 0.4, 0.08), toon(0xfff0a8, 0.2)), 0, 0.68, 0.56)
  } else if (id === 'mungge') {
    sheep(0xf4f8ff, 0x7a8ab0, 0.78)
  } else if (id === 'bolt') {
    // 볼트: a stout mole tinkerer with goggles and a wrench.
    const fur = toon(0x9a7a6a, 0.16)
    add(new Mesh(new CapsuleGeometry(0.42, 0.5, 6, 12), fur), 0, 0.78, 0)
    add(new Mesh(new SphereGeometry(0.34, 14, 10), fur), 0, 1.42, 0.06)
    add(new Mesh(new SphereGeometry(0.09, 8, 6), toon(0xff9fb8, 0.3)), 0, 1.36, 0.4)
    for (const sx of [-1, 1]) {
      const lens = add(new Mesh(new TorusGeometry(0.1, 0.035, 6, 14), toon(0xd9c9a6, 0.2)), sx * 0.13, 1.52, 0.3)
      lens.rotation.y = 0
      add(new Mesh(new SphereGeometry(0.08, 8, 6), new MeshBasicMaterial({ color: new Color(0x9fffe8).multiplyScalar(1.4) })), sx * 0.13, 1.52, 0.3, 1, 1, 0.4)
    }
    add(new Mesh(new BoxGeometry(0.62, 0.36, 0.1), toon(0x5a4a7e, 0.14)), 0, 0.8, 0.42)
    const wrench = add(new Mesh(new BoxGeometry(0.08, 0.6, 0.08), toon(0xc8d0e0, 0.3)), 0.52, 0.9, 0.2)
    wrench.rotation.z = -0.5
  } else if (id === 'toto') {
    // 토토: a bunny porter with a big backpack.
    const fur = toon(0xf4ece0, 0.22)
    add(new Mesh(new CapsuleGeometry(0.32, 0.42, 6, 12), fur), 0, 0.7, 0)
    add(new Mesh(new SphereGeometry(0.3, 14, 10), fur), 0, 1.3, 0.04)
    for (const sx of [-1, 1]) {
      const ear = add(new Mesh(new CapsuleGeometry(0.07, 0.42, 4, 8), fur), sx * 0.12, 1.75, 0)
      ear.rotation.z = sx * -0.2
      add(new Mesh(new SphereGeometry(0.035, 6, 5), toon(0x2a2040, 0.05)), sx * 0.11, 1.34, 0.31)
    }
    add(new Mesh(new BoxGeometry(0.6, 0.7, 0.4), toon(0x8a6ac0, 0.16)), 0, 0.95, -0.42)
    add(new Mesh(new BoxGeometry(0.64, 0.1, 0.44), toon(0xffe08a, 0.2)), 0, 1.2, -0.42)
  } else if (id === 'board') {
    const wood = toon(0xb08a6a, 0.12)
    for (const sx of [-1, 1]) add(new Mesh(new CylinderGeometry(0.06, 0.07, 2, 8), wood), sx * 0.8, 1, 0)
    add(new Mesh(new BoxGeometry(1.8, 1.1, 0.12), toon(0xf4e0c8, 0.18)), 0, 1.4, 0)
    const notes = [0xff9fd2, 0x9ad7ff, 0xffe58a, 0xb9a3ff]
    notes.forEach((c, i) => add(new Mesh(new BoxGeometry(0.34, 0.4, 0.02), toon(c, 0.3)), -0.6 + i * 0.4, 1.4 + (i % 2) * 0.12, 0.08))
    add(new Mesh(new IcosahedronGeometry(0.45, 1), toon(0xffffff, 0.3)), 0, 2.1, 0, 1.6, 0.5, 0.7)
  } else if (id === 'frag') {
    const glow = new MeshBasicMaterial({ color: new Color(0xffe9a0).multiplyScalar(1.5) })
    add(new Mesh(new OctahedronGeometry(0.32, 0), glow), 0, 1.1, 0, 1, 1.4, 1)
    const ring = add(new Mesh(new RingGeometry(0.55, 0.75, 28), new MeshBasicMaterial({ color: new Color(0xffd0f0).multiplyScalar(1.4), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })), 0, 0.06, 0)
    ring.rotation.x = -Math.PI / 2
  }
  return g
}

/** 뭉게 caught in a nightmare web (the rescue quest): the sheep plus a dark see-through web ball. */
export function webbedSheep(): Group {
  const g = new Group()
  g.add(townFigure('mungge'))
  const web = new Mesh(new IcosahedronGeometry(1.05, 1), new MeshBasicMaterial({ color: 0x8a5ab0, wireframe: true, transparent: true, opacity: 0.75 }))
  web.position.y = 0.8
  web.name = 'web'
  g.add(web)
  return g
}

/** Everything 몽실 마을 draws on top of the walled square. */
export class MongsilTown {
  readonly group = new Group()
  readonly blockers: Blocker[] = []
  /** Where each townsperson stands (world), facing the square. */
  readonly spots: { id: TownNpcId; name: string; hint: string; x: number; z: number; yaw: number }[] = []
  private readonly figures: { g: Group; base: number; phase: number }[] = []
  private readonly clouds: InstancedMesh
  private readonly bulbs: InstancedMesh
  private readonly cloudData: { x: number; y: number; z: number; s: number; drift: number }[] = []
  private readonly dummy = new Object3D()

  constructor(private readonly maze: Maze) {
    this.group.name = 'mongsil-town'
    const rand = rng(maze.seed ^ 0x6d6f6e67)
    const mid = Math.floor(maze.w / 2)
    const centre = tileCentre(maze, mid, Math.floor(maze.h / 2))
    // Townsfolk, each turned to face the middle of the square.
    for (const s of TOWN_SPOTS) {
      const c = tileCentre(maze, s.tile.x, s.tile.y)
      const yaw = s.id === 'gate' ? 0 : Math.atan2(centre.x - c.x, centre.z - c.z)
      this.spots.push({ id: s.id, name: s.name, hint: s.hint, x: c.x, z: c.z, yaw })
      if (s.id === 'gate') continue
      const fig = townFigure(s.id)
      fig.position.set(c.x, 0, c.z)
      fig.rotation.y = yaw
      this.group.add(fig)
      this.figures.push({ g: fig, base: 0, phase: rand() * 6 })
      this.blockers.push({ x: c.x, z: c.z, r: s.id === 'board' ? 0.9 : 0.55 })
    }
    // Stalls: one behind each shopkeeper against the side walls, plus two snack stalls south.
    const stallAt = (tx: number, ty: number, palette: [number, number], facing: number) => {
      const c = tileCentre(this.maze, tx, ty)
      const stall = this.stall(palette)
      stall.position.set(c.x, 0, c.z)
      stall.rotation.y = facing
      this.group.add(stall)
      this.blockers.push({ x: c.x, z: c.z, r: 1.15 })
    }
    for (const s of TOWN_SPOTS) {
      if (s.id === 'gate' || s.id === 'mongi') continue
      const west = s.tile.x < mid
      stallAt(west ? 1 : maze.w - 2, s.tile.y, STALL_ROOF[s.id], west ? Math.PI / 2 : -Math.PI / 2)
    }
    stallAt(2, maze.h - 2, [0xffb36b, 0xfff4fa], Math.PI)
    stallAt(maze.w - 3, maze.h - 2, [0x9ad7ff, 0xfff4fa], Math.PI)
    // The village round the square: pastel cottages on the border ring, paths, flowers, lamps.
    this.group.add(this.cottages(rand), this.flowers(rand), this.lampPosts())
    // Lantern strings criss-crossing the square (one instanced draw for every bulb).
    const strings: [number, number, number, number][] = []
    const lo = tileCentre(maze, 1, 1)
    const hi = tileCentre(maze, maze.w - 2, maze.h - 2)
    for (let k = 0; k < 3; k += 1) {
      const t = (k + 0.5) / 3
      strings.push([lo.x, lo.z + (hi.z - lo.z) * t, hi.x, lo.z + (hi.z - lo.z) * (1 - t)])
    }
    strings.push([lo.x, lo.z, hi.x, hi.z], [hi.x, lo.z, lo.x, hi.z])
    const per = 16
    this.bulbs = new InstancedMesh(new SphereGeometry(0.13, 8, 6), new MeshBasicMaterial({ color: 0xffffff }), strings.length * per)
    this.bulbs.name = 'town-lanterns'
    const lamp = [0xffe08a, 0xff9fd2, 0x9fe8d8, 0xbfe4ff, 0xffb36b]
    const col = new Color()
    let n = 0
    for (const [ax, az, bx, bz] of strings) {
      for (let i = 0; i < per; i += 1) {
        const t = (i + 0.5) / per
        const sag = Math.sin(t * Math.PI) * 0.9
        this.dummy.position.set(ax + (bx - ax) * t, 4.1 - sag, az + (bz - az) * t)
        this.dummy.scale.setScalar(i % 3 === 0 ? 1.5 : 1)
        this.dummy.updateMatrix()
        this.bulbs.setMatrixAt(n, this.dummy.matrix)
        this.bulbs.setColorAt(n, col.set(lamp[(i + n) % lamp.length]).multiplyScalar(1.5))
        n += 1
      }
    }
    this.bulbs.count = n
    this.group.add(this.bulbs)
    // Cloud puffs over the wall tops and drifting farther out.
    const puffs = 36
    this.clouds = new InstancedMesh(new IcosahedronGeometry(1, 1), toon(0xfff0fa, 0.55, 0xffd8ee), puffs)
    this.clouds.name = 'town-clouds'
    const span = (maze.w * 3.4) / 2
    for (let i = 0; i < puffs; i += 1) {
      const a = (i / puffs) * Math.PI * 2 + rand() * 0.2
      const far = i % 3 === 0
      const r = span * (far ? 1.7 + rand() * 0.7 : 1.25 + rand() * 0.15)
      this.cloudData.push({ x: centre.x + Math.sin(a) * r, y: far ? 8 + rand() * 6 : 5.6 + rand() * 1.2, z: centre.z + Math.cos(a) * r, s: far ? 2.4 + rand() * 2 : 1.2 + rand() * 0.9, drift: rand() * 6 })
    }
    this.placeClouds(0)
    this.group.add(this.clouds)
    // The moon and a few big stars.
    const moon = new Mesh(new SphereGeometry(6, 24, 16), new MeshBasicMaterial({ color: new Color(0xfff6c8).multiplyScalar(1.3), fog: false }))
    moon.position.set(centre.x + 30, 38, centre.z - 70)
    moon.name = 'town-moon'
    this.group.add(moon)
    const stars = new InstancedMesh(new OctahedronGeometry(0.5, 0), new MeshBasicMaterial({ color: new Color(0xfff0c8).multiplyScalar(1.4), fog: false }), 40)
    for (let i = 0; i < 40; i += 1) {
      const a = rand() * Math.PI * 2
      this.dummy.position.set(centre.x + Math.sin(a) * (60 + rand() * 30), 24 + rand() * 30, centre.z + Math.cos(a) * (60 + rand() * 30))
      this.dummy.scale.setScalar(0.4 + rand() * 0.8)
      this.dummy.updateMatrix()
      stars.setMatrixAt(i, this.dummy.matrix)
    }
    stars.name = 'town-stars'
    this.group.add(stars)
    // Lawn out past the cottages (the border ring has no floor tiles of its own).
    const ground = new Mesh(new CircleGeometry(span * 2.6, 48), toon(0x9ccfb4, 0.12))
    ground.rotation.x = -Math.PI / 2
    ground.position.set(centre.x, -0.02, centre.z)
    ground.name = 'town-ground'
    this.group.add(ground)
    // A soft round plaza rug under 몽이.
    const rug = new Mesh(new RingGeometry(0, 3.2, 40), new MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.5, depthWrite: false }))
    rug.rotation.x = -Math.PI / 2
    rug.position.set(centre.x, 0.03, centre.z)
    this.group.add(rug)
  }

  /** Floor colours: a cream path from her arrival up to the 별문 and round the plaza, soft lawn elsewhere. */
  paintFloor(floor: Mesh): void {
    const color = floor.geometry.getAttribute('color')
    if (!color) return
    const maze = this.maze
    const mid = Math.floor(maze.w / 2)
    const cy = Math.floor(maze.h / 2)
    const c = new Color()
    let v = 0
    for (let ty = 0; ty < maze.h; ty += 1) {
      for (let tx = 0; tx < maze.w; tx += 1) {
        if (maze.tiles[ty * maze.w + tx] === Tile.Solid) continue
        const shopRow = TOWN_SPOTS.some((s) => s.id !== 'gate' && s.id !== 'mongi' && s.tile.y === ty && tx >= Math.min(s.tile.x, mid) && tx <= Math.max(s.tile.x, mid))
        const plaza = Math.abs(tx - mid) <= 1 && Math.abs(ty - cy) <= 1
        const path = tx === mid || shopRow || plaza
        c.set(path ? ((tx + ty) % 2 ? 0xf4e2d0 : 0xeedac8) : (hash2(tx, ty) > 0.5 ? 0xb8e0c0 : 0xa8d8b8))
        for (let k = 0; k < 6; k += 1) color.setXYZ(v++, c.r, c.g, c.b)
      }
    }
    color.needsUpdate = true
  }

  /** Pastel cottages on the border ring (instanced parts: walls, roofs, doors, windows, chimneys). */
  private cottages(rand: () => number): Group {
    const g = new Group()
    g.name = 'town-cottages'
    const maze = this.maze
    const mid = Math.floor(maze.w / 2)
    const spots: { x: number; z: number; yaw: number; w: number }[] = []
    // Every other border tile, skipping the north gap behind the 별문 (it stays in view from the plaza).
    const push = (tx: number, ty: number, yaw: number) => {
      if (ty === 0 && Math.abs(tx - mid) <= 1) return
      const c = tileCentre(maze, tx, ty)
      spots.push({ x: c.x, z: c.z, yaw, w: 2.4 + rand() * 0.6 })
    }
    for (let tx = 1; tx < maze.w - 1; tx += 2) {
      push(tx, 0, 0)
      push(tx, maze.h - 1, Math.PI)
    }
    for (let ty = 1; ty < maze.h - 1; ty += 2) {
      push(0, ty, Math.PI / 2)
      push(maze.w - 1, ty, -Math.PI / 2)
    }
    // A second, taller row farther out for a skyline over the roofs.
    const back = spots.length
    for (let i = 0; i < back; i += 2) {
      const s = spots[i]
      const out = 3.6
      spots.push({ x: s.x - Math.sin(s.yaw) * out + (rand() - 0.5), z: s.z - Math.cos(s.yaw) * out, yaw: s.yaw, w: 2.8 + rand() * 0.6 })
    }
    const n = spots.length
    const wall = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), toon(0xffffff, 0.22), n)
    const roof = new InstancedMesh(new ConeGeometry(0.78, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), toon(0xffffff, 0.2), n)
    const door = new InstancedMesh(new BoxGeometry(0.5, 0.9, 0.06).translate(0, 0.45, 0), toon(0x9a6a7a, 0.15), n)
    const win = new InstancedMesh(new BoxGeometry(0.42, 0.42, 0.05), new MeshBasicMaterial({ color: new Color(0xffe6a0).multiplyScalar(1.35) }), n * 2)
    const chim = new InstancedMesh(new BoxGeometry(0.3, 0.8, 0.3).translate(0, 0.4, 0), toon(0xd8c8e8, 0.15), n)
    const WALLS = [0xffd9e8, 0xe4d8ff, 0xd2f2e2, 0xffeec4, 0xd8eaff]
    const ROOFS = [0xff7fb0, 0x9a80f0, 0x5fc8b0, 0xffa060, 0x70a8ff, 0xe880c8]
    const o = this.dummy
    const col = new Color()
    spots.forEach((s, i) => {
      const far = i >= back
      const h = far ? 2.6 + rand() * 1.4 : 1.9 + rand() * 0.6
      const d = 2.2
      const place = (mesh: InstancedMesh, k: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
        const cos = Math.cos(s.yaw)
        const sin = Math.sin(s.yaw)
        o.position.set(s.x + lx * cos + lz * sin, ly, s.z - lx * sin + lz * cos)
        o.rotation.set(0, s.yaw, 0)
        o.scale.set(sx, sy, sz)
        o.updateMatrix()
        mesh.setMatrixAt(k, o.matrix)
      }
      place(wall, i, 0, 0, 0, s.w, h, d)
      wall.setColorAt(i, col.set(WALLS[i % WALLS.length]))
      place(roof, i, 0, h, 0, s.w * 0.95, 1.3 + rand() * 0.5, d * 0.95)
      roof.setColorAt(i, col.set(ROOFS[(i * 7 + 3) % ROOFS.length]))
      place(door, i, (rand() - 0.5) * 0.6, 0, d / 2 + 0.02, 1, far ? 0 : 1, 1)
      place(win, i * 2, -s.w * 0.3, h * 0.62, d / 2 + 0.03, 1, 1, 1)
      place(win, i * 2 + 1, s.w * 0.3, h * 0.62, d / 2 + 0.03, 1, 1, 1)
      place(chim, i, s.w * 0.25, h + 0.3, -0.3, 1, i % 3 === 0 ? 1 : 0, 1)
    })
    for (const m of [wall, roof, door, win, chim]) {
      m.castShadow = false
      g.add(m)
    }
    return g
  }

  /** Flower clumps on the lawn tiles (one instanced draw, toon colours). */
  private flowers(rand: () => number): InstancedMesh {
    const maze = this.maze
    const mid = Math.floor(maze.w / 2)
    const cy = Math.floor(maze.h / 2)
    const at: { x: number; z: number }[] = []
    for (let ty = 1; ty < maze.h - 1; ty += 1) {
      for (let tx = 1; tx < maze.w - 1; tx += 1) {
        if (tx === mid || (Math.abs(tx - mid) <= 1 && Math.abs(ty - cy) <= 1)) continue
        if (TOWN_SPOTS.some((s) => Math.abs(s.tile.x - tx) + Math.abs(s.tile.y - ty) <= 0)) continue
        const c = tileCentre(maze, tx, ty)
        const k = 2 + Math.floor(rand() * 3)
        for (let i = 0; i < k; i += 1) at.push({ x: c.x + (rand() - 0.5) * 2.6, z: c.z + (rand() - 0.5) * 2.6 })
      }
    }
    const mesh = new InstancedMesh(new IcosahedronGeometry(0.16, 0), toon(0xffffff, 0.45), at.length)
    mesh.name = 'town-flowers'
    const PETALS = [0xff9fd2, 0xffe08a, 0xc8b0ff, 0xffffff, 0x9fe8ff, 0xffb3a0]
    const col = new Color()
    at.forEach((p, i) => {
      this.dummy.position.set(p.x, 0.16, p.z)
      this.dummy.rotation.set(0, rand() * 3, 0)
      this.dummy.scale.setScalar(0.8 + rand() * 0.7)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(i, this.dummy.matrix)
      mesh.setColorAt(i, col.set(PETALS[i % PETALS.length]))
    })
    return mesh
  }

  /** Lamp posts along the path (glowing heads, no real lights: the town stays cheap). */
  private lampPosts(): Group {
    const g = new Group()
    g.name = 'town-lamps'
    const maze = this.maze
    const mid = Math.floor(maze.w / 2)
    const at: [number, number][] = []
    for (const ty of [3, maze.h - 4]) for (const sx of [-1, 1]) at.push([mid + sx, ty])
    const post = new InstancedMesh(new CylinderGeometry(0.06, 0.08, 2.4, 6).translate(0, 1.2, 0), toon(0x7a6a9a, 0.15), at.length)
    const head = new InstancedMesh(new SphereGeometry(0.22, 12, 8), new MeshBasicMaterial({ color: new Color(0xffe6a0).multiplyScalar(1.6) }), at.length)
    const halo = new InstancedMesh(new SphereGeometry(0.6, 12, 8), new MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false }), at.length)
    at.forEach(([tx, ty], i) => {
      const c = tileCentre(maze, tx, ty)
      const x = c.x + (tx < mid ? 0.9 : -0.9)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(1)
      this.dummy.position.set(x, 0, c.z)
      this.dummy.updateMatrix()
      post.setMatrixAt(i, this.dummy.matrix)
      this.dummy.position.set(x, 2.5, c.z)
      this.dummy.updateMatrix()
      head.setMatrixAt(i, this.dummy.matrix)
      halo.setMatrixAt(i, this.dummy.matrix)
      this.blockers.push({ x, z: c.z, r: 0.25 })
    })
    g.add(post, head, halo)
    return g
  }

  private stall([roof, stripe]: [number, number]): Group {
    const g = new Group()
    const wood = toon(0x9a7a8a, 0.14)
    g.add(new Mesh(new BoxGeometry(2.4, 0.95, 1.1).translate(0, 0.475, 0), toon(0xe8d8f0, 0.2)))
    for (const [x, z] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]] as const) {
      const post = new Mesh(new CylinderGeometry(0.05, 0.05, 2.5, 6).translate(0, 1.25, 0), wood)
      post.position.set(x, 0, z)
      g.add(post)
    }
    // Striped awning: alternating slats, tilted out over the counter.
    const awning = new Group()
    for (let i = 0; i < 6; i += 1) {
      const slat = new Mesh(new BoxGeometry(0.42, 0.06, 1.6), toon(i % 2 ? stripe : roof, 0.28))
      slat.position.set(-1.05 + i * 0.42, 0, 0)
      awning.add(slat)
    }
    awning.position.set(0, 2.55, 0.2)
    awning.rotation.x = 0.28
    g.add(awning)
    // Goods on the counter and a paper lantern.
    const goods = [0xff9fd2, 0xffe08a, 0x9fe8d8, 0xb9a3ff]
    goods.forEach((c, i) => {
      const m = new Mesh(new SphereGeometry(0.14, 10, 8), toon(c, 0.4))
      m.position.set(-0.8 + i * 0.52, 1.08, 0.1)
      g.add(m)
    })
    const lantern = new Mesh(new SphereGeometry(0.2, 12, 8), new MeshBasicMaterial({ color: new Color(roof).multiplyScalar(1.5) }))
    lantern.position.set(0.9, 2.05, 0.75)
    lantern.scale.set(1, 1.3, 1)
    g.add(lantern)
    return g
  }

  private placeClouds(time: number): void {
    this.cloudData.forEach((c, i) => {
      this.dummy.position.set(c.x + Math.sin(time * 0.08 + c.drift) * 0.6, c.y + Math.sin(time * 0.3 + c.drift) * 0.15, c.z)
      this.dummy.scale.set(c.s * 1.4, c.s * 0.8, c.s)
      this.dummy.rotation.set(0, c.drift, 0)
      this.dummy.updateMatrix()
      this.clouds.setMatrixAt(i, this.dummy.matrix)
    })
    this.clouds.instanceMatrix.needsUpdate = true
  }

  private cloudClock = 0

  update(time: number, dt: number): void {
    for (const f of this.figures) f.g.position.y = Math.max(0, Math.sin(time * 2 + f.phase) * 0.04)
    this.cloudClock += dt
    // Clouds drift slowly: a few updates a second is plenty.
    if (this.cloudClock > 0.25) {
      this.cloudClock = 0
      this.placeClouds(time)
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh
      m.geometry?.dispose()
      const mat = m.material as { dispose?: () => void } | { dispose?: () => void }[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.())
      else mat?.dispose?.()
    })
  }
}
