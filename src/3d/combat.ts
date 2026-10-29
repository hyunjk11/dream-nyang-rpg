import {
  ConeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { toon } from './materials'

export interface Foe {
  kind: 'slime' | 'ghost' | 'bug'
  object: Group
  hp: number
  maxHp: number
  alive: boolean
  flash: number
  attack: number
  knock: Vector3
  respawn: number
  home: Vector3
}

interface Shot {
  mesh: Mesh
  vel: Vector3
  life: number
  fromHero: boolean
  damage: number
  radius: number
}

interface Drop {
  mesh: Mesh
  vel: Vector3
  life: number
  amount: number
}

interface Spark {
  life: number
  vel: Vector3
  pos: Vector3
}

export class Combat {
  readonly foes: Foe[] = []
  shots: Shot[] = []
  drops: Drop[] = []
  hitStop = 0
  shake = 0
  dust = 0
  private sparks: Spark[] = []
  private sparkMesh: InstancedMesh
  private dummy = new Object3D()
  private root: Object3D

  constructor(root: Object3D) {
    this.root = root
    this.sparkMesh = new InstancedMesh(new SphereGeometry(0.045, 6, 5), toon(0xffd0ea, 0xfff6ea, 0.15), 48)
    this.sparkMesh.count = 0
    this.sparkMesh.frustumCulled = false
    root.add(this.sparkMesh)
    const homes = [
      [9.2, 2.4, 'slime'],
      [-8.4, 6.2, 'slime'],
      [4.2, -9.4, 'ghost'],
      [-9.6, -3.2, 'bug'],
      [8.8, -5.5, 'bug'],
    ] as const
    for (const [x, z, kind] of homes) this.spawn(kind, x, z)
  }

  private spawn(kind: Foe['kind'], x: number, z: number): void {
    const object = kind === 'slime' ? slime() : kind === 'ghost' ? ghost() : bug()
    object.position.set(x, 0, z)
    this.root.add(object)
    const hp = kind === 'bug' ? 46 : kind === 'ghost' ? 28 : 34
    this.foes.push({
      kind,
      object,
      hp,
      maxHp: hp,
      alive: true,
      flash: 0,
      attack: 0.4 + Math.random(),
      knock: new Vector3(),
      respawn: 0,
      home: new Vector3(x, 0, z),
    })
  }

  fire(origin: Vector3, dir: Vector3, damage: number, fromHero: boolean, color: number, speed: number): void {
    const mesh = new Mesh(new SphereGeometry(fromHero ? 0.09 : 0.11, 8, 6), toon(color, color, 0.45))
    mesh.position.copy(origin)
    this.root.add(mesh)
    this.shots.push({
      mesh,
      vel: dir.clone().normalize().multiplyScalar(speed),
      life: 1.1,
      fromHero,
      damage,
      radius: fromHero ? 0.28 : 0.34,
    })
  }

  flashBurst(at: Vector3, color: number): void {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2
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
    for (const foe of this.foes) {
      foe.flash = Math.max(0, foe.flash - dt)
      foe.attack = Math.max(0, foe.attack - dt)
      foe.knock.multiplyScalar(Math.max(0, 1 - dt * 4))
      if (!foe.alive) {
        foe.respawn -= dt
        foe.object.visible = false
        if (foe.respawn <= 0) {
          foe.alive = true
          foe.hp = foe.maxHp
          foe.object.visible = true
          foe.object.position.copy(foe.home)
        }
        continue
      }
      const to = heroPos.clone().sub(foe.object.position)
      to.y = 0
      const dist = to.length()
      if (dist > 1.15) {
        to.normalize()
        const speed = foe.kind === 'ghost' ? 2.3 : foe.kind === 'bug' ? 3.1 : 1.8
        foe.object.position.addScaledVector(to, speed * dt)
      }
      foe.object.position.addScaledVector(foe.knock, dt)
      foe.object.position.y = Math.abs(Math.sin(performance.now() / 180 + foe.home.x)) * (foe.kind === 'ghost' ? 0.35 : 0.12)
      foe.object.lookAt(heroPos.x, foe.object.position.y, heroPos.z)
      const pulse = 1 + Math.sin(performance.now() / 160) * 0.04
      foe.object.scale.setScalar(pulse)
      if (foe.kind === 'ghost' && dist < 7.5 && dist > 1.4 && foe.attack <= 0) {
        foe.attack = 1.7
        const origin = foe.object.position.clone().setY(0.75)
        const dir = heroPos.clone().sub(origin)
        this.fire(origin, dir, 6, false, 0xd7b6ff, 6.5)
      } else if (dist < heroRadius + 0.85 && foe.attack <= 0) {
        foe.attack = foe.kind === 'bug' ? 0.9 : 1.2
        onHeroHit(foe.kind === 'bug' ? 10 : 7, foe.object.position)
      }
      paintHurt(foe)
    }

    for (const shot of this.shots) {
      shot.life -= dt
      shot.mesh.position.addScaledVector(shot.vel, dt)
      if (!shot.fromHero) {
        const body = heroPos.clone()
        body.y = 0.9
        if (body.distanceTo(shot.mesh.position) < 0.55) {
          onHeroHit(shot.damage, shot.mesh.position)
          shot.life = 0
        }
        continue
      }
      for (const foe of this.foes) {
        if (!foe.alive) continue
        const aim = foe.object.position.clone()
        aim.y += 0.45
        if (aim.distanceTo(shot.mesh.position) > shot.radius + 0.45) continue
        foe.hp -= shot.damage
        foe.flash = 0.1
        foe.knock.copy(shot.vel).setY(0).normalize().multiplyScalar(3.2)
        this.hitStop = Math.max(this.hitStop, 0.045)
        this.shake = Math.max(this.shake, 0.08)
        notes.push({ text: String(Math.round(shot.damage)), at: aim.clone() })
        this.flashBurst(aim, 0xffd0ea)
        shot.life = 0
        if (foe.hp <= 0) {
          foe.alive = false
          foe.respawn = 4.5
          this.flashBurst(foe.object.position, 0xffe08a)
          this.shake = Math.max(this.shake, 0.16)
          this.drop(foe.object.position)
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
      if (to.length() < 0.7 && drop.life > 0.2) {
        this.dust += drop.amount
        notes.push({ text: `+${drop.amount}`, at: drop.mesh.position.clone() })
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
    this.sparks = this.sparks.filter((spark) => spark.life > 0).slice(0, 48)
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

  private drop(at: Vector3): void {
    const roll = Math.random()
    const color = roll > 0.92 ? 0xffe08a : roll > 0.7 ? 0xd59bff : roll > 0.4 ? 0x7eb6ff : 0xb8f2d0
    const mesh = new Mesh(new SphereGeometry(0.12, 10, 8), toon(color, color, 0.7))
    mesh.position.copy(at)
    mesh.position.y = 0.4
    this.root.add(mesh)
    this.drops.push({
      mesh,
      vel: new Vector3((Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2),
      life: 0,
      amount: roll > 0.92 ? 8 : 3,
    })
  }
}

function slime(): Group {
  const group = new Group()
  const body = new Mesh(new SphereGeometry(0.42, 16, 12), toon(0xffb7d5, 0xffd0ea, 0.12))
  body.scale.y = 0.78
  body.position.y = 0.36
  body.castShadow = true
  const eye = new Mesh(new SphereGeometry(0.05, 8, 8), toon(0x4a3358))
  const eye2 = eye.clone()
  eye.position.set(-0.1, 0.42, 0.28)
  eye2.position.set(0.1, 0.42, 0.28)
  group.add(body, eye, eye2)
  return group
}

function ghost(): Group {
  const group = new Group()
  const body = new Mesh(new SphereGeometry(0.36, 14, 12), toon(0xd8c6ff, 0xf4e8ff, 0.08))
  body.position.y = 0.7
  body.castShadow = true
  const eye = new Mesh(new SphereGeometry(0.045, 8, 8), toon(0x4a3358))
  const eye2 = eye.clone()
  eye.position.set(-0.08, 0.76, 0.28)
  eye2.position.set(0.08, 0.76, 0.28)
  group.add(body, eye, eye2)
  return group
}

function bug(): Group {
  const group = new Group()
  const body = new Mesh(new SphereGeometry(0.32, 12, 10), toon(0xb8f2d0))
  body.scale.set(0.8, 0.7, 1.35)
  body.position.y = 0.34
  body.castShadow = true
  const wing = new Mesh(new ConeGeometry(0.16, 0.28, 4), toon(0xe8fff4, 0xffffff, 0.2))
  wing.rotation.z = 0.8
  wing.position.set(0.2, 0.5, 0)
  const wing2 = wing.clone()
  wing2.rotation.z = -0.8
  wing2.position.x = -0.2
  group.add(body, wing, wing2)
  return group
}

function paintHurt(foe: Foe): void {
  foe.object.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    const material = mesh.material
    const list = Array.isArray(material) ? material : [material]
    for (const entry of list) {
      const toonMat = entry as MeshToonMaterial
      if (!toonMat.emissive) continue
      const hot = foe.flash > 0
      toonMat.emissive.set(hot ? 0xfff6ea : 0x000000)
      toonMat.emissiveIntensity = hot ? 0.35 : 0
    }
  })
}
