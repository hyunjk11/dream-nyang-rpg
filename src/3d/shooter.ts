/**
 * The shared shoulder rig and water gun: the island town and the dream sewer drive the same
 * camera, crosshair, aim assist and full-auto gun, so they feel identical. Each world only says
 * what is solid and what can be shot.
 *
 * Aim, every frame, in this order (so the shot goes exactly where the crosshair is drawn):
 * 1. place the camera at her (`place`), 2. cast the crosshair ray from the camera centre through
 * walls AND foes (`aimFrom`), 3. fire from the muzzle toward that point (`Shooter.update`).
 */
import { AdditiveBlending, BoxGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D, Vector3, type PerspectiveCamera } from 'three'
import type { Hero } from './hero'
import type { Vfx } from './vfx'
import {
  ASSIST, TPS, anglesTo, assistPick, createView, kick, look, perPixel, pose, rayCapsule, recover, wishFrom,
  type AimTarget, type RayFn, type TpsView,
} from './tps'
import { GUN, Gun, hitStopFor, rollDamage, spreadDir } from './dungeon/gunfeel'
import { GunFx } from './dungeon/gunfx'
import { HudFx } from './dungeon/hudfx'
import type { GunCue } from './dungeon/gunsound'

/** What a world tells the rig and the gun. */
export interface AimWorld {
  /** Distance along a unit ray to the first wall / house / ground, or max. */
  solid: RayFn
  /** Live shootable bodies (for the crosshair ray and the assist). */
  targets: () => readonly AimTarget[]
}

export class ShoulderRig {
  readonly view: TpsView
  /** Crosshair point in the world (assisted). */
  readonly aim = new Vector3()
  /** Distance from the camera to the crosshair point. */
  aimDistance = 60
  /** Target index the crosshair is on (or magnetised to), -1 none. */
  target = -1
  /** The raw crosshair ray itself is on a target (not just the assist cone). */
  onTarget = false
  /** Inside some target's assist cone: the look slows a touch. */
  near = false
  fovKick = 0
  shake = 0
  /** Last look came from a finger (touch gets a gentle pull toward foes). */
  touch = false
  private readonly camera: PerspectiveCamera
  private readonly f = new Vector3()

  constructor(camera: PerspectiveCamera, yaw = 0, pitch = 0.1) {
    this.camera = camera
    this.view = createView(yaw, pitch)
  }

  /** Mouse/touch look in pixels: raw, at the saved sensitivity, slower over a foe. */
  look(dx: number, dy: number, touch = false): void {
    this.touch = touch
    look(this.view, dx, dy, perPixel(touch, this.near ? ASSIST.friction : 1))
  }

  wish(axisX: number, axisY: number): { x: number; z: number } {
    return wishFrom(axisX, axisY, this.view.yaw)
  }

  /**
   * Put the camera on her shoulder (locked to her, no follow lag) and apply the per-shot FOV
   * punch and lens shake. Returns true when the lens is far enough from her head to draw her.
   */
  place(dt: number, px: number, py: number, pz: number, ray: RayFn | null): boolean {
    recover(this.view, dt)
    const cam = pose(this.view, ray, px, py, pz, dt)
    const c = this.camera
    c.position.set(cam.x, cam.y, cam.z)
    c.lookAt(cam.x + cam.fx, cam.y + cam.fy, cam.z + cam.fz)
    this.fovKick *= Math.exp(-dt * 14)
    this.shake *= Math.exp(-dt * 22)
    const fov = TPS.fov + this.fovKick
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov
      c.updateProjectionMatrix()
    }
    if (this.shake > 0.001) {
      c.position.x += (Math.random() - 0.5) * this.shake
      c.position.y += (Math.random() - 0.5) * this.shake
    }
    c.updateMatrixWorld()
    // Backed hard into a wall the lens would sit in her hair: let her vanish rather than fill the screen.
    return Math.hypot(cam.x - px, cam.y - py - TPS.height, cam.z - pz) > 0.62
  }

  /**
   * The crosshair ray from the camera centre, against walls and foes. When it misses but a foe
   * sits inside the small assist cone, the aim point snaps to that foe (bullet magnetism).
   */
  aimFrom(world: AimWorld, dt: number): void {
    const c = this.camera
    const o = c.position
    const f = c.getWorldDirection(this.f)
    const solid = world.solid(o.x, o.y, o.z, f.x, f.y, f.z, 60)
    const targets = world.targets()
    let best = solid
    let hit = -1
    for (let i = 0; i < targets.length; i += 1) {
      const t = rayCapsule(o.x, o.y, o.z, f.x, f.y, f.z, targets[i], best)
      if (t >= 0 && t < best) {
        best = t
        hit = i
      }
    }
    // Never aim at a point between the lens and her (it would spin her round).
    const minAim = TPS.back * this.view.boom + 0.9
    if (hit >= 0 && best >= minAim * 0.6) {
      this.onTarget = true
      this.near = true
      this.target = hit
      this.aimDistance = best
      this.aim.copy(o).addScaledVector(f, best)
      return
    }
    this.onTarget = false
    const pick = assistPick(o.x, o.y, o.z, f.x, f.y, f.z, targets, solid)
    if (pick && pick.dist > minAim) {
      this.near = true
      this.target = pick.index
      this.aimDistance = pick.dist
      this.aim.set(pick.x, pick.y, pick.z)
      if (this.touch && dt > 0) {
        // Fingers are clumsy: drift the view gently onto the foe.
        const want = anglesTo(o.x, o.y, o.z, pick.x, pick.y, pick.z)
        const step = ASSIST.touchPull * dt
        let dy = want.yaw - this.view.yaw
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        this.view.yaw += Math.max(-step, Math.min(step, dy))
        this.view.pitch += Math.max(-step, Math.min(step, want.pitch - this.view.pitch)) * 0.5
      }
      return
    }
    this.near = false
    this.target = -1
    this.aimDistance = solid
    this.aim.copy(o).addScaledVector(f, Math.max(solid, minAim))
  }
}

/** One landed droplet, as the world reports it. */
export interface ShotHit {
  t: number
  kill: boolean
  /** How the damage number and hit-stop read. */
  tone: 'n' | 'elite' | 'boss'
  color: number
  /** Where the kill splat goes on the floor. */
  floor?: Vector3
}

export interface ShotWorld extends AimWorld {
  /** Nearest shootable along the shot before `max`: land `amount` on it, or null. */
  strike: (o: Vector3, d: Vector3, max: number, amount: number) => ShotHit | null
  /** Surface normal where a droplet splashed on something solid. */
  normal: (end: Vector3, d: Vector3) => { x: number; y: number; z: number }
}

export interface ShooterHost {
  camera: PerspectiveCamera
  hero: Hero
  vfx: Vfx
  hud: HTMLElement | null
  sfx: (cue: 'shoot_water', gain?: number) => void
  gun?: (cue: GunCue, gain?: number, pitch?: number) => void
  hitStop?: (seconds: number) => void
}

/** Last droplet for QA: muzzle, end point and whether it landed on a foe. */
export interface ShotTrace {
  from: Vector3
  to: Vector3
  aim: Vector3
  hit: boolean
}

/** The full-auto water gun on the shoulder rig. */
export class Shooter {
  readonly rig: ShoulderRig
  readonly gun = new Gun()
  readonly gunFx = new GunFx()
  readonly hudFx: HudFx
  /** Most recent droplet (QA). */
  last: ShotTrace | null = null
  private readonly host: ShooterHost
  private readonly tip = new Vector3()
  private readonly dir = new Vector3()
  private readonly end = new Vector3()
  private readonly tracers: InstancedMesh
  private readonly tracerLife: number[] = []
  private readonly tracerFrom: Vector3[] = []
  private readonly tracerTo: Vector3[] = []
  private readonly dummy = new Object3D()

  constructor(host: ShooterHost, parent: Object3D, yaw = 0, pitch = 0.1) {
    this.host = host
    this.rig = new ShoulderRig(host.camera, yaw, pitch)
    this.hudFx = new HudFx(host.hud)
    this.tracers = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new MeshBasicMaterial({ color: new Color(0xbfeaff).multiplyScalar(2.4), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      24,
    )
    this.tracers.count = 0
    this.tracers.frustumCulled = false
    parent.add(this.gunFx.group, this.tracers)
  }

  get view(): TpsView {
    return this.rig.view
  }

  /** Trigger, gun heat and every droplet that leaves this frame. Call after `rig.aimFrom`. */
  update(dt: number, trigger: boolean, world: ShotWorld): void {
    const { hero } = this.host
    const wasHot = this.gun.overheated
    const shots = this.gun.update(dt, trigger && hero.alive)
    for (let i = 0; i < shots; i += 1) this.fireOne(world)
    if (this.gun.overheated && !wasHot) {
      this.host.gun?.('hiss', 1)
      const t = hero.muzzle.getWorldPosition(this.tip)
      this.host.vfx.burst(t, 0xf2f0ff, { count: 10, speed: 0.8, up: 1.4, life: 0.8, size: 0.4, grow: 0.8, gravity: -1.5, drag: 2, additive: false })
    }
    this.hudFx.aim(this.gun.gapPx, this.gun.heat, this.gun.overheated)
    this.hudFx.target(this.rig.onTarget ? 2 : this.rig.near ? 1 : 0)
    this.tickTracers(dt)
    this.gunFx.update(dt)
    this.hudFx.update(dt, this.host.camera)
  }

  private fireOne(world: ShotWorld): void {
    const { hero, camera } = this.host
    const gun = this.gun
    const tip = hero.muzzle.getWorldPosition(this.tip)
    // Converge on the crosshair point, jittered inside the bloom cone.
    const aimDir = this.dir.copy(this.rig.aim).sub(tip).normalize()
    const d = spreadDir(aimDir.x, aimDir.y, aimDir.z, gun.spread, Math.random(), Math.random())
    const dir = aimDir.set(d.x, d.y, d.z)
    const reach = world.solid(tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, 60)
    const roll = rollDamage(Math.random())
    const hit = world.strike(tip, dir, reach, roll.amount)
    const end = this.end.copy(tip)
    const sfx = this.host.gun
    if (hit) {
      end.addScaledVector(dir, hit.t)
      this.host.vfx.hit(end, hit.color, roll.crit || (hit.kill && hit.tone !== 'n'))
      this.hudFx.hit(hit.kill, roll.crit)
      this.hudFx.number(roll.amount, end, roll.crit ? 'crit' : hit.tone)
      if (hit.kill && hit.tone !== 'boss') {
        this.host.vfx.poof(end, hit.tone === 'elite' ? 0xffe08a : 0xffb7e0, hit.tone === 'elite' ? 1.6 : 1)
        if (hit.floor) this.gunFx.splat(hit.floor, { x: 0, y: 1, z: 0 }, hit.tone === 'elite' ? 0xffd27a : 0xff9fd2, hit.tone === 'elite' ? 1.5 : 0.9)
        sfx?.('pop', hit.tone === 'elite' ? 1 : 0.75, (Math.random() - 0.5) * 0.2)
        if (hit.tone === 'elite') sfx?.('thunk', 1)
      } else sfx?.(roll.crit ? 'crit' : 'tick', hit.tone === 'boss' ? 0.8 : 0.7)
      const stop = hitStopFor({ boss: hit.tone === 'boss', elite: hit.tone === 'elite', kill: hit.kill, crit: roll.crit })
      if (stop > 0) this.host.hitStop?.(stop)
    } else {
      end.addScaledVector(dir, reach)
      const n = world.normal(end, dir)
      this.gunFx.splat(end, n, 0x9ad7ff, 0.42)
      // Sparks kick off the surface, not along the ray.
      this.host.vfx.burst(end.clone().addScaledVector(new Vector3(n.x, n.y, n.z), 0.05), 0xd8f2ff, { count: 4, speed: 3.4, up: 1.2, life: 0.22, size: 0.09, gravity: 7, drag: 2 })
      this.host.vfx.hit(end, 0x9ad7ff)
    }
    this.last = { from: tip.clone(), to: end.clone(), aim: this.rig.aim.clone(), hit: !!hit }
    this.tracer(tip, end)
    this.gunFx.shot(tip, dir, camera, gun.shots)
    hero.recoil()
    kick(this.rig.view, GUN.kickUp * (1 + gun.bloom * 0.6), (Math.random() - 0.5) * 2 * GUN.kickSide)
    this.rig.fovKick = Math.min(1.4, this.rig.fovKick + 0.3)
    this.rig.shake = Math.min(0.02, this.rig.shake + 0.005)
    if (sfx) {
      sfx('shot', 1, gun.heat * 0.1)
      if (gun.shots % 4 === 0) sfx('tail', 0.9)
    } else this.host.sfx('shoot_water', 0.8)
  }

  private tracer(from: Vector3, to: Vector3): void {
    if (this.tracerLife.length >= 24) {
      this.tracerLife.shift()
      this.tracerFrom.shift()
      this.tracerTo.shift()
    }
    this.tracerLife.push(0.05)
    this.tracerFrom.push(from.clone())
    this.tracerTo.push(to.clone())
  }

  private tickTracers(dt: number): void {
    let n = 0
    for (let i = this.tracerLife.length - 1; i >= 0; i -= 1) {
      this.tracerLife[i] -= dt
      if (this.tracerLife[i] <= 0) {
        this.tracerLife.splice(i, 1)
        this.tracerFrom.splice(i, 1)
        this.tracerTo.splice(i, 1)
      }
    }
    for (let i = 0; i < this.tracerLife.length; i += 1) {
      const a = this.tracerFrom[i]
      const b = this.tracerTo[i]
      const len = a.distanceTo(b)
      this.dummy.position.copy(a)
      this.dummy.lookAt(b)
      this.dummy.scale.set(0.04, 0.04, len)
      this.dummy.updateMatrix()
      this.tracers.setMatrixAt(n, this.dummy.matrix)
      n += 1
    }
    this.tracers.count = n
    this.tracers.instanceMatrix.needsUpdate = true
  }

  /** Clear the in-flight bits (switching worlds). */
  reset(): void {
    this.tracerLife.length = 0
    this.tracerFrom.length = 0
    this.tracerTo.length = 0
    this.tracers.count = 0
    this.rig.fovKick = 0
    this.rig.shake = 0
  }

  dispose(): void {
    this.gunFx.dispose()
    this.hudFx.dispose()
    this.tracers.removeFromParent()
    this.tracers.geometry.dispose()
    ;(this.tracers.material as MeshBasicMaterial).dispose()
    this.gunFx.group.removeFromParent()
  }
}
