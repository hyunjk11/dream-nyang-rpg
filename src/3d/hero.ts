import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type AnimationAction,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { wrapAngle } from './feel'
import { addOutline, applyToon, toon } from './materials'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

export interface HeroInput {
  wishX: number
  wishZ: number
  aim: Vector3
  firing: boolean
  dash: boolean
  run: boolean
}

export class Hero {
  readonly object = new Group()
  readonly muzzle = new Object3D()
  readonly aimPoint = new Vector3()
  hp = 100
  readonly maxHp = 100
  alive = true
  iframes = 0
  yaw = 0
  moving = false
  running = false
  dashing = false
  private dashT = 0
  private dashCd = 0
  private hitT = 0
  private deadT = 0
  private shootT = 0
  private walkPhase = 0
  private mixer: AnimationMixer | null = null
  private actions = new Map<string, AnimationAction>()
  private current = ''
  private usingClips = false
  private puppet: Puppet | null = null
  private flashMeshes: Mesh[] = []
  private gun: Group | null = null
  private rightHand: Object3D | null = null
  private spine: Object3D | null = null
  private head: Object3D | null = null
  modelLabel = '임시 모습'

  constructor() {
    this.object.add(shadow())
    this.aimPoint.set(0, 1.1, 4)
  }

  async load(url: string): Promise<boolean> {
    try {
      const gltf = await loader.loadAsync(url)
      const model = gltf.scene
      const box = new Box3().setFromObject(model)
      const height = box.max.y - box.min.y
      const scale = height > 0.2 ? 1.62 / height : 1
      model.scale.setScalar(scale)
      model.position.y = -box.min.y * scale
      model.traverse((obj) => {
        const mesh = obj as Mesh
        if (!mesh.isMesh) return
        this.flashMeshes.push(mesh)
      })
      applyToon(model)
      addOutline(model)
      this.object.add(model)
      this.mixer = new AnimationMixer(model)
      for (const clip of gltf.animations) plantFeet(clip)
      this.bindClip('idle', gltf.animations, 'Idle')
      this.bindClip('walk', gltf.animations, 'Walking_Woman')
      this.bindClip('run', gltf.animations, 'Run_02')
      this.bindClip('shootMove', gltf.animations, 'Walk_Forward_While_Shooting')
      this.bindClip('runShoot', gltf.animations, 'Run_and_Shoot')
      const cowboy = findClip(gltf.animations, 'Cowboy_Quick_Draw_Shooting')
      if (cowboy) {
        const short = sliceClip(cowboy, 'shoot', 0.85, 1.7)
        const action = this.mixer.clipAction(maskUpper(short))
        action.play()
        action.setEffectiveWeight(0.15)
        this.actions.set('aim', action)
      }
      const hit = findClip(gltf.animations, 'Hit_Reaction')
      if (hit) {
        const action = this.mixer.clipAction(maskUpper(hit))
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        this.actions.set('hit', action)
      }
      const death = findClip(gltf.animations, 'dying_backwards')
      if (death) {
        const action = this.mixer.clipAction(death)
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        this.actions.set('death', action)
      }
      this.usingClips = this.actions.has('idle') || this.actions.has('walk')
      this.rightHand = findNamed(model, 'RightHand')
      this.spine = findNamed(model, 'Spine')
      this.head = findNamed(model, 'Head')
      this.attachGun(this.rightHand ?? model)
      this.modelLabel = '메쉬 모델'
      this.play('idle', 0)
      return true
    } catch (error) {
      console.warn('별하 모델을 열지 못했습니다. 임시 모습으로 이어갑니다.', error)
      this.puppet = new Puppet()
      this.object.add(this.puppet.root)
      this.flashMeshes = this.puppet.meshes
      this.rightHand = this.puppet.hand
      this.spine = this.puppet.spine
      this.head = this.puppet.head
      this.attachGun(this.puppet.hand)
      this.modelLabel = '임시 모습'
      return false
    }
  }

  private attachGun(hand: Object3D): void {
    this.rightHand = hand
    this.gun = createWaterGun(this.muzzle)
    this.object.add(this.gun)
  }

  update(dt: number, input: HeroInput): void {
    this.aimPoint.copy(input.aim)
    this.dashCd = Math.max(0, this.dashCd - dt)
    this.iframes = Math.max(0, this.iframes - dt)
    this.hitT = Math.max(0, this.hitT - dt)
    this.shootT = Math.max(0, this.shootT - dt)
    if (!this.alive) {
      this.deadT += dt
      this.actions.get('aim')?.fadeOut(0.12)
      this.play('death', 0.12)
      if (!this.usingClips && this.puppet) this.puppet.fall(Math.min(1, this.deadT / 0.7))
      this.mixer?.update(dt)
      this.pointGun()
      return
    }
    const wish = Math.hypot(input.wishX, input.wishZ)
    this.moving = wish > 0.12
    this.running = wish > 0.2 && input.run
    if (input.dash && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashT = 0.18
      this.dashCd = 0.85
      this.iframes = Math.max(this.iframes, 0.26)
      this.dashing = true
    }
    if (this.dashT > 0) {
      this.dashT -= dt
      this.dashing = this.dashT > 0
    }
    const speed = this.dashing ? 9.2 : this.running ? 5.1 : this.moving ? 3.15 : 0
    if (wish > 0.05) {
      const nx = input.wishX / wish
      const nz = input.wishZ / wish
      this.object.position.x += nx * speed * dt
      this.object.position.z += nz * speed * dt
      const moveYaw = Math.atan2(nx, nz)
      const aimYaw = Math.atan2(input.aim.x - this.object.position.x, input.aim.z - this.object.position.z)
      const face = this.moving ? moveYaw : aimYaw
      this.yaw = dampAngle(this.yaw, face, dt, 14)
    } else {
      const aimYaw = Math.atan2(input.aim.x - this.object.position.x, input.aim.z - this.object.position.z)
      this.yaw = dampAngle(this.yaw, aimYaw, dt, 10)
    }
    const limit = 13.2
    const radial = Math.hypot(this.object.position.x, this.object.position.z)
    if (radial > limit) {
      this.object.position.x *= limit / radial
      this.object.position.z *= limit / radial
    }
    this.object.rotation.y = this.yaw
    this.walkPhase += dt * (this.dashing ? 14 : this.running ? 11 : 8)
    const aimYaw = Math.atan2(input.aim.x - this.object.position.x, input.aim.z - this.object.position.z)
    const upper = wrapAngle(aimYaw - this.yaw)
    if (!this.usingClips) {
      if (this.spine) this.spine.rotation.y = upper * 0.55
      if (this.head) this.head.rotation.y = upper * 0.35
    }
    if (input.firing) this.shootT = 0.22
    let next = 'idle'
    if (this.hitT > 0.45 && this.actions.has('hit')) next = 'hit'
    else if (this.dashing) next = 'run'
    else if (this.running && this.shootT > 0) next = 'runShoot'
    else if (this.moving && this.shootT > 0) next = 'shootMove'
    else if (this.running) next = 'run'
    else if (this.moving) next = 'walk'
    else if (this.shootT > 0) next = 'shoot'
    this.play(next, 0.16)
    if (!this.usingClips && this.puppet) {
      this.puppet.pose(this.walkPhase, this.moving || this.dashing, this.running || this.dashing, this.hitT, upper)
    }
    this.mixer?.update(dt)
    const aim = this.actions.get('aim')
    if (aim && this.alive) {
      if (!aim.isRunning()) aim.play()
      const weight = this.shootT > 0 ? 0.92 : this.moving ? 0.55 : 0.72
      aim.setEffectiveWeight(weight)
    }
    this.pointGun()
    const blink = this.iframes > 0 && Math.sin(this.iframes * 46) > 0
    for (const mesh of this.flashMeshes) {
      const mat = mesh.material
      const list = Array.isArray(mat) ? mat : [mat]
      for (const entry of list) {
        const toonMat = entry as MeshToonMaterial
        if (!toonMat.emissive) continue
        const hot = blink || this.hitT > 0
        toonMat.emissive.set(hot ? 0xffd6ea : 0x000000)
        toonMat.emissiveIntensity = hot ? 0.28 : 0
      }
    }
  }

  hurt(amount: number, from: Vector3): boolean {
    if (!this.alive || this.iframes > 0 || amount <= 0) return false
    this.hp = Math.max(0, this.hp - amount)
    this.iframes = 0.45
    this.hitT = 0.55
    const away = this.object.position.clone().sub(from)
    away.y = 0
    if (away.lengthSq() > 0.01) {
      away.normalize().multiplyScalar(1.4)
      this.object.position.add(away)
    }
    if (this.hp <= 0) {
      this.alive = false
      this.deadT = 0
      this.play('death', 0.05)
    }
    return true
  }

  private pointGun(): void {
    const gun = this.gun
    const hand = this.rightHand
    if (!gun || !hand) return
    const handPos = new Vector3()
    const handQuat = new Quaternion()
    hand.updateWorldMatrix(true, false)
    hand.getWorldPosition(handPos)
    hand.getWorldQuaternion(handQuat)
    // Meshy hand bones point along local +Y toward the fingers.
    const hold = new Vector3(0.02, 0.08, 0.035).applyQuaternion(handQuat)
    handPos.add(hold)
    this.object.worldToLocal(handPos)
    gun.position.copy(handPos)
    gun.scale.setScalar(1)
    const target = this.aimPoint.clone()
    target.y = Math.max(0.75, target.y)
    gun.lookAt(target)
  }

  private play(name: string, fade: number): void {
    if (!this.mixer) return
    const resolved = this.actions.has(name) ? name : name === 'shoot' ? 'idle' : name === 'runShoot' || name === 'shootMove' ? (this.actions.has('walk') ? 'walk' : 'idle') : this.actions.has('walk') && name !== 'idle' ? 'walk' : 'idle'
    if (!this.actions.has(resolved) || this.current === resolved) return
    const next = this.actions.get(resolved)
    const prev = this.actions.get(this.current)
    next?.reset().fadeIn(fade).play()
    if (resolved === 'hit') next?.setEffectiveWeight(0.45)
    prev?.fadeOut(fade)
    this.current = resolved
  }

  private bindClip(key: string, clips: AnimationClip[], hint: string): void {
    const clip = findClip(clips, hint)
    if (!clip || !this.mixer) return
    const action = this.mixer.clipAction(clip)
    this.actions.set(key, action)
  }
}

function findClip(clips: AnimationClip[], hint: string): AnimationClip | undefined {
  const needle = hint.toLowerCase()
  return clips.find((clip) => clip.name.toLowerCase().includes(needle))
}

function findNamed(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null
  root.traverse((obj) => {
    if (found) return
    if (obj.name === name || obj.name.endsWith(`:${name}`) || obj.name.endsWith(`_${name}`)) found = obj
  })
  return found
}

function plantFeet(clip: AnimationClip): void {
  for (const track of clip.tracks) {
    const name = track.name.toLowerCase()
    if (!name.includes('position')) continue
    if (!name.includes('hips') && !name.includes('root')) continue
    const size = track.getValueSize()
    if (size < 3) continue
    const lockX = track.values[0]
    const lockZ = track.values[2]
    for (let i = 0; i < track.times.length; i += 1) {
      track.values[i * size] = lockX
      track.values[i * size + 2] = lockZ
    }
  }
}

function sliceClip(clip: AnimationClip, name: string, t0: number, t1: number): AnimationClip {
  const tracks = clip.tracks
    .map((track) => {
      const size = track.getValueSize()
      const times: number[] = []
      const values: number[] = []
      for (let i = 0; i < track.times.length; i += 1) {
        const time = track.times[i]
        if (time < t0 || time > t1) continue
        times.push(time - t0)
        for (let k = 0; k < size; k += 1) values.push(track.values[i * size + k])
      }
      if (times.length < 2) return null
      const next = track.clone()
      next.times = new Float32Array(times)
      next.values = new Float32Array(values)
      return next
    })
    .filter((track) => track !== null)
  return new AnimationClip(name, Math.max(0.2, t1 - t0), tracks)
}

function maskUpper(clip: AnimationClip): AnimationClip {
  const upper = ['spine', 'chest', 'neck', 'head', 'shoulder', 'arm', 'hand', 'clavicle']
  const tracks = clip.tracks.filter((track) => {
    const name = track.name.toLowerCase()
    return upper.some((part) => name.includes(part))
  })
  return new AnimationClip(`${clip.name}_upper`, clip.duration, tracks.length ? tracks : clip.tracks)
}

function createWaterGun(muzzle: Object3D): Group {
  const gun = new Group()
  gun.name = 'water-gun'
  const body = new Mesh(new BoxGeometry(0.07, 0.09, 0.18), toon(0xffb7d5))
  const tank = new Mesh(new SphereGeometry(0.048, 14, 10), toon(0x8fd0ff, 0x8fd0ff, 0.35))
  tank.scale.y = 0.72
  tank.position.set(0, 0.06, 0.01)
  const grip = new Mesh(new BoxGeometry(0.035, 0.08, 0.04), toon(0xff9ec4))
  grip.position.set(0, -0.06, 0.03)
  const barrel = new Mesh(new CylinderGeometry(0.018, 0.022, 0.16, 10), toon(0x7ec8ff))
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.015, -0.16)
  const nose = new Mesh(new SphereGeometry(0.02, 10, 8), toon(0xd7f4ff, 0xffffff, 0.4))
  nose.position.set(0, 0.015, -0.25)
  const star = new Mesh(new ConeGeometry(0.02, 0.035, 5), toon(0xffe08a, 0xffe08a, 0.2))
  star.position.set(0, 0.02, 0.02)
  muzzle.position.set(0, 0.015, -0.28)
  gun.add(body, tank, grip, barrel, nose, star, muzzle)
  return gun
}

function dampAngle(current: number, target: number, dt: number, lambda: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt))
}

class Puppet {
  readonly root = new Group()
  readonly hand: Object3D
  readonly spine: Object3D
  readonly head: Object3D
  readonly meshes: Mesh[] = []
  private leftLeg: Object3D
  private rightLeg: Object3D
  private leftArm: Object3D
  private rightArm: Object3D
  private body: Object3D

  constructor() {
    const hips = new Group()
    hips.position.y = 0.86
    hips.name = 'Hips'
    this.body = new Group()
    this.body.name = 'Spine'
    this.spine = this.body
    const torso = part(new CapsuleGeometry(0.16, 0.22, 4, 8), 0xc9b6ff)
    torso.position.y = 0.22
    const skirt = part(new ConeGeometry(0.22, 0.2, 12), 0x8ec5ff)
    skirt.position.y = 0.02
    this.head = new Group()
    this.head.name = 'Head'
    this.head.position.y = 0.5
    const face = part(new SphereGeometry(0.16, 16, 14), 0xffe0d0)
    const hair = part(new SphereGeometry(0.18, 16, 12), 0xff9ec8)
    hair.scale.set(1.05, 1.15, 1.05)
    hair.position.y = 0.04
    const bang = part(new SphereGeometry(0.1, 12, 10), 0xffb7d5)
    bang.position.set(0, 0.02, 0.1)
    const star = part(new ConeGeometry(0.04, 0.07, 5), 0xffe08a, 0xffe08a, 0.3)
    star.position.set(0.1, 0.12, 0.06)
    const eyeL = part(new SphereGeometry(0.028, 8, 8), 0x4a3358)
    const eyeR = eyeL.clone()
    eyeL.position.set(-0.05, 0.02, 0.14)
    eyeR.position.set(0.05, 0.02, 0.14)
    this.head.add(hair, bang, face, star, eyeL, eyeR)
    this.leftArm = limb(0.28, 0xc9b6ff)
    this.rightArm = limb(0.28, 0xc9b6ff)
    this.leftArm.position.set(-0.22, 0.28, 0)
    this.rightArm.position.set(0.22, 0.28, 0)
    this.rightArm.name = 'RightArm'
    this.hand = new Group()
    this.hand.name = 'RightHand'
    this.hand.position.y = -0.3
    this.rightArm.add(this.hand)
    this.leftLeg = limb(0.42, 0xfff6ea)
    this.rightLeg = limb(0.42, 0xfff6ea)
    this.leftLeg.position.set(-0.08, -0.02, 0)
    this.rightLeg.position.set(0.08, -0.02, 0)
    const shoeL = part(new BoxGeometry(0.1, 0.06, 0.16), 0xffb7d5)
    const shoeR = shoeL.clone()
    shoeL.position.set(0, -0.44, 0.03)
    shoeR.position.set(0, -0.44, 0.03)
    this.leftLeg.add(shoeL)
    this.rightLeg.add(shoeR)
    this.body.add(torso, this.head, this.leftArm, this.rightArm)
    hips.add(skirt, this.body, this.leftLeg, this.rightLeg)
    this.root.add(hips)
    this.root.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh) this.meshes.push(mesh)
    })
  }

  pose(phase: number, moving: boolean, running: boolean, hit: number, aimYaw: number): void {
    const swing = Math.sin(phase) * (moving ? (running ? 0.7 : 0.5) : 0.04)
    this.leftLeg.rotation.x = swing
    this.rightLeg.rotation.x = -swing
    this.leftArm.rotation.x = -swing * 0.45
    this.rightArm.rotation.x = -0.9 + Math.sin(phase) * (moving ? 0.08 : 0)
    this.rightArm.rotation.z = -0.35
    this.rightArm.rotation.y = aimYaw * 0.4
    const breathe = 1 + Math.sin(phase * 0.35) * 0.02
    this.body.scale.set(1, breathe, 1)
    this.body.rotation.x = hit > 0 ? -0.35 : moving ? 0.08 : 0
    this.head.rotation.x = hit > 0 ? 0.4 : 0
  }

  fall(k: number): void {
    this.root.rotation.x = -1.15 * k
    this.root.position.y = -0.35 * k
  }
}

function part(geometry: SphereGeometry | BoxGeometry | ConeGeometry | CapsuleGeometry | CylinderGeometry, color: number, emissive = 0x000000, emissiveIntensity = 0): Mesh {
  const mesh = new Mesh(geometry, toon(color, emissive, emissiveIntensity))
  mesh.castShadow = true
  return mesh
}

function limb(length: number, color: number): Group {
  const group = new Group()
  const mesh = part(new CapsuleGeometry(0.045, length * 0.55, 3, 6), color)
  mesh.position.y = -length * 0.35
  group.add(mesh)
  return group
}

function shadow(): Mesh {
  const mesh = new Mesh(new CircleGeometry(0.38, 20), new MeshBasicMaterial({ color: 0x241433, transparent: true, opacity: 0.28 }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.02
  return mesh
}
