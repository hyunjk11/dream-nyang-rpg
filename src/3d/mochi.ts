import {
  BackSide,
  Box3,
  ConeGeometry,
  Group,
  Matrix3,
  Matrix4,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  Object3D,
  RGBADepthPacking,
  SphereGeometry,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { CAT, createCat, gaitWeights, stepCat, type CatBrain } from '../sim/companion'
import { OUTLINE_COLOR, applyToon, chainOutlinePush, outlineGeometry, toon } from './materials'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

/** Uniforms shared by every Mochi material (and its shadow material). */
interface GaitUniforms {
  uTime: { value: number }
  uPhase: { value: number }
  uWalk: { value: number }
  uRun: { value: number }
  uTwitch: { value: number }
}

/**
 * Mochi has no rig, so the walk is procedural:
 * - the follow brain (companion.ts) moves it with capped speed and acceleration,
 * - the gait phase advances with distance travelled, so paws never skate,
 * - a vertex shader swings the four paws in a diagonal trot (front and back pairs bound together
 *   at a run), lifts the paw in its swing half, and moves tail and ears,
 * - the body group bobs twice per stride, rolls with weight shift, banks into turns,
 *   leans with acceleration, and squashes on footfalls.
 */
export class Mochi {
  readonly object = new Group()
  private body = new Group()
  private visual = new Group()
  private time = 0
  readonly fishMuzzle = new Object3D()
  readonly brain: CatBrain = createCat()
  private gait: GaitUniforms = { uTime: { value: 0 }, uPhase: { value: 0 }, uWalk: { value: 0 }, uRun: { value: 0 }, uTwitch: { value: 0 } }
  private walk = 0
  private run = 0
  private lean = 0
  private bank = 0
  private lastSpeed = 0
  private lastYaw = 0
  private twitchT = 2
  private placed = false

  constructor() {
    this.object.add(this.body)
    this.body.add(this.visual)
    this.fishMuzzle.position.set(0, 0.35, 0.45)
    this.object.add(this.fishMuzzle)
  }

  async load(url: string): Promise<boolean> {
    try {
      const gltf = await loader.loadAsync(url)
      const model = gltf.scene
      model.rotation.y = (30 * Math.PI) / 180
      const box = new Box3().setFromObject(model)
      const height = box.max.y - box.min.y
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
      if (height < width * 0.65) model.rotation.x = -Math.PI / 2
      const scale = height > 0.05 ? 0.62 / height : 1
      model.scale.setScalar(scale)
      model.position.y = -box.min.y * scale
      applyToon(model)
      this.visual.add(model)
      this.rigShaders(model)
      return true
    } catch (error) {
      console.warn('모찌 모델을 열지 못했습니다. 임시 고양이로 이어갑니다.', error)
      const cat = placeholderCat()
      this.visual.add(cat)
      this.rigShaders(cat)
      return false
    }
  }

  /** Mesh-local to cat-frame matrices so the shader can key legs, tail and ears in metres. */
  private rigShaders(root: Object3D): void {
    this.visual.updateMatrixWorld(true)
    const toVisual = new Matrix4().copy(this.visual.matrixWorld).invert()
    const shells: [Mesh, Mesh][] = []
    root.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh || mesh.userData.outline) return
      const toCat = new Matrix4().multiplyMatrices(toVisual, mesh.matrixWorld)
      const fromCat = new Matrix3().setFromMatrix4(toCat).invert()
      const local = { uToCat: { value: toCat }, uFromCat: { value: fromCat } }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) gaitShader(material, this.gait, local)
      const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
      gaitShader(depth, this.gait, local)
      mesh.customDepthMaterial = depth
      mesh.castShadow = true
      // Ink outline that bends with the same leg/tail shader as the body.
      const ws = mesh.getWorldScale(new Vector3())
      const width = 0.012 / Math.max(1e-4, (ws.x + ws.y + ws.z) / 3)
      const ink = new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide })
      gaitShader(ink, this.gait, local)
      chainOutlinePush(ink, width, `mochi-outline-${width.toFixed(5)}`)
      const shell = new Mesh(outlineGeometry(mesh.geometry), ink)
      shell.userData.outline = true
      shell.frustumCulled = false
      shells.push([mesh, shell])
    })
    for (const [mesh, shell] of shells) mesh.add(shell)
  }

  /** Put Mochi at a spot without walking there (spawn, restart). */
  place(x: number, z: number, yaw = 0): void {
    this.brain.x = x
    this.brain.z = z
    this.brain.vx = 0
    this.brain.vz = 0
    this.brain.yaw = yaw
    this.brain.moving = false
    this.object.position.set(x, 0, z)
    this.object.rotation.y = yaw
    this.lastYaw = yaw
    this.placed = true
  }

  get speed(): number {
    return Math.hypot(this.brain.vx, this.brain.vz)
  }

  update(dt: number, heroX: number, heroZ: number, heroVx: number, heroVz: number, camX: number, camZ: number, limit: number): void {
    this.time += dt
    if (!this.placed) this.place(heroX + 0.8, heroZ - 1.0)
    if (dt <= 0) return
    const cat = this.brain
    stepCat(cat, dt, heroX, heroZ, heroVx, heroVz, camX, camZ, limit)
    const speed = Math.hypot(cat.vx, cat.vz)
    const w = gaitWeights(speed)
    // Weights ease so stopping settles into idle instead of freezing mid-stride.
    this.walk += (w.walk - this.walk) * (1 - Math.exp(-8 * dt))
    this.run += (w.run - this.run) * (1 - Math.exp(-5 * dt))
    const accel = (speed - this.lastSpeed) / dt
    this.lastSpeed = speed
    this.lean += (Math.max(-1, Math.min(1, accel / CAT.accel)) - this.lean) * (1 - Math.exp(-6 * dt))
    const yawRate = Math.atan2(Math.sin(cat.yaw - this.lastYaw), Math.cos(cat.yaw - this.lastYaw)) / dt
    this.lastYaw = cat.yaw
    this.bank += (Math.max(-1, Math.min(1, yawRate * speed * 0.08)) - this.bank) * (1 - Math.exp(-6 * dt))

    const phase = cat.phase
    const walk = this.walk
    const run = this.run
    // Two footfalls per trot cycle; at a run the body arcs once per bound.
    const trotBob = Math.abs(Math.sin(phase))
    const bound = Math.max(0, Math.sin(phase))
    const bob = walk * (0.012 + 0.012 * run) * trotBob + run * 0.045 * bound * bound
    const breathe = Math.sin(this.time * 2.1) * (1 - walk) * 0.012
    this.object.position.set(cat.x, bob, cat.z)
    this.object.rotation.y = cat.yaw
    this.body.rotation.z = walk * (1 - run) * 0.05 * Math.sin(phase) - this.bank * 0.12
    this.body.rotation.x = run * 0.09 * Math.cos(phase) + this.lean * 0.07
    const land = walk * (1 - trotBob) * (0.035 + run * 0.05)
    this.visual.scale.set(1 + land * 0.5, 1 - land + breathe, 1 + land * 0.3 + run * 0.06 * bound)

    this.twitchT -= dt
    if (this.twitchT <= 0) this.twitchT = 1.6 + ((this.time * 7.31) % 2.6)
    this.gait.uTime.value = this.time
    this.gait.uPhase.value = phase
    this.gait.uWalk.value = walk
    this.gait.uRun.value = run
    this.gait.uTwitch.value = Math.max(0, 1 - this.twitchT * 5) * (1 - walk)
  }
}

function gaitShader(material: Material, gait: GaitUniforms, local: { uToCat: { value: Matrix4 }; uFromCat: { value: Matrix3 } }): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, gait, local)
    shader.vertexShader = `uniform float uTime;
uniform float uPhase;
uniform float uWalk;
uniform float uRun;
uniform float uTwitch;
uniform mat4 uToCat;
uniform mat3 uFromCat;
${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 p = (uToCat * vec4(transformed, 1.0)).xyz;
        vec3 d = vec3(0.0);
        // Paws: front cluster z 0.08..0.33, back -0.2..0.03, split left/right at x = 0.
        float hip = 0.2;
        float leg = clamp((hip - p.y) / hip, 0.0, 1.0);
        float paw = smoothstep(0.35, 1.0, leg);
        float front = smoothstep(0.0, 0.07, p.z);
        float right = smoothstep(-0.03, 0.03, p.x);
        // Trot pairs FL+BR vs FR+BL; at a run the front pair and back pair move together.
        float trot = front * (1.0 - right) + (1.0 - front) * right;
        float sgn = mix(2.0 * trot - 1.0, 2.0 * front - 1.0, uRun);
        float amp = uWalk * (0.075 + 0.05 * uRun);
        float runShift = uRun * (1.0 - front) * 1.2;
        d.z += sin(uPhase + runShift) * sgn * amp * leg;
        d.y += max(0.0, cos(uPhase + runShift) * sgn) * amp * 0.75 * paw;
        // Tail: sways, lifts and streams back with speed.
        float tail = smoothstep(-0.2, -0.36, p.z) * smoothstep(0.12, 0.26, p.y);
        float reach = clamp((-0.2 - p.z) / 0.25, 0.0, 1.0);
        float swish = sin(uTime * (2.6 + 3.0 * uWalk) + p.z * 9.0) * (0.045 + 0.03 * uWalk) * reach;
        d.x += swish * tail;
        d.y += (uRun * 0.05 + uWalk * 0.015) * reach * tail;
        // Ears: idle twitch, pinned back a little at a run.
        float ear = smoothstep(0.47, 0.56, p.y) * smoothstep(0.12, 0.22, p.z);
        d.x += sin(uTime * 38.0) * 0.012 * uTwitch * ear;
        d.z -= uRun * 0.025 * ear;
        d.y -= uRun * 0.01 * ear;
        transformed += uFromCat * d;
      }`,
    )
  }
  material.customProgramCacheKey = () => 'mochi-gait'
}

function placeholderCat(): Object3D {
  const cat = new Group()
  const body = new Mesh(new SphereGeometry(0.22, 16, 12), toon(0xfff1e4))
  body.scale.set(0.95, 0.9, 1.15)
  body.position.y = 0.24
  const head = new Mesh(new SphereGeometry(0.16, 16, 12), toon(0xfff6ea))
  head.position.set(0, 0.42, 0.22)
  const earL = new Mesh(new ConeGeometry(0.05, 0.1, 6), toon(0xffd0ea))
  const earR = earL.clone()
  earL.position.set(-0.07, 0.56, 0.2)
  earR.position.set(0.07, 0.56, 0.2)
  const tail = new Mesh(new SphereGeometry(0.05, 8, 8), toon(0xffe4d2))
  tail.scale.set(1, 1, 2.4)
  tail.position.set(0, 0.28, -0.3)
  const legs: Mesh[] = []
  for (const [x, z] of [[-0.1, 0.18], [0.1, 0.18], [-0.1, -0.1], [0.1, -0.1]]) {
    const leg = new Mesh(new SphereGeometry(0.055, 8, 6), toon(0xfff1e4))
    leg.scale.set(1, 1.6, 1)
    leg.position.set(x, 0.07, z)
    legs.push(leg)
  }
  body.castShadow = true
  head.castShadow = true
  cat.add(body, head, earL, earR, tail, ...legs)
  return cat
}
