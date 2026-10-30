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
import { HOLD_POSES, aimPitchDeg, damp, upperTwist, wrapAngle, type HoldPose, type HoldState } from './feel'
import { BARREL_CONE, CHARACTER_INK, GUN_SIZE, HERO_HEIGHT, REST_PITCH, barrelQuaternion, barrelYaw, calibrateGrip, handForGun, type Grip } from './grip'
import { addOutline, applyToon, characterGradient, toon } from './materials'
import { KNOCK, MOVE, gaitBlend, gaitRate, knockDecay, legYaw, turnToward } from './motion'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

export interface HeroInput {
  wishX: number
  wishZ: number
  aim: Vector3
  firing: boolean
  dash: boolean
  run: boolean
  /** Shoulder camera: keep her chest on the aim even when not shooting (legs still follow travel). */
  face?: boolean
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
  private hitAction: AnimationAction | null = null
  private actions = new Map<string, AnimationAction>()
  private current = ''
  private usingClips = false
  private puppet: Puppet | null = null
  private flashMeshes: Mesh[] = []
  private gun: Group | null = null
  private grip: Grip | null = null
  private rightHand: Object3D | null = null
  private arm: ArmRig | null = null
  private readonly hold: HoldPose = clonePose(HOLD_POSES.idle)
  private holdState: HoldState = 'idle'
  private twist = 0
  /** 0 = gun at rest (low ready), 1 = raised along the aim. */
  private ready = 0
  private recoilT = 0
  private moveYaw = 0
  /** Her own steering velocity (m/s), eased in and out, and a separate decaying knockback push. */
  readonly vel = new Vector3()
  readonly knock = new Vector3()
  /** Synced gait cycle [0,1) shared by the walk and run clips; per-clip phase offsets line feet up. */
  private gait = 0
  private gaitOffset: Record<string, number> = { walk: 0, run: 0 }
  private idleTurning = false
  private squash = 0
  private model: Object3D | null = null
  private baseScale = 1
  private spines: Object3D[] = []
  private spine: Object3D | null = null
  private head: Object3D | null = null
  modelLabel = '임시 모습'
  /** Island edge (m from the centre); the sewer turns it off and does its own wall collision. */
  limit = 13.2

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
      const scale = height > 0.2 ? HERO_HEIGHT / height : 1
      model.scale.setScalar(scale)
      model.position.y = -box.min.y * scale
      this.model = model
      this.baseScale = scale
      model.traverse((obj) => {
        const mesh = obj as Mesh
        if (!mesh.isMesh) return
        this.flashMeshes.push(mesh)
      })
      applyToon(model, characterGradient())
      // Thin, distance-scaled ink: the toy-like model reads by its silhouette, not by heavy lines.
      addOutline(model, CHARACTER_INK.width, CHARACTER_INK.color, CHARACTER_INK.near)
      this.object.add(model)
      // Grip calibration needs the bind pose, so it runs before any clip touches the bones.
      this.object.updateMatrixWorld(true)
      const bindHand = findNamed(model, 'RightHand')
      const bindFore = findNamed(model, 'RightForeArm')
      const grip = bindHand && bindFore ? calibrateGrip(this.object, bindFore, bindHand) : null
      this.mixer = new AnimationMixer(model)
      for (const clip of gltf.animations) plantFeet(clip)
      this.bindClip('idle', gltf.animations, 'Idle')
      this.bindClip('walk', gltf.animations, 'Walking_Woman')
      this.bindClip('run', gltf.animations, 'Run_02')
      this.bindClip('shootMove', gltf.animations, 'Walk_Forward_While_Shooting')
      this.bindClip('runShoot', gltf.animations, 'Run_and_Shoot')
      const hit = findClip(gltf.animations, 'Hit_Reaction')
      if (hit) {
        // Layered on top of locomotion (normalized blend), so the legs keep moving.
        const action = this.mixer.clipAction(maskUpper(hit))
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = false
        this.hitAction = action
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
      this.spines = ['Spine02', 'Spine01', 'Spine'].map((name) => findNamed(model, name)).filter((bone): bone is Object3D => !!bone)
      this.arm = ArmRig.from(model, gltf.animations, this.mixer)
      if (grip && this.rightHand) this.holdGun(this.rightHand, grip)
      else this.attachGun(this.rightHand ?? model)
      this.modelLabel = '메쉬 모델'
      this.measureGaitOffsets(model)
      this.startLocomotion()
      return true
    } catch (error) {
      console.warn('별하 모델을 열지 못했습니다. 임시 모습으로 이어갑니다.', error)
      this.puppet = new Puppet()
      this.object.add(this.puppet.root)
      this.flashMeshes = this.puppet.meshes
      this.rightHand = this.puppet.hand
      this.spine = this.puppet.spine
      this.spines = []
      this.head = this.puppet.head
      this.attachGun(this.puppet.hand)
      this.modelLabel = '임시 모습'
      return false
    }
  }

  /** Placeholder path: the gun floats with the puppet hand and is aimed every frame (pointGun). */
  private attachGun(hand: Object3D): void {
    this.rightHand = hand
    this.gun = createWaterGun(this.muzzle)
    this.object.add(this.gun)
  }

  /**
   * Rigged path: the gun is parented to the RightHand bone with a fixed grip (barrel along the
   * fingers, palm against the grip), so it always sits in her hand whatever the clip does.
   * Aiming turns the wrist (orientHand), never the gun on its own.
   */
  private holdGun(hand: Object3D, grip: Grip): void {
    this.rightHand = hand
    const gun = createWaterGun(this.muzzle)
    gun.position.copy(grip.offset)
    gun.quaternion.copy(grip.rotation)
    gun.scale.setScalar(GUN_SIZE / grip.handScale)
    hand.add(gun)
    this.gun = gun
    this.grip = grip
  }

  update(dt: number, input: HeroInput): void {
    this.aimPoint.copy(input.aim)
    this.dashCd = Math.max(0, this.dashCd - dt)
    this.iframes = Math.max(0, this.iframes - dt)
    this.hitT = Math.max(0, this.hitT - dt)
    this.shootT = Math.max(0, this.shootT - dt)
    if (!this.alive) {
      this.deadT += dt
      this.play('death', 0.12)
      if (!this.usingClips && this.puppet) this.puppet.fall(Math.min(1, this.deadT / 0.7))
      this.mixer?.update(dt)
      this.pointGun()
      return
    }
    const wish = Math.hypot(input.wishX, input.wishZ)
    const wants = wish > 0.12
    this.running = wants && wish > 0.2 && input.run
    if (input.dash && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashT = 0.18
      this.dashCd = 0.85
      this.iframes = Math.max(this.iframes, 0.26)
      this.dashing = true
      // Dash goes where she steers, else where she faces.
      const dx = wish > 0.05 ? input.wishX / wish : Math.sin(this.yaw)
      const dz = wish > 0.05 ? input.wishZ / wish : Math.cos(this.yaw)
      this.vel.set(dx * MOVE.dash, 0, dz * MOVE.dash)
    }
    if (this.dashT > 0) {
      this.dashT -= dt
      this.dashing = this.dashT > 0
    }
    // Steering velocity eases toward the wish, so starts and stops have a little weight instead of
    // popping between 0 and full speed (which also made the feet slide on every stop).
    const top = this.dashing ? MOVE.dash : this.running ? MOVE.run : wants ? MOVE.walk : 0
    // A strong push takes some steering away, so holding a key into the enemy can't fight it.
    const pushed = Math.min(1, this.knock.length() / KNOCK.speed)
    const control = 1 - pushed * KNOCK.controlLoss
    let tx = 0
    let tz = 0
    if (wish > 0.05 && !this.dashing) {
      tx = (input.wishX / wish) * top * control
      tz = (input.wishZ / wish) * top * control
    } else if (this.dashing) {
      const len = Math.hypot(this.vel.x, this.vel.z) || 1
      tx = (this.vel.x / len) * MOVE.dash
      tz = (this.vel.z / len) * MOVE.dash
    }
    const speedNow = Math.hypot(this.vel.x, this.vel.z)
    const lambda = Math.hypot(tx, tz) >= speedNow ? MOVE.accel : MOVE.brake
    const k = 1 - Math.exp(-lambda * dt)
    this.vel.x += (tx - this.vel.x) * k
    this.vel.z += (tz - this.vel.z) * k
    const decay = knockDecay(dt)
    this.knock.multiplyScalar(decay)
    if (this.knock.lengthSq() < 1e-4) this.knock.set(0, 0, 0)
    this.object.position.x += (this.vel.x + this.knock.x) * dt
    this.object.position.z += (this.vel.z + this.knock.z) * dt
    const speed = Math.hypot(this.vel.x, this.vel.z)
    this.moving = speed > 0.35
    if (speed > 0.05) this.moveYaw = Math.atan2(this.vel.x, this.vel.z)
    const aimYaw = Math.atan2(input.aim.x - this.object.position.x, input.aim.z - this.object.position.z)
    const firing = input.firing || this.shootT > 0
    if (firing || input.face) {
      // Torso squares up to the aim; legs lean toward travel so strafing isn't a sideways moonwalk.
      this.idleTurning = false
      const face = this.moving ? legYaw(this.moveYaw, aimYaw) : aimYaw
      this.yaw = turnToward(this.yaw, face, dt, MOVE.turnAim, MOVE.turnAimMax)
    } else if (this.moving) {
      this.idleTurning = false
      this.yaw = turnToward(this.yaw, this.moveYaw, dt, MOVE.turnMove, MOVE.turnMoveMax)
    } else {
      // Standing: head and chest follow the cursor; the feet only shuffle round once it is well
      // behind her shoulder. She used to whip 180° to the cursor every time she stopped.
      const off = Math.abs(wrapAngle(aimYaw - this.yaw))
      if (off > MOVE.idleTurnStart) this.idleTurning = true
      if (off < MOVE.idleTurnStop) this.idleTurning = false
      if (this.idleTurning) this.yaw = turnToward(this.yaw, aimYaw, dt, MOVE.turnIdle, MOVE.turnIdleMax)
    }
    const limit = this.limit
    const radial = Math.hypot(this.object.position.x, this.object.position.z)
    if (radial > limit) {
      this.object.position.x *= limit / radial
      this.object.position.z *= limit / radial
    }
    this.object.rotation.y = this.yaw
    this.walkPhase += dt * (this.dashing ? 14 : this.running ? 11 : 8)
    const upper = wrapAngle(aimYaw - this.yaw)
    if (!this.usingClips) {
      if (this.spine) this.spine.rotation.y = upper * 0.55
      if (this.head) this.head.rotation.y = upper * 0.35
    }
    if (input.firing) this.shootT = 0.22
    // Signed speed along her legs: negative = backpedal, the synced cycle runs backward.
    const along = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)
    const signed = speed * (along < -0.25 * speed ? -1 : 1)
    this.driveLocomotion(dt, speed, signed)
    let next = 'idle'
    if (this.dashing) next = 'run'
    else if (this.running && this.shootT > 0) next = 'runShoot'
    else if (this.moving && this.shootT > 0) next = 'shootMove'
    else if (this.running) next = 'run'
    else if (this.moving) next = 'walk'
    const hold: HoldState = this.dashing ? 'dash' : this.hitT > 0.2 ? 'hit' : next === 'idle' && this.shootT > 0 ? 'shoot' : (next as HoldState)
    this.holdState = hold
    this.blendHold(HOLD_POSES[hold], dt)
    this.recoilT = Math.max(0, this.recoilT - dt * 9)
    if (!this.usingClips && this.puppet) {
      this.puppet.pose(this.walkPhase, this.moving || this.dashing, this.running || this.dashing, this.hitT, upper)
    }
    this.mixer?.update(dt)
    // Walking somewhere without shooting, she glances at the cursor rather than corkscrewing.
    const share = this.moving && !firing ? this.hold.twist * 0.35 : this.hold.twist
    this.twist = damp(this.twist, upperTwist(aimYaw, this.yaw, share), dt, 12)
    this.ready = damp(this.ready, firing ? 1 : 0, dt, firing ? 22 : 5)
    this.applySquash(dt)
    this.poseUpperBody(aimYaw)
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
    this.squash = 1
    if (this.hitAction && this.hp > 0) {
      this.hitAction.reset().setEffectiveWeight(0.85).fadeIn(0.05).play()
      this.hitAction.fadeOut(0.5)
    }
    // A push that decays over a few frames. It used to add 1.4 m to her position in one frame,
    // which read as a teleport and yanked the camera.
    const away = this.object.position.clone().sub(from)
    away.y = 0
    if (away.lengthSq() < 0.01) away.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    away.normalize().multiplyScalar(KNOCK.speed)
    this.knock.copy(away)
    // Her own run is braked a little so the push reads, without zeroing it (no dead stop).
    this.vel.multiplyScalar(0.45)
    if (this.hp <= 0) {
      this.alive = false
      this.deadT = 0
      this.play('death', 0.05)
    }
    return true
  }

  /** Back to life after "다시 하기". */
  revive(): void {
    this.alive = true
    this.vel.set(0, 0, 0)
    this.knock.set(0, 0, 0)
    this.deadT = 0
    const death = this.actions.get('death')
    death?.fadeOut(0.2)
    this.current = ''
    this.startLocomotion()
  }

  /** Kick the gun back a touch on every shot. */
  recoil(): void {
    this.recoilT = 1
  }

  /** Current hold state, for QA hooks and tests. */
  get hold_state(): HoldState {
    return this.holdState
  }

  private blendHold(target: HoldPose, dt: number): void {
    const k = 1 - Math.exp(-16 * dt)
    const h = this.hold
    h.reach.fwd += (target.reach.fwd - h.reach.fwd) * k
    h.reach.right += (target.reach.right - h.reach.right) * k
    h.reach.up += (target.reach.up - h.reach.up) * k
    h.palm.x += (target.palm.x - h.palm.x) * k
    h.palm.y += (target.palm.y - h.palm.y) * k
    h.palm.z += (target.palm.z - h.palm.z) * k
    h.pitch += (target.pitch - h.pitch) * k
    h.twist += (target.twist - h.twist) * k
  }

  /** Spine twist toward the aim, then two-bone IK so the right hand holds the gun in front of her chest. */
  private poseUpperBody(aimYaw: number): void {
    if (!this.alive) return
    if (this.spines.length) {
      const share = this.twist / this.spines.length
      for (const bone of this.spines) rotateWorldY(bone, share)
    }
    const arm = this.arm
    const chest = this.spine
    if (!arm || !chest) return
    this.object.updateMatrixWorld(true)
    const chestPos = chest.getWorldPosition(_v1)
    const frameYaw = this.yaw + this.twist + wrapAngle(aimYaw - this.yaw - this.twist) * 0.35
    const fwd = _v2.set(Math.sin(frameYaw), 0, Math.cos(frameYaw))
    const right = _v3.set(-fwd.z, 0, fwd.x)
    const kick = this.recoilT * this.recoilT
    const r = this.hold.reach
    // Hold poses are tuned in metres for a 0.5 m arm; the chibi arm is shorter, so scale them.
    const k = arm.span / ARM_REFERENCE
    const target = _v4
      .copy(chestPos)
      .addScaledVector(fwd, (r.fwd - kick * 0.06) * k)
      .addScaledVector(right, r.right * k)
    target.y += (r.up + kick * 0.02) * k
    arm.solve(target, fwd, right)
    if (this.grip) this.orientHand(aimYaw, kick)
  }

  /** Turn the wrist so the hand-held barrel points along the aim, or rests in a low ready when she isn't shooting. */
  private orientHand(aimYaw: number, kick: number): void {
    const hand = this.rightHand
    const grip = this.grip
    if (!hand || !grip || !hand.parent) return
    hand.updateWorldMatrix(true, false)
    const at = this.muzzle.getWorldPosition(_v1)
    const toAim = _v2.copy(this.aimPoint).sub(at)
    const flat = Math.hypot(toAim.x, toAim.z)
    const facing = this.yaw + this.twist
    const yaw = barrelYaw(flat > 0.25 ? Math.atan2(toAim.x, toAim.z) : aimYaw, facing, this.alive)
    const pitchDeg = aimPitchDeg(toAim.y, flat, this.hold.pitch) + kick * 9
    const aimQ = barrelQuaternion(yaw, (pitchDeg * Math.PI) / 180, _q1)
    const restQ = barrelQuaternion(facing + 0.18, REST_PITCH, _q2)
    const gunWorld = restQ.slerp(aimQ, this.ready)
    const handWorld = handForGun(gunWorld, grip, _q3)
    const parentQ = hand.parent.getWorldQuaternion(_q4).invert()
    hand.quaternion.copy(parentQ.multiply(handWorld))
    hand.updateWorldMatrix(false, true)
  }

  private pointGun(): void {
    const gun = this.gun
    const hand = this.rightHand
    if (!gun || !hand || this.grip) return
    const handPos = new Vector3()
    const handQuat = new Quaternion()
    hand.updateWorldMatrix(true, false)
    hand.getWorldPosition(handPos)
    hand.getWorldQuaternion(handQuat)
    const place = handPos.clone()
    if (this.arm) {
      // Per-clip palm offset in RightHand space: along the fingers and out of the palm.
      const p = this.hold.palm
      place.addScaledVector(this.arm.handAxis(handQuat, 'thumb'), p.x)
      place.addScaledVector(this.arm.handAxis(handQuat, 'fingers'), p.y)
      place.addScaledVector(this.arm.handAxis(handQuat, 'palm'), p.z)
    } else {
      place.add(new Vector3(0, -0.02, 0.04).applyQuaternion(handQuat))
    }
    const local = this.object.worldToLocal(place.clone())
    gun.position.copy(local)
    gun.scale.setScalar(1.12)
    const aimDir = this.aimPoint.clone().sub(place)
    const flat = Math.hypot(aimDir.x, aimDir.z)
    let yaw = flat > 0.25 ? Math.atan2(aimDir.x, aimDir.z) : this.yaw
    // Never point across her back: keep the barrel inside a cone in front of her chest.
    const facing = this.yaw + this.twist
    const off = wrapAngle(yaw - facing)
    const cone = BARREL_CONE
    if (Math.abs(off) > cone) yaw = facing + Math.sign(off) * cone
    if (!this.alive) yaw = this.yaw
    const kick = this.recoilT * this.recoilT
    const pitchDeg = this.alive ? aimPitchDeg(aimDir.y, flat, this.hold.pitch) + kick * 9 : 0
    const pitch = (pitchDeg * Math.PI) / 180
    const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    gun.lookAt(place.add(dir))
  }

  /**
   * Idle, walk and run all play at once; their weights follow her real speed and the walk/run
   * clips are scrubbed from one shared cycle, so their feet stay in step through the blend and the
   * planted foot moves backward at her ground speed. Running backward plays the cycle in reverse.
   */
  private driveLocomotion(dt: number, speed: number, signed: number): void {
    if (!this.mixer || !this.alive) return
    const walk = this.actions.get('walk')
    const run = this.actions.get('run')
    const idle = this.actions.get('idle')
    if (!walk || !run || !idle) return
    const w = gaitBlend(speed)
    this.gait = (((this.gait + gaitRate(signed) * dt) % 1) + 1) % 1
    idle.setEffectiveWeight(w.idle)
    walk.setEffectiveWeight(w.walk)
    run.setEffectiveWeight(w.run)
    walk.time = (((this.gait + this.gaitOffset.walk) % 1) + 1) % 1 * walk.getClip().duration
    run.time = (((this.gait + this.gaitOffset.run) % 1) + 1) % 1 * run.getClip().duration
  }

  private startLocomotion(): void {
    if (!this.mixer) return
    for (const key of ['idle', 'walk', 'run']) {
      const action = this.actions.get(key)
      if (!action) continue
      action.reset().play()
      action.setEffectiveWeight(key === 'idle' ? 1 : 0)
      // Walk and run are scrubbed by hand from the shared cycle.
      action.setEffectiveTimeScale(key === 'idle' ? 1 : 0)
    }
    this.current = 'loco'
  }

  /** Phase of each locomotion clip where the left foot is furthest forward, so the blend is in step. */
  private measureGaitOffsets(model: Object3D): void {
    const foot = findNamed(model, 'LeftToeBase') ?? findNamed(model, 'LeftFoot')
    if (!foot || !this.mixer) return
    for (const key of ['walk', 'run'] as const) {
      const action = this.actions.get(key)
      if (!action) continue
      this.mixer.stopAllAction()
      action.reset().setEffectiveWeight(1).play()
      const duration = action.getClip().duration
      let best = -Infinity
      let at = 0
      for (let i = 0; i < 48; i += 1) {
        action.time = (duration * i) / 48
        this.mixer.update(0)
        model.updateMatrixWorld(true)
        const p = model.worldToLocal(foot.getWorldPosition(_v1))
        if (p.z > best) {
          best = p.z
          at = i / 48
        }
      }
      this.gaitOffset[key] = at
    }
    this.mixer.stopAllAction()
  }

  /** Quick squash-and-stretch on a hit instead of a jump in position. */
  private applySquash(dt: number): void {
    this.squash = Math.max(0, this.squash - dt * 4.5)
    if (!this.model) return
    const e = this.squash * this.squash
    const wobble = Math.sin((1 - this.squash) * 9) * e
    this.model.scale.set(this.baseScale * (1 + 0.07 * wobble), this.baseScale * (1 - 0.09 * wobble), this.baseScale * (1 + 0.07 * wobble))
  }

  /** Synced gait cycle, for QA. */
  get gait_phase(): number {
    return this.gait
  }

  /** Direction she travels this frame (yaw), for QA and the stride sync. */
  get move_yaw(): number {
    return this.moveYaw
  }

  private play(name: string, fade: number): void {
    // Locomotion is a weighted blend (driveLocomotion); this only switches into the death clip.
    if (!this.mixer || name !== 'death' || this.current === 'death') return
    const death = this.actions.get('death')
    if (!death) return
    for (const key of ['idle', 'walk', 'run']) this.actions.get(key)?.fadeOut(fade)
    death.reset().fadeIn(fade).play()
    this.current = 'death'
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

function maskUpper(clip: AnimationClip): AnimationClip {
  const upper = ['spine', 'chest', 'neck', 'head', 'shoulder', 'arm', 'hand', 'clavicle']
  const tracks = clip.tracks.filter((track) => {
    const name = track.name.toLowerCase()
    return upper.some((part) => name.includes(part))
  })
  return new AnimationClip(`${clip.name}_upper`, clip.duration, tracks.length ? tracks : clip.tracks)
}

/** Cute water pistol. Origin is the grip (sits in the palm); the barrel points along +Z so lookAt aims it. */
function createWaterGun(muzzle: Object3D): Group {
  const gun = new Group()
  gun.name = 'water-gun'
  const pink = toon(0xffa9cd)
  const body = new Mesh(new BoxGeometry(0.06, 0.075, 0.17), pink)
  body.position.set(0, 0.055, 0.045)
  const grip = new Mesh(new BoxGeometry(0.036, 0.085, 0.045), toon(0xff8fbf))
  grip.position.set(0, 0.0, 0.0)
  grip.rotation.x = -0.25
  const tank = new Mesh(new SphereGeometry(0.042, 12, 8), toon(0x8fd0ff, 0x8fd0ff, 0.45))
  tank.scale.set(0.9, 0.8, 1.1)
  tank.position.set(0, 0.112, 0.02)
  const barrel = new Mesh(new CylinderGeometry(0.016, 0.02, 0.12, 10), toon(0x7ec8ff, 0x7ec8ff, 0.15))
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.06, 0.18)
  const nose = new Mesh(new SphereGeometry(0.022, 10, 8), toon(0xe8f8ff, 0xffffff, 0.5))
  nose.position.set(0, 0.06, 0.245)
  const star = new Mesh(new ConeGeometry(0.018, 0.03, 5), toon(0xffe08a, 0xffe08a, 0.35))
  star.position.set(0, 0.097, 0.09)
  const guard = new Mesh(new BoxGeometry(0.012, 0.03, 0.05), toon(0xff8fbf))
  guard.position.set(0, 0.006, 0.045)
  muzzle.position.set(0, 0.06, 0.27)
  gun.add(body, grip, tank, barrel, nose, star, guard, muzzle)
  for (const child of gun.children) {
    const mesh = child as Mesh
    if (mesh.isMesh) mesh.castShadow = true
  }
  addOutline(gun, 0.01)
  return gun
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
  const mesh = new Mesh(new CircleGeometry(0.36, 24), new MeshBasicMaterial({ color: 0x3a2350, transparent: true, opacity: 0.26, depthWrite: false }))
  mesh.rotation.x = -Math.PI / 2
  // Above the painted ground (y 0.02) so it never z-fights.
  mesh.position.y = 0.05
  mesh.renderOrder = 1
  return mesh
}

const _v1 = new Vector3()
const _v2 = new Vector3()
const _v3 = new Vector3()
const _v4 = new Vector3()
const _q1 = new Quaternion()
const _q2 = new Quaternion()
const _q3 = new Quaternion()
const _q4 = new Quaternion()
const UP = new Vector3(0, 1, 0)
/** Arm length (m) the HOLD_POSES reach offsets were tuned for. */
const ARM_REFERENCE = 0.5

function clonePose(pose: HoldPose): HoldPose {
  return { reach: { ...pose.reach }, palm: { ...pose.palm }, pitch: pose.pitch, twist: pose.twist }
}

/** Rotate a bone about world up while keeping its parent untouched. */
function rotateWorldY(bone: Object3D, angle: number): void {
  if (Math.abs(angle) < 1e-4 || !bone.parent) return
  bone.parent.updateWorldMatrix(true, false)
  const parentQ = bone.parent.getWorldQuaternion(_q1)
  const spin = _q2.setFromAxisAngle(UP, angle)
  // local' = parent^-1 * spin * parent * local
  const inv = parentQ.clone().invert()
  bone.quaternion.premultiply(inv.multiply(spin).multiply(parentQ))
  bone.updateWorldMatrix(false, true)
}

/** Aim a bone so the direction to its child points at a world position. */
function aimBone(bone: Object3D, childPos: Vector3, goal: Vector3): void {
  if (!bone.parent) return
  const origin = bone.getWorldPosition(new Vector3())
  const from = childPos.clone().sub(origin).normalize()
  const to = goal.clone().sub(origin).normalize()
  if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return
  const delta = new Quaternion().setFromUnitVectors(from, to)
  const world = bone.getWorldQuaternion(new Quaternion())
  const parentQ = bone.parent.getWorldQuaternion(new Quaternion())
  world.premultiply(delta)
  bone.quaternion.copy(parentQ.invert().multiply(world))
  bone.updateWorldMatrix(false, true)
}

/**
 * Right arm chain with a ready pose taken from the shooting clip and a two-bone IK solve.
 * The elbow hangs down and a little out, so the forearm never cuts through her ribs.
 */
class ArmRig {
  private ready: { bone: Object3D; q: Quaternion }[] = []
  /** Upper arm + forearm length in world metres, measured from the bind pose. */
  span = ARM_REFERENCE
  private fingers = new Vector3(0, 1, 0)
  private thumb = new Vector3(1, 0, 0)
  private palm = new Vector3(0, 0, 1)

  constructor(
    private shoulder: Object3D,
    private upper: Object3D,
    private fore: Object3D,
    private hand: Object3D,
  ) {}

  static from(model: Object3D, clips: AnimationClip[], mixer: AnimationMixer): ArmRig | null {
    const shoulder = findNamed(model, 'RightShoulder')
    const upper = findNamed(model, 'RightArm')
    const fore = findNamed(model, 'RightForeArm')
    const hand = findNamed(model, 'RightHand')
    if (!shoulder || !upper || !fore || !hand) return null
    const rig = new ArmRig(shoulder, upper, fore, hand)
    const clip = findClip(clips, 'Walk_Forward_While_Shooting') ?? findClip(clips, 'Cowboy_Quick_Draw')
    if (clip) {
      const probe = mixer.clipAction(clip)
      probe.reset().setEffectiveWeight(1).play()
      probe.time = Math.min(1, clip.duration * 0.3)
      mixer.update(0)
      for (const bone of [shoulder, hand]) rig.ready.push({ bone, q: bone.quaternion.clone() })
      probe.stop()
      mixer.stopAllAction()
    }
    // Hand axes in its own space: the forearm->hand direction continues as "fingers".
    model.updateMatrixWorld(true)
    rig.span = upper.getWorldPosition(new Vector3()).distanceTo(fore.getWorldPosition(new Vector3())) + fore.getWorldPosition(new Vector3()).distanceTo(hand.getWorldPosition(new Vector3()))
    const handPos = hand.getWorldPosition(new Vector3())
    const forePos = fore.getWorldPosition(new Vector3())
    const handQ = hand.getWorldQuaternion(new Quaternion()).invert()
    rig.fingers.copy(handPos.sub(forePos).normalize().applyQuaternion(handQ)).normalize()
    // Pick the hand-space axis least aligned with the fingers as the palm normal seed.
    const seed = Math.abs(rig.fingers.z) < 0.8 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)
    rig.thumb.crossVectors(rig.fingers, seed).normalize()
    rig.palm.crossVectors(rig.thumb, rig.fingers).normalize()
    return rig
  }

  handAxis(handWorld: Quaternion, which: 'fingers' | 'thumb' | 'palm'): Vector3 {
    const axis = which === 'fingers' ? this.fingers : which === 'thumb' ? this.thumb : this.palm
    return axis.clone().applyQuaternion(handWorld)
  }

  solve(target: Vector3, fwd: Vector3, right: Vector3): void {
    for (const entry of this.ready) entry.bone.quaternion.copy(entry.q)
    this.shoulder.updateWorldMatrix(true, true)
    const a = this.upper.getWorldPosition(new Vector3())
    const b = this.fore.getWorldPosition(new Vector3())
    const c = this.hand.getWorldPosition(new Vector3())
    const l1 = a.distanceTo(b)
    const l2 = b.distanceTo(c)
    const toT = target.clone().sub(a)
    const d = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.985)
    const dir = toT.normalize()
    const goal = a.clone().addScaledVector(dir, d)
    // Elbow hint: down, out to her right, slightly back.
    const pole = new Vector3(0, -1, 0).addScaledVector(right, 0.7).addScaledVector(fwd, -0.25)
    pole.addScaledVector(dir, -pole.dot(dir)).normalize()
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along))
    const elbow = a.clone().addScaledVector(dir, along).addScaledVector(pole, h)
    aimBone(this.upper, b, elbow)
    const c2 = this.hand.getWorldPosition(new Vector3())
    aimBone(this.fore, c2, goal)
    // Straight wrist toward the aim so the grip reads as a pistol hold.
    const handQ = this.hand.getWorldQuaternion(new Quaternion())
    const fingers = this.fingers.clone().applyQuaternion(handQ)
    const want = fwd.clone().multiplyScalar(0.75).add(goal.clone().sub(this.fore.getWorldPosition(new Vector3())).normalize().multiplyScalar(0.25)).normalize()
    const twist = new Quaternion().setFromUnitVectors(fingers, want)
    const world = handQ.premultiply(twist)
    const parentQ = this.fore.getWorldQuaternion(new Quaternion()).invert()
    this.hand.quaternion.copy(parentQ.multiply(world))
    this.hand.updateWorldMatrix(false, true)
  }
}
