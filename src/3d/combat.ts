import {
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three'
import { FOE_SPECS, foePose, makeFoeBody, type FoeBody, type FoeKind } from './foes'
import { toon } from './materials'
import { PLACES, insidePlace, pushOutOfPlaces, type Place } from './places'
import type { Loot } from './loop'
import type { ZoneFoe } from './zones3d'
import type { CueName } from './soundplan'
import type { Vfx } from './vfx'
import { DIFFICULTY } from './difficulty'
import { rayCapsule, type AimTarget } from './tps'

const TOWN = DIFFICULTY.town
const townDamage = (raw: number) => Math.max(1, Math.round(raw * TOWN.damage))

export interface Foe {
  kind: FoeKind
  object: Group
  body: FoeBody
  hp: number
  maxHp: number
  alive: boolean
  flash: number
  attack: number
  knock: Vector3
  respawn: number
  home: Vector3
  phase: number
  /** Seconds left in the attack telegraph, 0 when idle. */
  windup: number
  hurt: number
  /** 0..1 pop-in after (re)spawning. */
  spawn: number
  /** 0..1 death animation progress; 0 while alive. */
  dying: number
  yaw: number
  stride: number
  bar: { group: Group; fill: Mesh }
  /** Quest tags from the zone roster ('wild', 'tutorial', 'boss'). */
  tags: string[]
  /** Elite affix: a bigger, tougher foe that always carries a toy part. */
  elite?: string
  /** Zone foes sleep for good once beaten (until she comes back to the zone). */
  once: boolean
}

interface Shot {
  mesh: Mesh
  vel: Vector3
  life: number
  fromHero: boolean
  damage: number
  radius: number
  color: number
}

interface Drop {
  mesh: Mesh
  vel: Vector3
  life: number
  amount: number
  item: 'gold' | Loot
}

interface Spark {
  life: number
  vel: Vector3
  pos: Vector3
}

const DEATH_TIME = 0.5
const SPAWN_TIME = 0.45
/** Dream-dust colour each foe bursts into. */
const POOF: Record<FoeKind, number> = { slime: 0xffb8e0, bat: 0xc9a8ff, bug: 0xd8a8ff, rabbit: 0xa890ff, bloom: 0xff8fd0 }

/** Where the starter island's foes live. The bloom guards the far side. */
export const FOE_HOMES: readonly (readonly [number, number, FoeKind])[] = [
  [5.2, 1.5, 'slime'],
  [-4.6, 3.1, 'slime'],
  [2.1, -5.4, 'bat'],
  [-5.1, -2.2, 'bug'],
  [4.4, -3.6, 'bug'],
  [-2.6, 6.2, 'rabbit'],
  [6.4, 4.8, 'rabbit'],
  [-1.2, -9.4, 'bloom'],
]

export class Combat {
  readonly foes: Foe[] = []
  shots: Shot[] = []
  /** Particle kit and sound hook, wired by main; combat still runs (silently) without them. */
  vfx: Vfx | null = null
  sound: (cue: CueName, gain?: number) => void = () => {}
  drops: Drop[] = []
  hitStop = 0
  shake = 0
  dust = 0
  /** Solid landmarks standing in the current zone. */
  places: readonly Place[] = PLACES
  /** Fired once when a foe is beaten, and when she picks up a drop. */
  onKill: (foe: Foe) => void = () => {}
  onPickup: (item: 'gold' | Loot, amount: number, at: Vector3) => void = () => {}
  /** Set by main so HP bars face the camera. */
  camera: Camera | null = null
  private sparks: Spark[] = []
  private sparkMesh: InstancedMesh
  private dummy = new Object3D()
  private root: Object3D
  private time = 0

  constructor(root: Object3D) {
    this.root = root
    this.sparkMesh = new InstancedMesh(new SphereGeometry(0.045, 6, 5), toon(0xffd0ea, 0xfff6ea, 0.15), 64)
    this.sparkMesh.count = 0
    this.sparkMesh.frustumCulled = false
    root.add(this.sparkMesh)
    for (const [x, z, kind] of FOE_HOMES) this.spawn(kind, x, z)
  }

  /** Swap the whole cast for a zone's roster (and clear shots and drops in flight). */
  setRoster(roster: readonly ZoneFoe[]): void {
    for (const foe of this.foes) {
      this.vfx?.endTelegraph(foe)
      foe.object.removeFromParent()
    }
    this.foes.length = 0
    for (const shot of this.shots) shot.mesh.removeFromParent()
    this.shots = []
    for (const drop of this.drops) drop.mesh.removeFromParent()
    this.drops = []
    for (const f of roster) this.spawn(f.kind, f.x, f.z, f.tags, f.elite, true)
  }

  /** Any boss still awake in this zone (it seals the altar's portal). */
  get bossAwake(): boolean {
    return this.foes.some((f) => f.kind === 'bloom' && f.alive)
  }

  /** A quest pickup lying in the zone, or popping out of a beaten foe. */
  dropLoot(at: Vector3, item: Loot, burst = true): void {
    const color = item === 'toy_part' ? 0xffb86a : 0xc8a8ff
    const mesh = new Mesh(this.gem(), this.glow(color, 1.1))
    mesh.position.copy(at).setY(0.4)
    this.root.add(mesh)
    const v = burst ? 2.4 : 0
    this.drops.push({ mesh, vel: new Vector3((Math.random() - 0.5) * v, 0, (Math.random() - 0.5) * v), life: 0, amount: 1, item })
  }

  private gemGeo: OctahedronGeometry | null = null
  private gem(): OctahedronGeometry {
    this.gemGeo ??= new OctahedronGeometry(0.17, 0)
    return this.gemGeo
  }

  /** Swap every foe's body for the freshly loaded Meshy model (or keep the fallback). */
  rebuildBodies(): void {
    for (const foe of this.foes) {
      foe.body.rig.removeFromParent()
      foe.body = makeFoeBody(foe.kind)
      foe.object.add(foe.body.rig)
    }
  }

  /** Centre of a foe's body in world space (for aiming and hits). */
  centre(foe: Foe, out = new Vector3()): Vector3 {
    const spec = FOE_SPECS[foe.kind]
    return out.copy(foe.object.position).setY(spec.hover + spec.height * 0.5)
  }

  /** A foe's body as a crosshair capsule (elites are drawn 1.3x). */
  capsule(foe: Foe): AimTarget {
    const spec = FOE_SPECS[foe.kind]
    const k = foe.elite ? 1.3 : 1
    return { x: foe.object.position.x, z: foe.object.position.z, y0: spec.hover - 0.1, y1: spec.hover + spec.height * k + 0.1, r: spec.radius * k }
  }

  /** Foes that can be shot right now (for the shoulder crosshair). */
  shootable(): Foe[] {
    return this.foes.filter((f) => f.alive && f.dying === 0 && f.spawn > 0.3 && f.object.visible)
  }

  /** Nearest shootable foe along a unit ray before `max`. */
  raycast(o: Vector3, d: Vector3, max: number): { foe: Foe; t: number } | null {
    let best: Foe | null = null
    let bt = max
    for (const foe of this.shootable()) {
      const t = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, this.capsule(foe), bt)
      if (t >= 0 && t < bt) {
        bt = t
        best = foe
      }
    }
    return best ? { foe: best, t: bt } : null
  }

  /** A hitscan droplet from the shoulder gun landed: damage, flash, shove, and the kill. */
  strikeFoe(foe: Foe, damage: number, dir: Vector3): boolean {
    const spec = FOE_SPECS[foe.kind]
    foe.hp -= damage
    foe.flash = 0.1
    foe.hurt = 1
    const shove = foe.kind === 'bloom' ? 0.25 : 1.4
    foe.knock.addScaledVector(new Vector3(dir.x, 0, dir.z).normalize(), shove)
    if (foe.knock.length() > 3.2) foe.knock.setLength(3.2)
    if (foe.kind === 'bloom') this.sound('boss_hit')
    if (foe.hp > 0) return false
    foe.alive = false
    foe.dying = 0.001
    foe.windup = 0
    this.vfx?.endTelegraph(foe)
    foe.respawn = spec.respawn
    foe.bar.group.visible = false
    foe.knock.multiplyScalar(1.6)
    this.shake = Math.max(this.shake, foe.kind === 'bloom' ? 0.3 : 0.12)
    this.hitStop = Math.max(this.hitStop, foe.kind === 'bloom' ? 0.12 : 0.05)
    this.drop(foe.object.position, foe.elite ? spec.dust * 2 : spec.dust)
    this.onKill(foe)
    return true
  }

  private spawn(kind: FoeKind, x: number, z: number, tags: string[] = [], elite?: string, once = false): void {
    const spec = FOE_SPECS[kind]
    const hp = Math.round(spec.hp * TOWN.hp * (elite ? 2.2 : 1))
    const object = new Group()
    const body = makeFoeBody(kind)
    object.add(body.rig)
    object.position.set(x, 0, z)
    const bar = hpBar(kind === 'bloom' ? 1.6 : 0.7, elite ? 0xffc65a : 0xff6fae)
    if (elite) object.scale.setScalar(1.3)
    bar.group.position.y = spec.hover + spec.height + 0.25
    object.add(bar.group)
    this.root.add(object)
    this.foes.push({
      kind,
      object,
      body,
      hp,
      maxHp: hp,
      alive: true,
      flash: 0,
      attack: 0.4 + Math.random(),
      knock: new Vector3(),
      respawn: 0,
      home: new Vector3(x, 0, z),
      phase: Math.random(),
      windup: 0,
      hurt: 0,
      spawn: 1,
      dying: 0,
      yaw: 0,
      stride: 1,
      bar,
      tags,
      elite,
      once,
    })
  }

  // Shots and drops reuse one geometry per size and one material per color. Each shot used to
  // allocate a fresh sphere and toon material that were never disposed (GPU buffers piled up).
  private geoms = new Map<number, SphereGeometry>()
  private mats = new Map<string, MeshToonMaterial>()

  private sphere(radius: number, w: number, h: number): SphereGeometry {
    let geo = this.geoms.get(radius)
    if (!geo) {
      geo = new SphereGeometry(radius, w, h)
      this.geoms.set(radius, geo)
    }
    return geo
  }

  private glow(color: number, intensity: number): MeshToonMaterial {
    const key = `${color}:${intensity}`
    let mat = this.mats.get(key)
    if (!mat) {
      mat = toon(color, color, intensity)
      this.mats.set(key, mat)
    }
    return mat
  }

  fire(origin: Vector3, dir: Vector3, damage: number, fromHero: boolean, color: number, speed: number, size = 0): void {
    const radius = size || (fromHero ? 0.09 : 0.11)
    const mesh = new Mesh(this.sphere(radius, 8, 6), this.glow(color, 0.45))
    mesh.position.copy(origin)
    this.root.add(mesh)
    this.shots.push({
      mesh,
      vel: dir.clone().normalize().multiplyScalar(speed),
      life: fromHero ? 1.1 : 2,
      fromHero,
      damage,
      radius: fromHero ? 0.28 : radius * 3,
      color,
    })
  }

  flashBurst(at: Vector3, color: number, count = 8): void {
    if (this.vfx) {
      this.vfx.hit(at, color, count > 8)
      return
    }
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      this.sparks.push({
        life: 0.45,
        pos: at.clone(),
        vel: new Vector3(Math.cos(angle) * 2.4, 1.5 + Math.random(), Math.sin(angle) * 2.4),
      })
    }
    void color
  }

  update(dt: number, heroPos: Vector3, heroRadius: number, onHeroHit: (amount: number, from: Vector3) => void): { text: string; at: Vector3 }[] {
    const notes: { text: string; at: Vector3 }[] = []
    this.time += dt
    for (const foe of this.foes) {
      const spec = FOE_SPECS[foe.kind]
      foe.flash = Math.max(0, foe.flash - dt)
      foe.hurt = Math.max(0, foe.hurt - dt * 5)
      foe.attack = Math.max(0, foe.attack - dt)
      foe.spawn = Math.min(1, foe.spawn + dt / SPAWN_TIME)
      foe.knock.multiplyScalar(Math.max(0, 1 - dt * 4))
      if (foe.dying > 0) {
        foe.dying += dt / DEATH_TIME
        foe.object.position.addScaledVector(foe.knock, dt)
        if (foe.dying >= 1) {
          foe.dying = 0
          foe.object.visible = false
          const boss = foe.kind === 'bloom'
          if (this.vfx) this.vfx.poof(this.centre(foe), POOF[foe.kind], boss ? 2 : 1)
          else this.flashBurst(this.centre(foe), 0xffe08a, 10)
          this.sound(boss ? 'victory' : 'pop')
        } else this.pose(foe, false)
        paintHurt(foe)
        continue
      }
      if (!foe.alive) {
        foe.object.visible = false
        if (foe.once) continue
        foe.respawn -= dt
        if (foe.respawn <= 0) {
          foe.alive = true
          foe.hp = foe.maxHp
          foe.spawn = 0
          foe.windup = 0
          foe.object.visible = true
          foe.object.position.copy(foe.home)
        }
        continue
      }
      const to = heroPos.clone().sub(foe.object.position)
      to.y = 0
      const dist = to.length()
      to.normalize()
      let moving = false
      if (foe.windup <= 0 && foe.spawn >= 1) {
        if (spec.ranged) {
          // Keep a firing distance and drift sideways rather than walking into her.
          const want = foe.kind === 'bloom' ? 5.5 : 4.4
          const side = new Vector3(-to.z, 0, to.x).multiplyScalar(Math.sin(this.time * 0.7 + foe.phase * 6) * 0.6)
          const push = dist > want + 0.6 ? 1 : dist < want - 1.2 ? -0.8 : 0
          const step = to.clone().multiplyScalar(push).add(side)
          // The bloom is rooted near its bed; it only shuffles a few steps out.
          if (foe.kind === 'bloom' && foe.object.position.clone().addScaledVector(step, 0.3).distanceTo(foe.home) > 3.5) step.set(0, 0, 0)
          if (step.lengthSq() > 0.01) {
            foe.object.position.addScaledVector(step, spec.speed * TOWN.speed * dt)
            moving = true
          }
        } else if (dist > 1.15) {
          foe.object.position.addScaledVector(to, spec.speed * TOWN.speed * foe.stride * dt)
          moving = true
        }
      }
      foe.object.position.addScaledVector(foe.knock, dt)
      foe.object.position.y = 0
      // Never stand inside Byeolha: the lunge stops at her body.
      const minGap = heroRadius * 0.6 + spec.radius
      const gap = Math.hypot(heroPos.x - foe.object.position.x, heroPos.z - foe.object.position.z)
      if (gap < minGap && gap > 1e-4) foe.object.position.addScaledVector(to, -(minGap - gap))
      // Turn smoothly toward Byeolha.
      const targetYaw = Math.atan2(to.x, to.z)
      let dy = targetYaw - foe.yaw
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      foe.yaw += dy * Math.min(1, dt * (foe.kind === 'bloom' ? 2.5 : 9))
      foe.object.rotation.set(0, foe.yaw, 0)

      if (foe.windup > 0) {
        // Ground warning that fills as the strike nears, so every attack can be read and dodged.
        const reach = foe.kind === 'bloom' ? 2.6 : spec.ranged ? 0.9 : heroRadius + 1.2
        this.vfx?.telegraph(foe, foe.object.position.x, foe.object.position.z, reach, 1 - foe.windup / (spec.windup * TOWN.windup), foe.kind === 'bloom' ? 0xff6fae : spec.ranged ? 0xb48cff : 0xff8aa8)
        foe.windup -= dt
        if (foe.windup <= 0) {
          foe.windup = 0
          foe.attack = spec.cooldown
          this.vfx?.endTelegraph(foe)
          this.strike(foe, heroPos, heroRadius, dist, to, onHeroHit)
        }
      } else if (foe.attack <= 0 && foe.spawn >= 1) {
        const inReach = spec.ranged ? dist < (foe.kind === 'bloom' ? 8 : 7.5) && dist > 1.4 : dist < heroRadius + 0.85
        if (inReach) {
          foe.windup = spec.windup * TOWN.windup
          if (foe.kind === 'bloom') this.sound('windup')
        }
      }
      this.pose(foe, moving)
      paintHurt(foe)
      this.paintBar(foe)
    }

    this.separate()
    // Houses, the well and the fountain are solid: foes slide round them, never through.
    for (const foe of this.foes) {
      const p = foe.object.position
      const out = pushOutOfPlaces(p.x, p.z, FOE_SPECS[foe.kind].radius, this.places)
      p.x = out.x
      p.z = out.z
    }

    for (const shot of this.shots) {
      shot.life -= dt
      shot.mesh.position.addScaledVector(shot.vel, dt)
      // Shots splash on landmark walls instead of passing through them.
      if (shot.mesh.position.y < 2.4 && insidePlace(shot.mesh.position.x, shot.mesh.position.z, this.places)) {
        this.flashBurst(shot.mesh.position, 0xe8f4ff)
        this.sound('splash')
        shot.life = 0
        continue
      }
      if (!shot.fromHero) {
        const body = heroPos.clone()
        body.y = 0.9
        if (body.distanceTo(shot.mesh.position) < 0.3 + shot.radius) {
          onHeroHit(shot.damage, shot.mesh.position)
          shot.life = 0
        }
        continue
      }
      for (const foe of this.foes) {
        if (!foe.alive) continue
        const spec = FOE_SPECS[foe.kind]
        // Vertical capsule around the body, so low cat bubbles still hit a hovering bat.
        const dx = foe.object.position.x - shot.mesh.position.x
        const dz = foe.object.position.z - shot.mesh.position.z
        const y = shot.mesh.position.y
        if (Math.hypot(dx, dz) > shot.radius + spec.radius) continue
        if (y < spec.hover - 0.45 || y > spec.hover + spec.height + 0.3) continue
        const aim = this.centre(foe)
        foe.hp -= shot.damage
        foe.flash = 0.1
        foe.hurt = 1
        const shove = foe.kind === 'bloom' ? 0.6 : 3.2
        foe.knock.copy(shot.vel).setY(0).normalize().multiplyScalar(shove)
        this.hitStop = Math.max(this.hitStop, 0.045)
        this.shake = Math.max(this.shake, 0.08)
        notes.push({ text: String(Math.round(shot.damage)), at: aim.clone().setY(spec.hover + spec.height + 0.1) })
        this.flashBurst(aim, shot.color, foe.kind === 'bloom' ? 9 : 8)
        if (foe.kind === 'bloom') this.sound('boss_hit')
        shot.life = 0
        if (foe.hp <= 0) {
          foe.alive = false
          foe.dying = 0.001
          foe.windup = 0
          this.vfx?.endTelegraph(foe)
          foe.respawn = spec.respawn
          foe.bar.group.visible = false
          foe.knock.multiplyScalar(1.6)
          this.shake = Math.max(this.shake, foe.kind === 'bloom' ? 0.3 : 0.16)
          this.hitStop = Math.max(this.hitStop, foe.kind === 'bloom' ? 0.12 : 0.07)
          this.drop(foe.object.position, foe.elite ? spec.dust * 2 : spec.dust)
          this.onKill(foe)
        }
        break
      }
    }
    this.shots = this.shots.filter((shot) => {
      if (shot.life > 0) return true
      shot.mesh.removeFromParent()
      return false
    })

    for (const drop of this.drops) {
      drop.life += dt
      drop.vel.multiplyScalar(Math.max(0, 1 - dt * 3))
      const to = heroPos.clone().sub(drop.mesh.position)
      to.y = 0
      if (drop.life > 0.25 && to.length() < 2.8) drop.vel.add(to.normalize().multiplyScalar(14 * dt))
      drop.mesh.position.addScaledVector(drop.vel, dt)
      drop.mesh.position.y = 0.35 + Math.sin(drop.life * 6) * 0.06
      if (drop.item !== 'gold') drop.mesh.rotation.y += dt * 2.5
      if (to.length() < 0.7 && drop.life > 0.2) {
        if (drop.item === 'gold') {
          this.dust += drop.amount
          notes.push({ text: `+${drop.amount}`, at: drop.mesh.position.clone() })
        }
        this.onPickup(drop.item, drop.amount, drop.mesh.position.clone())
        drop.life = -1
      }
    }
    this.drops = this.drops.filter((drop) => {
      if (drop.life >= 0) return true
      drop.mesh.removeFromParent()
      return false
    })

    for (const spark of this.sparks) {
      spark.life -= dt
      spark.vel.y -= dt * 4
      spark.pos.addScaledVector(spark.vel, dt)
    }
    this.sparks = this.sparks.filter((spark) => spark.life > 0).slice(0, 64)
    this.sparkMesh.count = this.sparks.length
    this.sparks.forEach((spark, index) => {
      this.dummy.position.copy(spark.pos)
      this.dummy.scale.setScalar(0.4 + spark.life)
      this.dummy.updateMatrix()
      this.sparkMesh.setMatrixAt(index, this.dummy.matrix)
    })
    this.sparkMesh.instanceMatrix.needsUpdate = true
    return notes
  }

  private strike(foe: Foe, heroPos: Vector3, heroRadius: number, dist: number, to: Vector3, onHeroHit: (amount: number, from: Vector3) => void): void {
    const spec = FOE_SPECS[foe.kind]
    if (spec.ranged) {
      const origin = this.centre(foe)
      const dir = heroPos.clone().setY(0.9).sub(origin)
      if (foe.kind === 'bloom') {
        // Five-petal fan the player can weave through.
        for (let i = -2; i <= 2; i += 1) this.fire(origin, dir.clone().applyAxisAngle(UP, i * 0.24), townDamage(spec.damage), false, 0xff9ad8, 5.2, 0.16)
        this.shake = Math.max(this.shake, 0.06)
      } else this.fire(origin, dir, townDamage(spec.damage), false, 0xd7b6ff, 6.5)
      return
    }
    // Melee lunge: a short hop forward, hits only if she is still close.
    foe.knock.copy(to).multiplyScalar(foe.kind === 'bug' ? 4.5 : 3.6)
    if (dist < heroRadius + 1.2) onHeroHit(townDamage(spec.damage), foe.object.position)
  }

  /** Push overlapping foes apart so a crowd reads as separate bodies. */
  private separate(): void {
    const list = this.foes.filter((f) => f.alive)
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i].object.position
        const b = list[j].object.position
        const need = (FOE_SPECS[list[i].kind].radius + FOE_SPECS[list[j].kind].radius) * 0.9
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        if (d >= need || d < 1e-4) continue
        const push = (need - d) / 2
        a.x -= (dx / d) * push
        a.z -= (dz / d) * push
        b.x += (dx / d) * push
        b.z += (dz / d) * push
      }
    }
  }

  private pose(foe: Foe, moving: boolean): void {
    const pose = foePose(foe.kind, {
      t: this.time,
      phase: foe.phase,
      moving,
      windup: foe.windup > 0 ? 1 - foe.windup / FOE_SPECS[foe.kind].windup : 0,
      hurt: foe.hurt,
      spawn: foe.spawn,
      dying: foe.dying,
    })
    foe.stride = pose.stride
    const rig = foe.body.rig
    rig.position.y = pose.y
    rig.scale.set(Math.max(0.001, pose.sx), Math.max(0.001, pose.sy), Math.max(0.001, pose.sz))
    rig.rotation.set(pose.lean, foe.dying * 7, pose.roll)
  }

  private paintBar(foe: Foe): void {
    const show = foe.hp < foe.maxHp && foe.alive
    foe.bar.group.visible = show
    if (!show) return
    foe.bar.fill.scale.x = Math.max(0.001, foe.hp / foe.maxHp)
    if (this.camera) {
      foe.bar.group.quaternion.copy(this.camera.quaternion)
      foe.bar.group.quaternion.premultiply(foe.object.quaternion.clone().invert())
    }
  }

  private drop(at: Vector3, amount: number): void {
    const count = amount >= 10 ? 5 : 1
    for (let i = 0; i < count; i += 1) {
      const roll = Math.random()
      const color = roll > 0.92 ? 0xffe08a : roll > 0.7 ? 0xd59bff : roll > 0.4 ? 0x7eb6ff : 0xb8f2d0
      const mesh = new Mesh(this.sphere(0.12, 10, 8), this.glow(color, 0.7))
      mesh.position.copy(at)
      mesh.position.y = 0.4
      this.root.add(mesh)
      this.drops.push({
        mesh,
        vel: new Vector3((Math.random() - 0.5) * (count > 1 ? 5 : 2), 2, (Math.random() - 0.5) * (count > 1 ? 5 : 2)),
        life: 0,
        amount: Math.round(amount / count) + (roll > 0.92 ? 5 : 0),
        item: 'gold',
      })
    }
  }
}

const UP = new Vector3(0, 1, 0)

function paintHurt(foe: Foe): void {
  const hot = foe.flash > 0 || (foe.dying > 0 && foe.dying < 0.3)
  const warn = foe.windup > 0 ? Math.min(1, 1 - foe.windup / FOE_SPECS[foe.kind].windup + 0.3) : 0
  for (const mat of foe.body.mats) {
    const base = (mat.userData.lift as number | undefined) ?? 0
    // Meshy bodies carry their texture as emissiveMap, so the flash reads as a bright tint.
    const hasMap = Boolean(mat.emissiveMap)
    mat.emissive.set(hot ? 0xfff6ea : warn > 0 ? 0xff7ab4 : hasMap ? 0xffffff : 0x000000)
    mat.emissiveIntensity = hot ? (hasMap ? 1.4 : 0.55) : warn > 0 ? base + 0.45 * warn : base
  }
}

function hpBar(width: number, color = 0xff6fae): { group: Group; fill: Mesh } {
  const group = new Group()
  const back = new Mesh(new PlaneGeometry(width + 0.06, 0.13), new MeshBasicMaterial({ color: 0x3a2350, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }))
  const fillGeo = new PlaneGeometry(width, 0.085)
  fillGeo.translate(width / 2, 0, 0.001)
  const fill = new Mesh(fillGeo, new MeshBasicMaterial({ color, depthWrite: false, depthTest: false }))
  fill.position.x = -width / 2
  back.renderOrder = 10
  fill.renderOrder = 11
  group.add(back, fill)
  group.visible = false
  return { group, fill }
}
