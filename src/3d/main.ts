import '@fontsource/jua/400.css'
import '@fontsource/noto-sans-kr/400.css'
import './style.css'
import { Clock, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three'
import { createStage } from './arena'
import { audio } from './audio'
import { Combat } from './combat'
import { cameraRelativeWish } from './feel'
import { Hero } from './hero'
import { axis, consumeDash, installInput, pad, runningHeld } from './input'
import { Mochi } from './mochi'

const base = import.meta.env.BASE_URL
const canvas = document.querySelector('canvas')
if (!canvas) throw new Error('canvas missing')

const stage = createStage(canvas)
if (stage.touch) document.body.classList.add('touch')
installInput(canvas)
const hero = new Hero()
const mochi = new Mochi()
stage.scene.add(hero.object, mochi.object)
const combat = new Combat(stage.scene)
const clock = new Clock()
const raycaster = new Raycaster()
const ndc = new Vector2()
const aim = new Vector3(0, 1.1, 4)
const ground = new Vector3()
let fireCd = 0
let mochiCd = 1
let frames = 0
let fpsTime = 0
let fps = 0
let showFps = true
const floats: { el: HTMLElement; life: number; y: number; at: Vector3 }[] = []

const hpFill = document.getElementById('hp-fill')
const dustEl = document.getElementById('dust')
const fpsEl = document.getElementById('fps')
const boot = document.getElementById('boot')
const note = document.getElementById('note')
const vol = document.getElementById('vol') as HTMLInputElement | null
if (vol) vol.value = String(Math.round(audio.master * 100))
vol?.addEventListener('input', () => {
  audio.setMaster(Number(vol.value) / 100)
  audio.sfx('ui')
})
document.getElementById('mute')?.addEventListener('click', () => {
  audio.setMaster(audio.master > 0.01 ? 0 : 0.35)
  if (vol) vol.value = String(Math.round(audio.master * 100))
})
document.getElementById('fps-toggle')?.addEventListener('click', () => {
  showFps = !showFps
  fpsEl?.classList.toggle('hidden', !showFps)
})
document.getElementById('retry')?.addEventListener('click', () => restart())

if (import.meta.env.DEV) Object.assign(window, { __slice: { hero, mochi, combat, stage } })

void bootGame()

async function bootGame(): Promise<void> {
  const [byeolha, cat] = await Promise.all([
    hero.load(`${base}models/3d/byeolha_animated_mobile.glb`),
    mochi.load(`${base}models/3d/mochi_mobile.glb`),
  ])
  if (boot) boot.classList.add('hidden')
  if (note && (!byeolha || !cat)) {
    note.textContent = '메쉬 파일을 찾지 못해 임시 모습으로 보여 줄게. 카메라와 손맛은 그대로야.'
    note.classList.remove('hidden')
    window.setTimeout(() => note.classList.add('hidden'), 4200)
  }
  audio.start()
  requestAnimationFrame(frame)
}

function frame(): void {
  requestAnimationFrame(frame)
  const raw = Math.min(0.05, clock.getDelta())
  let dt = raw
  if (combat.hitStop > 0) {
    combat.hitStop -= raw
    dt *= 0.08
  }
  combat.shake = Math.max(0, combat.shake - raw * 1.5)
  frames += 1
  fpsTime += raw
  if (fpsTime >= 0.5) {
    fps = Math.round(frames / fpsTime)
    fpsTime = 0
    frames = 0
    if (fpsEl && showFps) fpsEl.textContent = `${fps} FPS`
  }
  const move = axis()
  const wish = cameraRelativeWish(move.x, move.y)
  aimAt()
  fireCd = Math.max(0, fireCd - dt)
  const dash = consumeDash()
  if (dash && hero.alive) audio.sfx('dash')
  hero.update(dt, { wishX: wish.x, wishZ: wish.z, aim, firing: pad.fire, dash, run: runningHeld() })
  if (hero.dashing) ghost()
  if (pad.fire && fireCd <= 0 && hero.alive) {
    fireCd = 0.16
    const tip = hero.muzzle.getWorldPosition(new Vector3())
    const dir = aim.clone().sub(tip)
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
    combat.fire(tip, dir, 12, true, 0x9ad7ff, 16)
    combat.flashBurst(tip, 0xd7f4ff)
    audio.sfx('shoot_water')
  }
  const heroPos = hero.object.position
  mochiFollow(dt, heroPos)
  const notes = combat.update(dt, heroPos, 0.7, (amount, from) => {
    const hurt = hero.hurt(amount, from)
    if (!hurt) return
    audio.sfx('hurt')
    combat.shake = Math.max(combat.shake, 0.14)
    float(`-${amount}`, heroPos.clone().setY(1.6), '#ff9eb8')
    if (!hero.alive) {
      audio.sfx('hurt')
      document.getElementById('down')?.classList.remove('hidden')
    }
  })
  for (const item of notes) {
    float(item.text, item.at, item.text.startsWith('+') ? '#ffe08a' : '#fffaf6')
    if (item.text.startsWith('+')) audio.sfx('coin')
    else audio.sfx('hit')
  }
  if (hpFill) hpFill.style.width = `${Math.max(0, (hero.hp / hero.maxHp) * 100)}%`
  if (dustEl) dustEl.textContent = `꿈가루 ${combat.dust}`
  const aimFlatX = aim.x - heroPos.x
  const aimFlatZ = aim.z - heroPos.z
  stage.follow(heroPos.x, heroPos.y, heroPos.z, aimFlatX, aimFlatZ, combat.shake)
  tickFloats(dt)
  stage.render()
}

function aimAt(): void {
  if (!pad.pointer || pad.fire && stage.mobile) {
    const nearest = nearestFoe()
    if (nearest) {
      aim.set(nearest.object.position.x, 0.9, nearest.object.position.z)
      return
    }
  }
  ndc.x = (pad.px / window.innerWidth) * 2 - 1
  ndc.y = -(pad.py / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(ndc, stage.camera)
  const planeY = 0.05
  const origin = raycaster.ray.origin
  const dir = raycaster.ray.direction
  if (Math.abs(dir.y) > 0.0001) {
    const t = (planeY - origin.y) / dir.y
    if (t > 0) {
      ground.copy(origin).addScaledVector(dir, t)
      aim.set(ground.x, 1.05, ground.z)
      return
    }
  }
}

function nearestFoe() {
  let best: (typeof combat.foes)[number] | null = null
  let dist = 11
  for (const foe of combat.foes) {
    if (!foe.alive) continue
    const d = foe.object.position.distanceTo(hero.object.position)
    if (d < dist) {
      best = foe
      dist = d
    }
  }
  return best
}

function mochiFollow(dt: number, heroPos: Vector3): void {
  const yaw = hero.yaw
  const forwardX = Math.sin(yaw)
  const forwardZ = Math.cos(yaw)
  const target = new Vector3(heroPos.x - forwardX * 1.35 + forwardZ * 0.55, 0, heroPos.z - forwardZ * 1.35 - forwardX * 0.55)
  mochi.update(dt, target, heroPos)
  mochiCd -= dt
  const prey = nearestFoe()
  if (prey && mochiCd <= 0 && hero.alive) {
    mochiCd = 1.35
    const from = mochi.fishMuzzle.getWorldPosition(new Vector3())
    const dir = prey.object.position.clone().setY(0.5).sub(from)
    combat.fire(from, dir, 8, true, 0xffcf70, 11)
    audio.sfx('shoot_bubble')
  }
}

const ghosts: { mesh: Mesh; life: number }[] = []
function ghost(): void {
  if (ghosts.length > 6) return
  const mesh = new Mesh(
    new SphereGeometry(0.28, 8, 6),
    new MeshBasicMaterial({ color: 0xffd0ea, transparent: true, opacity: 0.35 }),
  )
  mesh.position.copy(hero.object.position)
  mesh.position.y = 0.8
  stage.scene.add(mesh)
  ghosts.push({ mesh, life: 0.28 })
}

function tickFloats(dt: number): void {
  for (const ghostItem of ghosts) {
    ghostItem.life -= dt
    const mat = ghostItem.mesh.material as MeshBasicMaterial
    mat.opacity = Math.max(0, ghostItem.life)
    if (ghostItem.life <= 0) {
      ghostItem.mesh.geometry.dispose()
      ;(ghostItem.mesh.material as MeshBasicMaterial).dispose()
      ghostItem.mesh.removeFromParent()
    }
  }
  for (let i = ghosts.length - 1; i >= 0; i -= 1) if (ghosts[i].life <= 0) ghosts.splice(i, 1)
  const width = window.innerWidth
  const height = window.innerHeight
  for (const item of floats) {
    item.life -= dt
    item.y += dt * 28
    const projected = item.at.clone()
    projected.y += item.y * 0.01
    projected.project(stage.camera)
    item.el.style.left = `${(projected.x * 0.5 + 0.5) * width}px`
    item.el.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`
    item.el.style.opacity = String(Math.max(0, item.life / 0.7))
  }
  for (let i = floats.length - 1; i >= 0; i -= 1) {
    if (floats[i].life > 0) continue
    floats[i].el.remove()
    floats.splice(i, 1)
  }
}

function float(text: string, at: Vector3, color: string): void {
  const layer = document.getElementById('floats')
  if (!layer) return
  const el = document.createElement('span')
  el.textContent = text
  el.style.color = color
  layer.append(el)
  floats.push({ el, life: 0.7, y: 0, at: at.clone() })
}

function restart(): void {
  hero.hp = hero.maxHp
  hero.alive = true
  hero.object.position.set(0, 0, 0)
  document.getElementById('down')?.classList.add('hidden')
  audio.sfx('heal')
}

window.addEventListener('resize', () => stage.resize())
