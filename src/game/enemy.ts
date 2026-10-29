import Phaser from 'phaser'
import { ELITES, ENEMIES, type EnemyDef } from '../data/enemies'
import { ENEMY_TEX } from './assets'
import type { EnemySpawn } from '../data/zones'

export interface BulletSpec {
  x: number
  y: number
  angle: number
  speed: number
  life: number
  damage: number
  kind: string
}

export interface HazardSpec {
  x: number
  y: number
  r: number
  life: number
  damage: number
  color: number
}

export interface CombatCtx {
  px: number
  py: number
  mx: number
  my: number
  taunt: boolean
  spawnBullet: (bullet: BulletSpec) => void
  addHazard: (hazard: HazardSpec) => void
  spawnMinion: (id: string, x: number, y: number) => void
  announce: (text: string) => void
}

let seq = 1

export class EnemyActor {
  readonly uid = seq++
  readonly sprite: Phaser.Physics.Arcade.Sprite
  readonly def: EnemyDef
  readonly tags: string[]
  readonly boss: boolean
  readonly name: string
  readonly knock: number
  readonly lifesteal: number
  readonly explode: boolean
  hp: number
  maxHp: number
  atk: number
  defn: number
  speed: number
  xp: number
  radius: number
  contact: number
  dead = false
  gone = false
  private state: 'idle' | 'windup' | 'act' | 'recover' = 'idle'
  private timer = 0.35
  private cool = 0.4
  private aggro = false
  private pattern = 0
  private patternName = ''
  private phase2 = false
  private lockX = 0
  private lockY = 0
  private baseX: number
  private baseY: number
  kx = 0
  ky = 0
  flash = 0
  contactCd = 0
  private gfx: Phaser.GameObjects.Graphics
  private label: Phaser.GameObjects.Text
  private bar: Phaser.GameObjects.Graphics
  private aura?: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene, spawn: EnemySpawn, level: number) {
    const def = ENEMIES[spawn.id]
    this.def = def
    this.tags = spawn.tags
    this.boss = def.behavior === 'boss'
    const elite = spawn.elite ? ELITES[spawn.elite] : undefined
    const lvl = spawn.fixed ? 1 : level
    const hpScale = (1 + (lvl - 1) * 0.1) * (elite ? 1.45 * (elite.hp ?? 1) : 1)
    this.maxHp = Math.round(def.hp * hpScale)
    this.hp = this.maxHp
    this.atk = Math.round(def.atk * (1 + (lvl - 1) * 0.06) * (elite ? 1.12 : 1))
    this.defn = def.def + (elite?.def ?? 0)
    this.speed = def.speed * (elite?.speed ?? 1)
    this.xp = Math.round(def.xp * (elite ? 2 : 1))
    this.radius = def.radius * (elite ? 1.12 : 1)
    this.contact = Math.round(def.contact * (elite ? 1.15 : 1))
    this.knock = def.knock * (elite?.knock ?? 1)
    this.lifesteal = elite?.lifesteal ?? 0
    this.explode = Boolean(elite?.explode)
    this.name = elite ? `${elite.name} ${def.name}` : def.name
    const tex = ENEMY_TEX[def.id] ?? 'enemy_slime'
    const height = (def.behavior === 'boss' ? 250 : 112) * (elite ? 1.16 : 1)
    this.sprite = scene.physics.add.sprite(spawn.x, spawn.y, tex)
    this.sprite.setOrigin(0.5, 0.98)
    const scale = height / this.sprite.height
    this.sprite.setScale(scale)
    this.baseX = scale
    this.baseY = scale
    const body = this.sprite.body as Phaser.Physics.Arcade.Body
    const bw = 36 / scale
    const bh = 18 / scale
    body.setSize(bw, bh)
    body.setOffset((this.sprite.width - bw) / 2, this.sprite.height * 0.98 - bh)
    body.setCollideWorldBounds(true)
    this.sprite.setDepth(spawn.y)
    if (elite) {
      this.aura = scene.add.image(spawn.x, spawn.y, tex)
      this.aura.setOrigin(0.5, 0.98)
      this.aura.setScale(scale * 1.06)
      this.aura.setTint(elite.color)
      this.aura.setAlpha(0.45)
      this.aura.setBlendMode(Phaser.BlendModes.ADD)
    }
    this.gfx = scene.add.graphics()
    this.bar = scene.add.graphics()
    this.label = scene.add.text(spawn.x, spawn.y, this.name, {
      fontFamily: 'Jua, sans-serif',
      fontSize: this.boss ? '18px' : '13px',
      color: '#fffaf6',
      stroke: '#3a2448',
      strokeThickness: 3,
    })
    this.label.setOrigin(0.5, 1)
    this.label.setVisible(this.boss || Boolean(elite))
  }

  update(dt: number, ctx: CombatCtx): void {
    if (this.dead) return
    this.cool -= dt
    this.timer -= dt
    this.flash = Math.max(0, this.flash - dt)
    if (this.flash <= 0 && this.sprite.isTinted) this.sprite.clearTint()
    this.kx *= Math.max(0, 1 - dt * 5)
    this.ky *= Math.max(0, 1 - dt * 5)
    const tx = ctx.taunt && !this.boss ? ctx.mx : ctx.px
    const ty = ctx.taunt && !this.boss ? ctx.my : ctx.py
    const d = Math.hypot(tx - this.sprite.x, ty - this.sprite.y)
    if (this.boss) this.aggro = true
    else {
      if (!this.aggro && d < 400) this.aggro = true
      if (this.aggro && d > 640) this.aggro = false
    }
    if (this.sprite.x > tx + 8) this.sprite.setFlipX(true)
    else if (this.sprite.x < tx - 8) this.sprite.setFlipX(false)
    if (!this.aggro) this.wander()
    else if (this.def.behavior === 'hop') this.updHop(tx, ty)
    else if (this.def.behavior === 'kiter') this.updKite(tx, ty, d, ctx)
    else if (this.def.behavior === 'dasher') this.updDash(tx, ty, d)
    else if (this.def.behavior === 'swoop') this.updSwoop(tx, ty, d, ctx)
    else this.updBoss(tx, ty, d, ctx)
    this.place(tx, ty)
  }

  hurt(amount: number, fromX: number, fromY: number, power = 1): void {
    this.hp -= amount
    this.flash = 0.07
    this.sprite.setTintFill(0xffffff)
    this.label.setVisible(true)
    const ang = Math.atan2(this.sprite.y - fromY, this.sprite.x - fromX)
    this.kx = Math.cos(ang) * 190 * power * this.knock
    this.ky = Math.sin(ang) * 190 * power * this.knock
    this.aggro = true
  }

  private wander(): void {
    this.state = 'idle'
    if (this.timer <= 0) {
      this.timer = 0.8 + Math.random() * 1.1
      const a = Math.random() * Math.PI * 2
      this.sprite.setVelocity(Math.cos(a) * 26 + this.kx, Math.sin(a) * 26 + this.ky)
    }
  }

  private updHop(tx: number, ty: number): void {
    const s = this.sprite
    if (this.state === 'windup') {
      s.setVelocity(this.kx, this.ky)
      s.setScale(this.baseX * 1.14, this.baseY * 0.84)
      if (this.timer <= 0) {
        const a = Math.atan2(ty - s.y, tx - s.x)
        s.setVelocity(Math.cos(a) * 310 + this.kx, Math.sin(a) * 310 + this.ky)
        s.setScale(this.baseX, this.baseY)
        this.state = 'act'
        this.timer = 0.26
      }
      return
    }
    if (this.state === 'act') {
      if (this.timer <= 0) {
        this.state = 'idle'
        this.cool = 0.38
        s.setVelocity(this.kx, this.ky)
      }
      return
    }
    s.setVelocity(this.kx, this.ky)
    const wob = 1 + Math.sin(performance.now() / 160) * 0.04
    s.setScale(this.baseX * (2 - wob), this.baseY * wob)
    if (this.cool <= 0) {
      this.state = 'windup'
      this.timer = 0.16
    }
  }

  private updKite(tx: number, ty: number, d: number, ctx: CombatCtx): void {
    const s = this.sprite
    if (this.state === 'windup') {
      s.setVelocity(this.kx, this.ky)
      if (this.timer <= 0) {
        const shot = this.def.projectile
        if (shot) {
          const a = Math.atan2(ty - s.y, tx - s.x)
          ctx.spawnBullet({ x: s.x, y: s.y - 16, angle: a, speed: shot.speed, life: shot.life, damage: shot.damage, kind: shot.kind })
        }
        this.state = 'idle'
        this.cool = 1.2
      }
      return
    }
    const a = Math.atan2(ty - s.y, tx - s.x)
    let vx = 0
    let vy = 0
    if (d < 175) {
      vx = -Math.cos(a) * this.speed
      vy = -Math.sin(a) * this.speed
    } else if (d > 320) {
      vx = Math.cos(a) * this.speed
      vy = Math.sin(a) * this.speed
    } else {
      vx = Math.cos(a + Math.PI / 2) * this.speed * 0.75
      vy = Math.sin(a + Math.PI / 2) * this.speed * 0.75
    }
    s.setVelocity(vx + this.kx, vy + this.ky)
    if (this.cool <= 0) {
      this.state = 'windup'
      this.timer = 0.32
    }
  }

  private updDash(tx: number, ty: number, d: number): void {
    const s = this.sprite
    if (this.state === 'windup') {
      s.setVelocity(this.kx, this.ky)
      const wob = Math.sin(performance.now() / 30) * 2
      s.x += wob * 0.15
      if (this.timer <= 0) {
        const a = Math.atan2(this.lockY - s.y, this.lockX - s.x)
        s.setVelocity(Math.cos(a) * 460, Math.sin(a) * 460)
        this.state = 'act'
        this.timer = 0.2
      }
      return
    }
    if (this.state === 'act') {
      if (this.timer <= 0) {
        this.state = 'recover'
        this.timer = 0.45
        s.setVelocity(this.kx, this.ky)
      }
      return
    }
    if (this.state === 'recover') {
      s.setVelocity(this.kx, this.ky)
      if (this.timer <= 0) {
        this.state = 'idle'
        this.cool = 0.65
      }
      return
    }
    const a = Math.atan2(ty - s.y, tx - s.x)
    s.setVelocity(Math.cos(a) * this.speed + this.kx, Math.sin(a) * this.speed + this.ky)
    if (d < 200 && this.cool <= 0) {
      this.state = 'windup'
      this.timer = 0.46
      this.lockX = tx
      this.lockY = ty
    }
  }

  private updSwoop(tx: number, ty: number, d: number, ctx: CombatCtx): void {
    const s = this.sprite
    if (this.state === 'windup') {
      s.setVelocity(this.kx, this.ky)
      if (this.timer <= 0) {
        const a = Math.atan2(this.lockY - s.y, this.lockX - s.x)
        s.setVelocity(Math.cos(a) * 390, Math.sin(a) * 390)
        this.state = 'act'
        this.timer = 0.22
      }
      return
    }
    if (this.state === 'act') {
      if (this.timer <= 0) {
        this.state = 'idle'
        this.cool = 1.35
        s.setVelocity(this.kx, this.ky)
      }
      return
    }
    const a = Math.atan2(ty - s.y, tx - s.x)
    const toward = d > 190 ? 50 : -20
    s.setVelocity(
      Math.cos(a + Math.PI / 2) * this.speed * 0.85 + Math.cos(a) * toward + this.kx,
      Math.sin(a + Math.PI / 2) * this.speed * 0.85 + Math.sin(a) * toward + this.ky,
    )
    if (this.cool <= 0) {
      this.lockX = tx
      this.lockY = ty
      this.state = 'windup'
      this.timer = 0.52
      ctx.addHazard({ x: tx, y: ty, r: 48, life: 0.52, damage: this.contact, color: 0xb9d6ff })
    }
  }

  private updBoss(tx: number, ty: number, d: number, ctx: CombatCtx): void {
    const s = this.sprite
    if (!this.phase2 && this.hp < this.maxHp * 0.5 && this.state !== 'windup') {
      this.phase2 = true
      ctx.announce('꽃이 눈을 떴다!')
      this.beginPattern('summon', tx, ty, ctx)
      return
    }
    if (this.state === 'windup') {
      s.setVelocity(this.kx * 0.3, this.ky * 0.3)
      if (this.timer <= 0) this.releasePattern(ctx)
      return
    }
    if (this.state === 'act') {
      if (this.timer <= 0) {
        this.state = 'recover'
        this.timer = this.phase2 ? 0.5 : 0.72
        if (this.patternName !== 'charge') s.setVelocity(0, 0)
      }
      return
    }
    if (this.state === 'recover') {
      s.setVelocity(this.kx, this.ky)
      if (this.timer <= 0) {
        this.state = 'idle'
        this.timer = this.phase2 ? 0.32 : 0.5
      }
      return
    }
    const a = Math.atan2(ty - s.y, tx - s.x)
    const spd = d > 110 ? this.speed : 0
    s.setVelocity(Math.cos(a) * spd + this.kx, Math.sin(a) * spd + this.ky)
    if (this.timer <= 0) {
      const list = this.phase2 ? ['petal', 'charge', 'roots', 'petal', 'charge'] : ['petal', 'roots', 'petal', 'roots']
      const name = list[this.pattern % list.length]
      this.pattern += 1
      this.beginPattern(name, tx, ty, ctx)
    }
  }

  private beginPattern(name: string, tx: number, ty: number, ctx: CombatCtx): void {
    this.patternName = name
    this.state = 'windup'
    this.lockX = tx
    this.lockY = ty
    const times: Record<string, number> = { petal: 0.64, roots: 0.9, charge: 0.58, summon: 0.7 }
    this.timer = (times[name] ?? 0.6) * (this.phase2 ? 0.82 : 1)
    if (name === 'roots') {
      const spots = [{ x: tx, y: ty }]
      for (let i = 0; i < 4; i += 1) {
        const a = Math.random() * Math.PI * 2
        const dist = 80 + Math.random() * 140
        spots.push({ x: tx + Math.cos(a) * dist, y: ty + Math.sin(a) * dist })
      }
      for (const spot of spots) ctx.addHazard({ x: spot.x, y: spot.y, r: 54, life: this.timer, damage: 16, color: 0xff8ad8 })
    }
  }

  private releasePattern(ctx: CombatCtx): void {
    const s = this.sprite
    if (this.patternName === 'petal') {
      const n = this.phase2 ? 16 : 12
      for (let i = 0; i < n; i += 1) {
        const a = (Math.PI * 2 * i) / n + this.pattern * 0.18
        ctx.spawnBullet({
          x: s.x,
          y: s.y - 20,
          angle: a,
          speed: this.phase2 ? 170 : 145,
          life: 2.4,
          damage: 12,
          kind: 'petal',
        })
      }
      this.state = 'act'
      this.timer = 0.22
      return
    }
    if (this.patternName === 'charge') {
      const a = Math.atan2(this.lockY - s.y, this.lockX - s.x)
      s.setVelocity(Math.cos(a) * 430, Math.sin(a) * 430)
      this.state = 'act'
      this.timer = 0.32
      return
    }
    if (this.patternName === 'summon') {
      ctx.spawnMinion('slime', s.x - 90, s.y + 50)
      ctx.spawnMinion('bug', s.x + 90, s.y + 36)
      this.state = 'recover'
      this.timer = 0.4
      return
    }
    this.state = 'recover'
    this.timer = 0.35
  }

  private place(tx: number, ty: number): void {
    const s = this.sprite
    const y = s.y
    s.setDepth(y)
    this.aura?.setPosition(s.x, y)
    this.aura?.setDepth(y - 2)
    this.aura?.setFlipX(s.flipX)
    this.label.setPosition(s.x, y - s.displayHeight - 8)
    this.label.setDepth(y + 4)
    this.bar.clear()
    this.bar.setDepth(y + 3)
    if (this.hp < this.maxHp || this.boss) {
      const w = this.boss ? 86 : 42
      const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1)
      const by = y - s.displayHeight - 2
      this.bar.fillStyle(0x2a1838, 0.7)
      this.bar.fillRoundedRect(s.x - w / 2, by, w, 6, 3)
      this.bar.fillStyle(this.boss ? 0xff7ad9 : 0xffd0e4, 1)
      this.bar.fillRoundedRect(s.x - w / 2, by, w * ratio, 6, 3)
    }
    this.gfx.clear()
    this.gfx.setDepth(4)
    if (this.state === 'windup' && (this.def.behavior === 'dasher' || this.patternName === 'charge')) {
      this.gfx.lineStyle(3, 0xff8fb8, 0.9)
      this.gfx.beginPath()
      this.gfx.moveTo(s.x, s.y - 10)
      this.gfx.lineTo(this.lockX, this.lockY)
      this.gfx.strokePath()
    }
    if (this.state === 'windup' && this.patternName === 'petal') {
      this.gfx.lineStyle(3, 0xffd0ea, 0.8)
      this.gfx.strokeCircle(s.x, s.y - 10, 36 + (1 - Math.max(this.timer, 0)) * 20)
    }
    if (this.def.behavior === 'kiter' && this.state === 'windup') {
      this.gfx.lineStyle(2, 0xd7b6ff, 0.8)
      this.gfx.lineBetween(s.x, s.y - 12, tx, ty)
    }
  }

  destroy(): void {
    this.gone = true
    this.sprite.destroy()
    this.gfx.destroy()
    this.bar.destroy()
    this.label.destroy()
    this.aura?.destroy()
  }
}
