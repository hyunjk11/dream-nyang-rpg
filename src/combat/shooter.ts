/**
 * The shared shoulder rig and water gun: the island town and the dream sewer drive the same
 * camera, crosshair, aim assist and full-auto gun, so they feel identical. Each world only says
 * what is solid and what can be shot.
 *
 * Aim, every frame, in this order (so the shot goes exactly where the crosshair is drawn):
 * 1. place the camera at her (`place`), 2. cast the crosshair ray from the camera centre through
 * walls AND foes (`aimFrom`), 3. fire from the muzzle toward that point (`Shooter.update`).
 */
import type { ComboId } from '../data/mods'
import { AdditiveBlending, BoxGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D, Vector3, type PerspectiveCamera } from 'three'
import type { Hero } from '../actors/hero'
import type { Vfx } from '../core/vfx'
import {
  ASSIST, AUTO_AIM, TPS, anglesTo, assistPick, createView, kick, look, overlapsHer, perPixel, pose, rayCapsule, recover, wishFrom,
  type AimTarget, type RayFn, type TpsView,
} from '../core/tps'
import { aimSpreadScale, reticlePx, shotCone, splitDamage } from './aim'
import { EMPTY_GUN_RUNTIME, Gun, SWAP_DELAY, coolRuntime, hitStopFor, rollDamage, spreadFan, type GunRuntime } from './gunfeel'
import { firingHand } from '../actors/holds'
import { GUN_PROFILES, engageFor, falloffAt, type GunProfile } from '../data/guns'
import { GunFx } from './gunfx'
import { HudFx } from '../ui/hudfx'
import type { GunCue } from '../audio/gunsound'
import { JUICE, Juice, rollCloud, rollStar } from './juice'
import type { SkillBody } from './skills'
import { DUAL_PACE } from '../sim/hands'

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
  /** Lens shoved back along the view (m) by a heavy shot; settles fast. */
  punch = 0
  /** ⚙ 화면 흔들림: 1 = on, 0 = off (shake and shot shove both scale by it). */
  shakeScale = 1
  /** How fast the last shot's kick / shake / shove settles (1/s). Heavy guns linger, spray snaps back. */
  recoilRate: number = TPS.recover
  shakeRate = 22
  punchRate = 16
  fovRate = 14
  /** Last look came from a finger (touch gets a gentle pull toward foes). */
  touch = false
  /** ⚙ 자동 조준: the wide AUTO_AIM cone instead of the mild assist. */
  autoAim = false
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

  /** 0..1: how much she covers the crosshair (her body fades by this). */
  ghost = 0

  /**
   * Put the camera behind her (locked to her, no follow lag) and apply the per-shot FOV
   * punch and lens shake. Returns true when the lens is far enough from her head to draw her.
   */
  place(dt: number, px: number, py: number, pz: number, ray: RayFn | null): boolean {
    recover(this.view, dt, this.recoilRate)
    const cam = pose(this.view, ray, px, py, pz, dt)
    const c = this.camera
    c.position.set(cam.x, cam.y, cam.z)
    c.lookAt(cam.x + cam.fx, cam.y + cam.fy, cam.z + cam.fz)
    this.fovKick *= Math.exp(-dt * this.fovRate)
    this.shake *= Math.exp(-dt * this.shakeRate)
    this.punch *= Math.exp(-dt * this.punchRate)
    if (this.fovKick < 0.01) this.fovKick = 0
    if (this.shake < 0.0004) this.shake = 0
    if (this.punch < 0.0004) this.punch = 0
    const fov = TPS.fov + this.fovKick
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov
      c.updateProjectionMatrix()
    }
    const shake = this.shake * this.shakeScale
    if (shake > 0.001) {
      c.position.x += (Math.random() - 0.5) * shake
      c.position.y += (Math.random() - 0.5) * shake
    }
    const punch = this.punch * this.shakeScale
    if (punch > 0.0005) c.position.addScaledVector(c.getWorldDirection(this.f), -punch)
    c.updateMatrixWorld()
    // See-through when she stands in front of the crosshair (looking down past her head).
    const want = overlapsHer(cam.x, cam.y, cam.z, cam.fx, cam.fy, cam.fz, px, py, pz)
    this.ghost += (want - this.ghost) * (1 - Math.exp(-dt * 12))
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
    const pick = this.autoAim
      ? assistPick(o.x, o.y, o.z, f.x, f.y, f.z, targets, solid, AUTO_AIM.slack, AUTO_AIM.maxCone)
      : assistPick(o.x, o.y, o.z, f.x, f.y, f.z, targets, solid)
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
  /** Which foe took it: hits on the same target stack into one running total. */
  ref?: object
}

/** Element procs riding on one droplet (rolled by the shooter from gear chances). */
export interface ShotProcs {
  /** 반짝: a little burst of bonus damage around the hit. */
  sparkle?: boolean
  /** 서늘: the foe slows for a moment. */
  ice?: boolean
  /** 끈적: sticky candy that hurts over time. */
  candy?: boolean
  /** Shove scale for this droplet (gun identity: shotgun big, 연사 small). */
  knock?: number
  /** Seconds the foe reels from it (sniper / shotgun; the water pistols do not stagger). */
  stagger?: number
}

export interface ShotWorld extends AimWorld {
  /** Nearest shootable along the shot before `max`: land `amount` on it, or null. */
  strike: (o: Vector3, d: Vector3, max: number, amount: number, procs?: ShotProcs) => ShotHit | null
  /** Surface normal where a droplet splashed on something solid. */
  normal: (end: Vector3, d: Vector3) => { x: number; y: number; z: number }
  /** Everything a ricochet star or a candy cloud can hurt (same adapter the skills use). */
  bodies?: () => SkillBody[]
}

export interface ShooterHost {
  camera: PerspectiveCamera
  hero: Hero
  vfx: Vfx
  hud: HTMLElement | null
  sfx: (cue: 'shoot_water', gain?: number) => void
  gun?: (cue: GunCue, gain?: number, pitch?: number, pan?: number) => void
  hitStop?: (seconds: number) => void
  /** Slow-motion beat for an elite or boss kill (world at `scale` speed for `seconds`). */
  slowmo?: (seconds: number, scale: number) => void
  /** Lifesteal: heal her by this many hp. */
  heal?: (hp: number) => void
  /** Phones and software GL: fewer stars and clouds alive at once. */
  lowPower?: boolean
}

/** What the equipped gun and her stats make of each droplet (from sim computeStats). */
export interface Loadout {
  profile: GunProfile
  /** Damage per droplet before crits. */
  damage: number
  critChance: number
  critMul: number
  pierce: number
  lifesteal: number
  sparkle: number
  ice: number
  candy: number
  fireRate: number
  /** Extra chance per droplet to throw a ricochet star (별도탄 확률). */
  starShot?: number
  /** Extra chance per landed droplet to puff a cotton-candy cloud (솜사탕 구름). */
  cloud?: number
  /** Tracer / splash colour. */
  tint: number
  /** 부품 조합 on this gun (see data/mods COMBOS). */
  combos?: ComboId[]
  /** 쌍권총: the off-hand gun's own droplet (left-hand shots use it). `fireRate` above is then the pair's cadence. */
  off?: Omit<Loadout, 'off'>
  /** False when that weapon set has no gun (an empty swap). Absent = armed. */
  armed?: boolean
}

export function defaultLoadout(): Loadout {
  const p = GUN_PROFILES.water
  return { profile: p, damage: p.damage, critChance: p.critChance, critMul: p.critMul, pierce: 0, lifesteal: 0, sparkle: 0, ice: 0, candy: 0, fireRate: 1, tint: p.look.tracer }
}

/** Last droplet for QA: muzzle, end point and whether it landed on a foe. */
export interface ShotTrace {
  from: Vector3
  to: Vector3
  aim: Vector3
  hit: boolean
  /** Where the end point sat on screen the moment it fired (NDC, 0,0 = crosshair). */
  ndcX: number
  ndcY: number
}

/** The full-auto water gun on the shoulder rig. */
export class Shooter {
  readonly rig: ShoulderRig
  readonly gun = new Gun()
  readonly gunFx: GunFx
  readonly hudFx: HudFx
  /** Ricochet stars and cotton-candy clouds. */
  readonly juice: Juice
  /** Most recent droplet (QA). */
  last: ShotTrace | null = null
  /** Droplets fired / landed on a foe since the last reset (QA readout). */
  fired = 0
  landed = 0
  /** The equipped gun and her stats (setLoadout). */
  loadout: Loadout = defaultLoadout()
  /** Holstered gun's heat and trigger timer (the other weapon set). */
  private stowed: GunRuntime = { ...EMPTY_GUN_RUNTIME }
  /** Bonus crit chance while overdrive runs. */
  overdriveCrit = 0
  /** Which hand's gun fired last (QA: per-hand damage numbers). */
  lastHand: 'main' | 'off' = 'main'
  /** Damage dealt per hand since the last reset (QA). */
  readonly handDamage = { main: 0, off: 0 }
  /** Shots / landed shots per hand since the last reset (QA). */
  readonly handShots = { main: 0, off: 0, mainHit: 0, offHit: 0 }
  private readonly host: ShooterHost
  private readonly tip = new Vector3()
  private readonly dir = new Vector3()
  private readonly end = new Vector3()
  private readonly tracers: InstancedMesh
  private readonly tracerLife: number[] = []
  private readonly tracerW: number[] = []
  private readonly tracerMax: number[] = []
  private readonly tracerFrom: Vector3[] = []
  private readonly tracerTo: Vector3[] = []
  private readonly dummy = new Object3D()

  constructor(host: ShooterHost, parent: Object3D, yaw = 0, pitch = 0.1) {
    this.host = host
    this.rig = new ShoulderRig(host.camera, yaw, pitch)
    this.gunFx = new GunFx(!!host.lowPower)
    this.hudFx = new HudFx(host.hud)
    this.juice = new Juice({
      vfx: host.vfx,
      lowPower: !!host.lowPower,
      number: (n, at, tone) => this.hudFx.number(n, at, tone),
      sound: (cue, gain, pitch) => host.gun?.(cue, gain, pitch),
      heal: (n) => host.heal?.(n),
    })
    this.tracers = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
      new MeshBasicMaterial({ color: new Color(0xbfeaff).multiplyScalar(2.4), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      40,
    )
    this.tracers.count = 0
    this.tracers.frustumCulled = false
    parent.add(this.gunFx.group, this.tracers, this.juice.group)
  }

  get view(): TpsView {
    return this.rig.view
  }

  /**
   * Park the live gun's heat and trigger timer and hand back the holstered one's.
   * Call `adopt` after the new profile is loaded (`setFeel` keeps heat until then).
   */
  exchange(): GunRuntime {
    const incoming = this.stowed
    this.stowed = this.gun.snapshot()
    return incoming
  }

  /** Put a holstered runtime on the live gun and hold the trigger for a short swap. */
  adopt(s: GunRuntime): void {
    this.gun.restore(s)
    this.gun.cooldown = Math.max(this.gun.cooldown, SWAP_DELAY)
    this.hudFx.pulse()
  }

  /** Swap in a gun / stat set: cadence, droplet damage, procs and tracer colour. */
  setLoadout(l: Loadout): void {
    this.loadout = l
    // A pair fires faster; each gun heats at its own pace, so the pair overheats no sooner than one gun.
    // 쌍권총: each barrel heats and blooms on its own, so per pair-shot both build 1/DUAL_PACE as fast (same heat & cone per second as one gun).
    this.gun.setFeel(l.off ? { ...l.profile, heatPerShot: l.profile.heatPerShot / DUAL_PACE, bloomPerShot: l.profile.bloomPerShot / DUAL_PACE } : l.profile, l.fireRate)
    this.juice.combos = new Set(l.combos ?? [])
    ;(this.tracers.material as MeshBasicMaterial).color.set(l.tint).multiplyScalar(2.4)
  }

  /** Trigger, gun heat and every droplet that leaves this frame. Call after `rig.aimFrom`. */
  update(dt: number, trigger: boolean, world: ShotWorld): void {
    const { hero } = this.host
    const wasHot = this.gun.overheated
    coolRuntime(this.stowed, dt)
    const armed = this.loadout.armed !== false
    const shots = this.gun.update(dt, trigger && hero.alive && armed)
    // Two shots on a long frame still alternate hands: number each one, not the gun's final count.
    for (let i = 0; i < shots; i += 1) this.fireOne(world, this.gun.shots - shots + 1 + i)
    if (this.gun.overheated && !wasHot) {
      this.host.gun?.('hiss', 1)
      const t = hero.muzzle.getWorldPosition(this.tip)
      this.host.vfx.burst(t, 0xf2f0ff, { count: 10, speed: 0.8, up: 1.4, life: 0.8, size: 0.4, grow: 0.8, gravity: -1.5, drag: 2, additive: false })
    }
    const cone = shotCone(hero.holdStyle.type, this.gun.bloom)
    const viewH = this.host.hud?.clientHeight || (typeof globalThis.innerHeight === 'number' ? globalThis.innerHeight : 0) || 720
    const scale = aimSpreadScale(hero.moving || hero.dashing, this.rig.view.kickPitch)
    this.hudFx.aim(reticlePx(cone.yaw, this.host.camera.fov, viewH) * scale, reticlePx(cone.pitch, this.host.camera.fov, viewH) * scale, this.gun.heat, this.gun.overheated, hero.holdStyle.type)
    this.hudFx.target(this.rig.onTarget ? 2 : this.rig.near ? 1 : 0)
    this.tickTracers(dt)
    this.juice.update(dt, world)
    this.gunFx.update(dt)
    this.hudFx.update(dt, this.host.camera)
  }

  private fireOne(world: ShotWorld, n = this.gun.shots): void {
    const { hero, camera } = this.host
    const gun = this.gun
    // Dual pistols alternate hands; two-handed guns always fire from the one barrel.
    const hand = firingHand(hero.holdStyle, n)
    // 쌍권총: each hand's droplet is its own gun's (damage, crits, element, parts).
    const l = hand === 'left' && this.loadout.off ? this.loadout.off : this.loadout
    this.lastHand = l === this.loadout ? 'main' : 'off'
    const p = l.profile
    const tip = hero.muzzleFor(n).getWorldPosition(this.tip)
    const aim = new Vector3().copy(this.rig.aim).sub(tip).normalize()
    const sfx = this.host.gun
    let anyHit = false
    let lastEnd = tip
    let firstDir = aim
    let stolen = 0
    this.puffed = false
    // Hold picks the cone: 쌍권총 fans one rolled hit across several rays; the shotgun's
    // pellets are already separate droplets. Other holds put the whole hit on one ray.
    const cone = shotCone(hero.holdStyle.type, gun.bloom)
    const pelletRolls = Math.max(1, p.pellets) > 1
    const critChance = l.critChance + (gun.overdrive > 0 ? this.overdriveCrit : 0)
    const rollProcs = (): ShotProcs => ({
      knock: p.knock,
      stagger: p.stagger,
      sparkle: l.sparkle > 0 && Math.random() < l.sparkle,
      ice: l.ice > 0 && Math.random() < l.ice,
      candy: l.candy > 0 && Math.random() < l.candy,
    })
    const rays: { amount: number; crit: boolean }[] = []
    const sharedProcs = pelletRolls ? null : rollProcs()
    if (pelletRolls) {
      for (let k = 0; k < p.pellets; k += 1) rays.push(rollDamage(Math.random(), l.damage, critChance, l.critMul))
    } else {
      const roll = rollDamage(Math.random(), l.damage, critChance, l.critMul)
      for (const amount of splitDamage(roll.amount, cone.fan)) rays.push({ amount, crit: roll.crit })
    }
    const fan = !pelletRolls && rays.length > 1
    // 쌍권총 is shorter than the same pistol alone; the sniper reaches across the room.
    const band = engageFor(p.kind, hero.holdStyle.dual)
    for (let k = 0; k < rays.length; k += 1) {
      const roll = rays[k]
      // Converge on the crosshair point, jittered inside this hold's bloom cone.
      const d = spreadFan(aim.x, aim.y, aim.z, cone.yaw, cone.pitch, Math.random(), Math.random())
      const dir = this.dir.set(d.x, d.y, d.z)
      if (k === 0) firstDir = dir.clone()
      const reach = Math.min(band.far, world.solid(tip.x, tip.y, tip.z, dir.x, dir.y, dir.z, band.far))
      const procs = sharedProcs ?? rollProcs()
      // Pierce: after a hit, the droplet carries on past that foe.
      let from = tip.clone()
      let travelled = 0
      let end = this.end.copy(tip)
      let hit: ShotHit | null = null
      let first: ShotHit | null = null
      for (let pass = 0; pass <= l.pierce; pass += 1) {
        // Full inside the sweet band, then down to `min` at the gun's far reach.
        const far = falloffAt({ engage: band }, travelled)
        const shot = { amount: Math.max(1, Math.round(roll.amount * far)), crit: roll.crit }
        hit = world.strike(from, dir, reach - travelled, pass ? Math.round(shot.amount * 0.8) : shot.amount, procs)
        if (!hit) break
        if (far < 1) {
          const nearHit = falloffAt({ engage: band }, travelled + hit.t)
          shot.amount = Math.max(1, Math.round(roll.amount * nearHit))
        }
        first ??= hit
        anyHit = true
        end = this.end.copy(from).addScaledVector(dir, hit.t)
        this.landedHit(end, hit, shot, pass > 0, sfx, k === 0 && pass === 0)
        stolen += shot.amount * l.lifesteal
        const step = hit.t + 1.1
        travelled += step
        from = from.addScaledVector(dir, step)
        if (travelled >= reach) break
      }
      if (!first) {
        end = this.end.copy(tip).addScaledVector(dir, reach)
        const norm = world.normal(end, dir)
        this.gunFx.splat(end, norm, l.tint, p.pellets > 1 || fan ? 0.3 : 0.42)
        if (k === 0) this.host.vfx.burst(end.clone().addScaledVector(new Vector3(norm.x, norm.y, norm.z), 0.05), 0xd8f2ff, { count: 4, speed: 3.4, up: 1.2, life: 0.22, size: 0.09, gravity: 7, drag: 2 })
        this.host.vfx.hit(end, l.tint)
      } else if (l.pierce > 0 && hit === null) {
        end = this.end.copy(tip).addScaledVector(dir, Math.min(reach, travelled + 4))
      }
      // A fan's streaks stay thin so the spread reads as several droplets, not one thick beam.
      this.tracer(tip, end, p.tracerW * (fan ? 0.72 : 1), p.tracerLife)
      lastEnd = end.clone()
    }
    if (stolen > 0) this.host.heal?.(stolen)
    // 두두두 사이사이 별 도탄 (도탄 부품 · 별 옵션 · 별똥 점사총): every few droplets a star flies out and bounces around.
    if (rollStar(this.fired + 1, l.starShot ?? 0, Math.random())) this.juice.star(tip, firstDir, l.damage * JUICE.starShare)
    const ndc = lastEnd.clone().project(camera)
    this.last = { from: tip.clone(), to: lastEnd.clone(), aim: this.rig.aim.clone(), hit: anyHit, ndcX: ndc.x, ndcY: ndc.y }
    this.fired += 1
    if (anyHit) this.landed += 1
    this.handShots[this.lastHand] += 1
    if (anyHit) this.handShots[this.lastHand === 'main' ? 'mainHit' : 'offHit'] += 1
    this.gunFx.shot(tip, firstDir, camera, n, 0xc8f0ff, p.casing, p.light, p.pellets > 1 ? 1.35 : fan ? 1.15 : p.voice === 'crack' ? 1.6 : 1)
    hero.recoil(hand)
    // Heavy guns shove the lens back along the view (water pistols barely).
    // 쌍권총: 1/DUAL_PACE kick per shot, so the view climbs as fast as with one gun (twice the shots would otherwise walk the crosshair off).
    const pace = this.loadout.off ? 1 / DUAL_PACE : 1
    this.rig.punch = Math.min(0.22, this.rig.punch + p.punch * pace)
    // 쌍권총: each hand nudges its own way, so the yaw averages back to centre instead of random-walking.
    const side = recoilSide(hero.holdStyle.dual, hand, p.kickSide, pace, Math.random())
    // Each gun kicks its own way: the 연사 gun barely twitches, the sniper throws the view up once.
    kick(this.rig.view, p.kickUp * pace * (1 + Math.min(0.35, gun.bloom * 0.45)), side)
    const feel = fireFeel(p)
    const decay = feelDecay(p.voice)
    this.rig.recoilRate = decay.recoil
    this.rig.shakeRate = decay.shake
    this.rig.punchRate = decay.punch
    this.rig.fovRate = decay.fov
    this.rig.fovKick = Math.min(feel.fovCap, this.rig.fovKick + p.fovKick)
    this.rig.shake = Math.min(feel.shakeCap, this.rig.shake + p.fireShake)
    const pan = hero.holdStyle.dual ? (hand === 'left' ? -0.35 : 0.35) : 0
    if (sfx) for (const [cue, gain, pitch] of gunVoice(p.voice, gun.heat, n, Math.random())) sfx(cue, gain, pitch, pan)
    else this.host.sfx('shoot_water', 0.8)
    // 탕! — the sniper's shot word pops over the muzzle.
    if (p.voice === 'crack') this.hudFx.word('탕!', tip)
  }

  /** One candy cloud per trigger pull at most (shotgun pellets would carpet the room). */
  private puffed = false

  private landedHit(end: Vector3, hit: ShotHit, roll: { amount: number; crit: boolean }, pierced: boolean, sfx: ShooterHost['gun'], lead = true): void {
    const p = this.loadout.profile
    this.host.vfx.hit(end, hit.color, roll.crit || (hit.kill && hit.tone !== 'n'))
    // Hit spark burst: a little crown of sparks on every landed droplet, bigger on crits.
    this.host.vfx.burst(end, roll.crit ? 0xffe27a : 0xffffff, { count: roll.crit ? 10 : 4, speed: roll.crit ? 5 : 3.4, up: 1.4, life: 0.22, size: roll.crit ? 0.16 : 0.09, shape: 1, gravity: 4, drag: 3, additive: true })
    if (!this.puffed && !pierced && rollCloud(roll.crit, this.loadout.cloud ?? 0, Math.random())) {
      this.puffed = true
      this.juice.cloud(end, roll.amount)
    }
    this.hudFx.hit(hit.kill, roll.crit)
    const shown = pierced ? Math.round(roll.amount * 0.8) : roll.amount
    this.handDamage[this.lastHand] += shown
    this.hudFx.number(shown, end, p.bigNumbers && !pierced ? 'snipe' : roll.crit ? 'crit' : hit.tone)
    this.hudFx.tally(shown, end, hit.ref ?? null, hit.kill)
    if (hit.kill && hit.tone !== 'boss') {
      this.host.vfx.poof(end, hit.tone === 'elite' ? 0xffe08a : 0xffb7e0, hit.tone === 'elite' ? 1.6 : 1)
      if (hit.floor) this.gunFx.splat(hit.floor, { x: 0, y: 1, z: 0 }, hit.tone === 'elite' ? 0xffd27a : 0xff9fd2, hit.tone === 'elite' ? 1.5 : 0.9)
      sfx?.('pop', hit.tone === 'elite' ? 1 : 0.75, (Math.random() - 0.5) * 0.2)
      if (hit.tone === 'elite') sfx?.('thunk', 1)
      // Loot fountain: a spray of candy sparks up out of the body.
      this.host.vfx.burst(end, hit.tone === 'elite' ? 0xffd86b : 0xffc2ea, { count: hit.tone === 'elite' ? 18 : 8, speed: 2.4, up: 5.5, life: 0.75, size: 0.13, shape: 1, gravity: 11, drag: 0.6, additive: false })
    } else if (!hit.kill) sfx?.(roll.crit ? 'crit' : 'tick', hit.tone === 'boss' ? 0.8 : 0.7)
    if (hit.kill) {
      // Kill confirm ding (every kill), and a slow-mo beat on the big ones.
      sfx?.('confirm', hit.tone === 'n' ? 0.6 : 1, hit.tone === 'boss' ? -0.3 : 0)
      const slow = killSlowmo(hit.tone)
      if (slow) this.host.slowmo?.(slow.seconds, slow.scale)
    }
    // A light lens shake on the big ones (crits, elite kills); chip hits stay steady for aiming.
    const big = bigHitShake({ crit: roll.crit, kill: hit.kill, elite: hit.tone === 'elite', boss: hit.tone === 'boss' })
    if (big > 0) this.rig.shake = Math.max(this.rig.shake, big)
    if (lead && p.voice === 'crack') {
      sfx?.('thunk', 1.1, -0.4)
      this.host.vfx.burst(end, 0xe2d6ff, { count: 16, speed: 6, up: 1.6, life: 0.32, size: 0.2, shape: 1, gravity: 3, drag: 3, additive: true })
    }
    // Gun identity: a heavy shot freezes the world a beat longer (sniper 탕!, shotgun 펑).
    const stop = Math.max(hitStopFor({ boss: hit.tone === 'boss', elite: hit.tone === 'elite', kill: hit.kill, crit: roll.crit }), lead ? p.stop : 0)
    if (stop > 0) this.host.hitStop?.(stop)
  }

  private tracer(from: Vector3, to: Vector3, w = 1, life = 1): void {
    if (this.tracerLife.length >= 40) {
      this.tracerLife.shift()
      this.tracerFrom.shift()
      this.tracerTo.shift()
      this.tracerW.shift()
      this.tracerMax.shift()
    }
    this.tracerW.push(w)
    this.tracerMax.push(TRACER_LIFE * life)
    this.tracerLife.push(TRACER_LIFE * life)
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
        this.tracerW.splice(i, 1)
        this.tracerMax.splice(i, 1)
      }
    }
    for (let i = 0; i < this.tracerLife.length; i += 1) {
      const a = this.tracerFrom[i]
      const b = this.tracerTo[i]
      const len = a.distanceTo(b)
      this.dummy.position.copy(a)
      this.dummy.lookAt(b)
      // Fat and bright as it leaves, thinning out as it fades.
      const w = (0.025 + 0.05 * Math.max(0, this.tracerLife[i] / this.tracerMax[i])) * this.tracerW[i]
      this.dummy.scale.set(w, w, len)
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
    this.tracerW.length = 0
    this.tracerMax.length = 0
    this.tracerFrom.length = 0
    this.tracerTo.length = 0
    this.tracers.count = 0
    this.juice.reset()
    this.rig.fovKick = 0
    this.rig.shake = 0
    this.rig.punch = 0
  }

  dispose(): void {
    this.gunFx.dispose()
    this.hudFx.dispose()
    this.juice.dispose()
    this.tracers.removeFromParent()
    this.tracers.geometry.dispose()
    ;(this.tracers.material as MeshBasicMaterial).dispose()
    this.gunFx.group.removeFromParent()
  }
}

/** Slow-mo on an elite or boss kill (regular kills only get the hit-stop). Pure. */
export function killSlowmo(tone: ShotHit['tone']): { seconds: number; scale: number } | null {
  if (tone === 'boss') return { seconds: 0.6, scale: 0.25 }
  if (tone === 'elite') return { seconds: 0.32, scale: 0.4 }
  return null
}

/** Caps on the per-shot camera punch: heavy guns may kick harder (comfort stays capped). */
export function fireFeel(p: Pick<GunProfile, 'voice'>): { fovCap: number; shakeCap: number } {
  if (p.voice === 'crack') return { fovCap: 3.4, shakeCap: 0.08 }
  if (p.voice === 'boom') return { fovCap: 2.6, shakeCap: 0.06 }
  if (p.voice === 'burst') return { fovCap: 1.6, shakeCap: 0.025 }
  return { fovCap: 1.2, shakeCap: 0.014 }
}

/**
 * How fast that shot settles (1/s). The sniper's 탕! hangs, then is gone before the next round;
 * the water pistol snaps back so a spray cannot drift the aim.
 */
/** Side kick: dual pistols alternate left/right so the aim does not random-walk; other guns jitter evenly. */
export function recoilSide(dual: boolean, hand: 'left' | 'right', kickSide: number, pace: number, rand: number): number {
  if (dual) return (hand === 'left' ? -1 : 1) * kickSide * 0.85 * pace
  return (rand - 0.5) * 2 * kickSide * pace
}

export function feelDecay(voice: GunProfile['voice']): { recoil: number; shake: number; punch: number; fov: number } {
  if (voice === 'crack') return { recoil: 3.6, shake: 9, punch: 6.5, fov: 6 }
  if (voice === 'boom') return { recoil: 6.2, shake: 14, punch: 9, fov: 8 }
  if (voice === 'burst') return { recoil: 9, shake: 20, punch: 14, fov: 12 }
  return { recoil: 16, shake: 28, punch: 20, fov: 18 }
}

/** The sounds one shot makes: [cue, gain, pitch] — each gun has its own voice. */
export function gunVoice(voice: GunProfile['voice'], heat: number, shots: number, r: number): [GunCue, number, number][] {
  const j = (r - 0.5) * 0.25
  // Layers: transient (snap) → body (shot / boom) → tail (tail / echo / puff).
  // 저격 탕!: a hard crack, a deep boom under it and the echo rolling back off the walls.
  if (voice === 'crack') return [['snap', 1.4, -0.1 + j * 0.2], ['boom', 1.1, -0.15], ['shot', 1.2, -0.6], ['echo', 1, j * 0.2]]
  // 산탄 펑: a fat low boom with a soapy puff tail.
  if (voice === 'boom') return [['snap', 1, -0.35], ['boom', 1, 0.15 + j * 0.3], ['puff', 0.9, j], ['tail', 0.7, -0.4]]
  // 별 점사: bright mid crack, a tail on every third.
  if (voice === 'burst') return [['snap', 0.8, 0.1 + j], ['shot', 1, 0.12 + heat * 0.1], ...(shots % 3 === 0 ? [['tail', 0.8, 0] as [GunCue, number, number]] : [])]
  // 물총 두두두: short, light and high, no heavy body, a tail every few drops.
  return [['snap', 0.4, 0.3 + j], ['shot', 0.7, 0.28 + heat * 0.1 + j * 0.4], ...(shots % 6 === 0 ? [['tail', 0.6, 0.15] as [GunCue, number, number]] : [])]
}

/** Seconds a tracer streak stays on screen. */
export const TRACER_LIFE = 0.075

/** Lens shake for a hit: 0 for chip damage so aim stays steady; capped small (comfort). */
export function bigHitShake(h: { crit: boolean; kill: boolean; elite: boolean; boss: boolean }): number {
  if (h.kill && h.elite) return 0.09
  if (h.crit && h.boss) return 0.05
  if (h.crit) return 0.035
  if (h.kill && !h.boss) return 0.02
  return 0
}
