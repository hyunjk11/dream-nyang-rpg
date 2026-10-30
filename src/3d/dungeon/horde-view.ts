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
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FOE_SPECS, foePose } from '../foes'
import { outlineInstanced, toonGradient } from '../materials'
import { DIE_TIME, ELITE, HORDE_CAP, SPAWN_TIME, type Horde, type HordeKind } from './horde'

export const HORDE_KINDS: HordeKind[] = ['slime', 'bug', 'rabbit', 'bat']
/** Within this many metres of the lens a foe gets the full textured model. */
export const NEAR_LOD = 10
export const NEAR_CAP = 16

interface Art {
  geo: BufferGeometry
  mat: Material
}

const art = new Map<string, Art>()

/** Fallback / test body: a toon ball in the kind's colour. */
function ballArt(kind: HordeKind): Art {
  const colors: Record<HordeKind, number> = { slime: 0xffb7d5, bat: 0xd8c6ff, bug: 0xc9a8ff, rabbit: 0x9a7ad8 }
  const h = FOE_SPECS[kind].height
  const geo = new SphereGeometry(h * 0.5, 10, 8).translate(0, h * 0.5, 0)
  return { geo, mat: new MeshToonMaterial({ color: colors[kind], gradientMap: toonGradient() }) }
}

/** Bake the GLB's node transform, then stand it on the floor at the kind's height. */
function normalise(geo: BufferGeometry, kind: HordeKind, box?: Box3): Box3 {
  geo.computeBoundingBox()
  const b = box ?? (geo.boundingBox as Box3).clone()
  const size = b.getSize(new Vector3())
  const s = size.y > 0.01 ? FOE_SPECS[kind].height / size.y : 1
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

/** Loads near (textured) and far (baked colour) bodies; missing files keep the ball fallback. */
export async function loadHordeArt(base: string): Promise<number> {
  const loader = new GLTFLoader()
  const grab = async (file: string) => {
    const gltf = await loader.loadAsync(`${base}models/3d/${file}`)
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
  let n = 0
  await Promise.all(
    HORDE_KINDS.map(async (kind) => {
      try {
        const near = await grab(FOE_SPECS[kind].file)
        const box = normalise(near.geo, kind)
        const src = near.mat as unknown as { map?: MeshToonMaterial['map'] }
        const lift = FOE_SPECS[kind].lift
        const mat = new MeshToonMaterial({ map: src.map ?? null, gradientMap: toonGradient(), emissive: 0xffffff, emissiveMap: src.map ?? null, emissiveIntensity: lift })
        art.set(`${kind}:near`, { geo: near.geo, mat })
        n += 1
        try {
          const far = await grab(FOE_SPECS[kind].file.replace('_mobile', '_far_mobile'))
          normalise(far.geo, kind, box)
          far.geo.computeVertexNormals()
          art.set(`${kind}:far`, { geo: far.geo, mat: new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), emissive: 0x302040, emissiveIntensity: 0.6 }) })
        } catch {
          art.set(`${kind}:far`, { geo: near.geo, mat })
        }
      } catch {
        // keep fallback
      }
    }),
  )
  return n
}

const ELITE_TINT = new Color(1.25, 1.02, 0.55)
const FLASH = new Color(3.2, 3.0, 3.4)
const DEATH = new Color(2.4, 1.6, 2.6)

export class HordeView {
  readonly group = new Group()
  /** Instances drawn last frame (near + far), for QA and the perf test. */
  drawn = 0
  nearDrawn = 0
  private readonly near = new Map<HordeKind, InstancedMesh>()
  private readonly far = new Map<HordeKind, InstancedMesh>()
  private readonly ink = new Map<HordeKind, InstancedMesh>()
  private readonly frustum = new Frustum()
  private readonly pv = new Matrix4()
  private readonly m = new Matrix4()
  private readonly q = new Quaternion()
  private readonly e = new Euler(0, 0, 0, 'YXZ')
  private readonly p = new Vector3()
  private readonly s = new Vector3()
  private readonly c = new Color()
  private readonly sphere = { center: new Vector3(), radius: 1 }

  constructor() {
    this.group.name = 'sewer-horde'
    for (const kind of HORDE_KINDS) {
      const n = art.get(`${kind}:near`) ?? ballArt(kind)
      const f = art.get(`${kind}:far`) ?? n
      const near = new InstancedMesh(n.geo, n.mat, NEAR_CAP)
      const far = new InstancedMesh(f.geo, f.mat, HORDE_CAP)
      for (const mesh of [near, far]) {
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.setColorAt(0, new Color(1, 1, 1))
        mesh.name = `horde-${kind}`
      }
      const ink = outlineInstanced(near, 0.018)
      ink.count = 0
      this.near.set(kind, near)
      this.far.set(kind, far)
      this.ink.set(kind, ink)
      this.group.add(near, ink, far)
    }
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
      this.sphere.center.set(f.x, 0.6 * scale, f.z)
      this.sphere.radius = 1.1 * scale
      if (!this.frustum.intersectsSphere(this.sphere as never)) continue
      const useNear = Math.sqrt(d) < NEAR_LOD && this.nearDrawn < NEAR_CAP
      const mesh = (useNear ? this.near : this.far).get(f.kind) as InstancedMesh
      const i = counts.get(mesh) ?? 0
      if (i >= mesh.instanceMatrix.count) continue
      counts.set(mesh, i + 1)
      const pose = foePose(f.kind, {
        t: time,
        phase: f.phase,
        moving: Math.hypot(f.vx, f.vz) > 0.3,
        windup: f.windup > 0 ? 1 - f.windup / 0.32 : 0,
        hurt: f.hurt,
        spawn: Math.min(1, f.age / SPAWN_TIME),
        dying: f.dying > 0 ? Math.min(1, f.dying / DIE_TIME) : 0,
      })
      this.e.set(pose.lean, f.yaw + (f.dying > 0 ? f.dying * 14 : 0), pose.roll)
      this.q.setFromEuler(this.e)
      this.p.set(f.x, pose.y * scale, f.z)
      this.s.set(pose.sx * scale, pose.sy * scale, pose.sz * scale)
      this.m.compose(this.p, this.q, this.s)
      mesh.setMatrixAt(i, this.m)
      this.c.setRGB(1, 1, 1)
      if (f.elite) this.c.copy(ELITE_TINT)
      if (f.dying > 0) this.c.copy(DEATH)
      else if (f.hurt > 0) this.c.lerp(FLASH, f.hurt * 0.8)
      mesh.setColorAt(i, this.c)
      this.drawn += 1
      if (useNear) this.nearDrawn += 1
    }
    for (const kind of HORDE_KINDS) {
      for (const mesh of [this.near.get(kind), this.far.get(kind)] as InstancedMesh[]) {
        mesh.count = counts.get(mesh) ?? 0
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
      const ink = this.ink.get(kind) as InstancedMesh
      ink.count = (this.near.get(kind) as InstancedMesh).count
    }
  }

  dispose(): void {
    for (const mesh of [...this.near.values(), ...this.far.values(), ...this.ink.values()]) mesh.dispose()
    this.group.removeFromParent()
  }
}
