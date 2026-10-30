import {
  AdditiveBlending,
  BoxGeometry,
  SphereGeometry,
  type Group,
  type MeshToonMaterial,
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
import { Tile, generateMaze, tileCentre, type Maze } from './maze'
import { Decor } from './dream'
import { Minimap } from './minimap'
import { Portal } from './portal'
import { Sewer } from './sewer'
import { TPS, createView, kick, look, pose, recover, wishFrom, type TpsView } from './tps'
import { collideCircle, rayHit } from './walls'
import { HORDE, Horde } from './horde'
import { HordeView } from './horde-view'
import { DRAIN, Director } from './waves'
import { BOSS, Boss } from './boss'
import { foePose, makeFoeBody } from '../foes'

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
  /** A foe or orb landed on her (the host owns the hurt flash, sound and the down screen). */
  hurt: (amount: number, from: Vector3) => void
  /** Big centre banner (wave start, boss). */
  banner: (title: string, sub: string) => void
}

/** Sewer fog: soft lavender haze that hides the far tunnels. */
export const SEWER_FOG = { color: 0x55407e, near: 4, far: 25 }

const FIRE_GAP = 0.11
/** Water-gun damage per shot (elites take ~14 shots, the boss ~150). */
export const SHOT_DAMAGE = 9
/** Boss body is drawn at this multiple of its island size. */
const BOSS_SCALE = 1.4

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
  readonly horde: Horde
  readonly hordeView: HordeView
  readonly director = new Director()
  readonly boss: Boss
  private readonly bossBody: Group
  private readonly bossMats: MeshToonMaterial[]
  private readonly orbs: InstancedMesh
  private readonly waveEl: HTMLElement | null = null
  private readonly bossBar: HTMLElement | null = null
  private bossShown = false
  private lastWave = 0
  /** Milliseconds the horde simulation + view took last frame (QA perf readout). */
  hordeMs = 0

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
    this.horde = new Horde(this.maze)
    this.hordeView = new HordeView()
    this.sewer.group.add(this.hordeView.group)
    this.boss = new Boss(this.maze)
    const body = makeFoeBody('bloom')
    this.bossBody = body.rig
    this.bossMats = body.mats
    this.bossBody.scale.setScalar(BOSS_SCALE)
    this.bossBody.position.set(this.boss.x, 0, this.boss.z)
    this.sewer.group.add(this.bossBody)
    this.orbs = new InstancedMesh(
      new SphereGeometry(BOSS.orbRadius, 12, 8),
      new MeshBasicMaterial({ color: new Color(0xff8fd0).multiplyScalar(1.8), transparent: true, opacity: 0.92, blending: AdditiveBlending, depthWrite: false }),
      96,
    )
    this.orbs.count = 0
    this.orbs.frustumCulled = false
    this.sewer.group.add(this.orbs)
    this.exitPortal.group.visible = false
    if (host.hud && typeof document !== 'undefined') {
      const wave = document.createElement('div')
      wave.id = 'wave'
      host.hud.appendChild(wave)
      this.waveEl = wave
      const bar = document.createElement('div')
      bar.id = 'bossbar'
      bar.className = 'hidden'
      bar.innerHTML = '<span>악몽 꽃</span><b><i></i></b>'
      host.hud.appendChild(bar)
      this.bossBar = bar
    }
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
    this.waveEl?.remove()
    this.bossBar?.remove()
    this.hordeView.dispose()
    this.orbs.dispose()
    this.bossBody.removeFromParent()
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
    const t0 = performance.now()
    this.fight(dt)
    this.hordeMs = performance.now() - t0
    this.shoot(dt)
    this.host.steps(dt, p)
    this.tickTracers(dt)
    recover(this.view, dt)
    const cam = pose(this.view, this.maze, p.x, p.y, p.z, dt)
    camera.position.set(cam.x, cam.y, cam.z)
    // Backed hard into a wall the lens would sit in her hair: let her vanish rather than fill the screen.
    hero.object.visible = Math.hypot(cam.x - p.x, cam.y - p.y - TPS.height, cam.z - p.z) > 0.62
    camera.lookAt(cam.x + cam.fx, cam.y + cam.fy, cam.z + cam.fz)
    const t1 = performance.now()
    this.hordeView.sync(this.horde, camera, this.time)
    this.hordeMs += performance.now() - t1
    this.drawBoss()
    this.paintHud()
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
    let t = reach
    const foe = this.horde.raycast(tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, t)
    const bossT = this.boss.raycast(tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, t)
    const end = tip.clone()
    if (bossT >= 0 && (!foe || bossT < foe.t)) {
      t = bossT
      end.addScaledVector(dir, t)
      if (this.boss.damage(SHOT_DAMAGE)) this.bossDown()
      this.host.vfx.hit(end, 0xff9fd2)
    } else if (foe) {
      t = foe.t
      end.addScaledVector(dir, t)
      const f = foe.foe
      if (this.horde.damage(f, SHOT_DAMAGE, dir.x, dir.z)) {
        this.host.vfx.poof(end, f.elite ? 0xffe08a : 0xffb7e0, f.elite ? 1.6 : 1)
        this.host.sfx('splash', f.elite ? 0.9 : 0.5)
      }
      this.host.vfx.hit(end, 0xffc6e8)
    } else {
      end.addScaledVector(dir, t)
      this.host.vfx.hit(end, 0x9ad7ff)
    }
    this.tracer(tip, end)
    this.host.vfx.burst(tip, 0xd7f4ff, { count: 3, speed: 1.4, up: 0.2, life: 0.1, size: 0.2, gravity: 0, drag: 8 })
    hero.recoil()
    kick(this.view, 0.012, (Math.random() - 0.5) * 0.008)
    this.host.sfx('shoot_water', 0.8)
  }

  /** Waves out of the nest pipes, the crowd, and the boss once she reaches the chamber. */
  private fight(dt: number): void {
    const { hero } = this.host
    const p = hero.object.position
    const inBoss = this.boss.inRoom(p.x, p.z) || this.boss.awake
    const nestDistance = this.maze.nests.map((n) => this.horde.flow.at(n.x, n.y))
    const orders = this.director.update(dt, { nestDistance, alive: this.horde.alive, inBoss })
    for (const o of orders) this.pour(o.nest, o.kind, o.elite)
    if (this.director.wave !== this.lastWave && this.director.active) {
      this.lastWave = this.director.wave
      this.host.banner(`웨이브 ${this.lastWave}`, this.director.active.elites ? `정예 ${this.director.active.elites}마리가 섞여 있어` : '파이프에서 몰려온다')
      this.host.sfx('windup', 0.6)
    }
    const strike = (amount: number, x: number, z: number) => this.host.hurt(amount, new Vector3(x, 0, z))
    this.horde.update(dt, { x: p.x, z: p.z, alive: hero.alive }, strike)
    for (const ev of this.boss.update(dt, p.x, p.z, hero.alive, strike)) {
      if (ev === 'wake') {
        this.host.banner('악몽 꽃', '꿈 하수도의 주인이 깨어났다')
        this.host.sfx('windup', 1)
      } else if (ev === 'ring') this.host.sfx('windup', 0.45)
      else if (ev === 'summon') {
        const near = nestDistance
          .map((d, i) => ({ d, i }))
          .filter((n) => n.d >= 0)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
        for (let i = 0; i < 12; i += 1) {
          const n = near[i % near.length]
          if (n) this.pour(n.i, i % 3 === 0 ? 'bug' : 'slime', i === 0)
        }
      }
    }
  }

  private pour(nest: number, kind: keyof typeof HORDE, elite: boolean): void {
    if (nest === DRAIN) {
      const at = this.drainTile()
      if (!at) return
      const j = () => (Math.random() - 0.5) * 1.6
      const x = at.x + j()
      const z = at.z + j()
      this.horde.spawn(kind, x, z, elite)
      this.host.vfx.burst(new Vector3(x, 0.1, z), 0xb9f0ff, { count: 5, speed: 1.6, up: 2.2, life: 0.45, size: 0.22, gravity: -3, drag: 2 })
      return
    }
    const mouth = this.decor.mouths[nest]
    if (!mouth) return
    const j = (Math.random() - 0.5) * 0.8
    this.horde.spawn(kind, mouth.at.x + mouth.dir.z * j, mouth.at.z + mouth.dir.x * j, elite, mouth.dir.x, mouth.dir.z)
  }

  /** A random open tile 5–8 steps from her along the flow field (round a corner, mostly). */
  private drainTile(): { x: number; z: number } | null {
    const m = this.maze
    const pick: number[] = []
    for (let i = 0; i < m.w * m.h; i += 1) {
      const d = this.horde.flow.dist[i]
      if (d >= 5 && d <= 8 && m.tiles[i] !== Tile.Boss && m.tiles[i] !== Tile.Start) pick.push(i)
    }
    if (!pick.length) return null
    const i = pick[Math.floor(Math.random() * pick.length)]
    return tileCentre(m, i % m.w, Math.floor(i / m.w))
  }

  private bossDown(): void {
    const at = new Vector3(this.boss.x, 1.6, this.boss.z)
    this.host.vfx.poof(at, 0xff9fd2, 3)
    this.host.vfx.ring(at.clone().setY(0.1), 0xffe08a, 0.5, 6, 0.8)
    this.host.sfx('splash', 1)
    this.host.banner('악몽 꽃을 쓰러뜨렸다', '출구 포털이 열렸어')
    this.horde.clear()
    this.exitPortal.group.visible = true
  }

  private drawBoss(): void {
    const b = this.boss
    const body = this.bossBody
    body.visible = b.dying < 0.9
    if (!body.visible) return
    body.position.set(b.x, 0, b.z)
    body.rotation.y = b.yaw
    const pose = foePose('bloom', { t: this.time, phase: 0, moving: b.awake, windup: b.windup, hurt: b.hurt, spawn: 1, dying: b.dying > 0 ? Math.min(1, b.dying / 0.9) : 0 })
    const inner = body.children[0]
    if (inner) {
      inner.position.y = pose.y
      inner.scale.set(pose.sx, pose.sy, pose.sz)
      inner.rotation.set(pose.lean, 0, pose.roll)
    }
    for (const m of this.bossMats) m.emissiveIntensity = (m.userData.lift ?? 0.2) + b.hurt * 0.9 + b.windup * 0.5
    let n = 0
    for (const o of b.orbs) {
      this.dummy.position.set(o.x, o.y, o.z)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(1 + Math.sin(this.time * 12 + n) * 0.12)
      this.dummy.updateMatrix()
      this.orbs.setMatrixAt(n, this.dummy.matrix)
      n += 1
      if (n >= 96) break
    }
    this.orbs.count = n
    this.orbs.instanceMatrix.needsUpdate = true
  }

  private paintHud(): void {
    if (this.waveEl) {
      const w = this.director.active
      const text = this.boss.awake
        ? this.boss.alive
          ? `보스전 · 처치 ${this.horde.kills}`
          : `미궁 정화 · 처치 ${this.horde.kills}`
        : w
          ? `웨이브 ${w.n} · 남은 ${this.horde.alive} · 처치 ${this.horde.kills}`
          : `다음 웨이브 ${Math.ceil(Math.max(0, this.director.rest))}초 · 처치 ${this.horde.kills}`
      if (this.waveEl.textContent !== text) this.waveEl.textContent = text
    }
    if (this.bossBar) {
      const show = this.boss.awake && this.boss.alive
      if (show !== this.bossShown) {
        this.bossShown = show
        this.bossBar.classList.toggle('hidden', !show)
      }
      const fill = this.bossBar.querySelector('i') as HTMLElement | null
      if (fill && show) fill.style.width = `${(this.boss.hp / BOSS.hp) * 100}%`
    }
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
