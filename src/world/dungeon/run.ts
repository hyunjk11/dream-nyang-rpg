import {
  AdditiveBlending,
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
import type { Hero } from '../../actors/hero'
import type { Mochi } from '../../actors/mochi'
import type { Vfx } from '../../core/vfx'
import { axis, consumeDash, consumeRecall, consumeTalk, pad, runningHeld, shoulder } from '../../core/input'
import { TILE, Tile, generateMaze, tileCentre, walkable, worldToTile, type Maze } from './maze'
import { Decor } from './dream'
import { Minimap } from './minimap'
import { Portal } from './portal'
import { Sewer } from './sewer'
import { TPS, type AimTarget, type RayFn, type TpsView } from '../../core/tps'
import { Shooter, type ShotProcs, type ShotWorld } from '../../combat/shooter'
import { blast, type SkillBody, type SkillWorld } from '../../combat/skills'
import { applyProcs, chill, ELEMENTS, procBursts } from '../../combat/elements'
import { RARITY_COLOR } from '../../sim/types'
import { collideCircle, rayHit } from './walls'
import { HORDE, Horde, type HordeFoe } from './horde'
import { HordeView } from './horde-view'
import { DRAIN, Director } from './waves'
import { BOSS, Boss } from './boss'
import { foePose, makeFoeBody } from '../../combat/foes'
import { hitNormal } from '../../combat/gunfeel'
import type { GunCue } from '../../audio/gunsound'
import { rayCapsule } from '../../core/tps'
import { DIFFICULTY } from '../../combat/difficulty'
import { delveDrops, floorIntro, floorLabel, floorPlan, objectiveText, type FloorPlan } from '../../sim/delve'
import type { Drop } from '../../sim/loot'
import { LootView } from './loot-view'
import { Chest } from './chest'

/** What the sewer borrows from the hub game each frame. */
export interface RunHost {
  scene: Scene
  camera: PerspectiveCamera
  hero: Hero
  mochi: Mochi
  vfx: Vfx
  sfx: (cue: 'shoot_water' | 'dash' | 'hit' | 'splash' | 'ui' | 'windup', gain?: number) => void
  steps: (dt: number, at: Vector3) => void
  /** Home: the start-room portal or the town scroll ('recall'), or the exit after the boss ('clear'). */
  leave: (why: 'recall' | 'clear') => void
  /** Floor objective met and she stepped into the stairs portal. */
  stairs?: () => void
  /** A foe went down (elite?) — the delve counts kills. */
  kill?: (elite: boolean) => void
  /** She touched a pickup; returns the heal share (of max hp) and the float text. */
  pickup?: (drop: Drop) => { heal: number; text: string }
  /** Spend a return scroll if she carries one (instant recall). */
  scroll?: () => boolean
  /** The floor boss went down (unlock the next depth now, so a fall after still counts). */
  bossDown?: () => void
  /** Run gold so far (HUD readout). */
  runGold?: () => number
  /** Kills this whole trip (HUD readout; floors add up). */
  runKills?: () => number
  /** A nest pipe was plugged / the floor objective was met (XP). */
  nestDown?: () => void
  objectiveDone?: () => void
  /** Any foe died at (x, z), by droplet, bomb or candy (skills chain off it). */
  foeDied?: (x: number, z: number) => void
  /** Loot luck from gear and the tree. */
  luck?: () => number
  /** Little rising text (gold, hearts). */
  float?: (text: string, at: Vector3, color: string) => void
  /** HUD layer for the minimap (null in tests). */
  hud: HTMLElement | null
  /** Real point lights following the nearest star lamps (fewer on phones). */
  lights: number
  /** A foe or orb landed on her (the host owns the hurt flash, sound and the down screen). */
  hurt: (amount: number, from: Vector3) => void
  /** Big centre banner (wave start, boss). */
  banner: (title: string, sub: string) => void
  /** Synth gun layer (shots, hit ticks, kill pops); absent in tests. */
  gun?: (cue: GunCue, gain?: number, pitch?: number) => void
  /** Freeze the world for a beat on a meaty hit. */
  hitStop?: (seconds: number) => void
  /** The game's one shoulder rig + gun (shared with the town); the run makes its own if absent. */
  shooter?: Shooter
}

/** Sewer fog: soft lavender haze that hides the far tunnels. */
export const SEWER_FOG = { color: 0x55407e, near: 4, far: 25 }

/** Boss body is drawn at this multiple of its island size. */
const BOSS_SCALE = 1.4
/** Town scroll: seconds of standing still-ish (a hit cancels it). */
export const RECALL_TIME = 1.6

/** A pipe she can plug on the nest floor. */
interface NestTarget {
  i: number
  x: number
  z: number
  hp: number
  maxHp: number
  hurt: number
}

/** Which portal she stands in (for the hint and E). */
export type PortalKind = 'home' | 'stairs' | 'exit' | 'chest'

/**
 * One sewer run: the maze, the shoulder camera and her shooting. Owns nothing of the hub; the
 * host lends hero, Mochi, vfx and sound.
 */
export class DungeonRun {
  readonly maze: Maze
  readonly sewer: Sewer
  readonly decor: Decor
  readonly minimap: Minimap
  /** Way home in the start room, and the exit beyond the boss. */
  readonly homePortal: Portal
  readonly exitPortal: Portal
  /** Gold stairs to the next floor (normal floors), hidden until the objective is met. */
  readonly stairsPortal: Portal
  readonly plan: FloorPlan
  /** Objective met (stairs open / boss down). */
  done = false
  /** Waves survived / pipes plugged. */
  progress = 0
  readonly nests: NestTarget[] = []
  readonly loot: LootView
  readonly chest: Chest | null = null
  /** >0 while the town scroll is being read (seconds so far). */
  recallT = 0
  private recallHp = 0
  private recallRing = 0
  private readonly delveEl: HTMLElement | null = null
  private delveText = ''
  private readonly host: RunHost
  /** The shared shoulder camera + water gun (same as the island town). */
  readonly shooter: Shooter
  private readonly ownShooter: boolean
  private readonly world: ShotWorld
  private readonly ray: RayFn
  private readonly aimTargets: AimTarget[] = []
  private readonly dummy = new Object3D()
  private lastHero = new Vector3()
  private time = 0
  readonly horde: Horde
  readonly hordeView: HordeView
  readonly director: Director
  /** The floor boss (boss floor only). */
  readonly boss: Boss | null
  private readonly bossBody: Group
  private readonly bossMats: MeshToonMaterial[]
  private readonly orbs: InstancedMesh
  private readonly waveEl: HTMLElement | null = null
  private readonly bossBar: HTMLElement | null = null
  private bossShown = false
  private lastWave = 0
  /** Milliseconds the horde simulation + view took last frame (QA perf readout). */
  hordeMs = 0
  /** What skills (bombs, Mochi's rush, sparkle bursts) can hurt down here. */
  readonly skillWorld: SkillWorld

  constructor(host: RunHost, plan: FloorPlan | number) {
    this.host = host
    this.plan = typeof plan === 'number' ? { ...floorPlan(1, 1), seed: plan } : plan
    this.maze = generateMaze(this.plan.seed, this.plan.cells, this.plan.cells, this.plan.bossRoom)
    this.director = new Director(this.plan.scale.firstWave)
    // A maze without dead ends has no pipes to plug: that floor becomes "find the exit".
    if (this.plan.objective === 'nests' && !this.maze.nests.length) this.plan = { ...this.plan, objective: 'exit', goal: 1 }
    if (this.plan.objective === 'nests') this.plan = { ...this.plan, goal: Math.min(this.plan.goal, this.maze.nests.length) }
    this.sewer = new Sewer(this.maze)
    host.scene.add(this.sewer.group)
    const s = tileCentre(this.maze, this.maze.start.x, this.maze.start.y)
    this.decor = new Decor(this.maze, host.lights)
    this.sewer.group.add(this.decor.group)
    const home = tileCentre(this.maze, this.maze.startRoom.x, this.maze.startRoom.y)
    this.homePortal = new Portal(new Vector3(home.x, 0, home.z), 0x9ad7ff)
    const b = this.maze.bossRoom
    const bx = b.x + Math.floor(b.w / 2)
    const by = b.y + Math.floor(b.h / 2)
    const isBoss = this.plan.objective === 'boss'
    const exit = tileCentre(this.maze, bx, isBoss ? by + 2 : by)
    this.exitPortal = new Portal(new Vector3(exit.x, 0, exit.z), 0xff9fd2)
    this.stairsPortal = new Portal(new Vector3(exit.x, 0, exit.z), 0xffd36b)
    this.stairsPortal.active = this.plan.objective === 'exit'
    this.sewer.group.add(this.homePortal.group, this.exitPortal.group, this.stairsPortal.group)
    this.minimap = new Minimap(this.maze, host.hud)
    this.minimap.mark(this.maze.startRoom.x, this.maze.startRoom.y, '#7fd0ff')
    if (isBoss) this.minimap.mark(bx, by, '#ff6fb8')
    else if (this.plan.objective === 'exit') this.minimap.mark(bx, by, '#ffd36b')
    for (const n of this.maze.nests) this.minimap.mark(n.x, n.y, this.plan.objective === 'nests' ? '#d24dff' : '#7a3a8a')
    this.ownShooter = !host.shooter
    this.shooter = host.shooter ?? new Shooter(host, this.sewer.group, Math.PI / 4, 0.1)
    this.shooter.reset()
    this.shooter.view.yaw = Math.PI / 4
    this.shooter.view.pitch = 0.1
    const maze = this.maze
    this.ray = (ox, oy, oz, dx, dy, dz, max) => rayHit(maze, ox, oy, oz, dx, dy, dz, max)
    this.world = {
      solid: this.ray,
      targets: () => this.targets(),
      strike: (o, d, max, amount, procs) => this.strike(o, d, max, amount, procs),
      normal: (end, d) => hitNormal(maze, end.x, end.y, end.z, d.x, d.z),
    }
    this.horde = new Horde(this.maze)
    this.horde.scale = { hp: this.plan.scale.hp, damage: this.plan.scale.damage }
    this.horde.onKill = (f) => this.foeDown(f)
    this.skillWorld = { solid: this.ray, bodies: () => this.bodies() }
    this.hordeView = new HordeView()
    this.sewer.group.add(this.hordeView.group)
    this.loot = new LootView((x, z) => collideCircle(maze, x, z, 0.2))
    this.sewer.group.add(this.loot.group)
    this.boss = isBoss ? new Boss(this.maze, this.plan.scale.boss) : null
    const body = makeFoeBody('bloom')
    this.bossBody = body.rig
    this.bossMats = body.mats
    this.bossBody.scale.setScalar(BOSS_SCALE)
    this.bossBody.visible = !!this.boss
    if (this.boss) {
      this.bossBody.position.set(this.boss.x, 0, this.boss.z)
      this.sewer.group.add(this.bossBody)
      const c = tileCentre(this.maze, bx, by)
      this.chest = new Chest(c.x, c.z)
      this.chest.group.visible = false
      this.sewer.group.add(this.chest.group)
    }
    if (this.plan.objective === 'nests') {
      const hp = Math.round(DIFFICULTY.delve.nestHp * this.plan.scale.hp)
      this.maze.nests.forEach((n, i) => {
        const c = tileCentre(this.maze, n.x, n.y)
        this.nests.push({ i, x: c.x - n.dx * (TILE / 2 - 0.55), z: c.z - n.dy * (TILE / 2 - 0.55), hp, maxHp: hp, hurt: 0 })
      })
    }
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
      bar.innerHTML = `<span>${this.plan.depth > 1 ? `깊이 ${this.plan.depth}의 ` : ''}악몽 꽃</span><b><i></i></b>`
      host.hud.appendChild(bar)
      this.bossBar = bar
      const delve = document.createElement('div')
      delve.id = 'delve'
      delve.innerHTML = '<b></b><span></span><em></em>'
      host.hud.appendChild(delve)
      this.delveEl = delve
    }
    host.hero.limit = Infinity
    host.hero.revive()
    host.hero.object.position.set(s.x, 0, s.z)
    host.hero.yaw = this.view.yaw
    host.mochi.place(s.x - 0.9, s.z - 0.6)
    this.lastHero.copy(host.hero.object.position)
    host.camera.fov = TPS.fov
    host.camera.updateProjectionMatrix()
    this.shooter.rig.place(1, s.x, 0, s.z, this.ray)
    shoulder.on = true
    shoulder.look = (dx, dy, touch) => this.look(dx, dy, touch)
    consumeRecall()
    const intro = floorIntro(this.plan)
    host.banner(intro.title, intro.sub)
  }

  /** Tear down; the host restores the island. */
  dispose(): void {
    shoulder.on = false
    shoulder.look = () => {}
    // The shared rig carries on in the town, pointer lock and all; a standalone run lets go.
    if (this.ownShooter && document.pointerLockElement) document.exitPointerLock?.()
    this.host.hero.limit = 13.2
    this.host.hero.object.visible = true
    this.minimap.dispose()
    this.waveEl?.remove()
    this.bossBar?.remove()
    this.delveEl?.remove()
    this.loot.dispose()
    this.chest?.dispose()
    this.stairsPortal.dispose()
    this.hordeView.dispose()
    if (this.ownShooter) this.shooter.dispose()
    else this.shooter.reset()
    this.orbs.dispose()
    this.bossBody.removeFromParent()
    this.decor.dispose()
    this.homePortal.dispose()
    this.exitPortal.dispose()
    this.sewer.dispose()
  }

  update(dt: number): void {
    const { hero } = this.host
    this.time += dt
    const move = axis()
    const wish = this.shooter.rig.wish(move.x, move.y)
    const dash = consumeDash()
    if (dash && hero.alive) {
      this.host.sfx('dash')
      this.host.vfx.dust(hero.object.position, 2.4)
    }
    // She squares up to last frame's crosshair point; the shot itself uses this frame's.
    hero.update(dt, { wishX: wish.x, wishZ: wish.z, aim: this.aim, firing: pad.fire && hero.alive, dash, run: runningHeld(), face: true })
    const p = hero.object.position
    const out = collideCircle(this.maze, p.x, p.z, 0.34)
    p.x = out.x
    p.z = out.z
    this.follow(dt)
    const t0 = performance.now()
    this.fight(dt)
    this.hordeMs = performance.now() - t0
    this.host.steps(dt, p)
    // Camera first, then the crosshair ray from it, then the gun: what you see is what you hit.
    hero.object.visible = this.shooter.rig.place(dt, p.x, p.y, p.z, this.ray)
    this.shooter.rig.aimFrom(this.world, dt)
    this.shooter.update(dt, pad.fire, this.world)
    const camera = this.host.camera
    const t1 = performance.now()
    this.hordeView.sync(this.horde, camera, this.time)
    this.hordeMs += performance.now() - t1
    this.drawBoss()
    this.collect(dt)
    this.objective()
    this.chest?.update(dt, this.time)
    this.recall(dt)
    this.paintHud()
    this.decor.update(this.time, dt, p)
    this.homePortal.update(this.time)
    this.exitPortal.update(this.time)
    this.stairsPortal.update(this.time)
    this.minimap.update(dt, p.x, p.z, this.view.yaw)
    if (consumeTalk()) this.use()
  }

  /** E: open the chest, take the stairs, or go home. */
  use(): void {
    const at = this.portalAt
    if (at === 'chest') this.openChest()
    else if (at === 'stairs') this.host.stairs?.()
    else if (at === 'exit') this.host.leave('clear')
    else if (at === 'home') this.host.leave('recall')
  }

  /** Start (or cancel) reading the town scroll. */
  startRecall(): void {
    if (!this.host.hero.alive) return
    if (this.recallT > 0) {
      this.recallT = 0
      return
    }
    if (this.host.scroll?.()) {
      this.host.vfx.ring(this.host.hero.object.position.clone().setY(0.06), 0x9ad7ff, 0.3, 2.4, 0.5)
      this.host.banner('귀환 두루마리!', '포포의 두루마리가 바로 마을로 데려다줘')
      this.host.leave('recall')
      return
    }
    this.recallT = 1e-3
    this.recallHp = this.host.hero.hp
    this.recallRing = 0
    this.host.sfx('windup', 0.5)
  }

  private recall(dt: number): void {
    if (consumeRecall()) this.startRecall()
    if (this.recallT <= 0) return
    const hero = this.host.hero
    if (!hero.alive || hero.hp < this.recallHp) {
      this.recallT = 0
      this.host.banner('귀환 주문이 끊겼어', '맞으면 다시 읽어야 해')
      return
    }
    this.recallT += dt
    this.recallRing -= dt
    if (this.recallRing <= 0) {
      this.recallRing = 0.4
      this.host.vfx.ring(hero.object.position.clone().setY(0.06), 0x9ad7ff, 0.3, 1.6, 0.5)
    }
    if (this.recallT >= RECALL_TIME) {
      this.recallT = 0
      this.host.leave('recall')
    }
  }

  /** Waves / pipes / boss → objective met: open the way on. */
  private objective(): void {
    if (this.done) return
    const o = this.plan.objective
    if (o === 'survive') this.progress = this.director.cleared
    else if (o === 'nests') this.progress = this.nests.filter((n) => n.hp <= 0).length
    if ((o === 'survive' || o === 'nests') && this.progress >= this.plan.goal) {
      this.done = true
      this.director.quiet = true
      const at = this.stairsSpot()
      this.stairsPortal.group.position.set(at.x, 0, at.z)
      this.stairsPortal.active = true
      const t = worldToTile(this.maze, at.x, at.z)
      this.minimap.mark(t.x, t.y, '#ffd36b')
      this.host.vfx.poof(new Vector3(at.x, 0.8, at.z), 0xffd36b, 1.6)
      this.host.sfx('splash', 0.8)
      this.host.banner(o === 'survive' ? '웨이브를 버텨 냈어!' : '둥지를 모두 막았어!', '가까이에 금빛 계단 포털이 열렸어')
      this.host.objectiveDone?.()
    }
  }

  /** An open tile a few steps from her (not on top of her, not inside the boss room). */
  private stairsSpot(): { x: number; z: number } {
    const m = this.maze
    const p = this.host.hero.object.position
    const here = worldToTile(m, p.x, p.z)
    let best: { x: number; z: number } | null = null
    let bestScore = Infinity
    for (let y = 0; y < m.h; y += 1) {
      for (let x = 0; x < m.w; x += 1) {
        if (!walkable(m, x, y)) continue
        const d = this.horde.flow.at(x, y)
        if (d < 0) continue
        const score = Math.abs(d - 2.5) + (x === here.x && y === here.y ? 9 : 0)
        if (score < bestScore) {
          bestScore = score
          best = tileCentre(m, x, y)
        }
      }
    }
    return best ?? { x: p.x, z: p.z }
  }

  /** Pickups she walked into this frame. */
  private collect(dt: number): void {
    const { hero } = this.host
    const p = hero.object.position
    for (const drop of this.loot.update(dt, p.x, p.z, hero.alive, this.time)) {
      const r = this.host.pickup?.(drop) ?? { heal: drop.kind === 'potion' ? 0.25 : 0, text: '' }
      if (r.heal > 0) hero.hp = Math.min(hero.maxHp, hero.hp + Math.round(hero.maxHp * r.heal))
      this.host.gun?.('tick', 0.5, drop.kind === 'gold' ? 1.6 : 1.2)
      if (r.text) {
        const color = drop.kind === 'gold' ? '#ffd35a' : drop.kind === 'potion' ? '#ff9ec8' : drop.kind === 'item' && drop.item ? RARITY_COLOR[drop.item.rarity] : '#b8f0ff'
        this.host.float?.(r.text, p.clone().setY(1.9), color)
      }
    }
  }

  private openChest(): void {
    const c = this.chest
    if (!c || c.opened) return
    c.open()
    const at = c.group.position
    this.host.vfx.poof(at.clone().setY(1), 0xffd36b, 2.2)
    this.host.sfx('splash', 1)
    this.loot.spill(this.drops(false, true), at.x, at.z + 0.6, 1.4)
    this.exitPortal.active = true
    this.host.banner('보물 상자를 열었어!', '선물을 챙기고 분홍 포털로 마을에 돌아가자')
  }

  get view(): TpsView {
    return this.shooter.rig.view
  }

  get aim(): Vector3 {
    return this.shooter.rig.aim
  }

  /** Last crosshair ray hit distance from the camera (m). */
  get aimDistance(): number {
    return this.shooter.rig.aimDistance
  }

  get gun() {
    return this.shooter.gun
  }

  get gunFx() {
    return this.shooter.gunFx
  }

  /** Mouse/touch look in pixels (pointer lock or the QA harness). */
  look(dx: number, dy: number, touch = false): void {
    this.shooter.rig.look(dx, dy, touch)
  }

  /** What E would do where she stands (null = nothing). */
  get portalAt(): PortalKind | null {
    const p = this.host.hero.object.position
    if (this.chest?.near(p.x, p.z) && this.boss && !this.boss.alive) return 'chest'
    if (this.stairsPortal.contains(p.x, p.z)) return 'stairs'
    if (this.exitPortal.contains(p.x, p.z)) return 'exit'
    if (this.homePortal.contains(p.x, p.z)) return 'home'
    return null
  }

  /** True when E does something here (for the hint). */
  get nearPortal(): boolean {
    return this.portalAt !== null
  }

  /** The hint over her head. */
  get portalHint(): string {
    switch (this.portalAt) {
      case 'chest':
        return '상자 열기'
      case 'stairs':
        return '다음 층으로'
      case 'exit':
        return '마을로 (탐험 완료)'
      case 'home':
        return '마을로 귀환'
      default:
        return ''
    }
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

  /** Horde bodies and the boss as crosshair capsules (index past the horde = the boss). */
  private targets(): readonly AimTarget[] {
    const out = this.aimTargets
    out.length = 0
    for (const f of this.horde.foes) if (this.horde.hittable(f)) out.push(this.horde.capsule(f))
    if (this.boss?.alive && this.boss.awake) out.push(this.boss.capsule())
    for (const n of this.nests) if (n.hp > 0) out.push(this.nestCapsule(n))
    return out
  }

  private nestCapsule(n: NestTarget): AimTarget {
    return { x: n.x, z: n.z, y0: 0.3, y1: 2.1, r: 0.7 }
  }

  /** Nearest live pipe along the ray, or null. */
  private nestRay(o: Vector3, d: Vector3, max: number): { n: NestTarget; t: number } | null {
    let best: { n: NestTarget; t: number } | null = null
    for (const n of this.nests) {
      if (n.hp <= 0) continue
      const t = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, this.nestCapsule(n), max)
      if (t >= 0 && (!best || t < best.t)) best = { n, t }
    }
    return best
  }

  private plugNest(n: NestTarget): void {
    n.hp = 0
    this.decor.sealNest(n.i)
    const nest = this.maze.nests[n.i]
    this.minimap.mark(nest.x, nest.y, '#8d8798')
    const at = new Vector3(n.x, 1.25, n.z)
    this.host.vfx.poof(at, 0xd9a6ff, 1.4)
    this.host.sfx('splash', 0.9)
    this.loot.spill(this.drops(true, false), n.x, n.z, 1)
    this.host.nestDown?.()
    const left = this.nests.filter((x) => x.hp > 0).length
    const plugged = this.nests.length - left
    if (plugged < this.plan.goal) this.host.banner('둥지 파이프를 막았어', `${plugged}/${this.plan.goal} · 남은 둥지를 찾아 보자`)
  }

  private drops(elite: boolean, boss: boolean) {
    return delveDrops(this.plan.depth, elite, boss, Math.random, this.host.luck?.() ?? 2, this.plan.floor)
  }

  /** A horde foe went down (any cause): count it, spill its drops, let skills chain. */
  private foeDown(f: HordeFoe): void {
    this.host.kill?.(f.elite)
    this.loot.spill(this.drops(f.elite, false), f.x, f.z, f.elite ? 1.2 : 0.8)
    this.host.foeDied?.(f.x, f.z)
  }

  /** Foes, the boss and live pipes as skill targets. */
  private bodies(): SkillBody[] {
    const out: SkillBody[] = []
    for (const f of this.horde.foes) {
      if (!this.horde.hittable(f)) continue
      out.push({
        id: `f${f.id}`,
        x: f.x,
        z: f.z,
        r: f.radius,
        tone: f.elite ? 'elite' : 'n',
        hit: (amount, dx, dz, knock, slow) => {
          chill(f, slow)
          return this.horde.damage(f, amount, dx * (1 + knock), dz * (1 + knock))
        },
      })
    }
    const boss = this.boss
    if (boss?.alive && boss.awake) {
      out.push({
        id: 'boss',
        x: boss.x,
        z: boss.z,
        r: boss.capsule().r,
        tone: 'boss',
        hit: (amount) => {
          const kill = boss.damage(amount)
          if (kill) this.bossDown()
          return kill
        },
      })
    }
    for (const n of this.nests) {
      if (n.hp <= 0) continue
      out.push({
        id: `n${n.i}`,
        x: n.x,
        z: n.z,
        r: 0.7,
        tone: 'elite',
        hit: (amount) => {
          n.hp -= amount
          n.hurt = 1
          if (n.hp > 0) return false
          this.plugNest(n)
          return true
        },
      })
    }
    return out
  }

  /** Element procs where a droplet landed. */
  private procs(at: Vector3, amount: number, procs: ShotProcs | undefined, f: HordeFoe | null): void {
    if (!procs) return
    if (f) procBursts(this.host.vfx, at, applyProcs(f, procs, amount))
    if (procs.sparkle) {
      procBursts(this.host.vfx, at, { sparkle: true })
      const x = at.x
      const z = at.z
      queueMicrotask(() => blast(this.bodies(), x, z, ELEMENTS.sparkleRadius, amount * ELEMENTS.sparkleShare, 0, 0, (n, p, tone) => this.shooter.hudFx.number(n, p, tone)))
    }
  }

  private strike(tip: Vector3, dir: Vector3, reach: number, amount: number, procs?: ShotProcs) {
    const foe = this.horde.raycast(tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, reach)
    const bossT = this.boss ? this.boss.raycast(tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, reach) : -1
    if (this.boss && bossT >= 0 && (!foe || bossT < foe.t)) {
      const kill = this.boss.damage(amount)
      if (kill) this.bossDown()
      else this.procs(tip.clone().addScaledVector(dir, bossT), amount, procs ? { sparkle: procs.sparkle } : undefined, null)
      return { t: bossT, kill, tone: 'boss' as const, color: 0xff9fd2 }
    }
    const nest = this.nests.length ? this.nestRay(tip, dir, reach) : null
    if (nest && (!foe || nest.t < foe.t)) {
      nest.n.hp -= amount
      nest.n.hurt = 1
      const kill = nest.n.hp <= 0
      if (kill) this.plugNest(nest.n)
      return { t: nest.t, kill, tone: 'elite' as const, color: 0xd9a6ff }
    }
    if (!foe) return null
    const f = foe.foe
    const kill = this.horde.damage(f, amount, dir.x, dir.z)
    this.procs(tip.clone().addScaledVector(dir, foe.t), amount, procs, kill ? null : f)
    return { t: foe.t, kill, tone: f.elite ? ('elite' as const) : ('n' as const), color: 0xffc6e8, floor: new Vector3(f.x, 0, f.z) }
  }

  /** Waves out of the nest pipes, the crowd, and the boss once she reaches the chamber. */
  private fight(dt: number): void {
    const { hero } = this.host
    const p = hero.object.position
    const boss = this.boss
    const inBoss = !!boss && (boss.inRoom(p.x, p.z) || boss.awake)
    // Plugged pipes are out of the director's pick.
    const nestDistance = this.maze.nests.map((n, i) => (this.nests[i] && this.nests[i].hp <= 0 ? -1 : this.horde.flow.at(n.x, n.y)))
    const orders = this.director.update(dt, { nestDistance, alive: this.horde.alive, inBoss })
    for (const o of orders) this.pour(o.nest, o.kind, o.elite)
    if (this.director.wave !== this.lastWave && this.director.active) {
      this.lastWave = this.director.wave
      const of = this.plan.objective === 'survive' && !this.done ? ` / ${this.plan.goal}` : ''
      this.host.banner(`웨이브 ${this.lastWave}${of}`, this.director.active.elites ? `정예 ${this.director.active.elites}마리가 섞여 있어` : '파이프에서 몰려온다')
      this.host.sfx('windup', 0.6)
    }
    const strike = (amount: number, x: number, z: number) => this.host.hurt(amount, new Vector3(x, 0, z))
    this.horde.update(dt, { x: p.x, z: p.z, alive: hero.alive }, strike)
    if (!boss) return
    for (const ev of boss.update(dt, p.x, p.z, hero.alive, strike)) {
      if (ev === 'wake') {
        this.host.banner(this.plan.depth > 1 ? `깊이 ${this.plan.depth}의 악몽 꽃` : '악몽 꽃', '꿈 하수도의 주인이 깨어났다')
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
    if (!this.boss) return
    const at = new Vector3(this.boss.x, 1.6, this.boss.z)
    this.host.vfx.poof(at, 0xff9fd2, 3)
    this.host.vfx.ring(at.clone().setY(0.1), 0xffe08a, 0.5, 6, 0.8)
    this.host.sfx('splash', 1)
    this.host.banner('악몽 꽃을 쓰러뜨렸다', '달빛 방 가운데 보물 상자가 나타났어')
    this.horde.clear()
    this.done = true
    this.director.quiet = true
    if (this.chest) this.chest.group.visible = true
    this.host.bossDown?.()
  }

  private drawBoss(): void {
    const b = this.boss
    if (!b) return
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
    const boss = this.boss
    if (this.waveEl) {
      const w = this.director.active
      const kills = this.host.runKills?.() ?? this.horde.kills
      const text = boss?.awake
        ? boss.alive
          ? `보스전 · 총 처치 ${kills}`
          : `미궁 정화 · 총 처치 ${kills}`
        : w
          ? `웨이브 ${this.director.wave} · 남은 ${this.horde.alive} · 총 처치 ${kills}`
          : this.director.quiet
            ? `조용해졌어 · 총 처치 ${kills}`
            : `다음 웨이브 ${Math.ceil(Math.max(0, this.director.rest))}초 · 총 처치 ${kills}`
      if (this.waveEl.textContent !== text) this.waveEl.textContent = text
    }
    if (this.delveEl) {
      const goal =
        this.plan.objective === 'boss' && boss && !boss.alive
          ? this.chest?.opened
            ? '분홍 포털로 마을에 돌아가자'
            : '보물 상자를 열자 (E)'
          : objectiveText(this.plan, this.progress, this.done)
      const gold = this.host.runGold ? `이번 탐험 골드 ${this.host.runGold()}` : ''
      const recall = this.recallT > 0 ? `귀환 주문 읽는 중… ${Math.max(0, RECALL_TIME - this.recallT).toFixed(1)}초` : gold
      const text = `${floorLabel(this.plan.depth, this.plan.floor)}|${goal}|${recall}`
      if (text !== this.delveText) {
        this.delveText = text
        const [a, b, c] = this.delveEl.children
        a.textContent = floorLabel(this.plan.depth, this.plan.floor)
        b.textContent = goal
        c.textContent = recall
        this.delveEl.classList.toggle('done', this.done)
      }
    }
    if (this.bossBar && boss) {
      const show = boss.awake && boss.alive
      if (show !== this.bossShown) {
        this.bossShown = show
        this.bossBar.classList.toggle('hidden', !show)
      }
      const fill = this.bossBar.querySelector('i') as HTMLElement | null
      if (fill && show) fill.style.width = `${(boss.hp / boss.maxHp) * 100}%`
    }
  }
}
export { loadHordeArt } from './horde-view'
