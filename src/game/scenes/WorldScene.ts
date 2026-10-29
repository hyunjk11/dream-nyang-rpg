import Phaser from 'phaser'
import { HOTBAR, SKILLS } from '../../data/skills'
import { ZONES, type ZoneDef } from '../../data/zones'
import { npcMarker, resolveDialogue } from '../../data/dialogues'
import { burst } from '../fx'
import { EnemyActor, type BulletSpec, type HazardSpec } from '../enemy'
import { audio, buzz } from '../audio'
import { bus } from '../bus'
import { hud } from '../hud'
import { controls } from '../input'
import { RARITY_TINT } from '../assets'
import { BYEOLHA_ORIGIN_Y, BYEOLHA_SCALE, HAND_LIFT, MOCHI_ORIGIN_Y, MOCHI_SCALE, cameraFocus, facingFromAim, gripPoint, gunInFront, gunSpec, muzzlePoint } from '../rig'
import { runtime } from '../runtime'
import { commit, live, settings } from '../session'
import { calcDamage } from '../../sim/formulas'
import { xpToNext } from '../../sim/formulas'
import { addItem } from '../../sim/inventory'
import { itemName, rollDrops, splitGold } from '../../sim/loot'
import { collectMaterial, onDeath } from '../../sim/mutate'
import { onEnter, onKill, tracker } from '../../sim/quests'
import { computeStats, gainGold, gainXp, healAmount } from '../../sim/stats'
import { POTION_CAP, mergeResult, type ItemInstance, type MutationResult } from '../../sim/types'

interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  kind: string
  fromPlayer: boolean
  weaponDamage: number
  mul: number
  forceCrit: boolean
  pierce: number
  aoe: number
  popped: boolean
  damage: number
  hit: Set<number>
  sprite: Phaser.GameObjects.Image
  trail: { x: number; y: number }[]
}

interface Pickup {
  x: number
  y: number
  vx: number
  vy: number
  kind: 'gold' | 'item' | 'material' | 'potion'
  amount: number
  item?: ItemInstance
  matId?: string
  age: number
  sprite: Phaser.GameObjects.Image
  beam?: Phaser.GameObjects.Rectangle
}

interface Hazard {
  x: number
  y: number
  r: number
  life: number
  max: number
  damage: number
  color: number
}

interface Floater {
  t: Phaser.GameObjects.Text
  life: number
  vy: number
}

const PROMPTS: Record<string, string> = {
  luna: '이야기하기',
  popo: '상점 열기',
  kiki: '이야기하기',
  well: '쉬어 가기',
  board: '게시판',
}

export class WorldScene extends Phaser.Scene {
  private zoneId = 'meadow'
  private spawnId = 'default'
  private player!: Phaser.Physics.Arcade.Sprite
  private avatar!: Phaser.GameObjects.Sprite
  private focus!: Phaser.GameObjects.Zone
  private gun!: Phaser.GameObjects.Image
  private mochi!: Phaser.GameObjects.Sprite
  private mochiShadow!: Phaser.GameObjects.Ellipse
  private playerShadow!: Phaser.GameObjects.Ellipse
  private foes!: Phaser.Physics.Arcade.Group
  private enemies: EnemyActor[] = []
  private bullets: Bullet[] = []
  private pickups: Pickup[] = []
  private hazards: Hazard[] = []
  private floats: Floater[] = []
  private blocks: Phaser.GameObjects.Rectangle[] = []
  private aim = 0
  private hover = false
  private aimX = 0
  private aimY = 0
  private moving = false
  private dashT = 0
  private dashX = 1
  private dashY = 0
  private muzzle = 0
  private recoil = 0
  private hurtT = 0
  private avatarAnim = ''
  private mochiAnim = ''
  private mochiMoved = 0
  private hitStop = 0
  private dying = false
  private traveling = false
  private exitArmed = false
  private elapsed = 0
  private playAcc = 0
  private denyAt = 0
  private fullToast = 0
  private afterAcc = 0
  private pounce = { on: false, t: 0, x: 0, y: 0, tx: 0, ty: 0 }
  private flash!: Phaser.GameObjects.Rectangle
  private hazardGfx!: Phaser.GameObjects.Graphics
  private trailGfx!: Phaser.GameObjects.Graphics
  private zone!: ZoneDef

  constructor() {
    super('world')
  }

  init(data: { zoneId?: string; spawn?: string }): void {
    this.zoneId = data.zoneId || live.save?.zoneId || 'meadow'
    this.spawnId = data.spawn || live.save?.spawn || 'default'
  }

  create(): void {
    this.enemies = []
    this.bullets = []
    this.pickups = []
    this.hazards = []
    this.floats = []
    this.blocks = []
    this.dying = false
    this.traveling = false
    this.exitArmed = false
    this.dashT = 0
    this.muzzle = 0
    this.hitStop = 0
    const save = live.save
    if (!save) return
    this.zone = ZONES[this.zoneId] ?? ZONES.meadow
    const zone = this.zone
    this.physics.world.setBounds(0, 0, zone.width, zone.height)
    this.cameras.main.setBounds(0, 0, zone.width, zone.height)
    this.cameras.main.fadeIn(240, 22, 10, 36)
    this.foes = this.physics.add.group()

    const ground = this.add.tileSprite(zone.width / 2, zone.height / 2, zone.width, zone.height, zone.ground)
    ground.setDepth(0)
    ground.setTint(zone.tint)
    for (const path of zone.paths) {
      const tile = this.add.tileSprite(path.x, path.y, path.w, path.h, 'tex_path')
      tile.setDepth(1)
    }
    for (const prop of zone.props) {
      const img = this.add.image(prop.x, prop.y, prop.key)
      img.setOrigin(0.5, 1)
      img.setScale(prop.h / img.height)
      if (prop.flip) img.setFlipX(true)
      img.setDepth(prop.sort ? prop.y : 2)
      if (prop.sort) {
        const shadow = this.add.ellipse(prop.x, prop.y - 2, prop.h * 0.36, 14, 0x241433, 0.2)
        shadow.setDepth((prop.sort ? prop.y : 2) - 1)
      }
      const blocksGate = zone.exits.some(
        (exit) => Math.hypot(prop.x - exit.x, prop.y - exit.y) < 200,
      )
      if (prop.block && !blocksGate) this.addBlock(prop.x, prop.y - prop.block.h / 2, prop.block.w, prop.block.h)
      if (prop.key === 'prop_portal') {
        const dest = zone.exits.find((exit) => Math.hypot(exit.x - prop.x, exit.y - prop.y) < 280)
        const place = dest ? ZONES[dest.to]?.name : '별문'
        const sign = this.add.text(prop.x, prop.y - prop.h - 6, place ?? '별문', {
          fontFamily: 'Jua, sans-serif',
          fontSize: '18px',
          color: '#fffaf6',
          stroke: '#3a2448',
          strokeThickness: 4,
        })
        sign.setOrigin(0.5, 1)
        sign.setDepth(prop.y + 8)
      }
    }
    for (const npc of zone.npcs) this.addNpc(npc.id, npc.key, npc.x, npc.y, npc.h)
    const spawn = zone.spawns[this.spawnId] ?? zone.spawns.default
    this.player = this.physics.add.sprite(spawn.x, spawn.y, 'byeolha')
    this.player.setOrigin(0.5, 0.98)
    this.player.setScale(138 / this.player.height)
    this.player.setVisible(false)
    const pBody = this.player.body as Phaser.Physics.Arcade.Body
    const pScale = this.player.scaleX
    const pbw = 32 / pScale
    const pbh = 16 / pScale
    pBody.setSize(pbw, pbh)
    pBody.setOffset((this.player.width - pbw) / 2, this.player.height * 0.98 - pbh)
    pBody.setCollideWorldBounds(true)
    this.avatar = this.add.sprite(spawn.x, spawn.y, 'byeolha_idle', 0)
    this.avatar.setOrigin(0.5, BYEOLHA_ORIGIN_Y)
    this.avatar.setScale(BYEOLHA_SCALE)
    this.avatar.play('byeolha_idle')
    this.avatarAnim = 'byeolha_idle'
    this.playerShadow = this.add.ellipse(spawn.x, spawn.y, 46, 16, 0x241433, 0.25)
    this.gun = this.add.image(spawn.x, spawn.y, this.gunKey())
    const spec = gunSpec(this.gunKey())
    this.gun.setOrigin(spec.originX, spec.originY)
    this.gun.setScale(spec.scale)
    this.mochi = this.add.sprite(spawn.x + 48, spawn.y, 'mochi_idle', 0)
    this.mochi.setOrigin(0.5, MOCHI_ORIGIN_Y)
    this.mochi.setScale(MOCHI_SCALE)
    this.mochi.play('mochi_idle')
    this.mochiAnim = 'mochi_idle'
    this.mochiShadow = this.add.ellipse(spawn.x, spawn.y, 36, 12, 0x241433, 0.22)
    const look = cameraFocus(spawn.x, spawn.y, 0, this.avatar.displayHeight)
    this.focus = this.add.zone(look.x, look.y, 4, 4)

    for (const spawnDef of zone.enemies) this.addEnemy(spawnDef.id, spawnDef.x, spawnDef.y, spawnDef.tags, spawnDef.elite, spawnDef.fixed)
    for (const drop of zone.pickups) {
      if (drop.kind === 'gold') this.dropPickup(drop.x, drop.y, { kind: 'gold', amount: drop.amount })
      else if (drop.kind === 'potion') this.dropPickup(drop.x, drop.y, { kind: 'potion', amount: drop.amount })
      else this.dropPickup(drop.x, drop.y, { kind: 'material', amount: drop.amount, matId: drop.id })
    }

    this.physics.add.collider(this.player, this.blocks)
    this.physics.add.collider(this.foes, this.blocks)
    this.physics.add.collider(this.foes, this.foes)
    this.cameras.main.startFollow(this.focus, false, 0.14, 0.14)
    this.cameras.main.setFollowOffset(0, 0)
    this.cameras.main.setRoundPixels(false)
    this.hazardGfx = this.add.graphics().setDepth(3)
    this.trailGfx = this.add.graphics().setDepth(40)
    this.flash = this.add.rectangle(640, 360, 1280, 720, 0xffffff, 1).setScrollFactor(0).setDepth(40000).setAlpha(0)
    const vignette = this.add.image(640, 360, 'vignette').setScrollFactor(0).setDepth(12000).setAlpha(0.55)
    vignette.setDisplaySize(1280, 720)

    this.input.addPointer(2)
    this.input.mouse?.disableContextMenu()
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.hover = true
      this.aimX = pointer.worldX
      this.aimY = pointer.worldY
    })
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.hover = true
      this.aimX = pointer.worldX
      this.aimY = pointer.worldY
      if (pointer.rightButtonDown()) controls.queueDash()
    })

    audio.playBgm(zone.bgm)
    const entered = onEnter(save, zone.id)
    if (zone.id === 'forest' && !save.flags.forestHint) {
      save.flags.forestHint = true
      entered.toasts.push('모찌: 공기가 달콤한데… 조금 짜릿해.')
    }
    commit(entered)
    live.paused = false
    if (!save.flags.metMochi) {
      this.time.delayedCall(600, () => {
        if (live.save && !live.save.flags.metMochi) bus.emit('dialogue', 'mochi_meet')
      })
    }
    if (zone.id === 'altar' && !save.flags.bossIntro) {
      this.time.delayedCall(700, () => bus.emit('dialogue', 'boss_intro'))
    }
  }

  update(_time: number, delta: number): void {
    const save = live.save
    if (!save || !this.player?.body) return
    const dt = Math.min(0.033, delta / 1000)
    if (this.hitStop > 0) this.hitStop -= dt
    const held = live.paused || this.hitStop > 0
    this.physics.world.isPaused = held
    if (held) {
      this.player.setVelocity(0, 0)
      for (const enemy of this.enemies) if (!enemy.dead) enemy.sprite.setVelocity(0, 0)
      if (this.dying) this.avatar.anims.resume()
      else this.avatar.anims.pause()
      this.syncHud(save)
      return
    }
    if (this.avatar.anims.isPaused) this.avatar.anims.resume()
    this.elapsed += dt
    this.playAcc += dt
    if (this.playAcc >= 1) {
      save.playSeconds += Math.floor(this.playAcc)
      this.playAcc %= 1
    }
    if (this.elapsed > 0 && Math.floor(this.elapsed) % 30 === 0 && this.playAcc < dt) commit()
    runtime.dashCd = Math.max(0, runtime.dashCd - dt)
    runtime.fireCd = Math.max(0, runtime.fireCd - dt)
    runtime.invuln = Math.max(0, runtime.invuln - dt)
    this.hurtT = Math.max(0, this.hurtT - dt)
    runtime.shieldT = Math.max(0, runtime.shieldT - dt)
    runtime.taunt = Math.max(0, runtime.taunt - dt)
    if (runtime.shieldT <= 0) runtime.shield = 0
    for (const id of Object.keys(runtime.cds)) runtime.cds[id] = Math.max(0, runtime.cds[id] - dt)

    this.steer(dt, save)
    this.tickSkills(save)
    this.tickFire(save)
    const ctx = this.combatCtx()
    for (const enemy of this.enemies) enemy.update(dt, ctx)
    this.touchDamage(save)
    this.tickBullets(dt, save)
    this.tickHazards(dt, save)
    this.tickPickups(dt, save)
    this.tickFloats(dt)
    this.tickPounce(dt, save)
    this.followMochi(dt)
    this.pose()
    this.exits()
    this.prompt()
    this.syncHud(save)
    this.enemies = this.enemies.filter((enemy) => !enemy.gone)
    if (save.hp <= 0 && !this.dying) {
      this.dying = true
      this.pose()
      live.paused = true
      if (settings.current.shake) this.cameras.main.shake(240, 0.012)
      this.time.delayedCall(820, () => {
        if (this.dying) bus.emit('death', undefined)
      })
    }
  }

  private steer(dt: number, save: NonNullable<typeof live.save>): void {
    const stats = computeStats(save)
    const axis = controls.axis()
    if (controls.consumeDash() && runtime.dashCd <= 0 && this.dashT <= 0) {
      const len = Math.hypot(axis.x, axis.y)
      this.dashX = len > 0.1 ? axis.x : Math.cos(this.aim)
      this.dashY = len > 0.1 ? axis.y : Math.sin(this.aim)
      this.dashT = 0.18
      runtime.dashCd = 0.82
      runtime.invuln = Math.max(runtime.invuln, 0.26)
      audio.sfx('dash', 0.94 + Math.random() * 0.1)
      buzz(14)
    }
    if (this.dashT > 0) {
      this.dashT -= dt
      this.player.setVelocity(this.dashX * 640, this.dashY * 640)
      this.moving = true
      this.afterAcc += dt
      if (this.afterAcc > 0.04) {
        this.afterAcc = 0
        const ghost = this.add.image(this.avatar.x, this.avatar.y, this.avatar.texture.key, this.avatar.frame.name)
        ghost.setOrigin(this.avatar.originX, this.avatar.originY)
        ghost.setScale(this.avatar.scaleX, Math.abs(this.avatar.scaleY))
        ghost.setFlipX(this.avatar.flipX)
        ghost.setAlpha(0.4)
        ghost.setTint(0xd8c6ff)
        ghost.setDepth(this.player.y - 1)
        this.tweens.add({ targets: ghost, alpha: 0, duration: 180, onComplete: () => ghost.destroy() })
      }
    } else {
      this.player.setVelocity(axis.x * stats.moveSpeed, axis.y * stats.moveSpeed)
      this.moving = Math.hypot(axis.x, axis.y) > 0.1
    }
    const pointer = this.input.activePointer
    const canvasAim = pointer.isDown && this.hover
    if ((this.hover && !controls.attackHeld) || canvasAim) {
      this.aim = Math.atan2(this.aimY - this.player.y, this.aimX - this.player.x)
    } else if (controls.attackHeld) {
      const target = this.nearest(480)
      if (target) this.aim = Math.atan2(target.sprite.y - this.player.y, target.sprite.x - this.player.x)
      else if (this.moving) this.aim = Math.atan2(axis.y, axis.x)
    }
  }

  private tickFire(save: NonNullable<typeof live.save>): void {
    const stats = computeStats(save)
    const pointer = this.input.activePointer
    const firing = controls.attackHeld || (pointer.isDown && pointer.leftButtonDown() && this.hover)
    if (!firing || runtime.fireCd > 0) return
    runtime.fireCd = stats.weaponCooldown / stats.attackSpeed
    const spread = (Math.random() - 0.5) * stats.weaponSpread * 2
    const force = runtime.focus > 0
    if (force) runtime.focus -= 1
    this.launch(this.aim + spread, stats.weaponDamage, 1, force, stats.weaponPierce, stats.weaponAoe, stats.weaponKind, stats.weaponSpeed, stats.weaponLife, true)
    audio.sfx(`shoot_${stats.weaponKind}`, 0.94 + Math.random() * 0.12)
    this.muzzle = 0.07
    this.recoil = 10
  }

  private tickSkills(save: NonNullable<typeof live.save>): void {
    if (controls.consumePotion()) this.drink()
    let skill = controls.consumeSkill()
    while (skill) {
      this.cast(skill, save)
      skill = controls.consumeSkill()
    }
    const menu = controls.consumeMenu()
    if (menu === 'inventory' || menu === 'skills' || menu === 'quests' || menu === 'pause') {
      window.dispatchEvent(new CustomEvent('dream-menu', { detail: menu }))
    }
    if (controls.consumeInteract()) this.interact()
  }

  private cast(id: string, save: NonNullable<typeof live.save>): void {
    const def = SKILLS[id]
    if (!def || def.kind !== 'active') return
    if (!save.learnedSkills.includes(id)) {
      this.deny('아직 배우지 않은 기술이야.')
      return
    }
    if ((runtime.cds[id] ?? 0) > 0) {
      this.deny('아직 모으는 중이야.')
      return
    }
    const stats = computeStats(save)
    runtime.cds[id] = def.cooldown
    if (id === 'spray') {
      for (let i = 0; i < 8; i += 1) {
        const a = this.aim + (i - 3.5) * 0.09
        this.launch(a, stats.weaponDamage, 0.5, false, 1, 0, 'water', stats.weaponSpeed * 0.95, 0.36, true)
      }
      audio.sfx('shoot_water', 0.8)
      this.muzzle = 0.1
    } else if (id === 'shield') {
      runtime.shield = stats.maxHp * 0.38
      runtime.shieldT = 4.6
      audio.sfx('heal', 1.25)
      burst(this, this.player.x, this.player.y, 0xbff5ff, 16)
      this.floatText(this.player.x, this.player.y - 60, '방벽', '#c8f4ff', 20)
    } else if (id === 'focus') {
      runtime.focus = 6
      audio.sfx('crit', 0.9)
      this.floatText(this.player.x, this.player.y - 60, '집중', '#ffe08a', 20)
    } else if (id === 'taunt') {
      runtime.taunt = 4.6
      audio.sfx('boss', 1.5)
      burst(this, this.mochi.x, this.mochi.y, 0xffd2ef, 14)
      this.floatText(this.mochi.x, this.mochi.y - 40, '야옹!', '#ffd0ea', 20)
    } else if (id === 'heal') {
      const healed = healAmount(save, Math.round(stats.maxHp * 0.3 + 8))
      audio.sfx('heal')
      burst(this, this.player.x, this.player.y, 0xb8ffcf, 18)
      this.floatText(this.player.x, this.player.y - 50, `+${healed}`, '#9dffc4', 22)
      commit()
    } else if (id === 'pounce') {
      const target = this.nearest(360)
      this.pounce.on = true
      this.pounce.t = 0
      this.pounce.x = this.mochi.x
      this.pounce.y = this.mochi.y
      this.pounce.tx = target ? target.sprite.x : this.player.x + Math.cos(this.aim) * 150
      this.pounce.ty = target ? target.sprite.y : this.player.y + Math.sin(this.aim) * 110
      audio.sfx('dash', 1.15)
    }
  }

  private drink(): void {
    const save = live.save
    if (!save) return
    if (save.potions <= 0) {
      this.deny('포션이 없어.')
      return
    }
    const stats = computeStats(save)
    if (save.hp >= stats.maxHp) {
      this.deny('체력이 이미 가득이야.')
      return
    }
    save.potions -= 1
    const healed = healAmount(save, Math.max(30, Math.round(stats.maxHp * 0.42)))
    audio.sfx('potion')
    this.floatText(this.player.x, this.player.y - 48, `+${healed}`, '#b8ffcf', 22)
    commit()
  }

  private deny(text: string): void {
    if (this.elapsed < this.denyAt) return
    this.denyAt = this.elapsed + 0.45
    audio.sfx('deny')
    bus.emit('toast', text)
  }

  private launch(
    angle: number,
    weaponDamage: number,
    mul: number,
    forceCrit: boolean,
    pierce: number,
    aoe: number,
    kind: string,
    speed: number,
    life: number,
    fromPlayer: boolean,
    damage = 0,
  ): void {
    const key = kind === 'dart' ? 'dart' : kind === 'bubble' ? 'bubble' : kind === 'spore' ? 'spore' : kind === 'petal' ? 'petal' : 'drop'
    const from = fromPlayer ? muzzlePoint(this.player.x, this.player.y, this.aim, this.gunKey(), this.recoil) : { x: this.player.x, y: this.player.y }
    const sprite = this.add.image(from.x, from.y, key)
    const size = kind === 'dart' ? 28 : kind === 'bubble' ? 26 : kind === 'petal' ? 18 : 14
    sprite.setDisplaySize(kind === 'dart' ? 36 : size, size)
    sprite.setDepth(fromPlayer && Math.sin(angle) >= -0.35 ? this.player.y + 5 : from.y)
    const x = from.x
    const y = from.y
    sprite.setPosition(x, y)
    this.bullets.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      kind,
      fromPlayer,
      weaponDamage,
      mul,
      forceCrit,
      pierce,
      aoe,
      popped: false,
      damage,
      hit: new Set(),
      sprite,
      trail: [],
    })
  }

  private enemyBullet(spec: BulletSpec): void {
    const key = spec.kind === 'spore' ? 'spore' : 'petal'
    const sprite = this.add.image(spec.x, spec.y, key)
    sprite.setDisplaySize(spec.kind === 'petal' ? 20 : 18, spec.kind === 'petal' ? 16 : 18)
    this.bullets.push({
      x: spec.x,
      y: spec.y,
      vx: Math.cos(spec.angle) * spec.speed,
      vy: Math.sin(spec.angle) * spec.speed,
      life: spec.life,
      kind: spec.kind,
      fromPlayer: false,
      weaponDamage: spec.damage,
      mul: 1,
      forceCrit: false,
      pierce: 1,
      aoe: 0,
      popped: false,
      damage: spec.damage,
      hit: new Set(),
      sprite,
      trail: [],
    })
  }

  private tickBullets(dt: number, save: NonNullable<typeof live.save>): void {
    const stats = computeStats(save)
    this.trailGfx.clear()
    this.trailGfx.setDepth(this.player.y + 4)
    for (const bullet of this.bullets) {
      bullet.life -= dt
      bullet.x += bullet.vx * dt
      bullet.y += bullet.vy * dt
      if (bullet.kind === 'bubble') {
        bullet.x += Math.sin(this.elapsed * 7 + bullet.y) * 18 * dt
      }
      bullet.sprite.setPosition(bullet.x, bullet.y)
      bullet.sprite.setRotation(Math.atan2(bullet.vy, bullet.vx))
      bullet.sprite.setDepth(bullet.fromPlayer && bullet.vy >= -20 ? Math.max(bullet.y, this.player.y + 5) : bullet.y)
      if (bullet.kind === 'bubble') {
        const pulse = 1 + Math.sin(this.elapsed * 10) * 0.08
        bullet.sprite.setScale((26 / 64) * pulse)
      }
      bullet.trail.push({ x: bullet.x, y: bullet.y })
      if (bullet.trail.length > 7) bullet.trail.shift()
      const color = bullet.kind === 'petal' ? 0xffb7d5 : bullet.kind === 'spore' ? 0xd7b6ff : bullet.kind === 'bubble' ? 0xc8ffe8 : 0xb7e6ff
      bullet.trail.forEach((point, index) => {
        this.trailGfx.fillStyle(color, 0.18 + index * 0.06)
        this.trailGfx.fillCircle(point.x, point.y, 2 + index * 0.4)
      })
      if (bullet.fromPlayer) {
        for (const enemy of this.enemies) {
          if (enemy.dead || bullet.hit.has(enemy.uid)) continue
          const aimY = enemy.sprite.y - enemy.sprite.displayHeight * 0.42
          const reach = Math.max(36, enemy.sprite.displayHeight * 0.38)
          if (Math.hypot(enemy.sprite.x - bullet.x, aimY - bullet.y) > reach) continue
          bullet.hit.add(enemy.uid)
          this.damageEnemy(enemy, bullet, save, 1)
          bullet.pierce -= 1
          if (bullet.aoe > 0) this.pop(bullet, save)
          if (bullet.pierce <= 0) bullet.life = 0
        }
      } else if (runtime.invuln <= 0 && Math.hypot(this.player.x - bullet.x, this.player.y - 20 - bullet.y) < 24) {
        const hit = calcDamage({
          atk: 0,
          weaponDamage: bullet.damage,
          multiplier: 1,
          targetDef: stats.def,
          critChance: 0,
          critMultiplier: 1,
        })
        this.playerHurt(hit.amount)
        bullet.life = 0
      }
      if (bullet.life <= 0 && bullet.aoe > 0) this.pop(bullet, save)
    }
    this.bullets = this.bullets.filter((bullet) => {
      if (bullet.life > 0) return true
      bullet.sprite.destroy()
      return false
    })
  }

  private pop(bullet: Bullet, save: NonNullable<typeof live.save>): void {
    if (bullet.popped) return
    bullet.popped = true
    burst(this, bullet.x, bullet.y, 0xd9fff2, 10)
    audio.sfx('explode', 1.45)
    for (const enemy of this.enemies) {
      if (enemy.dead || bullet.hit.has(enemy.uid)) continue
      if (Math.hypot(enemy.sprite.x - bullet.x, enemy.sprite.y - bullet.y) > bullet.aoe) continue
      bullet.hit.add(enemy.uid)
      this.damageEnemy(enemy, bullet, save, 0.82)
    }
  }

  private damageEnemy(enemy: EnemyActor, bullet: Bullet, save: NonNullable<typeof live.save>, mulScale: number): void {
    const stats = computeStats(save)
    const result = calcDamage({
      atk: stats.atk,
      weaponDamage: bullet.weaponDamage,
      multiplier: bullet.mul * mulScale,
      targetDef: enemy.defn,
      critChance: stats.critChance,
      critMultiplier: stats.critDamage,
      forceCrit: bullet.forceCrit,
    })
    enemy.hurt(result.amount, bullet.x, bullet.y, result.crit ? 1.35 : 1)
    this.floatText(enemy.sprite.x, enemy.sprite.y - enemy.sprite.displayHeight, result.crit ? `${result.amount}!` : `${result.amount}`, result.crit ? '#ffe08a' : '#fffaf6', result.crit ? 28 : 18)
    audio.sfx(result.crit ? 'crit' : 'hit', 0.92 + Math.random() * 0.16)
    if (settings.current.shake && (result.crit || result.amount >= 22)) {
      this.cameras.main.shake(result.crit ? 90 : 50, Math.min(0.011, 0.002 + result.amount / 8000))
    }
    if ((result.crit && bullet.mul >= 0.9) || enemy.hp <= 0) this.hitStop = Math.max(this.hitStop, enemy.hp <= 0 ? 0.045 : 0.05)
    burst(this, enemy.sprite.x, enemy.sprite.y - 20, result.crit ? 0xffe08a : 0xffd0ea, result.crit ? 8 : 4)
    if (enemy.hp <= 0) this.killEnemy(enemy, save)
  }

  private killEnemy(enemy: EnemyActor, save: NonNullable<typeof live.save>): void {
    if (enemy.dead) return
    enemy.dead = true
    const body = enemy.sprite.body as Phaser.Physics.Arcade.Body
    body.enable = false
    this.tweens.add({
      targets: enemy.view,
      alpha: 0,
      scaleX: enemy.view.scaleX * 1.25,
      scaleY: enemy.view.scaleY * 1.25,
      duration: 260,
      onComplete: () => enemy.destroy(),
    })
    burst(this, enemy.sprite.x, enemy.sprite.y - 20, 0xffc2e2, enemy.boss ? 28 : 12)
    audio.sfx('explode', enemy.boss ? 0.75 : 1.15)
    if (enemy.boss && settings.current.shake) this.cameras.main.shake(420, 0.016)
    if (enemy.explode) this.hazards.push({ x: enemy.sprite.x, y: enemy.sprite.y, r: 80, life: 0.42, max: 0.42, damage: 14, color: 0xff8ad2 })
    let result: MutationResult = onKill(save, enemy.def.id, enemy.tags)
    result = mergeResult(result, gainXp(save, enemy.xp))
    if (enemy.tags.includes('tutorial') && !save.flags.slimeHint) {
      save.flags.slimeHint = true
      result.toasts.push('모찌: 좋아, 그 손맛! 남쪽 별문을 지나면 꿈의 마을이야.')
    }
    commit(result)
    if (result.leveled) {
      this.flash.setAlpha(0.45)
      audio.sfx('levelup')
    }
    const stats = computeStats(save)
    const drops = rollDrops({
      table: enemy.def,
      luck: stats.luck,
      elite: enemy.name !== enemy.def.name,
      boss: enemy.boss,
      rng: Math.random,
      itemLevel: save.level,
    })
    for (const drop of drops) {
      if (drop.kind === 'gold') {
        const piles = enemy.boss ? 6 : 1
        for (const amount of splitGold(drop.amount, piles)) {
          const a = Math.random() * Math.PI * 2
          this.dropPickup(enemy.sprite.x, enemy.sprite.y, { kind: 'gold', amount }, Math.cos(a) * 90, Math.sin(a) * 70)
        }
      } else {
        const a = Math.random() * Math.PI * 2
        this.dropPickup(enemy.sprite.x, enemy.sprite.y, drop, Math.cos(a) * 70, Math.sin(a) * 50)
      }
    }
  }

  private dropPickup(
    x: number,
    y: number,
    drop: { kind: Pickup['kind']; amount: number; item?: ItemInstance; matId?: string },
    vx = 0,
    vy = 0,
  ): void {
    const key = drop.kind === 'gold' ? 'loot_coin' : drop.kind === 'material' && drop.matId === 'toy_part' ? 'loot_part' : drop.kind === 'material' ? 'loot_dust' : drop.kind === 'item' && drop.item?.defId.startsWith('gun_') ? drop.item.defId : 'loot_gem'
    const sprite = this.add.image(x, y, key)
    sprite.setOrigin(0.5, 0.8)
    sprite.setScale(drop.kind === 'item' ? 0.16 : 0.13)
    if (drop.item) sprite.setTint(RARITY_TINT[drop.item.rarity] ?? 0xffffff)
    let beam: Phaser.GameObjects.Rectangle | undefined
    if (drop.item) {
      const color = RARITY_TINT[drop.item.rarity] ?? 0xffffff
      beam = this.add.rectangle(x, y, 8, drop.item.rarity === 'legendary' ? 92 : 64, color, 0.55)
      beam.setOrigin(0.5, 1)
      beam.setBlendMode(Phaser.BlendModes.ADD)
      beam.setDepth(y - 2)
    }
    this.pickups.push({ x, y, vx, vy, kind: drop.kind, amount: drop.amount, item: drop.item, matId: drop.matId, age: 0, sprite, beam })
  }

  private tickPickups(dt: number, save: NonNullable<typeof live.save>): void {
    const keep: Pickup[] = []
    for (const pickup of this.pickups) {
      pickup.age += dt
      pickup.vx *= Math.max(0, 1 - dt * 3)
      pickup.vy *= Math.max(0, 1 - dt * 3)
      const dx = this.player.x - pickup.x
      const dy = this.player.y - pickup.y
      const dist = Math.hypot(dx, dy)
      if (pickup.age > 0.35 && dist < 150 && this.canTake(pickup, save)) {
        pickup.vx += (dx / dist) * 920 * dt
        pickup.vy += (dy / dist) * 920 * dt
      }
      pickup.x += pickup.vx * dt
      pickup.y += pickup.vy * dt
      const bob = Math.sin(this.elapsed * 5 + pickup.x) * 3
      pickup.sprite.setPosition(pickup.x, pickup.y + bob)
      pickup.sprite.setDepth(pickup.y)
      pickup.beam?.setPosition(pickup.x, pickup.y + bob)
      if (pickup.beam) pickup.beam.alpha = 0.35 + Math.sin(this.elapsed * 6) * 0.2
      if (dist < 28 && pickup.age > 0.25) {
        if (!this.canTake(pickup, save)) {
          if (this.elapsed > this.fullToast) {
            this.fullToast = this.elapsed + 1.5
            bus.emit('toast', '가방이 가득 찼어.')
          }
        } else {
          this.collect(pickup, save)
          pickup.sprite.destroy()
          pickup.beam?.destroy()
          continue
        }
      }
      keep.push(pickup)
    }
    this.pickups = keep
  }

  private canTake(pickup: Pickup, save: NonNullable<typeof live.save>): boolean {
    if (pickup.kind !== 'item') return true
    return this.bagHasRoom(save)
  }

  private bagHasRoom(save: NonNullable<typeof live.save>): boolean {
    const equipped = new Set(Object.values(save.equipment))
    return save.items.filter((item) => !equipped.has(item.uid)).length < 24
  }

  private collect(pickup: Pickup, save: NonNullable<typeof live.save>): void {
    if (pickup.kind === 'gold') {
      gainGold(save, pickup.amount)
      audio.sfx('coin', 0.96 + Math.random() * 0.08)
      this.floatText(pickup.x, pickup.y - 16, `+${pickup.amount}`, '#ffe08a', 16)
      commit()
      return
    }
    if (pickup.kind === 'potion') {
      if (save.potions >= POTION_CAP) gainGold(save, 5)
      else save.potions += pickup.amount
      audio.sfx('pickup')
      commit()
      return
    }
    if (pickup.kind === 'material' && pickup.matId) {
      const result = collectMaterial(save, pickup.matId, pickup.amount)
      audio.sfx('pickup', 1.08)
      const label = pickup.matId === 'toy_part' ? '장난감 부품' : '꿈가루'
      result.toasts.unshift(`${label} +${pickup.amount}`)
      commit(result)
      return
    }
    if (pickup.kind === 'item' && pickup.item) {
      addItem(save, pickup.item)
      audio.sfx(pickup.item.rarity === 'legendary' || pickup.item.rarity === 'epic' ? 'levelup' : 'pickup')
      if (pickup.item.rarity === 'legendary') buzz([16, 30, 16])
      bus.emit('toast', `${itemName(pickup.item)} 획득`)
      commit()
    }
  }

  private tickHazards(dt: number, save: NonNullable<typeof live.save>): void {
    this.hazardGfx.clear()
    const keep: Hazard[] = []
    for (const hazard of this.hazards) {
      hazard.life -= dt
      const alpha = 0.35 + Math.sin(this.elapsed * 18) * 0.15
      this.hazardGfx.lineStyle(3, hazard.color, 0.9)
      this.hazardGfx.strokeCircle(hazard.x, hazard.y, hazard.r * (0.7 + 0.3 * (hazard.life / hazard.max)))
      this.hazardGfx.fillStyle(hazard.color, alpha * 0.25)
      this.hazardGfx.fillCircle(hazard.x, hazard.y, hazard.r)
      if (hazard.life > 0) {
        keep.push(hazard)
        continue
      }
      if (runtime.invuln <= 0 && Math.hypot(this.player.x - hazard.x, this.player.y - hazard.y) < hazard.r) {
        const stats = computeStats(save)
        const hit = calcDamage({ atk: 0, weaponDamage: hazard.damage, multiplier: 1, targetDef: stats.def, critChance: 0, critMultiplier: 1 })
        this.playerHurt(hit.amount)
      }
      burst(this, hazard.x, hazard.y, hazard.color, 8)
      audio.sfx('explode', 1.2)
    }
    this.hazards = keep
  }

  private touchDamage(save: NonNullable<typeof live.save>): void {
    if (runtime.invuln > 0) return
    const stats = computeStats(save)
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.contactCd > 0) continue
      const bodyY = enemy.sprite.y - enemy.sprite.displayHeight * 0.28
      const dist = Math.hypot(enemy.sprite.x - this.player.x, bodyY - (this.player.y - 30))
      if (dist > Math.max(42, enemy.sprite.displayHeight * 0.34)) continue
      enemy.contactCd = 0.55
      const hit = calcDamage({
        atk: 0,
        weaponDamage: enemy.contact,
        multiplier: 1,
        targetDef: stats.def,
        critChance: 0,
        critMultiplier: 1,
      })
      this.playerHurt(hit.amount, enemy)
    }
    for (const enemy of this.enemies) enemy.contactCd = Math.max(0, enemy.contactCd - 0.016)
  }

  private playerHurt(amount: number, source?: EnemyActor): void {
    const save = live.save
    if (!save || runtime.invuln > 0 || amount <= 0) return
    let left = amount
    if (runtime.shield > 0) {
      const absorbed = Math.min(runtime.shield, left)
      runtime.shield -= absorbed
      left -= absorbed
      this.floatText(this.player.x, this.player.y - 70, '막음', '#c8f4ff', 16)
    }
    if (left <= 0) {
      runtime.invuln = 0.12
      return
    }
    save.hp = Math.max(0, save.hp - left)
    runtime.invuln = 0.55
    this.hurtT = 0.42
    this.avatar.setTintFill(0xffffff)
    this.time.delayedCall(90, () => this.avatar?.clearTint())
    this.flash.setFillStyle(0xff8fb0, 1)
    this.flash.setAlpha(0.28)
    audio.sfx('hurt')
    buzz(20)
    if (settings.current.shake) this.cameras.main.shake(120, Math.min(0.012, 0.003 + left / 5000))
    this.floatText(this.player.x, this.player.y - 64, `-${left}`, '#ff9eb8', 20)
    if (source?.lifesteal) source.hp = Math.min(source.maxHp, source.hp + left * source.lifesteal)
    const ang = source ? Math.atan2(this.player.y - source.sprite.y, this.player.x - source.sprite.x) : this.aim + Math.PI
    this.player.setVelocity(Math.cos(ang) * 180, Math.sin(ang) * 180)
    commit()
  }

  private tickPounce(dt: number, save: NonNullable<typeof live.save>): void {
    if (!this.pounce.on) return
    this.pounce.t += dt
    const k = Math.min(1, this.pounce.t / 0.2)
    this.mochi.x = this.pounce.x + (this.pounce.tx - this.pounce.x) * k
    this.mochi.y = this.pounce.y + (this.pounce.ty - this.pounce.y) * k
    if (k < 1) return
    this.pounce.on = false
    const stats = computeStats(save)
    burst(this, this.mochi.x, this.mochi.y, 0xffe0b8, 12)
    audio.sfx('hit', 0.8)
    for (const enemy of this.enemies) {
      if (enemy.dead) continue
      if (Math.hypot(enemy.sprite.x - this.mochi.x, enemy.sprite.y - this.mochi.y) > 56) continue
      const fake: Bullet = {
        x: this.mochi.x,
        y: this.mochi.y,
        vx: 0,
        vy: 0,
        life: 0,
        kind: 'dart',
        fromPlayer: true,
        weaponDamage: stats.weaponDamage,
        mul: 2.3,
        forceCrit: false,
        pierce: 1,
        aoe: 0,
        popped: true,
        damage: 0,
        hit: new Set(),
        sprite: this.mochi,
        trail: [],
      }
      this.damageEnemy(enemy, fake, save, 1)
    }
  }

  private followMochi(dt: number): void {
    if (this.pounce.on) return
    const dist = 78
    const tx = this.player.x - Math.cos(this.aim) * dist + Math.sin(this.aim) * 34
    const ty = this.player.y - Math.sin(this.aim) * dist * 0.45 + 8
    const k = 1 - Math.pow(0.001, dt)
    const beforeX = this.mochi.x
    const beforeY = this.mochi.y
    this.mochi.x += (tx - this.mochi.x) * k
    this.mochi.y += (ty - this.mochi.y) * k
    this.mochiMoved = Math.hypot(this.mochi.x - beforeX, this.mochi.y - beforeY)
    if (this.mochi.x < beforeX - 0.2) this.mochi.setFlipX(true)
    else if (this.mochi.x > beforeX + 0.2) this.mochi.setFlipX(false)
  }

  private pose(): void {
    const aimLeft = Math.cos(this.aim) < 0
    const flip = this.dashT > 0 ? this.dashX < 0 : aimLeft
    this.avatar.setPosition(this.player.x, this.player.y)
    this.avatar.setFlipX(flip)
    this.avatar.setAlpha(runtime.invuln > 0 && !this.dying ? 0.55 + Math.sin(this.elapsed * 40) * 0.15 : 1)
    this.avatar.setDepth(this.player.y)
    this.playAvatar(this.avatarKey())
    this.playerShadow.setPosition(this.player.x, this.player.y - 2)
    this.playerShadow.setDepth(this.player.y - 3)
    const look = cameraFocus(this.player.x, this.player.y, this.aim, this.avatar.displayHeight)
    this.focus.setPosition(look.x, look.y)
    this.recoil = Math.max(0, this.recoil - 0.9)
    const spec = gunSpec(this.gunKey())
    const grip = gripPoint(this.player.x, this.player.y, this.aim, this.recoil)
    const bob = this.dying ? 0 : this.moving && this.dashT <= 0 ? Math.sin(this.elapsed * 14) * 2.2 : Math.sin(this.elapsed * 2.2) * 1.1
    grip.y += bob
    if (this.gun.texture.key !== this.gunKey()) this.gun.setTexture(this.gunKey())
    this.gun.setOrigin(spec.originX, spec.originY)
    this.gun.setScale(spec.scale)
    this.gun.setPosition(grip.x, grip.y)
    this.gun.setRotation(this.aim)
    this.gun.setFlipY(aimLeft)
    this.gun.setVisible(!this.dying)
    this.gun.setDepth(gunInFront(this.aim) ? this.player.y + 2 : this.player.y - 2)
    if (runtime.focus > 0) this.gun.setTint(0xffe08a)
    else this.gun.clearTint()
    const mochiWalking = this.pounce.on || this.mochiMoved > 0.45
    this.playMochi(mochiWalking ? 'mochi_walk' : 'mochi_idle')
    if (!mochiWalking) this.mochi.setFlipX(this.mochi.x > this.player.x)
    this.mochi.setDepth(this.mochi.y)
    if (runtime.taunt > 0) this.mochi.setTint(0xffd0ea)
    else this.mochi.clearTint()
    this.mochiShadow.setPosition(this.mochi.x, this.mochi.y - 2)
    this.mochiShadow.setDepth(this.mochi.y - 3)
    if (this.muzzle > 0) {
      this.muzzle = 0
      const tip = muzzlePoint(this.player.x, this.player.y, this.aim, this.gunKey(), this.recoil)
      tip.y += bob
      const flash = this.add.image(tip.x, tip.y, 'star')
      flash.setBlendMode(Phaser.BlendModes.ADD)
      flash.setScale(0.42)
      flash.setDepth(this.gun.depth + 1)
      flash.setTint(0xd8f4ff)
      this.tweens.add({ targets: flash, alpha: 0, scale: 0.05, duration: 70, onComplete: () => flash.destroy() })
    }
    if (this.flash.alpha > 0) this.flash.alpha = Math.max(0, this.flash.alpha - 0.03)
    if (runtime.shield > 0) {
      this.hazardGfx.lineStyle(2, 0xbff5ff, 0.45)
      this.hazardGfx.strokeCircle(this.player.x, this.player.y - HAND_LIFT, 36)
    }
  }

  private avatarKey(): string {
    if (this.dying) return 'byeolha_death'
    if (this.dashT > 0) return 'byeolha_dash'
    if (this.hurtT > 0) return 'byeolha_hit'
    if (!this.moving) return 'byeolha_idle'
    const face = facingFromAim(this.aim)
    if (face === 'front') return 'byeolha_walk_front'
    if (face === 'back') return 'byeolha_walk_back'
    return 'byeolha_walk_side'
  }

  private playAvatar(key: string): void {
    if (this.avatarAnim === key && (this.avatar.anims.isPlaying || key === 'byeolha_death' || key === 'byeolha_hit')) return
    this.avatarAnim = key
    if (this.anims.exists(key)) this.avatar.play(key, true)
  }

  private playMochi(key: string): void {
    if (this.mochiAnim === key) return
    this.mochiAnim = key
    if (this.anims.exists(key)) this.mochi.play(key, true)
  }

  private exits(): void {
    if (this.traveling || !live.save) return
    const bossUp = this.enemies.some((enemy) => enemy.boss && !enemy.dead)
    const inside = this.zone.exits.find(
      (exit) => Math.abs(this.player.x - exit.x) <= exit.w / 2 + 70 && Math.abs(this.player.y - exit.y) <= exit.h / 2 + 70,
    )
    if (!inside) {
      this.exitArmed = true
      return
    }
    if (!this.exitArmed) return
    if (inside.seal === 'boss' && bossUp) return
    this.travel(inside.to, inside.spawn)
  }

  private travel(to: string, spawn: string): void {
    const save = live.save
    if (!save || this.traveling) return
    this.traveling = true
    save.zoneId = to
    save.spawn = spawn
    commit()
    this.player.setVelocity(0, 0)
    this.cameras.main.fadeOut(220, 22, 10, 36)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ zoneId: to, spawn })
    })
  }

  private prompt(): void {
    const near = this.nearestTalk()
    if (near) {
      const mark = npcMarker(live.save!, near.id)
      hud.prompt = `${mark ? `${mark} ` : ''}${PROMPTS[near.id] ?? '살펴보기'}`
      return
    }
    const bossUp = this.enemies.some((enemy) => enemy.boss && !enemy.dead)
    const sealed = this.zone.exits.find(
      (exit) => exit.seal === 'boss' && bossUp && Math.abs(this.player.x - exit.x) < exit.w / 2 && Math.abs(this.player.y - exit.y) < exit.h / 2,
    )
    const gate = this.zone.exits.find(
      (exit) => Math.abs(this.player.x - exit.x) <= exit.w / 2 + 70 && Math.abs(this.player.y - exit.y) <= exit.h / 2 + 70,
    )
    hud.prompt = sealed ? '제단이 닫혀 있어' : gate ? '별문으로 걸어가' : ''
  }

  private nearestTalk(): { id: string; x: number; y: number } | null {
    let best: { id: string; x: number; y: number; d: number } | null = null
    const consider = (id: string, x: number, y: number, r: number) => {
      const d = Math.hypot(this.player.x - x, this.player.y - y)
      if (d > r) return
      if (!best || d < best.d) best = { id, x, y, d }
    }
    for (const npc of this.zone.npcs) consider(npc.id, npc.x, npc.y, 78)
    for (const spot of this.zone.spots) consider(spot.id, spot.x, spot.y, spot.r)
    return best
  }

  private interact(): void {
    const near = this.nearestTalk()
    if (!near || !live.save) return
    bus.emit('dialogue', resolveDialogue(near.id, live.save))
  }

  private nearest(maxDist: number): EnemyActor | null {
    let best: EnemyActor | null = null
    let bestD = maxDist
    for (const enemy of this.enemies) {
      if (enemy.dead) continue
      const d = Math.hypot(enemy.sprite.x - this.player.x, enemy.sprite.y - this.player.y)
      if (d < bestD) {
        best = enemy
        bestD = d
      }
    }
    return best
  }

  private combatCtx() {
    return {
      px: this.player.x,
      py: this.player.y,
      mx: this.mochi.x,
      my: this.mochi.y,
      taunt: runtime.taunt > 0,
      spawnBullet: (bullet: BulletSpec) => this.enemyBullet(bullet),
      addHazard: (hazard: HazardSpec) => this.hazards.push({ ...hazard, max: hazard.life }),
      spawnMinion: (id: string, x: number, y: number) => this.addEnemy(id, x, y, ['wild']),
      announce: (text: string) => {
        bus.emit('toast', text)
        audio.sfx('boss', 0.8)
        if (settings.current.shake) this.cameras.main.shake(180, 0.01)
      },
    }
  }

  private addEnemy(id: string, x: number, y: number, tags: string[], elite?: string, fixed?: boolean): void {
    const save = live.save
    if (!save) return
    const enemy = new EnemyActor(this, { id, x, y, tags, elite, fixed }, save.level)
    this.enemies.push(enemy)
    this.foes.add(enemy.sprite)
  }

  private addNpc(id: string, key: string, x: number, y: number, h: number): void {
    const img = this.add.image(x, y, key)
    img.setOrigin(0.5, 0.98)
    img.setScale(h / img.height)
    img.setDepth(y)
    const shadow = this.add.ellipse(x, y - 2, h * 0.34, 14, 0x241433, 0.22)
    shadow.setDepth(y - 2)
    const mark = this.add.text(x, y - h - 8, '', {
      fontFamily: 'Jua, sans-serif',
      fontSize: '20px',
      color: '#ffe08a',
      stroke: '#3a2448',
      strokeThickness: 4,
    })
    mark.setOrigin(0.5, 1)
    mark.setDepth(y + 5)
    const name = this.add.text(x, y - h + 8, labelOf(id), {
      fontFamily: 'Jua, sans-serif',
      fontSize: '15px',
      color: '#fffaf6',
      stroke: '#3a2448',
      strokeThickness: 3,
    })
    name.setOrigin(0.5, 1)
    name.setDepth(y + 5)
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => {
      if (!live.save) return
      mark.setText(npcMarker(live.save, id))
    })
  }

  private addBlock(x: number, y: number, w: number, h: number): void {
    const rect = this.add.rectangle(x, y, w, h, 0x000000, 0)
    this.physics.add.existing(rect, true)
    this.blocks.push(rect)
  }

  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Jua, sans-serif',
      fontSize: `${size}px`,
      color,
      stroke: '#3a2448',
      strokeThickness: 4,
    })
    label.setOrigin(0.5)
    label.setDepth(22000)
    this.floats.push({ t: label, life: 0.7, vy: -48 })
  }

  private tickFloats(dt: number): void {
    this.floats = this.floats.filter((floater) => {
      floater.life -= dt
      floater.t.y += floater.vy * dt
      floater.t.alpha = Math.max(0, floater.life / 0.7)
      if (floater.life > 0) return true
      floater.t.destroy()
      return false
    })
  }

  private syncHud(save: NonNullable<typeof live.save>): void {
    const stats = computeStats(save)
    hud.hp = save.hp
    hud.maxHp = stats.maxHp
    hud.shield = runtime.shield
    hud.level = save.level
    hud.xp = save.xp
    hud.next = xpToNext(save.level)
    hud.gold = save.gold
    hud.potions = save.potions
    hud.zone = this.zone.name
    hud.quests = tracker(save)
    hud.learned = [...save.learnedSkills]
    hud.pointsB = save.byeolhaPoints
    hud.pointsM = save.mochiPoints
    hud.low = save.hp / stats.maxHp < 0.3
    const boss = this.enemies.find((enemy) => enemy.boss && !enemy.dead)
    hud.boss = boss ? { name: boss.name, ratio: boss.hp / boss.maxHp } : null
    hud.cds = {}
    for (const id of HOTBAR) {
      const total = SKILLS[id]?.cooldown ?? 1
      hud.cds[id] = { r: runtime.cds[id] ?? 0, t: total }
    }
  }

  private gunKey(): string {
    const id = live.save?.equipment.weapon
    const item = live.save?.items.find((entry) => entry.uid === id)
    if (item?.defId === 'gun_bubble' || item?.defId === 'gun_dart' || item?.defId === 'gun_water') return item.defId
    return 'gun_water'
  }
}

function labelOf(id: string): string {
  if (id === 'luna') return '루나'
  if (id === 'popo') return '포포'
  if (id === 'kiki') return '키키'
  return id
}

export function respawnHere(): { zoneId: string; spawn: string; lost: number } {
  const save = live.save
  if (!save) return { zoneId: 'meadow', spawn: 'default', lost: 0 }
  const lost = onDeath(save)
  commit()
  return { zoneId: save.zoneId, spawn: save.spawn, lost }
}
