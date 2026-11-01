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
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  BoxGeometry,
  ConeGeometry,
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

/** Popo's candy stall: a wooden counter, a pink-and-cream striped awning, sweet jars, and Popo. */
function popoStall(base: string): Group {
  const group = new Group()
  const wood = toon(0xb07a56)
  const counter = new Mesh(new BoxGeometry(1.8, 0.85, 0.7), wood)
  counter.position.set(0, 0.43, 0.25)
  const top = new Mesh(new BoxGeometry(1.95, 0.08, 0.82), toon(0xe9c9a0))
  top.position.set(0, 0.89, 0.25)
  const front = new Mesh(new BoxGeometry(1.6, 0.5, 0.02), toon(0xffd6e6))
  front.position.set(0, 0.48, 0.61)
  group.add(counter, top, front)
  for (const x of [-0.88, 0.88]) {
    const post = new Mesh(new CylinderGeometry(0.04, 0.05, 2.0, 6), wood)
    post.position.set(x, 1.0, 0.55)
    group.add(post)
  }
  // Striped awning: alternating wedges along a tilted board.
  const stripes = 7
  for (let i = 0; i < stripes; i += 1) {
    const w = 2.1 / stripes
    const stripe = new Mesh(new BoxGeometry(w, 0.05, 1.05), toon(i % 2 ? 0xfff4e4 : 0xff9fc6))
    stripe.position.set(-1.05 + w * (i + 0.5), 2.02, 0.32)
    stripe.rotation.x = 0.28
    group.add(stripe)
    const flap = new Mesh(new ConeGeometry(w * 0.5, 0.16, 3), toon(i % 2 ? 0xfff4e4 : 0xff9fc6))
    flap.position.set(-1.05 + w * (i + 0.5), 1.83, 0.86)
    flap.rotation.x = Math.PI
    group.add(flap)
  }
  // Sweet jars on the counter, each with a candy glow.
  const jarColors = [0xff9fd2, 0x9fe8c8, 0xffe08a, 0xbfa8ff]
  jarColors.forEach((c, i) => {
    const jar = new Mesh(new CylinderGeometry(0.12, 0.12, 0.26, 10), toon(0xeaf8ff, c, 0.35))
    jar.position.set(-0.6 + i * 0.4, 1.06, 0.4)
    const lid = new Mesh(new SphereGeometry(0.1, 8, 6), toon(0x9fe8c8))
    lid.scale.y = 0.5
    lid.position.set(jar.position.x, 1.21, 0.4)
    group.add(jar, lid)
  })
  // A little sign on the awning: 포포.
  const sign = new Mesh(new BoxGeometry(0.7, 0.26, 0.04), toon(0xfff4e4, 0xffc070, 0.25))
  sign.position.set(0, 2.32, 0.2)
  group.add(sign)
  // Twinkly bulbs strung under the awning lip, and a big swirl lollipop on each post.
  const bulbCols = [0xffe08a, 0xff9fd2, 0x9fe8c8, 0xbfa8ff]
  for (let i = 0; i < 9; i += 1) {
    const x = -0.88 + (1.76 * i) / 8
    const bulb = new Mesh(new SphereGeometry(0.045, 6, 5), toon(0xffffff, bulbCols[i % 4], 1.1))
    bulb.position.set(x, 1.74 - Math.sin((i / 8) * Math.PI) * 0.12, 0.84)
    group.add(bulb)
  }
  for (const x of [-1.05, 1.05]) {
    const stick = new Mesh(new CylinderGeometry(0.025, 0.025, 0.5, 6), toon(0xfff4e4))
    stick.position.set(x, 1.4, 0.62)
    const pop = new Mesh(new CylinderGeometry(0.22, 0.22, 0.06, 16), toon(0xff9fc6, 0xff6fae, 0.25))
    pop.rotation.x = Math.PI / 2
    pop.position.set(x, 1.72, 0.62)
    const swirl = new Mesh(new TorusGeometry(0.12, 0.03, 5, 14), toon(0xfff4e4))
    swirl.position.set(x, 1.72, 0.66)
    group.add(stick, pop, swirl)
  }
  // A crate of candy at the counter's foot.
  const crate = new Mesh(new BoxGeometry(0.5, 0.32, 0.4), wood)
  crate.position.set(-0.6, 0.16, 0.95)
  group.add(crate)
  for (let i = 0; i < 5; i += 1) {
    const candy = new Mesh(new SphereGeometry(0.07, 6, 5), toon(jarColors[i % 4], jarColors[i % 4], 0.3))
    candy.position.set(-0.78 + i * 0.09, 0.36, 0.92 + (i % 2) * 0.08)
    group.add(candy)
  }
  group.traverse((obj) => {
    if ((obj as Mesh).isMesh) (obj as Mesh).castShadow = true
  })
  addOutline(group, 0.014)
  // Popo herself, from her painted portrait, standing behind the counter.
  const tex = new TextureLoader().load(`${base}assets/npc_popo.png`)
  tex.colorSpace = SRGBColorSpace
  const popo = new Sprite(new SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.2 }))
  popo.scale.set(1.25, 1.25, 1)
  popo.position.set(0, 1.18, -0.2)
  popo.name = 'popo'
  group.add(popo)
  return group
}

/** Byeolha's stash chest: a round-lidded toy chest with a gold band and a star latch. */
function stashChest(): Group {
  const group = new Group()
  const box = new Mesh(new BoxGeometry(0.9, 0.5, 0.6), toon(0x9a6ad0))
  box.position.y = 0.25
  const lid = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 14, 1, false, 0, Math.PI), toon(0xb98ad6))
  lid.rotation.z = Math.PI / 2
  lid.rotation.y = Math.PI / 2
  lid.position.y = 0.5
  lid.name = 'lid'
  const band = new Mesh(new BoxGeometry(0.94, 0.08, 0.64), toon(0xffd66b, 0xffc070, 0.3))
  band.position.y = 0.5
  const latch = new Mesh(new SphereGeometry(0.07, 8, 6), toon(0xfff2a0, 0xffd66b, 1.2))
  latch.position.set(0, 0.42, 0.31)
  latch.name = 'latch'
  group.add(box, lid, band, latch)
  // Gold corner trims, stubby feet, and a star on the lid so it reads as hers from afar.
  for (const x of [-0.44, 0.44]) {
    for (const z of [-0.29, 0.29]) {
      const trim = new Mesh(new BoxGeometry(0.06, 0.5, 0.06), toon(0xffd66b, 0xffc070, 0.25))
      trim.position.set(x, 0.25, z)
      const foot = new Mesh(new SphereGeometry(0.07, 6, 5), toon(0x7a4fb0))
      foot.position.set(x * 0.9, 0.02, z * 0.9)
      group.add(trim, foot)
    }
  }
  const star = new Mesh(new ConeGeometry(0.11, 0.04, 5), toon(0xfff2a0, 0xffd66b, 0.8))
  star.rotation.x = Math.PI / 2 - 0.3
  star.position.set(0, 0.68, 0.17)
  group.add(star)
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
  private popo: Object3D | null = null
  private latch: Mesh | null = null

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
    for (const place of PLACES) {
      if (place.kind !== 'popo' && place.kind !== 'stash') continue
      const made = place.kind === 'popo' ? popoStall(base) : stashChest()
      made.position.set(place.x, 0, place.z)
      made.rotation.y = place.turn
      this.group.add(made)
      this.track(place.kind, made)
      if (place.kind === 'popo') this.popo = made.getObjectByName('popo') ?? null
      else this.latch = (made.getObjectByName('latch') as Mesh | undefined) ?? null
    }
    const jobs = PLACES.filter((p) => p.kind !== 'lantern' && p.kind !== 'popo' && p.kind !== 'stash').map(async (place) => {
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
    // Popo bounces on her toes; the chest's star latch twinkles.
    if (this.popo) this.popo.position.y = 1.18 + Math.abs(Math.sin(t * 2.4)) * 0.05
    if (this.latch) (this.latch.material as MeshToonMaterial).emissiveIntensity = 1 + Math.sin(t * 3.1) * 0.5
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
