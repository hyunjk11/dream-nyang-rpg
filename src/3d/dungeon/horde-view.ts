/**
 * Draws the horde with a handful of instanced meshes: per kind one textured near LOD (with an
 * ink outline) and one vertex-coloured far LOD. Foes outside the view frustum are skipped, so the
 * GPU only sees what she can see. Poses reuse foePose (squash, hop, flap) per instance matrix.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  Group,
  type Material,
  type Camera,
  type AnimationClip,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { FOE_SPECS, foePose, type FoeKind } from '../foes'
import { outlineInstanced, toonGradient } from '../materials'
import { bakeSkinned, decimate } from './bake'
import { DIE_TIME, ELITE, HORDE, HORDE_CAP, SPAWN_TIME, type Horde, type HordeKind } from './horde'
import { LORD_TINTS, luckyFrames, type LuckyKind } from './lucky'

/** Every kind the view can draw, in draw order. */
export const HORDE_KINDS: HordeKind[] = Object.keys(HORDE) as HordeKind[]
/** Within this many metres of the lens a foe gets the full textured model. */
export const NEAR_LOD = 10
export const NEAR_CAP = 16
/** Walk-cycle frames baked for the reused (skinned / procedural) kinds. */
export const WALK_FRAMES = 4

type Source = 'meshy' | 'kaykit' | 'lucky'

export interface KindArt {
  source: Source
  /** Standing height in metres before the elite scale. */
  height: number
  /** Which foePose family drives the squash / hop / flap. */
  pose: FoeKind
  /** Hover height (overrides the pose family's). */
  hover?: number
  /** GLB under models/3d (meshy, kaykit). */
  file?: string
  /** Dream tint multiplied over the reused texture (kaykit). */
  tint?: number
  /** Texture-as-emissive lift. */
  lift?: number
}

/** Where each kind's body comes from and how it stands in the sewer. */
export const KIND_ART: Record<HordeKind, KindArt> = {
  slime: { source: 'meshy', height: FOE_SPECS.slime.height, pose: 'slime' },
  bug: { source: 'meshy', height: FOE_SPECS.bug.height, pose: 'bug' },
  rabbit: { source: 'meshy', height: FOE_SPECS.rabbit.height, pose: 'rabbit' },
  bat: { source: 'meshy', height: FOE_SPECS.bat.height, pose: 'bat', hover: FOE_SPECS.bat.hover },
  skeleton: { source: 'kaykit', file: 'kk_skel_minion_mobile.glb', height: 1.2, pose: 'bug', tint: 0xf4eeff, lift: 0.16 },
  skel_rogue: { source: 'kaykit', file: 'kk_skel_rogue_mobile.glb', height: 1.25, pose: 'bug', tint: 0xe8f4ff, lift: 0.16 },
  skel_warrior: { source: 'kaykit', file: 'kk_skel_warrior_mobile.glb', height: 1.35, pose: 'bug', tint: 0xfff0f6, lift: 0.16 },
  skel_mage: { source: 'kaykit', file: 'kk_skel_mage_mobile.glb', height: 1.35, pose: 'bug', tint: 0xeee4ff, lift: 0.18 },
  lich: { source: 'kaykit', file: 'hd_lich_mobile.glb', height: 1.85, pose: 'bloom', tint: 0xf0e6ff, lift: 0.26 },
  jelly: { source: 'lucky', height: 0.72, pose: 'slime' },
  wolf: { source: 'lucky', height: 0.95, pose: 'bug' },
  goblin: { source: 'lucky', height: 0.95, pose: 'bug' },
  knight: { source: 'lucky', height: 1.25, pose: 'bug' },
  wraith: { source: 'lucky', height: 1.3, pose: 'bat', hover: 0.18 },
  golem: { source: 'lucky', height: 1.35, pose: 'bug' },
  drake: { source: 'lucky', height: 1.2, pose: 'bug' },
  lord: { source: 'lucky', height: 1.6, pose: 'bloom' },
}

interface Art {
  /** One geometry per walk frame (1 for the Meshy pests). */
  frames: BufferGeometry[]
  mat: Material | Material[]
  far: BufferGeometry
  farMat: Material
}

const art = new Map<HordeKind, Art>()

const BALL_COLORS: Partial<Record<HordeKind, number>> = { slime: 0xffb7d5, bat: 0xd8c6ff, bug: 0xc9a8ff, rabbit: 0x9a7ad8 }

/** Fallback / test body: a toon ball in the kind's colour. */
function ballArt(kind: HordeKind): Art {
  const h = KIND_ART[kind].height
  const geo = new SphereGeometry(h * 0.5, 10, 8).translate(0, h * 0.5, 0)
  const mat = new MeshToonMaterial({ color: BALL_COLORS[kind] ?? 0xd8c6ff, gradientMap: toonGradient() })
  return { frames: [geo], mat, far: geo, farMat: mat }
}

/** Bake the GLB's node transform, then stand it on the floor at the kind's height. */
function normalise(geo: BufferGeometry, kind: HordeKind, box?: Box3): Box3 {
  geo.computeBoundingBox()
  const b = box ?? (geo.boundingBox as Box3).clone()
  const size = b.getSize(new Vector3())
  const s = size.y > 0.01 ? KIND_ART[kind].height / size.y : 1
  const c = b.getCenter(new Vector3())
  geo.translate(-c.x, -b.min.y, -c.z)
  geo.scale(s, s, s)
  return b
}

/**
 * Quantised GLBs (KHR_mesh_quantization) keep positions as normalised int16 and put the scale in
 * the node matrix; baking that matrix into int storage clamps every vertex past ±1 (stretched
 * wings). Copy each attribute out to plain floats first.
 */
function toFloat(geo: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name)
    if (a.array instanceof Float32Array && !(a as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i += 1) for (let k = 0; k < a.itemSize; k += 1) out[i * a.itemSize + k] = a.getComponent(i, k)
    geo.setAttribute(name, new BufferAttribute(out, a.itemSize))
  }
  return geo
}

/** A reused texture, restyled: toon ramp, pastel tint, a little texture-as-emissive glow. */
function dreamToon(src: Material, tint: number, lift: number): MeshToonMaterial {
  const s = src as unknown as { map?: MeshToonMaterial['map']; color?: Color; emissive?: Color }
  const glowy = !s.map && s.emissive && s.emissive.getHex() > 0
  const color = new Color(tint)
  if (!s.map && s.color) color.multiply(s.color)
  return new MeshToonMaterial({
    map: s.map ?? null,
    color,
    gradientMap: toonGradient(),
    emissive: glowy ? new Color(0x9af0ff) : new Color(0xffffff),
    emissiveMap: s.map ?? null,
    emissiveIntensity: glowy ? 1.4 : lift,
  })
}

const VERTEX_TOON = () => new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), emissive: 0x302040, emissiveIntensity: 0.6 })

/** Loads every kind's body; missing files keep the ball fallback. Returns kinds loaded. */
export async function loadHordeArt(base: string): Promise<number> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const load = (file: string) => loader.loadAsync(`${base}models/3d/${file}`)
  const grab = async (file: string) => {
    const gltf = await load(file)
    gltf.scene.updateMatrixWorld(true)
    let found: Mesh | null = null
    gltf.scene.traverse((o) => {
      if (!found && (o as Mesh).isMesh) found = o as Mesh
    })
    if (!found) throw new Error(file)
    const mesh = found as Mesh
    const geo = toFloat(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld)
    return { geo, mat: mesh.material as MeshToonMaterial }
  }
  // The KayKit skeletons share one rig; only the minion file carries the walk clip.
  let walk: Promise<AnimationClip | null> | null = null
  const kayWalk = () =>
    (walk ??= load('kk_skel_minion_mobile.glb')
      .then((g) => g.animations.find((a) => /walk/i.test(a.name)) ?? null)
      .catch(() => null))
  let n = 0
  await Promise.all(
    HORDE_KINDS.map(async (kind) => {
      const a = KIND_ART[kind]
      try {
        if (a.source === 'meshy') {
          const file = FOE_SPECS[kind as FoeKind].file
          const near = await grab(file)
          const box = normalise(near.geo, kind)
          const src = near.mat as unknown as { map?: MeshToonMaterial['map'] }
          const lift = FOE_SPECS[kind as FoeKind].lift
          const mat = new MeshToonMaterial({ map: src.map ?? null, gradientMap: toonGradient(), emissive: 0xffffff, emissiveMap: src.map ?? null, emissiveIntensity: lift })
          let far = near.geo
          let farMat: Material = mat
          try {
            const f = await grab(file.replace('_mobile', '_far_mobile'))
            normalise(f.geo, kind, box)
            f.geo.computeVertexNormals()
            far = f.geo
            farMat = VERTEX_TOON()
          } catch {
            // near doubles as far
          }
          art.set(kind, { frames: [near.geo], mat, far, farMat })
        } else if (a.source === 'kaykit') {
          const gltf = await load(a.file as string)
          const clip = gltf.animations.find((c) => /walk/i.test(c.name)) ?? (kind === 'lich' ? null : await kayWalk())
          const baked = bakeSkinned(gltf.scene, clip, WALK_FRAMES)
          const box = normalise(baked.frames[0], kind)
          for (const f of baked.frames.slice(1)) normalise(f, kind, box)
          const mats = baked.materials.map((m) => dreamToon(m, a.tint ?? 0xffffff, a.lift ?? 0.2))
          const far = decimate(baked.frames[0], kind === 'lich' ? 22 : 14)
          art.set(kind, { frames: baked.frames, mat: mats.length === 1 ? mats[0] : mats, far, farMat: mats[0] })
        } else {
          const frames = luckyFrames(kind as LuckyKind, WALK_FRAMES)
          const box = normalise(frames[0], kind)
          for (const f of frames.slice(1)) normalise(f, kind, box)
          const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), emissive: 0x2a1c44, emissiveIntensity: 0.5 })
          art.set(kind, { frames, mat, far: frames[0], farMat: mat })
        }
        n += 1
      } catch {
        // keep fallback
      }
    }),
  )
  return n
}

/** Walk frame for a foe: cycles with time while it moves, idles on a slow sway. */
export function walkFrame(time: number, phase: number, moving: boolean, frames: number, speed = 1): number {
  if (frames <= 1) return 0
  const rate = moving ? 1.7 * speed : 0.35
  const c = (time * rate + phase) % 1
  return Math.min(frames - 1, Math.floor((c < 0 ? c + 1 : c) * frames))
}

const ELITE_TINT = new Color(1.25, 1.02, 0.55)
const FLASH = new Color(3.2, 3.0, 3.4)
const DEATH = new Color(2.4, 1.6, 2.6)

export class HordeView {
  readonly group = new Group()
  /** Instances drawn last frame (near + far), for QA and the perf test. */
  drawn = 0
  nearDrawn = 0
  /** Per-kind near meshes, one per walk frame. */
  private readonly near = new Map<HordeKind, InstancedMesh[]>()
  private readonly far = new Map<HordeKind, InstancedMesh>()
  private readonly ink = new Map<InstancedMesh, InstancedMesh>()
  private readonly all: InstancedMesh[] = []
  private readonly frustum = new Frustum()
  private readonly pv = new Matrix4()
  private readonly m = new Matrix4()
  private readonly q = new Quaternion()
  private readonly e = new Euler(0, 0, 0, 'YXZ')
  private readonly p = new Vector3()
  private readonly s = new Vector3()
  private readonly c = new Color()
  private readonly tints = LORD_TINTS.map((t) => new Color(t))
  private readonly sphere = { center: new Vector3(), radius: 1 }

  constructor() {
    this.group.name = 'sewer-horde'
    for (const kind of HORDE_KINDS) {
      const a = art.get(kind) ?? ballArt(kind)
      const nears = a.frames.map((geo, f) => {
        const mesh = new InstancedMesh(geo, a.mat, NEAR_CAP)
        mesh.name = `horde-${kind}-${f}`
        return mesh
      })
      const far = new InstancedMesh(a.far, a.farMat, HORDE_CAP)
      far.name = `horde-${kind}-far`
      for (const mesh of [...nears, far]) {
        mesh.count = 0
        mesh.visible = false
        mesh.frustumCulled = false
        mesh.setColorAt(0, new Color(1, 1, 1))
        this.all.push(mesh)
      }
      for (const mesh of nears) {
        const ink = outlineInstanced(mesh, 0.018)
        ink.count = 0
        ink.visible = false
        this.ink.set(mesh, ink)
        this.group.add(mesh, ink)
      }
      this.near.set(kind, nears)
      this.far.set(kind, far)
      this.group.add(far)
    }
  }

  /** Meshes for one kind (tests, QA). */
  meshes(kind: HordeKind): { near: InstancedMesh[]; far: InstancedMesh } {
    return { near: this.near.get(kind) ?? [], far: this.far.get(kind) as InstancedMesh }
  }

  sync(horde: Horde, camera: Camera, time: number): void {
    camera.updateMatrixWorld()
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv)
    const counts = new Map<InstancedMesh, number>()
    const cam = camera.position
    this.drawn = 0
    this.nearDrawn = 0
    // Nearest first so the near-LOD budget goes to the ones in her face.
    const order = horde.foes
      .map((f) => ({ f, d: (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
    for (const { f, d } of order) {
      const scale = f.elite ? ELITE.scale : 1
      const look = KIND_ART[f.kind]
      const h = look.height * scale
      this.sphere.center.set(f.x, 0.5 * h + (look.hover ?? 0), f.z)
      this.sphere.radius = Math.max(1.1 * scale, h * 0.6)
      if (!this.frustum.intersectsSphere(this.sphere as never)) continue
      const useNear = Math.sqrt(d) < NEAR_LOD && this.nearDrawn < NEAR_CAP
      const moving = Math.hypot(f.vx, f.vz) > 0.3
      let mesh: InstancedMesh
      if (useNear) {
        const nears = this.near.get(f.kind) as InstancedMesh[]
        mesh = nears[walkFrame(time, f.phase, moving, nears.length, f.speed / 2.6)]
      } else mesh = this.far.get(f.kind) as InstancedMesh
      const i = counts.get(mesh) ?? 0
      if (i >= mesh.instanceMatrix.count) continue
      counts.set(mesh, i + 1)
      const pose = foePose(look.pose, {
        t: time,
        phase: f.phase,
        moving,
        windup: f.windup > 0 ? 1 - f.windup / 0.32 : 0,
        hurt: f.hurt,
        spawn: Math.min(1, f.age / SPAWN_TIME),
        dying: f.dying > 0 ? Math.min(1, f.dying / DIE_TIME) : 0,
      })
      if (look.hover !== undefined && look.pose === 'bat') pose.y += look.hover - FOE_SPECS.bat.hover
      this.e.set(pose.lean, f.yaw + (f.dying > 0 ? f.dying * 14 : 0), pose.roll)
      this.q.setFromEuler(this.e)
      this.p.set(f.x, pose.y * scale, f.z)
      this.s.set(pose.sx * scale, pose.sy * scale, pose.sz * scale)
      this.m.compose(this.p, this.q, this.s)
      mesh.setMatrixAt(i, this.m)
      this.c.setRGB(1, 1, 1)
      // The lord's six boss variants (boss10…50, bounty) are tints of one body.
      if (f.kind === 'lord') this.c.copy(this.tints[f.id % this.tints.length])
      else if (f.elite) this.c.copy(ELITE_TINT)
      if (f.dying > 0) this.c.copy(DEATH)
      else if (f.hurt > 0) this.c.lerp(FLASH, f.hurt * 0.8)
      mesh.setColorAt(i, this.c)
      this.drawn += 1
      if (useNear) this.nearDrawn += 1
    }
    for (const mesh of this.all) {
      mesh.count = counts.get(mesh) ?? 0
      mesh.visible = mesh.count > 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      const ink = this.ink.get(mesh)
      if (ink) {
        ink.count = mesh.count
        ink.visible = mesh.visible
      }
    }
  }

  dispose(): void {
    for (const mesh of [...this.all, ...this.ink.values()]) mesh.dispose()
    this.group.removeFromParent()
  }
}
