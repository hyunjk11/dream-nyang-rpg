/**
 * Draws the horde with a handful of instanced meshes: per kind one textured near LOD (with an
 * ink outline) and one vertex-coloured far LOD. Foes outside the view frustum are skipped, so the
 * GPU only sees what she can see. Poses reuse foePose (squash, hop, flap) per instance matrix.
 */
import { DIFFICULTY } from '../../combat/difficulty'
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
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Shape,
  TorusGeometry,
  Vector3,
  Group,
  type Material,
  type Camera,
  type AnimationClip,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { FOE_SPECS, foePose, type FoeKind } from '../../combat/foes'
import { outlineInstanced, toonGradient } from '../../core/materials'
import { bakeSkinned, decimate } from './bake'
import { DIE_TIME, ELITE, HORDE, HORDE_CAP, SHOT_STYLE, SHOTS_CAP, SPAWN_TIME, type Horde, type HordeKind, type ShotStyle } from './horde'
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
/** Enraged elites glow hot pink-red. */
const RAGE_TINT = new Color(1.6, 0.55, 0.6)
/** Wind-up rings and charge lanes drawn at once (one instanced draw call each). */
export const TELL_CAP = 32
/** Floating hp bars over hurt foes (nearest first), and how far out they show (m). */
export const BAR_CAP = 40
export const BAR_RANGE = 24
/**
 * fix/boss-floor: a foe hugging the lens drew its 0.7 m bar across half the screen. Bars need the
 * foe at least BAR_MIN_DEPTH m in front of the camera, at most BAR_SHOWN of them (nearest first),
 * and a foe whose body would wrap the lens (closer than its radius + CAM_CLEAR) is not drawn at all.
 */
export const BAR_MIN_DEPTH = 2.4
export const BAR_SHOWN = 14
/**
 * Most a bar may span on screen (half-width in NDC, 1 = half the screen). A tall phone has a
 * narrow horizontal view, so a 0.7 m bar 3 m out still crossed a third of it; near bars shrink.
 */
export const BAR_MAX_NDC = 0.09
export const CAM_CLEAR = 0.75
const BAR_BACK = new Color(0x2a1830)
const BAR_FILL = new Color(0xff6fae)
const BAR_ELITE = new Color(0xffc65a)
const BAR_RAGE = new Color(0xff4d6d)
const WHITE = new Color(0xffffff)
const TELL_MELEE = new Color(0.95, 0.18, 0.5)
const TELL_CHARGE = new Color(1.0, 0.28, 0.08)
/** Ranged charge: a soft gold ring under the foe while its shot glows. */
const TELL_RANGED = new Color(1.0, 0.82, 0.35)
/** Dream shots: one look per archetype, plain colours (≤ 1, inside the brightness cap). */
export const SHOT_LOOK: Record<ShotStyle, { color: number; size: number; opacity: number }> = {
  bubble: { color: 0x9fe3ff, size: 0.22, opacity: 0.72 },
  star: { color: 0xffe07a, size: 0.26, opacity: 0.95 },
  spore: { color: 0xb8ee8c, size: 0.2, opacity: 0.92 },
  moon: { color: 0xd6bcff, size: 0.26, opacity: 0.92 },
}
const SHOT_STYLES_ALL: ShotStyle[] = ['bubble', 'star', 'spore', 'moon']
function shotGeometry(style: ShotStyle): BufferGeometry {
  if (style === 'bubble') return new SphereGeometry(1, 12, 8)
  if (style === 'spore') return new IcosahedronGeometry(1, 0)
  if (style === 'moon') return new TorusGeometry(0.72, 0.3, 6, 14, Math.PI * 1.25)
  const star = new Shape()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? 0.45 : 1
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else star.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return new ExtrudeGeometry(star, { depth: 0.35, bevelEnabled: false }).translate(0, 0, -0.175)
}
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
  /** Ground tells: a filling ring under a winding foe, a lane in front of a crouching charger. */
  readonly rings: InstancedMesh
  readonly lanes: InstancedMesh
  /** Tells drawn last frame (QA). */
  tells = 0
  /** Hp bars over hurt foes: a dark back and a fill scaled from its left edge. */
  readonly bars: InstancedMesh
  readonly fills: InstancedMesh
  /** Bars drawn last frame (QA, tests). */
  barsDrawn = 0
  private readonly cq = new Quaternion()
  private readonly right = new Vector3()
  private readonly fwd = new Vector3()
  /** Foes skipped last frame for sitting on the lens (QA, tests). */
  lensHidden = 0
  /** Dream shots and charge orbs: one pooled instanced mesh per style. */
  readonly shotMeshes = new Map<ShotStyle, InstancedMesh>()
  /** Shots + charge orbs drawn last frame (QA). */
  shotsDrawn = 0

  constructor() {
    this.group.name = 'sewer-horde'
    const tellMat = () => new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false })
    this.rings = new InstancedMesh(new RingGeometry(0.66, 1, 28).rotateX(-Math.PI / 2), tellMat(), TELL_CAP)
    this.lanes = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), tellMat(), TELL_CAP)
    for (const t of [this.rings, this.lanes]) {
      t.name = t === this.rings ? 'horde-tell-rings' : 'horde-tell-lanes'
      t.count = 0
      t.frustumCulled = false
      t.renderOrder = 3
      t.setColorAt(0, new Color(1, 1, 1))
      this.group.add(t)
    }
    // Walls hide the bar (depth-tested); depthWrite off + renderOrder keeps the fill over its back.
    const barMat = () => new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94, depthTest: true, depthWrite: false, fog: false, toneMapped: false })
    this.bars = new InstancedMesh(new PlaneGeometry(1, 1), barMat(), BAR_CAP)
    this.fills = new InstancedMesh(new PlaneGeometry(1, 1).translate(0.5, 0, 0), barMat(), BAR_CAP)
    this.bars.name = 'horde-hp-bars'
    this.fills.name = 'horde-hp-fills'
    for (const [i, b] of [this.bars, this.fills].entries()) {
      b.count = 0
      b.visible = false
      b.frustumCulled = false
      b.renderOrder = 20 + i
      b.setColorAt(0, i ? BAR_FILL : BAR_BACK)
      this.group.add(b)
    }
    for (const style of SHOT_STYLES_ALL) {
      const look = SHOT_LOOK[style]
      const mesh = new InstancedMesh(shotGeometry(style), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: look.opacity, depthWrite: false }), SHOTS_CAP + TELL_CAP)
      mesh.name = `horde-shot-${style}`
      mesh.count = 0
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 4
      mesh.setColorAt(0, new Color(look.color))
      this.shotMeshes.set(style, mesh)
      this.group.add(mesh)
    }
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
    let rings = 0
    let lanes = 0
    let bars = 0
    const p00 = camera.projectionMatrix.elements[0]
    camera.getWorldQuaternion(this.cq)
    this.right.set(1, 0, 0).applyQuaternion(this.cq)
    this.fwd.set(0, 0, -1).applyQuaternion(this.cq)
    this.lensHidden = 0
    // Nearest first so the near-LOD budget goes to the ones in her face.
    const order = horde.foes
      .map((f) => ({ f, d: (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
    for (const { f, d } of order) {
      const scale = f.elite ? ELITE.scale : 1
      const look = KIND_ART[f.kind]
      // Tells first (also for foes just off-screen: the lane may cross into view).
      if (f.dying <= 0 && d < 400) {
        if (f.windup > 0 && rings < TELL_CAP) {
          const k = 1 - f.windup / DIFFICULTY.horde.windup
          const r = (f.radius + 0.95) * (0.45 + 0.55 * k)
          this.p.set(f.x, 0.04, f.z)
          this.s.set(r, 1, r)
          this.q.identity()
          this.m.compose(this.p, this.q, this.s)
          this.rings.setMatrixAt(rings, this.m)
          this.rings.setColorAt(rings, this.c.copy(TELL_MELEE).multiplyScalar(0.75 + 0.35 * k))
          rings += 1
        }
        if (f.aim > 0 && rings < TELL_CAP) {
          const k = 1 - f.aim / f.aimTime
          const r = (f.radius + 0.35) * (0.7 + 0.3 * k)
          this.p.set(f.x, 0.04, f.z)
          this.s.set(r, 1, r)
          this.q.identity()
          this.m.compose(this.p, this.q, this.s)
          this.rings.setMatrixAt(rings, this.m)
          this.rings.setColorAt(rings, this.c.copy(TELL_RANGED).multiplyScalar(0.7 + 0.3 * k))
          rings += 1
        }
        if (f.chargeWind > 0 && lanes < TELL_CAP) {
          const k = 1 - f.chargeWind / DIFFICULTY.elite.chargeWind
          const len = f.speed * DIFFICULTY.elite.chargeSpeed * DIFFICULTY.elite.chargeTime * (0.3 + 0.7 * k)
          this.p.set(f.x, 0.05, f.z)
          this.e.set(0, Math.atan2(f.chargeX, f.chargeZ), 0)
          this.q.setFromEuler(this.e)
          this.s.set(f.radius * 2, 1, len)
          this.m.compose(this.p, this.q, this.s)
          this.lanes.setMatrixAt(lanes, this.m)
          this.lanes.setColorAt(lanes, this.c.copy(TELL_CHARGE).multiplyScalar(0.7 + 0.45 * k))
          lanes += 1
        }
      }
      const h = look.height * scale
      this.sphere.center.set(f.x, 0.5 * h + (look.hover ?? 0), f.z)
      this.sphere.radius = Math.max(1.1 * scale, h * 0.6)
      if (!this.frustum.intersectsSphere(this.sphere as never)) continue
      // On the lens: skip the body (it would fill the screen) and its bar.
      if (Math.sqrt(d) < f.radius + CAM_CLEAR) {
        this.lensHidden += 1
        continue
      }
      const depth = (f.x - cam.x) * this.fwd.x + (this.sphere.center.y - cam.y) * this.fwd.y + (f.z - cam.z) * this.fwd.z
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
        windup: f.windup > 0 ? 1 - f.windup / DIFFICULTY.horde.windup : 0,
        hurt: f.hurt,
        spawn: Math.min(1, f.age / SPAWN_TIME),
        dying: f.dying > 0 ? Math.min(1, f.dying / DIE_TIME) : 0,
      })
      if (look.hover !== undefined && look.pose === 'bat') pose.y += look.hover - FOE_SPECS.bat.hover
      // Staggered by a heavy shot: knocked back on its heels, squashed and wobbling.
      if (f.stun > 0 && f.dying <= 0) {
        const s = Math.min(1, f.stun * 3)
        pose.lean -= 0.45 * s
        pose.sy *= 1 - 0.14 * s
        pose.sx *= 1 + 0.08 * s
        pose.roll += Math.sin(time * 38) * 0.12 * s
      }
      this.e.set(pose.lean, f.yaw + (f.dying > 0 ? f.dying * 14 : 0), pose.roll)
      this.q.setFromEuler(this.e)
      this.p.set(f.x, pose.y * scale, f.z)
      this.s.set(pose.sx * scale, pose.sy * scale, pose.sz * scale)
      this.m.compose(this.p, this.q, this.s)
      mesh.setMatrixAt(i, this.m)
      this.c.setRGB(1, 1, 1)
      // The lord's six boss variants (boss10…50, bounty) are tints of one body.
      if (f.kind === 'lord') this.c.copy(this.tints[f.id % this.tints.length])
      else if (f.elite) this.c.copy(f.rage ? RAGE_TINT : ELITE_TINT)
      // Charging a shot: a warm glow that quickens as it fills (≤ 1.35, under the flash cap).
      if (f.aim > 0) {
        const k = 1 - f.aim / f.aimTime
        this.c.lerp(TELL_RANGED, 0.25 + 0.35 * k * (0.6 + 0.4 * Math.sin(time * (14 + 20 * k))))
      }
      // Crouching to charge: a hot shimmer.
      if (f.chargeWind > 0) this.c.lerp(RAGE_TINT, 0.5 + 0.5 * Math.sin(time * 40))
      if (f.dying > 0) this.c.copy(DEATH).multiplyScalar(1 + Math.max(0, 0.5 - Math.abs(f.dying / DIE_TIME - 0.4) * 2.5))
      else if (f.hurt > 0) this.c.lerp(FLASH, Math.min(1, f.hurt * 1.1))
      mesh.setColorAt(i, this.c)
      // Hp bar once she has hurt it (tanky foes since 2026-11: show the progress).
      if (f.dying <= 0 && f.hp < f.maxHp && d < BAR_RANGE * BAR_RANGE && depth > BAR_MIN_DEPTH && bars < BAR_SHOWN) {
        const w0 = (f.elite ? 1.15 : 0.72) * Math.min(1.5, Math.max(1, look.height / 1.1))
        const k = Math.min(1, (BAR_MAX_NDC * depth) / ((w0 / 2) * p00))
        const w = w0 * k
        const y = h + (look.hover ?? 0) + 0.3
        this.p.set(f.x, y, f.z)
        this.s.set(w + 0.07 * k, 0.12 * k, 1)
        this.m.compose(this.p, this.cq, this.s)
        this.bars.setMatrixAt(bars, this.m)
        this.bars.setColorAt(bars, BAR_BACK)
        const frac = Math.max(0.02, Math.min(1, f.hp / f.maxHp))
        this.p.addScaledVector(this.right, -w / 2)
        this.s.set(w * frac, 0.08 * k, 1)
        this.m.compose(this.p, this.cq, this.s)
        this.fills.setMatrixAt(bars, this.m)
        this.c.copy(f.elite ? (f.rage ? BAR_RAGE : BAR_ELITE) : BAR_FILL)
        if (f.hurt > 0) this.c.lerp(WHITE, f.hurt * 0.6)
        this.fills.setColorAt(bars, this.c)
        bars += 1
      }
      this.drawn += 1
      if (useNear) this.nearDrawn += 1
    }
    this.tells = rings + lanes
    this.syncShots(horde, time)
    this.barsDrawn = bars
    for (const b of [this.bars, this.fills]) {
      b.count = bars
      b.visible = bars > 0
      b.instanceMatrix.needsUpdate = true
      if (b.instanceColor) b.instanceColor.needsUpdate = true
    }
    for (const [t, n] of [[this.rings, rings], [this.lanes, lanes]] as const) {
      t.count = n
      t.visible = n > 0
      t.instanceMatrix.needsUpdate = true
      if (t.instanceColor) t.instanceColor.needsUpdate = true
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

  /** Shots in the air, plus a growing orb in front of every foe charging one. */
  private syncShots(horde: Horde, time: number): void {
    const n = new Map<ShotStyle, number>()
    const put = (style: ShotStyle, x: number, y: number, z: number, size: number, spin: number, glow: number) => {
      const mesh = this.shotMeshes.get(style) as InstancedMesh
      const i = n.get(style) ?? 0
      if (i >= mesh.instanceMatrix.count) return
      n.set(style, i + 1)
      this.p.set(x, y, z)
      this.e.set(style === 'moon' ? 0 : spin * 0.7, spin, style === 'star' ? 0 : spin * 0.5)
      this.q.setFromEuler(this.e)
      // Bubbles wobble a little.
      const w = style === 'bubble' ? 1 + 0.08 * Math.sin(time * 18 + spin) : 1
      this.s.set(size * w, size / w, size * w)
      this.m.compose(this.p, this.q, this.s)
      mesh.setMatrixAt(i, this.m)
      mesh.setColorAt(i, this.c.set(SHOT_LOOK[style].color).multiplyScalar(glow))
    }
    for (const s of horde.shots) {
      if (!s.alive) continue
      put(s.style, s.x, s.y, s.z, SHOT_LOOK[s.style].size, time * 6 + s.seed * 6.28, 1)
    }
    for (const f of horde.foes) {
      if (f.aim <= 0 || f.dying > 0) continue
      const k = 1 - f.aim / f.aimTime
      const style = SHOT_STYLE[f.kind]
      const out = f.radius + 0.25
      const y = Math.max(0.55, Math.min(1.3, HORDE[f.kind].chest * (f.elite ? ELITE.scale : 1)))
      put(style, f.x + Math.sin(f.yaw) * out, y, f.z + Math.cos(f.yaw) * out, SHOT_LOOK[style].size * (0.35 + 0.75 * k), time * 9, 0.75 + 0.25 * k)
    }
    this.shotsDrawn = 0
    for (const [style, mesh] of this.shotMeshes) {
      mesh.count = n.get(style) ?? 0
      mesh.visible = mesh.count > 0
      this.shotsDrawn += mesh.count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    for (const mesh of this.shotMeshes.values()) mesh.dispose()
    for (const mesh of [...this.all, ...this.ink.values(), this.rings, this.lanes, this.bars, this.fills]) mesh.dispose()
    this.group.removeFromParent()
  }
}
