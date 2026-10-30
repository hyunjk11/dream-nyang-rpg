import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three'
import type { Hero } from '../hero'
import type { Mochi } from '../mochi'
import type { Vfx } from '../vfx'
import { axis, consumeDash, consumeTalk, pad, runningHeld, shoulder } from '../input'
import { generateMaze, tileCentre, type Maze } from './maze'
import { Decor } from './dream'
import { Minimap } from './minimap'
import { Portal } from './portal'
import { Sewer } from './sewer'
import { TPS, createView, kick, look, pose, recover, wishFrom, type TpsView } from './tps'
import { collideCircle, rayHit } from './walls'

/** What the sewer borrows from the hub game each frame. */
export interface RunHost {
  scene: Scene
  camera: PerspectiveCamera
  hero: Hero
  mochi: Mochi
  vfx: Vfx
  sfx: (cue: 'shoot_water' | 'dash' | 'hit' | 'splash' | 'ui' | 'windup', gain?: number) => void
  steps: (dt: number, at: Vector3) => void
  /** She stepped into the return portal. */
  leave: () => void
  /** HUD layer for the minimap (null in tests). */
  hud: HTMLElement | null
  /** Real point lights following the nearest star lamps (fewer on phones). */
  lights: number
}

/** Sewer fog: soft lavender haze that hides the far tunnels. */
export const SEWER_FOG = { color: 0x55407e, near: 4, far: 25 }

const FIRE_GAP = 0.11

/**
 * One sewer run: the maze, the shoulder camera and her shooting. Owns nothing of the hub; the
 * host lends hero, Mochi, vfx and sound.
 */
export class DungeonRun {
  readonly maze: Maze
  readonly view: TpsView
  readonly aim = new Vector3()
  readonly sewer: Sewer
  readonly decor: Decor
  readonly minimap: Minimap
  /** Way home in the start room, and the exit beyond the boss. */
  readonly homePortal: Portal
  readonly exitPortal: Portal
  /** Last crosshair ray hit distance from the camera (m). */
  aimDistance = 0
  private readonly host: RunHost
  private fireCd = 0
  private readonly tracers: InstancedMesh
  private readonly tracerLife: number[] = []
  private readonly tracerFrom: Vector3[] = []
  private readonly tracerTo: Vector3[] = []
  private readonly dummy = new Object3D()
  private lastHero = new Vector3()
  private time = 0

  constructor(host: RunHost, seed: number) {
    this.host = host
    this.maze = generateMaze(seed)
    this.sewer = new Sewer(this.maze)
    host.scene.add(this.sewer.group)
    const s = tileCentre(this.maze, this.maze.start.x, this.maze.start.y)
    this.view = createView(Math.PI / 4, 0.1)
    this.decor = new Decor(this.maze, host.lights)
    this.sewer.group.add(this.decor.group)
    const home = tileCentre(this.maze, this.maze.startRoom.x, this.maze.startRoom.y)
    this.homePortal = new Portal(new Vector3(home.x, 0, home.z), 0x9ad7ff)
    const b = this.maze.bossRoom
    const exit = tileCentre(this.maze, b.x + 2, b.y + 2)
    this.exitPortal = new Portal(new Vector3(exit.x, 0, exit.z), 0xff9fd2)
    this.sewer.group.add(this.homePortal.group, this.exitPortal.group)
    this.minimap = new Minimap(this.maze, host.hud)
    this.minimap.mark(this.maze.startRoom.x, this.maze.startRoom.y, '#7fd0ff')
    this.minimap.mark(b.x + 2, b.y + 2, '#ff6fb8')
    for (const n of this.maze.nests) this.minimap.mark(n.x, n.y, '#7a3a8a')
    this.tracers = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new MeshBasicMaterial({ color: new Color(0xbfeaff).multiplyScalar(2.4), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      24,
    )
    this.tracers.count = 0
    this.tracers.frustumCulled = false
    this.sewer.group.add(this.tracers)
    host.hero.limit = Infinity
    host.hero.revive()
    host.hero.object.position.set(s.x, 0, s.z)
    host.hero.yaw = this.view.yaw
    host.mochi.place(s.x - 0.9, s.z - 0.6)
    this.lastHero.copy(host.hero.object.position)
    host.camera.fov = TPS.fov
    host.camera.updateProjectionMatrix()
    shoulder.on = true
    shoulder.look = (dx, dy, touch) => this.look(dx, dy, touch)
  }

  /** Tear down; the host restores the island. */
  dispose(): void {
    shoulder.on = false
    shoulder.look = () => {}
    if (document.pointerLockElement) document.exitPointerLock?.()
    this.host.hero.limit = 13.2
    this.host.hero.object.visible = true
    this.minimap.dispose()
    this.decor.dispose()
    this.homePortal.dispose()
    this.exitPortal.dispose()
    this.sewer.dispose()
  }

  update(dt: number): void {
    const { hero, camera } = this.host
    this.time += dt
    const move = axis()
    const wish = wishFrom(move.x, move.y, this.view.yaw)
    const dash = consumeDash()
    if (dash && hero.alive) {
      this.host.sfx('dash')
      this.host.vfx.dust(hero.object.position, 2.4)
    }
    // Crosshair ray from last frame's camera: she squares up to whatever it lands on.
    this.aimRay(camera)
    hero.update(dt, { wishX: wish.x, wishZ: wish.z, aim: this.aim, firing: pad.fire && hero.alive, dash, run: runningHeld(), face: true })
    const p = hero.object.position
    const out = collideCircle(this.maze, p.x, p.z, 0.34)
    p.x = out.x
    p.z = out.z
    this.follow(dt)
    this.shoot(dt)
    this.host.steps(dt, p)
    this.tickTracers(dt)
    recover(this.view, dt)
    const cam = pose(this.view, this.maze, p.x, p.y, p.z, dt)
    camera.position.set(cam.x, cam.y, cam.z)
    // Backed hard into a wall the lens would sit in her hair: let her vanish rather than fill the screen.
    hero.object.visible = Math.hypot(cam.x - p.x, cam.y - p.y - TPS.height, cam.z - p.z) > 0.62
    camera.lookAt(cam.x + cam.fx, cam.y + cam.fy, cam.z + cam.fz)
    this.decor.update(this.time, dt, p)
    this.homePortal.update(this.time)
    this.exitPortal.update(this.time)
    this.minimap.update(dt, p.x, p.z, this.view.yaw)
    if (consumeTalk() && this.nearPortal) this.host.leave()
  }

  /** Mouse/touch look in pixels (pointer lock or the QA harness). */
  look(dx: number, dy: number, touch = false): void {
    look(this.view, dx, dy, touch ? TPS.touch : TPS.mouse)
  }

  /** True when she stands on the way home (for the hint). */
  get nearPortal(): boolean {
    const p = this.host.hero.object.position
    return this.homePortal.contains(p.x, p.z) || this.exitPortal.contains(p.x, p.z)
  }

  private aimRay(camera: PerspectiveCamera): void {
    const f = new Vector3()
    camera.getWorldDirection(f)
    const o = camera.position
    const hit = rayHit(this.maze, o.x, o.y, o.z, f.x, f.y, f.z, 60)
    this.aimDistance = hit
    // Too close (hugging a wall) and the parallax would spin her; keep the point a stride out.
    this.aim.copy(o).addScaledVector(f, Math.max(hit, 2.2))
  }

  private follow(dt: number): void {
    const { hero, mochi, camera } = this.host
    const p = hero.object.position
    const vx = dt > 0 ? (p.x - this.lastHero.x) / dt : 0
    const vz = dt > 0 ? (p.z - this.lastHero.z) / dt : 0
    this.lastHero.copy(p)
    mochi.update(dt, p.x, p.z, vx, vz, camera.position.x - p.x, camera.position.z - p.z, 1e6)
    const m = mochi.object.position
    const out = collideCircle(this.maze, m.x, m.z, 0.3)
    m.x = out.x
    m.z = out.z
  }

  private shoot(dt: number): void {
    const { hero } = this.host
    this.fireCd = Math.max(0, this.fireCd - dt)
    if (!pad.fire || !hero.alive || this.fireCd > 0) return
    this.fireCd = FIRE_GAP
    const tip = hero.muzzle.getWorldPosition(new Vector3())
    // Converge on the crosshair point; stop at the first wall between the muzzle and it.
    const dir = this.aim.clone().sub(tip)
    const reach = rayHit(this.maze, tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, dir.length() + 0.01)
    dir.normalize()
    const end = tip.clone().addScaledVector(dir, reach)
    this.tracer(tip, end)
    this.host.vfx.burst(tip, 0xd7f4ff, { count: 3, speed: 1.4, up: 0.2, life: 0.1, size: 0.2, gravity: 0, drag: 8 })
    this.host.vfx.hit(end, 0x9ad7ff)
    hero.recoil()
    kick(this.view, 0.012, (Math.random() - 0.5) * 0.008)
    this.host.sfx('shoot_water', 0.8)
  }

  private tracer(from: Vector3, to: Vector3): void {
    if (this.tracerLife.length >= 24) {
      this.tracerLife.shift()
      this.tracerFrom.shift()
      this.tracerTo.shift()
    }
    this.tracerLife.push(0.06)
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
      this.dummy.scale.set(0.03, 0.03, len)
      this.dummy.updateMatrix()
      this.tracers.setMatrixAt(n, this.dummy.matrix)
      n += 1
    }
    this.tracers.count = n
    this.tracers.instanceMatrix.needsUpdate = true
  }
}
