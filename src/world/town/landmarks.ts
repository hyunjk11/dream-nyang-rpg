import {
  AdditiveBlending,
  AnimationAction,
  AnimationMixer,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshToonMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { addOutline, applyToon, toon } from '../../core/materials'
import { PLACES, VILLAGE_ONLY, type Place, type PlaceKind } from './places'

const loader = new GLTFLoader()

/** How much of each model's own texture to add back as glow, so shaded sides stay readable. */
const LIFT: Partial<Record<PlaceKind, number>> = { portal: 0.75, fountain: 0.3, kiki: 0.18, luna: 0.2, tree: 0.18, well: 0.22 }
/** Ink-line width in world metres; big buildings get a slightly heavier line. */
const INK: Partial<Record<PlaceKind, number>> = { house: 0.03, workshop: 0.03, tree: 0.028, kiki: 0.012, luna: 0.012, board: 0.018 }

function fileFor(kind: PlaceKind): string {
  return kind === 'kiki' || kind === 'luna' ? `npc_${kind}_mobile.glb` : `place_${kind}_mobile.glb`
}

/** Scale to the target height, stand on the ground, centre on the footprint. */
function fit(model: Object3D, height: number): void {
  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  const scale = size.y > 0.01 ? height / size.y : 1
  model.scale.setScalar(scale)
  const centre = box.getCenter(new Vector3())
  model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale)
}

function lift(root: Object3D, amount: number): MeshToonMaterial[] {
  const mats: MeshToonMaterial[] = []
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const mat = mesh.material as MeshToonMaterial
    if (!mat.isMeshToonMaterial) return
    if (amount > 0 && mat.map) {
      mat.emissiveMap = mat.map
      mat.emissive.set(0xffffff)
      mat.emissiveIntensity = amount
    }
    mats.push(mat)
  })
  return mats
}

/** Paper lantern on a little post: a warm glow the bloom catches at dusk. */
function lantern(): Group {
  const group = new Group()
  const post = new Mesh(new CylinderGeometry(0.035, 0.05, 1.25, 6), toon(0x7a5640))
  post.position.y = 0.62
  const arm = new Mesh(new CylinderGeometry(0.025, 0.025, 0.36, 5), toon(0x7a5640))
  arm.rotation.z = Math.PI / 2
  arm.position.set(0.16, 1.2, 0)
  const globe = new Mesh(new SphereGeometry(0.2, 14, 10), toon(0xfff0c8, 0xffc070, 2.4))
  globe.scale.y = 1.12
  globe.position.set(0.32, 1.0, 0)
  globe.name = 'globe'
  const cap = new Mesh(new CylinderGeometry(0.07, 0.12, 0.07, 8), toon(0x8a5a48))
  cap.position.set(0.32, 1.24, 0)
  group.add(post, arm, globe, cap)
  group.traverse((obj) => {
    if ((obj as Mesh).isMesh) (obj as Mesh).castShadow = true
  })
  addOutline(group, 0.012)
  return group
}

/** A slow swirl of sparkles in front of the portal arch. */
function portalSparks(): Points {
  const count = 70
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const ang = (i / count) * Math.PI * 2 * 3
    const r = 0.25 + (i % 7) * 0.12
    pos.set([Math.cos(ang) * r, 1.5 + Math.sin(ang) * r * 1.2, 0.25], i * 3)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  return new Points(geo, new PointsMaterial({ color: 0xffd8ff, size: 0.09, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }))
}

export interface Npc {
  place: Place
  object: Group
  mixer: AnimationMixer | null
  idle: AnimationAction | null
  wave: AnimationAction | null
  /** Seconds before she waves again. */
  waveCd: number
  near: boolean
}

export class Landmarks {
  readonly group = new Group()
  readonly npcs: Npc[] = []
  private readonly lanterns: Mesh[] = []
  private readonly glow: { mats: MeshToonMaterial[]; base: number; speed: number }[] = []
  private sparks: Points | null = null
  private readonly byKind = new Map<PlaceKind, Group[]>()
  private zone = 'village'
  private time = 0

  constructor(scene: Scene) {
    scene.add(this.group)
    for (const place of PLACES) {
      if (place.kind !== 'lantern') continue
      const post = lantern()
      post.position.set(place.x, 0, place.z)
      post.rotation.y = place.turn + Math.PI / 2
      this.group.add(post)
      const globe = post.getObjectByName('globe') as Mesh
      this.lanterns.push(globe)
    }
  }

  /** Load every Meshy landmark; missing files just leave a gap. Returns how many loaded. */
  async load(base: string): Promise<number> {
    const jobs = PLACES.filter((p) => p.kind !== 'lantern').map(async (place) => {
      try {
        const gltf = await loader.loadAsync(`${base}models/3d/${fileFor(place.kind)}`)
        const model = gltf.scene
        applyToon(model)
        const mats = lift(model, LIFT[place.kind] ?? 0.12)
        fit(model, place.height)
        const wrap = new Group()
        wrap.add(model)
        addOutline(wrap, INK[place.kind] ?? 0.022)
        wrap.position.set(place.x, 0, place.z)
        wrap.rotation.y = place.turn
        this.group.add(wrap)
        this.track(place.kind, wrap)
        if (place.kind === 'portal') {
          this.glow.push({ mats, base: LIFT.portal ?? 0.7, speed: 1.6 })
          this.sparks = portalSparks()
          wrap.add(this.sparks)
        }
        if (place.kind === 'fountain') this.glow.push({ mats, base: LIFT.fountain ?? 0.3, speed: 2.4 })
        if (place.kind === 'kiki' || place.kind === 'luna') this.npcs.push(this.makeNpc(place, wrap, gltf.animations))
        return 1
      } catch {
        return 0
      }
    })
    return (await Promise.all(jobs)).reduce<number>((a, b) => a + b, 0)
  }

  private track(kind: PlaceKind, object: Group): void {
    const list = this.byKind.get(kind) ?? []
    list.push(object)
    this.byKind.set(kind, list)
    object.visible = this.zone === 'village' || !VILLAGE_ONLY.includes(kind)
  }

  /** Only the village has houses and townsfolk; the wild zones keep the tree, fountain and portal. */
  setZone(zone: string): void {
    this.zone = zone
    for (const [kind, list] of this.byKind) for (const object of list) object.visible = zone === 'village' || !VILLAGE_ONLY.includes(kind)
  }

  /** Where a talkable NPC's head is, for the quest marker. */
  npcAt(kind: PlaceKind): Npc | undefined {
    return this.npcs.find((n) => n.place.kind === kind)
  }

  private makeNpc(place: Place, object: Group, clips: import('three').AnimationClip[]): Npc {
    const npc: Npc = { place, object, mixer: null, idle: null, wave: null, waveCd: 0, near: false }
    if (!clips.length) return npc
    const mixer = new AnimationMixer(object)
    const find = (name: string) => clips.find((c) => c.name.toLowerCase().includes(name))
    const idleClip = find('idle') ?? clips[0]
    const waveClip = find('wave')
    npc.mixer = mixer
    npc.idle = mixer.clipAction(idleClip).play()
    if (waveClip) {
      npc.wave = mixer.clipAction(waveClip)
      npc.wave.setLoop(LoopOnce, 1)
      npc.wave.clampWhenFinished = false
      mixer.addEventListener('finished', () => npc.idle?.reset().fadeIn(0.3).play())
    }
    return npc
  }

  update(dt: number, hero: Vector3): void {
    this.time += dt
    const t = this.time
    this.lanterns.forEach((globe, i) => {
      globe.rotation.z = Math.sin(t * 1.4 + i) * 0.08
      ;(globe.material as MeshToonMaterial).emissiveIntensity = 2.2 + Math.sin(t * 3 + i * 1.7) * 0.25
    })
    for (const g of this.glow) {
      const k = g.base * (1 + Math.sin(t * g.speed) * 0.25)
      for (const mat of g.mats) mat.emissiveIntensity = k
    }
    if (this.sparks) {
      this.sparks.rotation.z = t * 0.6
      ;(this.sparks.material as PointsMaterial).opacity = 0.6 + Math.sin(t * 2.2) * 0.25
    }
    for (const npc of this.npcs) {
      if (!npc.object.visible) continue
      npc.mixer?.update(dt)
      const dx = hero.x - npc.place.x
      const dz = hero.z - npc.place.z
      const dist = Math.hypot(dx, dz)
      // Turn to watch Byeolha when she is close; ease back to the plaza otherwise.
      const target = dist < 5 ? Math.atan2(dx, dz) : npc.place.turn
      let delta = target - npc.object.rotation.y
      delta = Math.atan2(Math.sin(delta), Math.cos(delta))
      npc.object.rotation.y += delta * Math.min(1, dt * 4)
      npc.waveCd = Math.max(0, npc.waveCd - dt)
      const near = dist < 4.2
      if (near && !npc.near && npc.waveCd <= 0 && npc.wave) {
        npc.idle?.fadeOut(0.25)
        npc.wave.reset().fadeIn(0.25).play()
        npc.waveCd = 8
      }
      npc.near = near
    }
  }
}
