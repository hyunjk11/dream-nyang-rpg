import { Box3, ConeGeometry, Group, Mesh, MeshToonMaterial, Object3D, SphereGeometry, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { addOutline, applyToon, toon } from '../core/materials'

export type FoeKind = 'slime' | 'bat' | 'bug' | 'rabbit' | 'bloom'

export interface FoeSpec {
  /** Meshy model file under models/3d/. */
  file: string
  /** World height of the model, in metres (Byeolha is 1.62). */
  height: number
  hp: number
  speed: number
  /** Contact damage, or bullet damage for ranged foes. */
  damage: number
  ranged: boolean
  /** Seconds between attacks. */
  cooldown: number
  /** Telegraph before a melee hit / volley, so the player can read it. */
  windup: number
  /** Hover height above ground (flyers). */
  hover: number
  respawn: number
  /** Body radius for bullet hits. */
  radius: number
  /** Dream dust dropped on defeat. */
  dust: number
  /** Texture-as-emissive lift so dark Meshy textures still read under the 3-step toon ramp. */
  lift: number
}

export const FOE_SPECS: Record<FoeKind, FoeSpec> = {
  slime: { file: 'foe_slime_mobile.glb', height: 0.82, hp: 34, speed: 1.8, damage: 7, ranged: false, cooldown: 1.2, windup: 0.32, hover: 0, respawn: 4.5, radius: 0.45, dust: 3, lift: 0.12 },
  bat: { file: 'foe_bat_mobile.glb', height: 0.74, hp: 28, speed: 2.3, damage: 6, ranged: true, cooldown: 1.7, windup: 0.35, hover: 0.85, respawn: 4.5, radius: 0.42, dust: 3, lift: 0.1 },
  bug: { file: 'foe_bug_mobile.glb', height: 0.9, hp: 46, speed: 3.1, damage: 10, ranged: false, cooldown: 0.9, windup: 0.26, hover: 0, respawn: 4.5, radius: 0.48, dust: 4, lift: 0.15 },
  rabbit: { file: 'foe_rabbit_mobile.glb', height: 1.0, hp: 40, speed: 2.6, damage: 8, ranged: false, cooldown: 1.1, windup: 0.3, hover: 0, respawn: 4.5, radius: 0.45, dust: 4, lift: 0.95 },
  bloom: { file: 'foe_boss_mobile.glb', height: 2.5, hp: 260, speed: 0.55, damage: 7, ranged: true, cooldown: 2.6, windup: 0.6, hover: 0, respawn: 14, radius: 1.05, dust: 20, lift: 0.2 },
}

export const FOE_KINDS = Object.keys(FOE_SPECS) as FoeKind[]

/** Procedural pose offsets for a foe body. Pure so it can be unit-tested. */
export interface FoePose {
  y: number
  sx: number
  sy: number
  sz: number
  /** Forward lean (rotation.x) and side roll (rotation.z), radians. */
  lean: number
  roll: number
  /** Ground speed factor for this moment of the gait (rabbit/slime hop: 0 on the ground). */
  stride: number
}

export interface PoseInput {
  t: number
  phase: number
  moving: boolean
  /** 0..1 telegraph progress, 0 when not winding up. */
  windup: number
  /** 0..1 freshly-hit amount, decays to 0. */
  hurt: number
  /** 0..1 spawn pop-in, 1 when fully in. */
  spawn: number
  /** 0..1 death progress, 0 alive. */
  dying: number
}

export function foePose(kind: FoeKind, input: PoseInput): FoePose {
  const { t, phase, moving, windup, hurt, spawn, dying } = input
  const p: FoePose = { y: 0, sx: 1, sy: 1, sz: 1, lean: 0, roll: 0, stride: 1 }
  const spec = FOE_SPECS[kind]
  if (kind === 'slime') {
    const c = (t * (moving ? 2.4 : 1.2) + phase) % 1
    const air = Math.max(0, Math.sin(c * Math.PI * 2))
    p.y = air * (moving ? 0.22 : 0.05)
    // Squash on landing, stretch in the air (volume roughly kept).
    const squash = Math.max(0, -Math.sin(c * Math.PI * 2))
    p.sy = 1 + air * 0.16 - squash * 0.2
    p.sx = p.sz = 1 / Math.sqrt(p.sy)
    p.stride = moving ? 0.35 + air * 1.3 : 0
  } else if (kind === 'rabbit') {
    const c = (t * (moving ? 2.1 : 0.7) + phase) % 1
    const air = Math.max(0, Math.sin(c * Math.PI * 2))
    p.y = air * (moving ? 0.38 : 0.04)
    p.lean = moving ? -0.18 + air * 0.3 : 0
    const land = Math.max(0, -Math.sin(c * Math.PI * 2))
    p.sy = 1 - land * 0.12 + air * 0.06
    p.sx = p.sz = 1 / Math.sqrt(p.sy)
    p.stride = moving ? air * 1.8 : 0
  } else if (kind === 'bug') {
    const s = Math.sin((t * (moving ? 14 : 4) + phase * 6.283))
    p.y = Math.abs(s) * 0.035
    p.roll = s * (moving ? 0.07 : 0.02)
    p.lean = moving ? 0.08 : 0
    p.sy = 1 + Math.sin(t * 3 + phase) * 0.02
  } else if (kind === 'bat') {
    // No skeleton: the wings live in the same mesh, so a fast X squeeze reads as a flap.
    const flap = Math.sin(t * 13 + phase * 6.283)
    p.y = spec.hover + Math.sin(t * 2.2 + phase * 6.283) * 0.14 + flap * 0.04
    p.sx = 1 + flap * 0.12
    p.sy = 1 - flap * 0.04
    p.roll = Math.sin(t * 1.7 + phase) * 0.12
    p.lean = moving ? 0.22 : 0.05
  } else {
    // bloom: slow breathing sway; petals swell on the wind-up.
    const b = Math.sin(t * 1.6 + phase)
    p.sy = 1 + b * 0.03
    p.sx = p.sz = 1 - b * 0.015
    p.roll = Math.sin(t * 0.9 + phase) * 0.05
    p.lean = Math.sin(t * 1.1 + phase) * 0.03
  }
  if (windup > 0) {
    // Crouch and draw back, then the attack snaps forward.
    const w = Math.sin(Math.min(1, windup) * Math.PI * 0.5)
    p.sy *= 1 - 0.18 * w
    p.sx *= 1 + 0.12 * w
    p.sz *= 1 + 0.12 * w
    p.lean -= 0.28 * w
    p.stride = 0
  }
  if (hurt > 0) {
    p.sy *= 1 - 0.22 * hurt
    p.sx *= 1 + 0.16 * hurt
    p.sz *= 1 + 0.16 * hurt
    p.lean -= 0.35 * hurt
  }
  const pop = spawn >= 1 ? 1 : popIn(spawn)
  let scale = pop
  if (dying > 0) {
    // Swell, then shrink to nothing while spinning.
    scale *= dying < 0.25 ? 1 + dying * 1.2 : Math.max(0, 1.3 * (1 - (dying - 0.25) / 0.75))
    p.y += dying * 0.3
  }
  p.sx *= scale
  p.sy *= scale
  p.sz *= scale
  return p
}

/** Pop from 0 to 1 with a small overshoot (ease-out-back). */
export function popIn(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const c1 = 1.70158
  const u = x - 1
  return 1 + (c1 + 1) * u * u * u + c1 * u * u
}

const templates = new Map<FoeKind, Object3D>()
const loader = new GLTFLoader()

/** Loads every Meshy foe. Missing files fall back to primitive bodies. */
export async function loadFoeModels(base: string): Promise<number> {
  const jobs = FOE_KINDS.map(async (kind) => {
    try {
      const gltf = await loader.loadAsync(`${base}models/3d/${FOE_SPECS[kind].file}`)
      const model = gltf.scene
      applyToon(model)
      const lift = FOE_SPECS[kind].lift
      model.traverse((obj) => {
        const mesh = obj as Mesh
        if (!mesh.isMesh) return
        // Add the texture back as a flat glow so dark plush colours stay readable in shade.
        const mat = mesh.material as MeshToonMaterial
        mat.emissiveMap = mat.map
        mat.emissive.set(0xffffff)
        mat.emissiveIntensity = lift
        mat.userData.lift = lift
      })
      const box = new Box3().setFromObject(model)
      const size = box.getSize(new Vector3())
      const scale = size.y > 0.01 ? FOE_SPECS[kind].height / size.y : 1
      model.scale.setScalar(scale)
      const centre = box.getCenter(new Vector3())
      model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale)
      const wrap = new Group()
      wrap.add(model)
      addOutline(wrap, kind === 'bloom' ? 0.024 : 0.015)
      templates.set(kind, wrap)
      return 1
    } catch {
      return 0
    }
  })
  return (await Promise.all(jobs)).reduce<number>((a, b) => a + b, 0)
}

export interface FoeBody {
  /** Animated by foePose; parent group carries world position and facing. */
  rig: Group
  mats: MeshToonMaterial[]
  meshy: boolean
}

export function makeFoeBody(kind: FoeKind): FoeBody {
  const rig = new Group()
  const template = templates.get(kind)
  const inner = template ? template.clone(true) : primitive(kind)
  const mats: MeshToonMaterial[] = []
  inner.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh || mesh.userData.outline) return
    // Own materials per foe so a hit flash lights only the one that was hit.
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const own = list.map((m) => (m as MeshToonMaterial).clone())
    mesh.material = Array.isArray(mesh.material) ? own : own[0]
    for (const m of own) if ((m as MeshToonMaterial).emissive) mats.push(m as MeshToonMaterial)
    mesh.castShadow = true
  })
  if (!template) addOutline(inner, 0.015)
  rig.add(inner)
  return { rig, mats, meshy: Boolean(template) }
}

function primitive(kind: FoeKind): Group {
  const group = new Group()
  const h = FOE_SPECS[kind].height
  const colors: Record<FoeKind, number> = { slime: 0xffb7d5, bat: 0xd8c6ff, bug: 0xc9a8ff, rabbit: 0x9a7ad8, bloom: 0xc38bff }
  const body = new Mesh(new SphereGeometry(h * 0.5, 16, 12), toon(colors[kind]))
  body.position.y = h * 0.5
  group.add(body)
  if (kind === 'bat' || kind === 'bug') {
    const wing = new Mesh(new ConeGeometry(h * 0.2, h * 0.35, 4), toon(0xe8fff4))
    wing.rotation.z = 0.8
    wing.position.set(h * 0.3, h * 0.65, 0)
    const wing2 = wing.clone()
    wing2.rotation.z = -0.8
    wing2.position.x = -h * 0.3
    group.add(wing, wing2)
  }
  return group
}
