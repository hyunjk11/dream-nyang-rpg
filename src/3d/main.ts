import '@fontsource/jua/400.css'
import '@fontsource/noto-sans-kr/400.css'
import './style.css'
import { Clock, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three'
import { createStage } from './arena'
import { audio } from './audio'
import { Combat } from './combat'
import { loadFoeModels } from './foes'
import { cameraRelativeWish } from './feel'
import { groundAim } from './camera'
import { WALK_RADIUS } from './island'
import { Hero } from './hero'
import { axis, consumeDash, consumeTalk, installInput, pad, runningHeld } from './input'
import { Landmarks } from './landmarks'
import { Mochi } from './mochi'
import { killLoot, GameState, type Storageish } from './loop'
import { nearestTalk, placesFor, pushOutOfPlaces, type Place } from './places'
import { fadeThrough, hideTitle, openQuestLog, paintStats, paintTracker, playIntro, showEnding, showTitle, titleReady, toast, zoneBanner } from './screens'
import { TalkBox, type TalkChoice, type TalkDef } from './talk'
import { PLAZA, PORTAL_ARRIVAL, destinations, gateLocked, zone3d, type ZoneId } from './zones3d'
import { Color, Fog, HemisphereLight } from 'three'
import type { Action, MutationResult } from '../sim/types'
import { Vfx } from './vfx'

const base = import.meta.env.BASE_URL
const canvas = document.querySelector('canvas')
if (!canvas) throw new Error('canvas missing')

const stage = createStage(canvas)
if (stage.touch) document.body.classList.add('touch')
installInput(canvas, (dx, dy) => stage.orbit(dx, dy))
const hero = new Hero()
const mochi = new Mochi()
stage.scene.add(hero.object, mochi.object)
const combat = new Combat(stage.scene)
combat.camera = stage.camera
const vfx = new Vfx(stage.scene, stage.mobile)
vfx.resize(window.innerHeight)
combat.vfx = vfx
combat.sound = (cue, gain) => audio.sfx(cue, gain)
const landmarks = new Landmarks(stage.scene)
const talk = new TalkBox(base, (actions, choice, id) => talkDone(actions, choice, id))

function safeStore(): Storageish | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
const store = safeStore()
let game = new GameState()
/** title → intro → play; 'menu' freezes play under the quest log or ending card. */
let mode: 'title' | 'intro' | 'play' | 'menu' = 'title'
let zonePlaces: readonly Place[] = placesFor('meadow')
let saveClock = 0
let travelling = false
const talkTip = document.getElementById('talk-tip')
const talkBtn = document.getElementById('talk')
document.getElementById('dialog')?.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  talk.advance()
})
const clock = new Clock()
const raycaster = new Raycaster()
const ndc = new Vector2()
const aim = new Vector3(0, 1.1, 4)
let fireCd = 0
let mochiCd = 1
let frames = 0
let fpsTime = 0
let fps = 0
let showFps = true
const floats: { el: HTMLElement; life: number; y: number; at: Vector3 }[] = []

const hpFill = document.getElementById('hp-fill')
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

/** Dev-only close camera for checking the hand pose: __slice.view = { on: true, yaw, pitch, dist }. */
const view: { on: boolean; yaw: number; pitch: number; dist: number; height: number; aimYaw?: number; timeScale: number } = { timeScale: 1, on: false, yaw: 0, pitch: 12, dist: 2.4, height: 1.05 }
if (import.meta.env.DEV) Object.assign(window, { __slice: { hero, mochi, combat, stage, view, aim, landmarks, talk, vfx, audio, get game() { return game }, enterZone, travel, get mode() { return mode } } })

void bootGame()

async function bootGame(): Promise<void> {
  const saved = GameState.load(store)
  showTitle(base, false, { fresh: newGame, resume: () => resumeGame() })
  titleReady(false, '꿈을 입체로 모으는 중…')
  requestAnimationFrame(frame)
  const [byeolha, cat] = await Promise.all([
    hero.load(`${base}models/3d/byeolha_animated_mobile.glb`),
    mochi.load(`${base}models/3d/mochi_mobile.glb`),
    loadFoeModels(base),
    landmarks.load(base),
  ])
  combat.rebuildBodies()
  if (boot) boot.classList.add('hidden')
  showTitle(base, Boolean(saved), { fresh: newGame, resume: () => resumeGame() })
  titleReady(true, saved ? `저장된 꿈: ${zone3d(saved.zone).name} · Lv ${saved.save.level}` : '')
  if (note && (!byeolha || !cat)) {
    note.textContent = '메쉬 파일을 찾지 못해 임시 모습으로 보여 줄게. 카메라와 손맛은 그대로야.'
    note.classList.remove('hidden')
    window.setTimeout(() => note.classList.add('hidden'), 4200)
  }
  audio.start()
  combat.onKill = (foe) => {
    const zone = game.zone
    showResult(game.kill(foe.kind, foe.tags))
    for (const loot of killLoot(zone, foe.tags, foe.elite, Math.random())) combat.dropLoot(foe.object.position, loot)
    if (zone === 'meadow' && foe.tags.includes('tutorial')) toast('서쪽 별문이 반짝인다. 마을로 가 보자!', 'quest')
    if (foe.kind === 'bloom') toast('별문의 봉인이 풀렸다. 루나에게 돌아가자.', 'quest')
  }
  combat.onPickup = (item, amount, at) => {
    if (item === 'gold') {
      game.pickup('gold', amount)
      paintStats(game.save)
      return
    }
    showResult(game.pickup(item))
    float(item === 'toy_part' ? '+장난감 부품' : '+꿈가루', at.setY(1.2), item === 'toy_part' ? '#ffc890' : '#d7b8ff')
    audio.sfx('quest')
  }
}

function newGame(): void {
  audio.sfx('ui')
  game = new GameState()
  hideTitle()
  mode = 'intro'
  playIntro(base, () => beginPlay())
}

function resumeGame(): void {
  const saved = GameState.load(store)
  if (!saved) return
  audio.sfx('ui')
  game = saved
  hideTitle()
  document.body.classList.remove('menu')
  beginPlay()
}

function beginPlay(): void {
  mode = 'play'
  enterZone(game.zone, game.zone === 'meadow' || game.zone === 'village' ? PLAZA : PORTAL_ARRIVAL)
  if (!game.save.flags.metMochi) window.setTimeout(() => talk.start('mochi_meet'), 700)
}

/** Lay out one zone on the island: its foes, pickups, standing landmarks, light and name. */
function enterZone(id: ZoneId, at: { x: number; z: number } = PORTAL_ARRIVAL): void {
  const zone = zone3d(id)
  const tutorialDone = (game.save.quests.q_awaken?.counts.slime ?? 0) >= 1
  combat.setRoster(zone.foes.filter((f) => !(f.tags.includes('tutorial') && tutorialDone)))
  for (const p of zone.pickups) combat.dropLoot(new Vector3(p.x, 0, p.z), p.id as 'dream_dust' | 'toy_part', false)
  combat.rebuildBodies()
  zonePlaces = placesFor(id)
  combat.places = zonePlaces
  stage.setColliders(zonePlaces)
  landmarks.setZone(id)
  setMood(zone.mood)
  hero.revive()
  hero.object.position.set(at.x, 0, at.z)
  heroTracked = false
  stepTracked = false
  mochi.place(at.x + 0.8, at.z - 0.8)
  talk.close()
  const result = game.enter(id)
  if (id === 'village') hero.hp = hero.maxHp
  showResult(result)
  zoneBanner(zone.name, zone.bgm === 'battle' ? '괴물들이 꿈을 갉고 있어' : '평온한 꿈결')
  game.persist(store)
  if (id === 'altar' && !game.save.flags.bossIntro && combat.bossAwake) window.setTimeout(() => talk.start('boss_intro'), 900)
}

function travel(to: ZoneId): void {
  if (travelling) return
  travelling = true
  audio.sfx('windup', 0.7)
  void fadeThrough(() => enterZone(to, PORTAL_ARRIVAL)).then(() => {
    travelling = false
  })
}

const hemi = stage.scene.children.find((c): c is HemisphereLight => (c as HemisphereLight).isHemisphereLight)
function setMood(mood: { fog: number; sky: number; clear: number }): void {
  if (stage.scene.fog instanceof Fog) stage.scene.fog.color.set(mood.fog)
  hemi?.color.set(mood.sky)
  stage.renderer.setClearColor(new Color(mood.clear), 1)
}

function showResult(result: MutationResult): void {
  for (const text of result.toasts) {
    const quest = /완료!|새 기록|기록 달성|레벨/.test(text)
    toast(text, quest ? 'quest' : /\+|획득/.test(text) ? 'reward' : 'info')
  }
  if (result.questPop) audio.sfx('quest')
  paintTracker(game.tracker())
  paintStats(game.save)
}

/** A dialogue just ended: run its 2D actions on the save, then any portal hop or ending. */
function talkDone(actions: Action[], choice: TalkChoice | null, id: string | TalkDef): void {
  const out = game.run(actions)
  showResult(out.result)
  if (actions.some((a) => a.type === 'heal-full')) {
    hero.hp = hero.maxHp
    float('+기운', hero.object.position.clone().setY(1.7), '#b8f0c8')
    audio.sfx('heal')
  }
  if (out.openTinker) toast('총 재조정은 아직 2D 판 공방에서만 할 수 있어.', 'info')
  if (out.openShop) toast('포포 상점은 아직 2D 판에만 있어.', 'info')
  game.persist(store)
  if (out.openQuests) {
    mode = 'menu'
    openQuestLog(game.save, () => {
      mode = 'play'
    })
  }
  if (choice?.go) travel(choice.go as ZoneId)
  if (id === 'luna_bloom_done' && game.finished && !game.save.flags.ending) {
    game.save.flags.ending = true
    game.persist(store)
    mode = 'menu'
    window.setTimeout(() => showEnding(game.save, () => (mode = 'play')), 600)
  }
}

/** The portal's little menu, built from where the story lets her go. */
function gateTalk(): TalkDef {
  const dests = destinations(game.save, game.zone, combat.bossAwake)
  if (!dests.length) return { lines: [{ speaker: '모찌', portrait: 'mochi', text: gateLocked(game.zone) }] }
  return {
    lines: [{ speaker: '별문', portrait: 'prop_portal', text: '별빛 문이 일렁인다. 어디로 갈까?' }],
    choices: [...dests.map((d) => ({ text: d.label, go: d.to })), { text: '그만두기' }],
  }
}

function frame(): void {
  requestAnimationFrame(frame)
  const raw = Math.min(0.05, clock.getDelta())
  let dt = raw
  if (import.meta.env.DEV) dt *= view.timeScale
  if (combat.hitStop > 0) {
    combat.hitStop -= raw
    dt *= 0.08
  }
  if (mode !== 'play') {
    stage.render()
    return
  }
  game.save.playSeconds += raw
  saveClock += raw
  if (saveClock > 20) {
    saveClock = 0
    game.persist(store)
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
  const talking = talk.open
  const move = talking ? { x: 0, y: 0 } : axis()
  // Always relative to the live (smoothed) camera yaw, so A is screen-left after any orbit.
  const wish = cameraRelativeWish(move.x, move.y, stage.yaw)
  aimAt()
  fireCd = Math.max(0, fireCd - dt)
  const dash = consumeDash()
  if (dash && hero.alive && !talking) {
    audio.sfx('dash')
    vfx.dust(hero.object.position, 2.4)
    vfx.ring(hero.object.position.clone().setY(0.05), 0xffd0ea, 0.3, 1.2, 0.3, 0.5)
  }
  hero.update(dt, { wishX: wish.x, wishZ: wish.z, aim, firing: pad.fire && !talking, dash: dash && !talking, run: runningHeld() })
  {
    // Landmarks are solid; she slides round the house corner instead of walking through it.
    const p = hero.object.position
    const out = pushOutOfPlaces(p.x, p.z, 0.32, zonePlaces)
    p.x = out.x
    p.z = out.z
  }
  if (hero.dashing) ghost()
  if (pad.fire && !talking && fireCd <= 0 && hero.alive) {
    fireCd = 0.16
    const tip = hero.muzzle.getWorldPosition(new Vector3())
    const dir = aim.clone().sub(tip)
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
    combat.fire(tip, dir, 12, true, 0x9ad7ff, 16)
    vfx.burst(tip, 0xd7f4ff, { count: 3, speed: 1.4, up: 0.4, life: 0.14, size: 0.22, gravity: 0, drag: 8 })
    hero.recoil()
    audio.sfx('shoot_water')
  }
  const heroPos = hero.object.position
  mochiFollow(dt, heroPos)
  landmarks.update(dt, heroPos)
  const notes = combat.update(dt, heroPos, 0.7, (amount, from) => {
    const hurt = hero.hurt(amount, from)
    if (!hurt) return
    audio.sfx('hurt')
    hurtFlash()
    vfx.hit(heroPos.clone().setY(1.0), 0xff9eb8, true)
    combat.shake = Math.max(combat.shake, 0.07)
    float(`-${amount}`, heroPos.clone().setY(1.6), '#ff9eb8')
    if (!hero.alive) {
      audio.sfx('down')
      const { lost, home } = game.died()
      const text = document.getElementById('down-text')
      if (text) text.textContent = `별하가 잠시 눈을 감았다.${lost ? ` 골드 ${lost}을 흘렸어.` : ''} ${zone3d(home).name}에서 다시 일어나자.`
      game.persist(store)
      document.getElementById('down')?.classList.remove('hidden')
    }
  })
  for (const item of notes) {
    float(item.text, item.at, item.text.startsWith('+') ? '#ffe08a' : '#fffaf6')
    if (item.text.startsWith('+')) audio.sfx('coin')
    else audio.sfx('hit')
  }
  footsteps(dt, heroPos)
  audio.update(dt, threatNear(heroPos))
  vfx.update(dt)
  if (hpFill) hpFill.style.width = `${Math.max(0, (hero.hp / hero.maxHp) * 100)}%`
  const aimFlatX = aim.x - heroPos.x
  const aimFlatZ = aim.z - heroPos.z
  stage.follow(heroPos.x, heroPos.y, heroPos.z, aimFlatX, aimFlatZ, combat.shake)
  if (import.meta.env.DEV && view.on) inspectCamera(heroPos)
  // Tags are projected after the camera moved this frame, so they sit on the heads instead of trailing.
  stage.camera.updateMatrixWorld()
  updateTalk()
  paintMarkers()
  tickFloats(dt)
  stage.render()
}

const stepFrom = new Vector3()
let stepClock = 0
let stepTracked = false
/** Grass footfalls: a soft step and a puff of dust in time with her stride. */
function footsteps(dt: number, at: Vector3): void {
  if (!stepTracked) stepFrom.copy(at)
  stepTracked = true
  const speed = dt > 0 ? Math.hypot(at.x - stepFrom.x, at.z - stepFrom.z) / dt : 0
  stepFrom.copy(at)
  if (speed < 1.2 || !hero.alive || hero.dashing) {
    stepClock = Math.min(stepClock, 0.12)
    return
  }
  stepClock -= dt
  if (stepClock > 0) return
  stepClock = speed > 4.2 ? 0.26 : 0.34
  audio.sfx('step', speed > 4.2 ? 1.2 : 0.9)
  vfx.dust(at, speed > 4.2 ? 1 : 0.6)
}

/** Battle music while anything awake is close or striking. */
function threatNear(at: Vector3): boolean {
  return combat.foes.some((foe) => foe.alive && (foe.windup > 0 || foe.object.position.distanceTo(at) < (foe.kind === 'bloom' ? 9 : 6.5)))
}

const flashEl = document.getElementById('hurt-flash')
function hurtFlash(): void {
  if (!flashEl) return
  flashEl.classList.remove('on')
  void flashEl.offsetWidth
  flashEl.classList.add('on')
}

const tipAt = new Vector3()
function updateTalk(): void {
  const p = hero.object.position
  const near = hero.alive && !travelling ? nearestTalk(p.x, p.z, 2.4, zonePlaces) : null
  if (consumeTalk()) {
    if (talk.open) {
      talk.advance()
      audio.sfx('talk_next')
    } else if (near?.talk) {
      talk.start(near.talk === 'gate' ? gateTalk() : game.dialogueFor(near.talk))
      audio.sfx('talk_open')
    }
  }
  const showTip = Boolean(near && !talk.open)
  talkTip?.classList.toggle('hidden', !showTip)
  talkBtn?.classList.toggle('hidden', !near)
  if (!showTip || !near || !talkTip) return
  tipAt.set(near.x, TIP_HEIGHT[near.kind] ?? 2.2, near.z).project(stage.camera)
  talkTip.style.left = `${(tipAt.x * 0.5 + 0.5) * window.innerWidth}px`
  talkTip.style.top = `${(-tipAt.y * 0.5 + 0.5) * window.innerHeight}px`
  const verb = near.talk === 'gate' ? '별문' : near.talk === 'well' ? '우물' : near.talk === 'board' ? '게시판' : '대화'
  talkTip.textContent = stage.touch ? verb : `E ${verb}`
}

const TIP_HEIGHT: Partial<Record<Place['kind'], number>> = { kiki: 1.75, luna: 1.95, board: 1.95, portal: 2.6 }
const markAt = new Vector3()
/** Quest markers (! new errand, ? ready to report) over the villagers, like the 2D game. */
function paintMarkers(): void {
  for (const npc of ['kiki', 'luna'] as const) {
    const el = document.getElementById(`mk-${npc}`)
    if (!el) continue
    const who = landmarks.npcAt(npc)
    const mark = game.zone === 'village' && who ? game.marker(npc) : ''
    el.classList.toggle('hidden', !mark || talk.open)
    if (!mark || !who) continue
    markAt.set(who.place.x, who.place.height + 0.45, who.place.z).project(stage.camera)
    el.textContent = mark
    el.style.left = `${(markAt.x * 0.5 + 0.5) * window.innerWidth}px`
    el.style.top = `${(-markAt.y * 0.5 + 0.5) * window.innerHeight}px`
  }
}

function inspectCamera(at: Vector3): void {
  const yaw = hero.yaw + (view.yaw * Math.PI) / 180
  const pitch = (view.pitch * Math.PI) / 180
  const cam = stage.camera
  cam.position.set(at.x + Math.sin(yaw) * Math.cos(pitch) * view.dist, at.y + view.height + Math.sin(pitch) * view.dist, at.z + Math.cos(yaw) * Math.cos(pitch) * view.dist)
  cam.lookAt(at.x, at.y + view.height, at.z)
}

const aimHold = new Vector3()
let aimHeld = false
function aimAt(): void {
  // While right-dragging the view, keep her aim fixed in the world (relative to her), so the
  // camera swings round without her spinning to chase the cursor.
  if (pad.orbiting) {
    const p = hero.object.position
    if (!aimHeld) aimHold.set(aim.x - p.x, aim.y, aim.z - p.z)
    aimHeld = true
    aim.set(p.x + aimHold.x, aimHold.y, p.z + aimHold.z)
    return
  }
  aimHeld = false
  if (import.meta.env.DEV && view.on) {
    const p = hero.object.position
    const yaw = view.aimYaw ?? hero.yaw
    aim.set(p.x + Math.sin(yaw) * 5, 1.05, p.z + Math.cos(yaw) * 5)
    return
  }
  // Auto-aim only helps fingers. It used to key off stage.mobile, the low-power flag, which is
  // also on for weak desktop GPUs and short windows, so a mouse click snapped her aim (and the
  // camera lead) to the nearest foe.
  if (!pad.pointer || (pad.fire && pad.touchFire)) {
    const nearest = nearestFoe()
    if (nearest) {
      aim.set(nearest.object.position.x, 0.9, nearest.object.position.z)
      return
    }
  }
  ndc.x = (pad.px / window.innerWidth) * 2 - 1
  ndc.y = -(pad.py / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(ndc, stage.camera)
  // Low views put the cursor near (or above) the horizon: the hit is reined in to a sane reach
  // and, with no hit at all, the aim follows the ray's heading from her instead.
  const o = raycaster.ray.origin
  const d = raycaster.ray.direction
  const p = hero.object.position
  const hit = groundAim(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.z)
  aim.set(hit.x, 1.05, hit.z)
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

const lastHero = new Vector3()
let heroTracked = false
function mochiFollow(dt: number, heroPos: Vector3): void {
  if (!heroTracked) lastHero.copy(heroPos)
  heroTracked = true
  // Her real ground velocity, so Mochi trails where she travels rather than where she aims.
  const vx = dt > 0 ? (heroPos.x - lastHero.x) / dt : 0
  const vz = dt > 0 ? (heroPos.z - lastHero.z) / dt : 0
  lastHero.copy(heroPos)
  const cam = stage.camera.position
  mochi.update(dt, heroPos.x, heroPos.z, vx, vz, cam.x - heroPos.x, cam.z - heroPos.z, WALK_RADIUS)
  mochiCd -= dt
  const prey = nearestFoe()
  if (prey && mochiCd <= 0 && hero.alive) {
    mochiCd = 1.35
    const from = mochi.fishMuzzle.getWorldPosition(new Vector3())
    const dir = combat.centre(prey).sub(from)
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
  document.getElementById('down')?.classList.add('hidden')
  void fadeThrough(() => {
    enterZone(game.zone, PLAZA)
    hero.hp = hero.maxHp
  })
  audio.sfx('heal')
}

window.addEventListener('resize', () => {
  stage.resize()
  vfx.resize(window.innerHeight)
})
