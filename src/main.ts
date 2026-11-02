import { GunSound, type GunCue } from './audio/gunsound'
import '@fontsource/jua/400.css'
import '@fontsource/noto-sans-kr/400.css'
import './ui/style.css'
import { Clock, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three'
import { createStage } from './core/arena'
import { audio } from './audio/audio'
import { Combat } from './combat/combat'
import { loadFoeModels } from './combat/foes'
import { cameraColliders, type CameraCollider } from './core/camera'
import { FADE_FOCUS } from './core/materials'
import { Shooter, type ShotWorld } from './combat/shooter'
import { TPS, loadSens, rayCapsule, setSens, SENS, type AimTarget } from './core/tps'
import { WALK_RADIUS } from './world/town/island'
import { Hero } from './actors/hero'
import { autoRunOn, onAutoRun, setAutoRun, axis, clearQueued, consumeCandy, consumeDash, consumeMenu, consumeQuickEquip, consumeSkill, consumeTalk, installInput, pad, relockView, runningHeld, shoulder, syncCursor } from './core/input'
import { ALT_LABEL, cursor, installAlt, saveAltMode, setAlt } from './core/cursor'
import { aimZone, hudArena, installLayout, placePocket } from './ui/layout'
import { installTooltips } from './ui/tooltip'
import { Landmarks } from './world/town/landmarks'
import { Mochi } from './actors/mochi'
import { killLoot, GameState, type Storageish } from './core/loop'
import { nearestTalk, placesFor, pushOutOfPlaces, type Place } from './world/town/places'
import { fadeThrough, hideTitle, LEVELUP_MS, openQuestLog, paintStats, paintTracker, playIntro, playOnce, showEnding, showTitle, titleReady, toast, zoneBanner } from './ui/screens'
import { TalkBox, type TalkChoice, type TalkDef } from './ui/talk'
import { PLAZA, PORTAL_ARRIVAL, destinations, gateLocked, zone3d, type ZoneId } from './world/town/zones3d'
import { Color, Fog, HemisphereLight } from 'three'
import type { Action, MutationResult } from './sim/types'
import { Vfx } from './core/vfx'
import { HitStop } from './core/hitstop'
import { AUTO_RISE, LAST_GATE_KEY, QOL_KEY, autoSellPick, loadQol, rememberFirst, shouldAutoCandy, type QolPrefs } from './sim/qol'
import { DETAIL, Quality } from './core/quality'
import type { DungeonRun } from './world/dungeon/run'
import { Portal } from './world/dungeon/portal'
import { WaypointView } from './world/waypoint-view'
import { WAYPOINT_REACH, distanceText, goalForContract, goalForQuest, trailDots, type Waypoint, type WaypointGoal } from './sim/waypoint'
import { Delve, delveOf, fieldPlan, portalChoices, type DelveEnd, type DelveSummary, type FloorPlan } from './sim/delve'
import { floorStateLabel, type FloorState } from './sim/floorsnap'
import { showSummary } from './ui/summary'
import { playChime, type Chime } from './audio/chime'
import { blast, SkillRunner, type SkillBody, type SkillWorld } from './combat/skills'
import { applyProcs, chill, ELEMENTS, procBursts } from './combat/elements'
import { ACTIVES, TREE_BY_ID, hotbarName } from './data/tree'
import { GUN_PROFILES } from './data/guns'
import { rank } from './sim/skilltree'
import { computeStats, gainXp, type ComputedStats } from './sim/stats'
import { bossXp, killXp, nestXp, objectiveXp, townKillXp } from './sim/xp'
import { xpToNext } from './sim/formulas'
import { findItem } from './sim/inventory'
import { ilvText, itemName, makeItem } from './sim/loot'
import { skillSvg } from './ui/skillicons'
import { Help, keepHintItems } from './ui/help'
import { RARITY_COLOR, type ItemInstance } from './sim/types'
import { InventoryUI, compareEquip, dpsOf } from './ui/inventory'
import { TownUI, type TownPanel, type TownSuccess } from './ui/town'
import { activeContracts, contractEvent, contractLine, type ContractEvent } from './sim/contracts'
import { eatCandy, townOf, useScroll } from './sim/town'
import { tryEquip } from './sim/mutate'
import { isEquipped } from './sim/inventory'
import { CHAPTER2, CHAPTER_TITLE, FLUFF, chapter2Open, chaptersOf, fieldNeeds, guideEvent, guideStep, keepGuide, questEvent, questHud, skipGuide, type ChapterOut, type FieldEvent, type GuideEvent } from './sim/chapters'
import { ChapterUI } from './ui/chapters'
import { AREAS, MAZE_ELITE, RESCUE_NAME, dreamOf, mazeCleared, mazeEvent, mazeHud, mazeQuest, openAreas, passMaze, storyEvent, storyHud, storyTalk, wantsSparks, type AreaId, type DreamOut } from './sim/dreamstory'

const base = import.meta.env.BASE_URL
const canvas = document.querySelector('canvas')
if (!canvas) throw new Error('canvas missing')

const stage = createStage(canvas)
if (stage.touch) document.body.classList.add('touch')
/** Touch or a small window: the thumb layout (stick, action buttons, skill row above them). */
const compactHud = (): void => {
  const compact = stage.touch || window.innerWidth <= 900 || window.innerHeight <= 520
  document.body.classList.toggle('compact', compact)
  placePocket(compact)
}
installLayout(document.getElementById('ui'))
installTooltips()
compactHud()
window.addEventListener('resize', compactHud)
installInput(canvas)
const hero = new Hero()
const mochi = new Mochi()
stage.scene.add(hero.object, mochi.object)
const combat = new Combat(stage.scene)
combat.camera = stage.camera
const vfx = new Vfx(stage.scene, stage.mobile)
vfx.resize(window.innerHeight)
combat.vfx = vfx
/** World freeze on meaty hits, budgeted so rapid crits can never slow the game down. */
const hitStop = new HitStop()
/** Longest real frame the sim accepts (s); longer frames are hitches, not slow motion. */
const MAX_FRAME = 0.1
/** Largest single sim step in the dungeon (s); a long frame is split into ≤ 2 of these. */
const SIM_STEP = 0.05
const QUALITY_KEY = 'dnr.autoQuality'
const QUALITY_KO = ['높음', '보통', '낮음', '최저']
/** Adaptive quality: drops resolution / bloom / shadow refresh / sparks when FPS sags. */
const quality = new Quality((level) => {
  stage.setDetail(level)
  vfx.density = DETAIL[level].particles
})
quality.enabled = safeStore()?.getItem(QUALITY_KEY) !== '0'
/** 편의성 prefs (auto candy, auto-sell commons); saved apart from the game save, so they stick. */
const qol: QolPrefs = loadQol(safeStore()?.getItem(QOL_KEY), stage.touch)
function saveQol(): void {
  try {
    safeStore()?.setItem(QOL_KEY, JSON.stringify(qol))
  } catch {
    /* private mode */
  }
}
let autoCandyClock = 99
/** Low HP and a candy in the pocket: she eats one by herself (⚙ 자동 사탕). */
function autoCandy(raw: number): void {
  autoCandyClock += raw
  if (!hero.alive || !shouldAutoCandy(hero.hp, hero.maxHp, game.save.potions, autoCandyClock, qol)) return
  autoCandyClock = 0
  eatCandyNow()
  toast('체력이 낮아서 하트 사탕을 먹었어! (⚙ 자동 사탕)', 'info')
}
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
/** The sewer floor while she is down there; null on the island hub. */
let run: DungeonRun | null = null
/** The whole trip (floors, kills, run gold, loot) while she is down there. */
let delve: Delve | null = null
/** Boss of this trip beaten: the depth it opened (0 = none). Set the moment it falls. */
let delveUnlocked = -1
/**
 * 편의성: the floor she recalled from, left standing behind a return portal in the village
 * (this session only). Walking back in puts her on the same spot with the cleared foes gone.
 */
let parked: { run: DungeonRun; mod: typeof import('./world/dungeon/run'); depth: number; floor: number; salt: number; field: FloorPlan | null; area?: AreaId | null; areaFloor?: number } | null = null
/** Where the return portal stands in the village (beside the 별문). */
const RETURN_SPOT = { x: -7.6, z: 6.4 }
const returnPortal = new Portal(new Vector3(RETURN_SPOT.x, 0, RETURN_SPOT.z), 0xffc46b)
returnPortal.active = false
const RETURN_PLACE: Place = { kind: 'portal', x: RETURN_SPOT.x, z: RETURN_SPOT.z, turn: 0, height: 2.4, solid: 0, talk: 'return' }

/** The return portal stands only in the village while a floor is parked. */
/** The floor kept on disk (던전 유지 across a reload), when nothing is parked in memory. */
function savedFloor(): FloorState | null {
  return delveOf(game.save).floorState ?? null
}
/** Write (or clear) the kept floor in the save block. */
function keepFloor(s: FloorState | null): void {
  delveOf(game.save).floorState = s
}

/** "깊이 2 · 3층" / "몽실 들판" for the kept floor (in memory or on disk), or '' when none. */
function keptLabel(): string {
  if (parked) return parked.area ? `${AREAS[parked.area].name} · ${parked.areaFloor ?? 1}/${AREAS[parked.area].floors}층` : parked.field ? '몽실 들판' : `깊이 ${parked.depth} · ${parked.floor}층`
  const s = savedFloor()
  return s ? floorStateLabel(s) : ''
}

function paintReturnPortal(): void {
  const on = (!!parked || !!savedFloor()) && !run && game.zone === 'village'
  if (on && returnPortal.group.parent !== stage.scene) stage.scene.add(returnPortal.group)
  returnPortal.active = on
}

/** Throw the parked floor away (a new trip started, or it can no longer be reached). */
function dropParked(): void {
  keepFloor(null)
  if (parked) {
    parked.run.dispose()
    parked = null
  }
  paintReturnPortal()
}

/** Through the return portal: back onto the parked floor, same spot. */
function returnThrough(): void {
  if (run || travelling) return
  if (!parked) {
    const kept = savedFloor()
    if (kept) void returnFromSave(kept)
    return
  }
  const p = parked
  const trip = p.area ? Delve.reopenArea(game.save, p.area, p.areaFloor ?? 1, p.salt) : p.field ? Delve.reopenField(game.save, p.field, p.salt) : Delve.reopen(game.save, p.depth, p.floor, p.salt)
  if (!trip) {
    dropParked()
    return
  }
  travelling = true
  audio.sfx('windup', 0.7)
  void fadeThrough(() => {
    talk.close()
    combat.setRoster([])
    combat.places = []
    landmarks.group.visible = false
    const theme = p.mod.themeOf(trip.plan)
    stage.setWorld('sewer', p.mod.planFog(trip.plan))
    setMood({ fog: theme.fog, sky: theme.sky, clear: theme.fog })
    zonePlaces = []
    delve = trip
    delveUnlocked = -1
    hero.hp = hero.maxHp
    parked = null
    paintReturnPortal()
    run = p.run
    run.unpark()
    skills.reset()
    game.persist(store)
    document.body.classList.add('sewer')
    if (p.field) document.body.classList.add('field')
    showHint()
    if (trip.area === 'maze') placeMazeQuest(false)
    if (waypoint) refreshWaypoint(true)
  }).finally(() => {
    travelling = false
  })
}
/** After a reload: rebuild the kept floor from its seed, then put the saved state back onto it. */
async function returnFromSave(kept: FloorState): Promise<void> {
  const trip = kept.area ? Delve.reopenArea(game.save, kept.area, kept.areaFloor ?? 1, kept.salt) : kept.field ? Delve.reopenField(game.save, fieldPlan(kept.salt, kept.field), kept.salt) : Delve.reopen(game.save, kept.depth, kept.floor, kept.salt)
  if (!trip) {
    dropParked()
    return
  }
  travelling = true
  audio.sfx('windup', 0.7)
  const mod = await loadDungeon()
  await fadeThrough(() => {
    talk.close()
    combat.setRoster([])
    combat.places = []
    landmarks.group.visible = false
    const theme = mod.themeOf(trip.plan)
    stage.setWorld('sewer', mod.planFog(trip.plan))
    setMood({ fog: theme.fog, sky: theme.sky, clear: theme.fog })
    zonePlaces = []
    delve = trip
    delveUnlocked = -1
    hero.hp = hero.maxHp
    paintReturnPortal()
    buildFloor(mod, kept.seed ? { ...trip.plan, seed: kept.seed } : trip.plan)
    if (run && !run.restore(kept)) keepFloor(null)
    skills.reset()
    game.persist(store)
    document.body.classList.add('sewer')
    if (kept.field) document.body.classList.add('field')
    showHint()
    if (trip.area === 'maze') placeMazeQuest(false)
    if (waypoint) refreshWaypoint(true)
  }).finally(() => {
    travelling = false
  })
}

/** The sewer lives in its own chunk: fetched (with its horde art) while the title shows, awaited on entry. */
let dungeonModule: Promise<typeof import('./world/dungeon/run')> | null = null
/** The loaded dungeon module (parking a floor needs it to come back). */
let dungeonMod: typeof import('./world/dungeon/run') | null = null
function loadDungeon(): Promise<typeof import('./world/dungeon/run')> {
  dungeonModule ??= import('./world/dungeon/run').then((m) => {
    dungeonMod = m
    return m
  })
  return dungeonModule
}
const crosshair = document.getElementById('crosshair')
const help = new Help(document.getElementById('ui') ?? document.body)
const hint = document.getElementById('hint')
const TPS_HINT_MOUSE = '클릭: 시점 고정 · WASD 이동 · 클릭 사격 · Space 대시 · 1–4 스킬 · I 가방 · H 도움말'
const TPS_HINT_TOUCH = '왼쪽 스틱 이동 · 오른쪽 드래그 시점 · 공격 길게 눌러 연사 · 대시 · 사탕 버튼으로 회복'
/** Same controls everywhere now, so one hint; it fades after a few seconds like the sewer's. */
function showHint(): void {
  if (!hint) return
  const sewer = run ? (stage.touch ? ' · 귀환 버튼' : ' · M 지도 · T 귀환') : ''
  hint.textContent = keepHintItems((stage.touch ? TPS_HINT_TOUCH : TPS_HINT_MOUSE) + sewer)
  hint.classList.remove('fade')
  void hint.offsetWidth
  hint.classList.add('fade')
}
const talkTip = document.getElementById('talk-tip')
const talkBtn = document.getElementById('talk')
document.getElementById('dialog')?.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  talk.advance()
})
const clock = new Clock()
loadSens()
/** The one shoulder rig + water gun, shared by the town and the sewer (identical feel). */
const shooter = new Shooter(
  {
    camera: stage.camera,
    hero,
    vfx,
    hud: crosshair?.parentElement ?? null,
    sfx: (cue, gain) => audio.sfx(cue, gain),
    gun: (cue, gain, pitch) => gunSfx(cue, gain, pitch),
    lowPower: stage.mobile,
    hitStop: (seconds) => {
      hitStop.request(seconds)
    },
    heal: (hp) => {
      if (hero.alive) hero.hp = Math.min(hero.maxHp, hero.hp + hp)
    },
  },
  stage.scene,
)
const rig = shooter.rig
rig.autoAim = qol.autoAim
const aim = rig.aim
let townColliders: CameraCollider[] = []
const townTargets: AimTarget[] = []
let townFoes: ReturnType<typeof combat.shootable> = []
/** Ground, houses, trees and the portal are solid to the camera boom and the crosshair. */
function townRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  const len = Math.hypot(dx, dy, dz) || 1
  const ux = dx / len
  const uy = dy / len
  const uz = dz / len
  let best = max
  if (uy < -1e-6) {
    const t = (0.02 - oy) / uy
    if (t >= 0 && t < best) best = t
  }
  for (const c of townColliders) {
    const t = rayCapsule(ox, oy, oz, ux, uy, uz, c, best)
    if (t >= 0 && t < best) best = t
  }
  return best
}
const townWorld: ShotWorld = {
  solid: townRay,
  targets: () => {
    townFoes = combat.shootable()
    townTargets.length = 0
    for (const f of townFoes) townTargets.push(combat.capsule(f))
    return townTargets
  },
  bodies: () => townSkillWorld.bodies(),
  strike: (o, d, max, amount, procs) => {
    const hit = combat.raycast(o, d, max)
    if (!hit) return null
    const kill = combat.strikeFoe(hit.foe, amount, d)
    // Same element rules as the sewer: ice chills, candy goos, sparkle pops everyone nearby.
    const at = o.clone().addScaledVector(d, hit.t)
    // The bloom, like the sewer's nightmare flower, only takes the sparkle pop.
    if (!kill && hit.foe.kind !== 'bloom') procBursts(vfx, at, applyProcs(hit.foe, procs, amount))
    if (procs?.sparkle) {
      procBursts(vfx, at, { sparkle: true })
      const x = at.x
      const z = at.z
      queueMicrotask(() => blast(townSkillWorld.bodies(), x, z, ELEMENTS.sparkleRadius, amount * ELEMENTS.sparkleShare, 0, 0, (n, p, tone) => shooter.hudFx.number(n, p, tone)))
    }
    const tone = hit.foe.kind === 'bloom' ? 'boss' : hit.foe.elite ? 'elite' : 'n'
    return { t: hit.t, kill, tone, color: 0xffc6e8, floor: hit.foe.object.position.clone().setY(0.02), ref: hit.foe }
  },
  normal: (end, d) => {
    if (end.y < 0.1) return { x: 0, y: 1, z: 0 }
    let best: CameraCollider | null = null
    let gap = Infinity
    for (const c of townColliders) {
      if (end.y < c.y0 - 0.2 || end.y > c.y1 + 0.2) continue
      const g = Math.abs(Math.hypot(end.x - c.x, end.z - c.z) - c.r)
      if (g < gap) {
        gap = g
        best = c
      }
    }
    if (!best || gap > 0.5) return { x: -d.x, y: -d.y, z: -d.z }
    const nx = end.x - best.x
    const nz = end.z - best.z
    const l = Math.hypot(nx, nz) || 1
    return { x: nx / l, y: 0, z: nz / l }
  },
}
/** Town look: the shared rig, but not while a dialogue or the quest log is up. */
function armTown(): void {
  shoulder.on = true
  shoulder.look = (dx, dy, touch) => {
    if (mode === 'play' && !talk.open && !run && !menuUp()) rig.look(dx, dy, touch)
  }
}
/** Hand the mouse back (talk, quest log, down screen); a click on the world takes it again. */
function releaseLook(): void {
  if (document.pointerLockElement) document.exitPointerLock?.()
}
/** Her stats from level, gear and the tree; applyBuild() pushes them into the live hero and gun. */
let stats: ComputedStats = computeStats(game.save)
const skills = new SkillRunner({
  hero,
  mochi,
  vfx,
  shooter,
  parent: stage.scene,
  sfx: (cue, gain) => audio.sfx(cue, gain),
  gun: (cue, gain, pitch) => gunSfx(cue, gain, pitch),
  rank: (id) => rank(game.save, id),
  damageMul: () => stats.damageMul,
  armor: () => stats.armor,
  say: (text) => toast(text, 'info'),
})
const townBodies: SkillBody[] = []
/** Skill targets on the island: the awake foes of this zone. */
/** How far a flat ray from (ox, oz) travels before it leaves a circle of radius r round the plaza. */
function rimDistance(ox: number, oz: number, dx: number, dz: number, r: number, max: number): number {
  const l = Math.hypot(dx, dz)
  if (l < 1e-4) return max
  const ux = dx / l
  const uz = dz / l
  const b = ox * ux + oz * uz
  const c = ox * ox + oz * oz - r * r
  if (c >= 0) return b >= 0 ? 0 : max
  const t = -b + Math.sqrt(b * b - c)
  return Math.max(0, Math.min(max, t / l))
}
const townSkillWorld: SkillWorld = {
  // Landmarks and the island's rim both stop skills: Mochi's rush no longer runs off into the sea.
  solid: (ox, oy, oz, dx, dy, dz, max) => Math.min(townRay(ox, oy, oz, dx, dy, dz, max), rimDistance(ox, oz, dx, dz, WALK_RADIUS - 0.4, max)),
  bodies: () => {
    townBodies.length = 0
    for (const foe of combat.foes) {
      if (!foe.alive) continue
      const p = foe.object.position
      townBodies.push({
        id: foe.object.uuid,
        x: p.x,
        z: p.z,
        r: foe.kind === 'bloom' ? 1.4 : 0.55,
        tone: foe.kind === 'bloom' ? 'boss' : foe.elite ? 'elite' : 'n',
        hit: (amount, dx, dz, knock, slow) => {
          chill(foe, slow)
          return combat.strikeFoe(foe, amount, new Vector3(dx, 0, dz), 1 + knock)
        },
      })
    }
    return townBodies
  },
}
const skillWorld = (): SkillWorld | null => (run ? run.skillWorld : townSkillWorld)

function hexOf(css: string): number {
  return parseInt(css.replace('#', ''), 16)
}

/** Level, gear and tree → hero hp/speed/regen/armour, the gun's feel, model and tracer colour. */
function applyBuild(): void {
  const prevMax = hero.maxHp
  stats = computeStats(game.save)
  hero.maxHp = stats.maxHp
  if (stats.maxHp > prevMax && hero.alive) hero.hp = Math.min(stats.maxHp, hero.hp + (stats.maxHp - prevMax))
  hero.hp = Math.min(hero.hp, hero.maxHp)
  hero.speedMul = stats.moveMul
  hero.regenMul = stats.regenMul
  hero.regenDelay = stats.regenDelay
  hero.guard = stats.armor
  const look = GUN_PROFILES[stats.weaponKind].look
  const gunItem: ItemInstance | undefined = findItem(game.save, game.save.equipment.weapon)
  const gem = gunItem && gunItem.rarity !== 'common' ? hexOf(RARITY_COLOR[gunItem.rarity]) : null
  shooter.setLoadout({
    profile: stats.gun,
    damage: stats.shotDamage,
    critChance: stats.critChance,
    critMul: stats.critMul,
    pierce: stats.pierce,
    lifesteal: stats.lifesteal,
    sparkle: stats.sparkle,
    ice: stats.ice,
    candy: stats.candy,
    starShot: stats.starShot,
    cloud: stats.cloud,
    fireRate: stats.fireRate,
    tint: gem && gunItem && (gunItem.rarity === 'epic' || gunItem.rarity === 'legendary') ? gem : look.tracer,
  })
  hero.setGunLook(stats.weaponKind, look, gem)
  const worn = (slot: 'hat' | 'outfit' | 'shoes') => {
    const item = findItem(game.save, game.save.equipment[slot])
    return item ? { id: item.defId, rarity: item.rarity } : undefined
  }
  hero.setWear({ hat: worn('hat'), outfit: worn('outfit'), shoes: worn('shoes') })
  paintStats(game.save)
  paintXp()
}

const xpFill = document.getElementById('xp-fill')
const xpText = document.getElementById('xp-text')
function paintXp(): void {
  const s = game.save
  const cap = s.level >= 30
  const need = cap ? 1 : xpToNext(s.level)
  if (xpFill) xpFill.style.width = `${cap ? 100 : Math.min(100, (s.xp / need) * 100)}%`
  if (xpText) xpText.textContent = cap ? 'MAX' : `${s.xp}/${need}`
}

function chime(c: Chime): void {
  if (audio.master <= 0.001) return
  const a = audio.context()
  if (a) playChime(a.ctx, a.bus, c)
}

/** XP from a kill, nest, objective or boss (the trip's tally too); level-ups light her up. */
function giveXp(amount: number): void {
  if (amount <= 0) return
  if (delve) delve.xp += amount
  showResult(gainXp(game.save, amount))
  paintXp()
}

const levelEl = document.getElementById('levelup')
/** Ding! ring, sparkles, a jingle, a cute card and full health. */
function levelUpFx(): void {
  applyBuild()
  hero.hp = hero.maxHp
  const at = hero.object.position
  vfx.ring(at.clone().setY(0.06), 0xffe27a, 0.3, 3.2, 0.7, 0.9)
  vfx.ring(at.clone().setY(0.9), 0xffb8e6, 0.2, 2.2, 0.55, 0.7)
  vfx.poof(at.clone().setY(1.3), 0xfff0a8, 1.8)
  vfx.burst(at.clone().setY(1.2), 0xffe27a, { count: 26, speed: 4, up: 3.5, life: 0.9, size: 0.16, gravity: 3, drag: 1.6, additive: true })
  chime('levelup')
  if (levelEl) {
    levelEl.innerHTML = `<b>레벨 업!</b><span>Lv ${game.save.level} · 스킬 포인트 +1</span><small>K 키로 스킬 나무를 열어 봐</small>`
    playOnce(levelEl, LEVELUP_MS)
  }
}

const inventory = new InventoryUI({
  save: () => game.save,
  inTown: () => !run || inMongsil(),
  changed: () => {
    applyBuild()
    game.persist(store)
  },
  toast: (text) => toast(text, 'info'),
  sfx: (cue) => audio.sfx(cue),
  // The bag pauses the sewer (foes everywhere) but not the island: in town the world keeps
  // living (NPCs, Mochi, water, lanterns) while Byeolha stands still; zone foes hold their ground.
  opened: () => {
    bagPaused = Boolean(run)
    if (bagPaused) mode = 'menu'
    pad.fire = false
    releaseLook()
    document.body.classList.add('bag-open')
  },
  closed: () => {
    if (bagPaused && mode === 'menu') mode = 'play'
    bagPaused = false
    clearQueued()
    document.body.classList.remove('bag-open')
    paintHotbar()
    paintCandy()
  },
})
let bagPaused = false

const townUI = new TownUI({
  save: () => game.save,
  changed: () => {
    applyBuild()
    game.persist(store)
    paintStats(game.save)
    paintContracts()
    paintCandy()
  },
  toast: (text) => toast(text, 'info'),
  sfx: (cue) => audio.sfx(cue),
  success: (kind, item) => townSuccess(kind, item),
  openStory: () => {
    mode = 'menu'
    releaseLook()
    openQuestLog(game.save, () => {
      mode = 'play'
    })
  },
  opened: () => {
    pad.fire = false
    releaseLook()
    talk.close()
    // 몽실 마을 is a run world: the panel holds its frame (the stalls wait for her).
    if (inMongsil() && mode === 'play') mode = 'menu'
    document.body.classList.add('bag-open')
  },
  closed: () => {
    if (inMongsil() && mode === 'menu') mode = 'play'
    clearQueued()
    document.body.classList.remove('bag-open')
    paintHotbar()
    paintContracts()
  },
  viewed: (panel) => {
    if (panel === 'shop' || panel === 'workshop' || panel === 'board') guideHit({ type: panel })
  },
  chapterClaimed: (result, cleared) => {
    showResult(result)
    if (cleared) queueClearCard()
  },
})

/** Any town panel or the bag is up (she stands still; the island keeps living). */
function menuUp(): boolean {
  return inventory.isOpen || townUI.isOpen || help.isOpen
}

function openTown(panel: TownPanel): void {
  if ((run && !inMongsil()) || inventory.isOpen) return
  townUI.open(panel)
}

/** The little fanfare when a town job goes well. */
function townSuccess(kind: TownSuccess, item?: ItemInstance): void {
  const at = hero.object.position.clone().setY(1.3)
  const card = document.querySelector('#town .town-card')
  if (card && kind !== 'take' && kind !== 'stash') {
    card.classList.remove('flash')
    void (card as HTMLElement).offsetWidth
    card.classList.add('flash')
  }
  if (kind === 'upgrade') {
    chime('forge')
    audio.sfx('coin')
    vfx.ring(hero.object.position.clone().setY(0.06), 0xffd66b, 0.3, 2.4, 0.5)
    vfx.burst(at, 0xffe9a0, { count: 26, speed: 3.4, up: 2.4, life: 0.7, size: 0.14, gravity: 2, drag: 1.6, additive: true })
    if (item) float(`+${item.plus ?? 0} 강화 성공!`, at.clone().setY(1.9), '#ffe08a')
  } else if (kind === 'reroll' || kind === 'element') {
    chime('reroll')
    vfx.burst(at, kind === 'element' ? 0x9fdcff : 0xd7b8ff, { count: 18, speed: 2.6, up: 1.8, life: 0.6, size: 0.12, gravity: 1.5, drag: 1.8, additive: true })
  } else if (kind === 'claim') {
    chime('contract')
    audio.sfx('coin')
    vfx.burst(at, 0xffd66b, { count: 22, speed: 3, up: 2.2, life: 0.7, size: 0.13, gravity: 2.5, drag: 1.6, additive: true })
    paintTracker(game.tracker())
  } else if (kind === 'buy' || kind === 'sell') audio.sfx('coin')
  else audio.sfx(kind === 'take' ? 'quest' : 'ui')
}

const contractHud = document.getElementById('contract-hud')
/** 편의성: the tracked quest's waypoint (glowing trail on the ground, minimap pin, distance chip). */
let waypoint: Waypoint | null = null
const waypointView = new WaypointView()
waypointView.attach(stage.scene)
const wpChip = document.getElementById('waypoint')
let wpGoal: { x: number; z: number } | null = null
let wpLine: { x: number; z: number }[] = []
let wpClock = 0
let wpTile = ''

/** Track (or untrack, on a second click) one tracker row. */
function setWaypoint(next: Waypoint | null): void {
  waypoint = next
  wpClock = 0
  wpTile = ''
  if (!next) {
    wpGoal = null
    wpLine = []
    waypointView.hide()
    run?.showWaypoint(null)
    wpChip?.classList.add('hidden')
    paintContracts()
    return
  }
  refreshWaypoint(true)
  paintContracts()
}

/** The tracker row → a waypoint (chapter-2 quests and board contracts). */
function waypointFor(id: string): Waypoint | null {
  const quest = CHAPTER2.find((d) => d.id === id)
  if (quest) {
    const row = questHud(game.save).find((q) => q.id === id)
    return { id, label: quest.title, goal: goalForQuest(quest.kind, quest.target, !!row?.done, !!run) }
  }
  const c = activeContracts(game.save).find((k) => k.id === id)
  if (!c) return null
  return { id, label: `의뢰 · ${contractLine(c).replace(/ (\d|완료).*$/, '')}`, goal: goalForContract(c.kind, c.status === 'done', !!run) }
}

/** Where a goal sits in the town (the board, the 별문, or the return portal). */
function townGoal(goal: WaypointGoal): { x: number; z: number } | null {
  if (goal.kind === 'return' || (goal.kind === 'gate' && returnPortal.active)) return returnPortal.active ? RETURN_SPOT : null
  const want = goal.kind === 'board' ? 'board' : 'portal'
  const spot = zonePlaces.find((p) => p.kind === want) ?? zonePlaces.find((p) => p.kind === 'portal')
  return spot ? { x: spot.x, z: spot.z } : null
}

/** Re-aim the waypoint (a few times a second, or when she steps onto a new tile). */
function refreshWaypoint(force = false): void {
  if (!waypoint) return
  const p = hero.object.position
  // A quest that changed state (done → back to the board) re-targets itself.
  const fresh = waypointFor(waypoint.id)
  if (!fresh) {
    // The quest was handed in (or dropped): nothing left to walk to.
    setWaypoint(null)
    return
  }
  waypoint = fresh
  if (run) {
    const g = waypoint.goal.kind === 'board' || waypoint.goal.kind === 'gate' || waypoint.goal.kind === 'return' ? ({ kind: 'exit' } as const) : waypoint.goal
    wpGoal = run.goalPoint(g, p.x, p.z)
    const tile = `${Math.round(p.x / 2)},${Math.round(p.z / 2)}`
    if (wpGoal && (force || tile !== wpTile || wpLine.length < 2)) {
      wpTile = tile
      const way = run.waypointRoute(p.x, p.z, wpGoal)
      wpLine = way.line
      run.showWaypoint(wpGoal, way.tiles)
    } else if (wpGoal) run.showWaypoint(wpGoal)
    else run.showWaypoint(null)
  } else {
    wpGoal = townGoal(waypoint.goal)
    wpLine = wpGoal ? [{ x: p.x, z: p.z }, wpGoal] : []
  }
  paintWaypointChip()
}

function waypointDistance(): number {
  if (wpLine.length < 2) return wpGoal ? Math.hypot(wpGoal.x - hero.object.position.x, wpGoal.z - hero.object.position.z) : 0
  let d = 0
  for (let i = 1; i < wpLine.length; i++) d += Math.hypot(wpLine[i]!.x - wpLine[i - 1]!.x, wpLine[i]!.z - wpLine[i - 1]!.z)
  return d
}

function paintWaypointChip(): void {
  if (!wpChip) return
  const on = !!waypoint && mode === 'play'
  wpChip.classList.toggle('hidden', !on)
  if (!on || !waypoint) return
  const label = wpChip.querySelector('span')
  const text = `${waypoint.label} · ${wpGoal ? distanceText(waypointDistance()) : '—'}`
  if (label && label.textContent !== text) label.textContent = text
}

/** Per frame: follow her with the trail head, pulse the dots, clear on arrival. */
function waypointFrame(dt: number): void {
  if (!waypoint) return
  wpClock -= dt
  if (wpClock <= 0) {
    wpClock = 0.25
    refreshWaypoint()
  }
  const p = hero.object.position
  if (wpLine.length >= 2) wpLine[0] = { x: p.x, z: p.z }
  if (wpGoal && Math.hypot(wpGoal.x - p.x, wpGoal.z - p.z) < WAYPOINT_REACH) {
    toast(`도착! ${waypoint.label}`, 'quest')
    setWaypoint(null)
    return
  }
  const time = performance.now() / 1000
  waypointView.show(wpGoal ? trailDots(wpLine, 1.4, 16, (time * 1.8) % 1.4) : [], wpGoal, time)
}
/** Taken contracts in the HUD (town and sewer). */
function paintContracts(): void {
  if (!contractHud) return
  const list = mode === 'title' ? [] : activeContracts(game.save)
  const dream = mode === 'title' ? [] : [mazeHud(game.save), storyHud(game.save)].filter((r): r is { title: string; prog: string; done?: boolean } => !!r)
  const chapter = mode === 'title' ? [] : questHud(game.save)
  contractHud.classList.toggle('hidden', list.length + chapter.length + dream.length === 0)
  contractHud.innerHTML = ''
  // Small screens fold the rows into one chip; a tap (or click) opens them.
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.id = 'quest-chip'
  const doneCount = chapter.filter((q) => q.done).length + list.filter((c) => c.status === 'done').length
  chip.textContent = `퀘스트 ${list.length + chapter.length + dream.length}${doneCount ? ` · 완료 ${doneCount}` : ''} ${contractHud.classList.contains('open') ? '▴' : '▾'}`
  chip.setAttribute('aria-expanded', String(contractHud.classList.contains('open')))
  contractHud.append(chip)
  for (const q of dream) {
    const row = document.createElement('div')
    row.className = q.done ? 'ch story done' : 'ch story'
    row.dataset.tip = `챕터 2 · ${CHAPTER_TITLE[2]}\n${q.title}\n${q.prog}`
    const b = document.createElement('b')
    b.textContent = '이야기'
    row.append(b, document.createTextNode(`${q.title.replace(/^이야기 · /, '')} · ${q.prog}`))
    contractHud.append(row)
  }
  for (const q of chapter) {
    const row = document.createElement('div')
    row.className = (q.done ? 'ch done' : 'ch') + (waypoint?.id === q.id ? ' wp' : '')
    row.dataset.id = q.id
    row.dataset.tip = `챕터 2 · ${q.title}\n진행 ${q.prog}${q.done ? '\n완료! 마을 게시판에서 보상을 받아.' : ''}\n${waypoint?.id === q.id ? '다시 누르면 길 안내 끄기' : '눌러서 길 안내'}`
    const b = document.createElement('b')
    b.textContent = '챕터 2'
    row.append(b, document.createTextNode(`${q.title} ${q.prog}`))
    contractHud.append(row)
  }
  for (const c of list) {
    const row = document.createElement('div')
    row.className = (c.status === 'done' ? 'done' : '') + (waypoint?.id === c.id ? ' wp' : '')
    row.dataset.id = c.id
    row.dataset.tip = `의뢰\n${contractLine(c)}\n${waypoint?.id === c.id ? '다시 누르면 길 안내 끄기' : '눌러서 길 안내'}`
    const b = document.createElement('b')
    b.textContent = '의뢰'
    row.append(b, document.createTextNode(contractLine(c)))
    contractHud.append(row)
  }
}

/** Push a sewer happening into the taken contracts; cheer for any it finishes. */
function contractHit(e: ContractEvent): void {
  const done = contractEvent(game.save, e)
  for (const _ of done) {
    toast('의뢰 완료! 마을 게시판에서 보상을 받아.', 'quest')
    chime('contract')
  }
  paintContracts()
}

// ---- 챕터: the guide chapter and the 몽실 들판 quests ----
const chapterUI = new ChapterUI(document.getElementById('ui') ?? document.body)
/** A chapter-clear card waits for the next calm moment (no summary or dialogue up). */
let clearPending = false

function chapterOut(o: ChapterOut): void {
  if (o.say) chapterUI.say(o.say.who, o.say.text)
  if (o.gift === 'candy') {
    paintCandy()
    toast('모찌가 하트 사탕을 챙겨 줬어!', 'reward')
  } else if (o.gift === 'gear') {
    const item = game.save.items[game.save.items.length - 1]
    if (item) lootPing(item)
  }
  for (const t of o.toasts) {
    toast(t, 'quest')
    chime('contract')
  }
  if (o.advanced >= 0) audio.sfx('quest')
  if (o.cleared) queueClearCard()
  if (o.advanced >= 0 || o.cleared) paintContracts()
  if (o.advanced >= 0 || o.cleared || o.toasts.length) game.persist(store)
}

/** Something the guide chapter may be waiting for. */
function guideHit(e: GuideEvent): void {
  if (mode === 'title' || !guideStep(game.save)) return
  chapterOut(guideEvent(game.save, e))
}

/** A 몽실 들판 happening for the active chapter quests. */
function questHit(e: FieldEvent): void {
  chapterOut(questEvent(game.save, e))
  paintContracts()
}

function queueClearCard(): void {
  clearPending = true
  window.setTimeout(showClearCard, 1200)
}

function showClearCard(): void {
  const c = chaptersOf(game.save)
  if (!clearPending || !c.card) return
  if (mode !== 'play' || (run && !inMongsil()) || travelling || talk.open || menuUp()) {
    window.setTimeout(showClearCard, 800)
    return
  }
  clearPending = false
  const n = c.card
  c.card = 0
  game.persist(store)
  mode = 'menu'
  releaseLook()
  chime('contract')
  levelUpFx()
  void chapterUI.clearCard(n).then(() => {
    mode = 'play'
    paintContracts()
  })
}

/** Existing players: offer the skip once. */
function offerSkip(): void {
  const c = chaptersOf(game.save)
  if (!c.offerSkip || c.guide.done) return
  if (mode !== 'play' || talk.open || menuUp() || run) {
    window.setTimeout(offerSkip, 800)
    return
  }
  mode = 'menu'
  releaseLook()
  void chapterUI.skipCard().then((skip) => {
    if (skip) {
      skipGuide(game.save)
      toast('가이드를 건너뛰었어. 게시판에서 챕터 2 퀘스트를 받아 봐!', 'quest')
    } else {
      keepGuide(game.save)
      const step = guideStep(game.save)
      if (step) chapterUI.say(step.say.who, step.say.text)
    }
    game.persist(store)
    paintContracts()
    mode = 'play'
  })
}

/** Watch for the guide's body steps (walk, fire, dash, gear) every play frame. */
let guideLast: { x: number; z: number } | null = null
let guideFired = 0
let guideDashing = false
let guideGear = ''
/** Last time she fired or foes chased her: the guide stays folded through a fight and a moment after. */
let fightAt = -1e9
let fightFired = 0
function inFight(now: number): boolean {
  if (shooter.fired !== fightFired) {
    fightFired = shooter.fired
    fightAt = now
  }
  if (run?.inCombat()) fightAt = now
  return now - fightAt < 2500
}
function chapterTick(): void {
  const step = mode === 'play' ? guideStep(game.save) : null
  const now = performance.now()
  chapterUI.paint(game.save, stage.touch, !!step && !travelling, inFight(now), now)
  if (!step) return
  const p = hero.object.position
  if (step.id === 'move' && guideLast) {
    const d = Math.hypot(p.x - guideLast.x, p.z - guideLast.z)
    if (d > 0.01 && d < 2) guideTally += d
    if (guideTally >= 1) {
      guideHit({ type: 'move', amount: Math.floor(guideTally) })
      guideTally -= Math.floor(guideTally)
    }
  }
  guideLast = { x: p.x, z: p.z }
  if (shooter.fired < guideFired) guideFired = shooter.fired
  if (shooter.fired > guideFired) {
    if (step.id === 'shoot') guideHit({ type: 'shoot', amount: shooter.fired - guideFired })
    guideFired = shooter.fired
  }
  if (hero.dashing && !guideDashing) guideHit({ type: 'dash' })
  guideDashing = hero.dashing
  const gear = JSON.stringify(game.save.equipment)
  if (step.id === 'equip' && guideGear && gear !== guideGear) guideHit({ type: 'equip' })
  guideGear = gear
}
let guideTally = 0

/** Through the portal to the 몽실 들판 (챕터 2 quest hunting). */
function enterField(): void {
  if ((run && !inMongsil()) || travelling) return
  if (!chapter2Open(game.save)) {
    toast('가이드 챕터를 마치면 열리는 들판이야.', 'info')
    return
  }
  if (!inMongsil()) dropParked()
  travelling = true
  audio.sfx('windup', 0.7)
  const trip = Delve.field(game.save, fieldNeeds(game.save))
  void loadDungeon().then((mod) => fadeThrough(() => {
    dropTown()
    talk.close()
    combat.setRoster([])
    combat.places = []
    landmarks.group.visible = false
    const theme = mod.themeFor(1)
    // Open sky: the fog sits far back so the packs read across the field.
    stage.setWorld('sewer', { ...mod.themeFog(1), near: 14, far: 62 })
    setMood({ fog: theme.fog, sky: theme.sky, clear: theme.fog })
    zonePlaces = []
    delve = trip
    delveUnlocked = -1
    hero.hp = hero.maxHp
    game.persist(store)
    buildFloor(mod, trip.plan)
    document.body.classList.add('sewer', 'field')
    showHint()
  }))
    .catch(() => toast('들판으로 가는 길을 불러오지 못했어. 잠시 뒤 다시 해 줘.', 'info'))
    .finally(() => {
      travelling = false
    })
}

const candyBtn = document.getElementById('candy')
const candyCount = document.getElementById('candy-count')
function paintCandy(): void {
  if (candyCount) candyCount.textContent = ` ${game.save.potions}`
  candyBtn?.classList.toggle('empty', game.save.potions <= 0)
}

/** Q / 사탕: a heart candy from the pocket. */
function eatCandyNow(): void {
  if (!hero.alive) return
  const r = eatCandy(game.save, hero.hp, hero.maxHp)
  if (!r.ok || !r.heal) {
    toast(r.reason ?? '지금은 못 먹어.', 'info')
    return
  }
  hero.hp = Math.min(hero.maxHp, hero.hp + r.heal)
  guideHit({ type: 'candy' })
  const at = hero.object.position.clone().setY(1.5)
  float(`+${r.heal}`, at, '#ffb8d6')
  vfx.burst(at, 0xff9fd2, { count: 12, speed: 1.6, up: 1.8, life: 0.6, size: 0.14, gravity: -0.5, drag: 1.6 })
  audio.sfx('heal')
  paintCandy()
  game.persist(store)
}

/** The newest gear pickup (G / the toast's 장착 button wears it). */
let lastPickup: string | null = null
function quickEquip(uid: string | null = lastPickup): void {
  if (!uid || mode !== 'play' || talk.open) return
  const item = findItem(game.save, uid)
  if (!item) return
  if (isEquipped(game.save, uid)) {
    toast('이미 장착했어.', 'info')
    return
  }
  const r = tryEquip(game.save, uid)
  if (!r.ok) {
    toast(r.reason ?? '장착할 수 없어.', 'info')
    return
  }
  applyBuild()
  game.persist(store)
  audio.sfx('ui')
  toast(`${itemName(item)} 장착!`, 'reward')
  if (lastPickup === uid) lastPickup = null
  document.querySelectorAll(`.loot-toast[data-uid="${uid}"] .quick`).forEach((b) => b.remove())
}

const hotbar = document.getElementById('hotbar')
const hotSlots = hotbar ? [...hotbar.querySelectorAll<HTMLElement>('[data-slot]')] : []
/** Keys 1–4: glyph, name, and a cooldown veil sliding down. */
function paintHotbar(): void {
  ACTIVES.forEach((id, i) => {
    const el = hotSlots[i]
    if (!el) return
    const def = TREE_BY_ID[id]
    const r = rank(game.save, id)
    el.classList.toggle('locked', r <= 0)
    const ready = skills.readiness(id)
    el.classList.toggle('cooling', ready > 0)
    const glyph = el.querySelector('i')
    if (glyph && glyph.dataset.skill !== id) {
      glyph.dataset.skill = id
      glyph.innerHTML = skillSvg(id)
    }
    const name = el.querySelector('b')
    const label = hotbarName(def)
    if (name && name.textContent !== label) name.textContent = label
    const veil = el.querySelector('s') as HTMLElement | null
    if (veil) veil.style.height = `${Math.round(ready * 100)}%`
    const tip = r > 0 ? `${def.name} [${i + 1}]\n${def.text(r)}${def.cooldown ? `\n대기 ${def.cooldown(r)}초` : ''}${ready > 0 ? '\n충전 중…' : ''}` : `${def.name}\n아직 안 배웠어. K 스킬 나무에서 배울 수 있어.`
    if (el.dataset.tip !== tip) el.dataset.tip = tip
    el.removeAttribute('title')
  })
}

/** 1–4 and I / Tab / K while playing. */
function handleKeys(): void {
  const menu = consumeMenu()
  if (menu && (mode === 'play' || inventory.isOpen) && !talk.open && !travelling && !townUI.isOpen) inventory.toggle(menu)
  if (mode !== 'play') {
    clearQueued()
    return
  }
  if (consumeCandy() && !menuUp() && !travelling) eatCandyNow()
  if (consumeQuickEquip() && !menuUp() && !travelling) quickEquip()
  for (let slot = consumeSkill(); slot >= 0; slot = consumeSkill()) {
    if (talk.open || travelling || menuUp()) continue
    const id = ACTIVES[slot]
    if (id && skills.use(id, skillWorld())) {
      chime('skill')
      guideHit({ type: 'skill' })
    }
  }
}

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
const sens = document.getElementById('sens') as HTMLInputElement | null
const sensOut = document.getElementById('sens-out')
if (sens) sens.value = String(SENS.value)
if (sensOut) sensOut.textContent = SENS.value.toFixed(2)
sens?.addEventListener('input', () => {
  const v = setSens(Number(sens.value))
  if (sensOut) sensOut.textContent = v.toFixed(2)
})
const vol = document.getElementById('vol') as HTMLInputElement | null
if (vol) vol.value = String(Math.round(audio.master * 100))
vol?.addEventListener('input', () => {
  audio.setMaster(Number(vol.value) / 100)
  audio.sfx('ui')
})
const bgm = document.getElementById('bgm') as HTMLInputElement | null
if (bgm) bgm.value = String(Math.round(audio.bgm * 100))
bgm?.addEventListener('input', () => audio.setBgm(Number(bgm.value) / 100))
document.getElementById('mute')?.addEventListener('click', () => {
  audio.setMaster(audio.master > 0.01 ? 0 : 0.35)
  if (vol) vol.value = String(Math.round(audio.master * 100))
})
const gear = document.getElementById('gear')
const settings = document.getElementById('settings')
const showSettings = (on: boolean): void => {
  settings?.classList.toggle('hidden', !on)
  gear?.setAttribute('aria-expanded', String(on))
}
gear?.addEventListener('click', () => showSettings(settings?.classList.contains('hidden') ?? false))
canvas.addEventListener('pointerdown', () => showSettings(false))
document.getElementById('fps-toggle')?.addEventListener('click', () => {
  showFps = !showFps
  fpsEl?.classList.toggle('hidden', !showFps)
})
const qualityBtn = document.getElementById('auto-quality')
const paintQuality = () => {
  if (qualityBtn) {
    qualityBtn.textContent = quality.enabled ? '자동 품질: 켬' : '자동 품질: 끔'
    qualityBtn.setAttribute('aria-pressed', String(quality.enabled))
  }
}
paintQuality()
const autoCandyBtn = document.getElementById('auto-candy')
const autoSellBtn = document.getElementById('auto-sell')
const autoAimBtn = document.getElementById('auto-aim')
const paintQol = () => {
  if (autoAimBtn) {
    autoAimBtn.textContent = `자동 조준: ${qol.autoAim ? '켬' : '끔'}`
    autoAimBtn.setAttribute('aria-pressed', String(qol.autoAim))
  }
  if (autoCandyBtn) {
    autoCandyBtn.textContent = `자동 사탕: ${qol.autoCandy ? `켬 (${Math.round(qol.autoCandyAt * 100)}%)` : '끔'}`
    autoCandyBtn.setAttribute('aria-pressed', String(qol.autoCandy))
  }
  if (autoSellBtn) {
    autoSellBtn.textContent = `일반 자동 판매: ${qol.autoSellCommon ? '켬' : '끔'}`
    autoSellBtn.setAttribute('aria-pressed', String(qol.autoSellCommon))
  }
}
paintQol()
autoCandyBtn?.addEventListener('click', () => {
  qol.autoCandy = !qol.autoCandy
  saveQol()
  paintQol()
  audio.sfx('ui')
})
autoAimBtn?.addEventListener('click', () => {
  qol.autoAim = !qol.autoAim
  rig.autoAim = qol.autoAim
  saveQol()
  paintQol()
  audio.sfx('ui')
  toast(qol.autoAim ? '자동 조준: 조준선 근처 가장 가까운 괴물에게 착 붙어.' : '자동 조준을 껐어 (살짝 끌리는 보정만 남아).', 'info')
})
onAutoRun((on) => {
  document.body.classList.toggle('autorun', on)
  if (mode === 'play') toast(on ? `자동 달리기 켜짐 · ${stage.touch ? '스틱을 움직이면' : 'WASD를 누르면'} 멈춰` : '자동 달리기 꺼짐', 'info')
})
autoSellBtn?.addEventListener('click', () => {
  qol.autoSellCommon = !qol.autoSellCommon
  saveQol()
  paintQol()
  audio.sfx('ui')
  if (qol.autoSellCommon) toast('던전에서 주운 일반 장비는 (더 좋은 게 아니면) 바로 골드가 돼.', 'info')
})
qualityBtn?.addEventListener('click', () => {
  quality.setEnabled(!quality.enabled)
  try {
    safeStore()?.setItem(QUALITY_KEY, quality.enabled ? '1' : '0')
  } catch {
    /* private mode */
  }
  paintQuality()
})
const altBtn = document.getElementById('alt-mode')
const paintAlt = () => {
  if (altBtn) altBtn.textContent = ALT_LABEL[cursor.mode]
}
paintAlt()
altBtn?.addEventListener('click', () => {
  cursor.mode = cursor.mode === 'hold' ? 'toggle' : 'hold'
  setAlt(false)
  saveAltMode(cursor.mode)
  paintAlt()
  toast(cursor.mode === 'hold' ? 'Alt를 누르는 동안 마우스 커서가 나와.' : 'Alt를 한 번 누르면 커서가 나오고, 다시 누르면 들어가.', 'info')
})
const relockBtn = document.getElementById('relock')
relockBtn?.addEventListener('click', () => relockView())
const shown = (id: string) => {
  const el = document.getElementById(id)
  return !!el && !el.classList.contains('hidden')
}
/** Any panel up frees the mouse cursor (and Alt does, see core/cursor). */
cursor.panel = () =>
  menuUp() || talk.open || shown('settings') || shown('summary') || shown('quest-log') || shown('ending') || shown('down') || !!document.querySelector('.chapter-card') || !!run?.minimap.big
let altTold = false
installAlt((free) => {
  document.body.classList.toggle('alt-free', free)
  if (free && !altTold && mode === 'play') {
    altTold = true
    toast(cursor.mode === 'hold' ? 'Alt를 떼면 다시 조준해.' : 'Alt를 다시 누르거나 화면을 클릭하면 조준해.', 'info')
  }
})
contractHud?.addEventListener('click', (event) => {
  const t = event.target as HTMLElement
  if (t.id === 'quest-chip') {
    contractHud?.classList.toggle('open')
    paintContracts()
    return
  }
  const row = t.closest<HTMLElement>('#contract-hud > div')
  if (!row?.dataset.id || mode !== 'play') return
  // 편의성: a click tracks the quest (trail on the ground, minimap pin, distance); again clears it.
  if (waypoint?.id === row.dataset.id) {
    setWaypoint(null)
    return
  }
  const next = waypointFor(row.dataset.id)
  if (!next) return
  setWaypoint(next)
  toast(`길 안내: ${next.label}`, 'quest')
})
wpChip?.querySelector('button')?.addEventListener('click', () => setWaypoint(null))
document.getElementById('retry')?.addEventListener('click', () => restart())
document.getElementById('guide-skip')?.addEventListener('click', () => {
  showSettings(false)
  if (mode === 'title' || chaptersOf(game.save).guide.done) {
    toast('가이드 챕터는 이미 끝났어.', 'info')
    return
  }
  skipGuide(game.save)
  game.persist(store)
  paintContracts()
  toast('가이드를 건너뛰었어. 게시판에서 챕터 2 퀘스트를 받아 봐!', 'quest')
})

/** Dev-only close camera for checking the hand pose: __slice.view = { on: true, yaw, pitch, dist }. */
const view: { on: boolean; yaw: number; pitch: number; dist: number; height: number; aimYaw?: number; timeScale: number } = { timeScale: 1, on: false, yaw: 0, pitch: 12, dist: 2.4, height: 1.05 }
if (import.meta.env.DEV) Object.assign(window, { __slice: { hero, mochi, combat, hitStop, quality, stage, view, aim, rig, shooter, TPS, SENS, setSens, landmarks, talk, vfx, audio, get game() { return game }, enterZone, travel, get mode() { return mode }, get run() { return run }, get delve() { return delve }, get summary() { return lastSummary }, skills, inventory, applyBuild, giveXp, get stats() { return stats }, dpsOf, makeItem, get places() { return zonePlaces }, enterSewer, leaveSewer, nextFloor, gateTalk, townUI, help, openTown, quickEquip, eatCandyNow, contractHit, paintContracts, townOf, enterField, guideHit, questHit, chapterUI, get chapters() { return chaptersOf(game.save) }, get lastPickup() { return lastPickup }, toast, zoneBanner, aimZone, cursor, hudArena, levelUpFx, guideFold: (v: 'full' | 'chip') => chapterUI.force(v), setWaypoint, waypointFor, get waypoint() { return waypoint ? { ...waypoint, goal: wpGoal, distance: waypointDistance(), dots: wpLine.length } : null }, get parked() { return parked ? { depth: parked.depth, floor: parked.floor, field: !!parked.field } : null }, returnThrough, get keptFloor() { return savedFloor() }, enterArea, enterMongsil, mongsilToIsland, get dream() { return dreamOf(game.save) }, dreamHit, placeMazeQuest, spotUsed, returnPortal, RETURN_SPOT, setAutoRun, get autoRun() { return autoRunOn() }, get qol() { return qol }, get guideView() { return chapterUI.view() } } })

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
    loadDungeon().then((m) => m.loadHordeArt(base)),
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
    giveXp(townKillXp(Boolean(foe.elite)) * (foe.kind === 'bloom' ? 10 : 1))
    guideHit({ type: 'kill' })
    skills.onKill(foe.object.position.x, foe.object.position.z, townSkillWorld)
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
  dropParked()
  setWaypoint(null)
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
  const banked = game.banked
  if (banked && banked.gold > 0) window.setTimeout(() => toast(`지난번 탐험(깊이 ${banked.depth}·${banked.floor}층)의 골드 ${banked.gold}을 챙겨 왔어!`, 'reward'), 900)
  game.banked = null
}

function beginPlay(): void {
  mode = 'play'
  armTown()
  applyBuild()
  hero.hp = hero.maxHp
  skills.reset()
  paintCandy()
  paintContracts()
  hotbar?.classList.remove('hidden')
  paintHotbar()
  crosshair?.classList.remove('hidden')
  showHint()
  enterZone(game.zone, game.zone === 'meadow' || game.zone === 'village' ? PLAZA : PORTAL_ARRIVAL)
  // 챕터 2: she went to sleep in 몽실 마을, so she wakes there.
  if (dreamOf(game.save).home === 'mongsil' && dreamOf(game.save).maze.passed) window.setTimeout(() => enterMongsil(true), 200)
  if (!game.save.flags.metMochi) window.setTimeout(() => talk.start('mochi_meet'), 700)
  const ch = chaptersOf(game.save)
  guideLast = null
  guideFired = shooter.fired
  guideGear = JSON.stringify(game.save.equipment)
  if (ch.offerSkip && !ch.guide.done) window.setTimeout(offerSkip, 900)
  else if (ch.card) queueClearCard()
  else {
    const step = guideStep(game.save)
    if (step) window.setTimeout(() => chapterUI.say(step.say.who, step.say.text), game.save.flags.metMochi ? 900 : 400)
  }
  paintContracts()
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
  townColliders = cameraColliders(zonePlaces)
  landmarks.setZone(id)
  setMood(zone.mood)
  hero.revive()
  hero.object.position.set(at.x, 0, at.z)
  // Arrive looking in toward the middle of the island (her back to the edge).
  if (Math.hypot(at.x, at.z) > 1) {
    rig.view.yaw = Math.atan2(-at.x, -at.z)
    hero.yaw = rig.view.yaw
  }
  rig.view.pitch = 0.12
  rig.view.boom = 1
  shooter.reset()
  skills.reset()
  heroTracked = false
  stepTracked = false
  mochi.place(at.x + 0.8, at.z - 0.8)
  talk.close()
  const result = game.enter(id)
  if (id === 'village') hero.hp = hero.maxHp
  showResult(result)
  zoneBanner(zone.name, zone.bgm === 'battle' ? '괴물들이 꿈을 갉고 있어' : '평온한 꿈결')
  game.persist(store)
  paintReturnPortal()
  if (id === 'altar' && !game.save.flags.bossIntro && combat.bossAwake) window.setTimeout(() => talk.start('boss_intro'), 900)
}

/**
 * Down the portal: start a trip at `depth` (from floor `floor`, the checkpoint when resuming).
 * A bare number (old debug hook) is treated as a maze seed on depth 1, floor 1.
 */
function enterSewer(depth = 1, floor = 1, seed?: number): void {
  if (run || travelling) return
  const trip = Delve.start(game.save, depth, floor)
  if (!trip) {
    toast('아직 열리지 않은 깊이야. 앞 깊이의 보스를 먼저 쓰러뜨려 줘.', 'info')
    return
  }
  dropParked()
  travelling = true
  audio.sfx('windup', 0.7)
  void loadDungeon().then((mod) => fadeThrough(() => {
    talk.close()
    combat.setRoster([])
    combat.places = []
    landmarks.group.visible = false
    const theme = mod.themeFor(trip.plan.depth)
    stage.setWorld('sewer', mod.themeFog(trip.plan.depth))
    setMood({ fog: theme.fog, sky: theme.sky, clear: theme.fog })
    zonePlaces = []
    delve = trip
    delveUnlocked = -1
    hero.hp = hero.maxHp
    game.persist(store)
    const plan = trip.plan
    buildFloor(mod, seed === undefined ? plan : { ...plan, seed })
    document.body.classList.add('sewer')
    showHint()
    guideHit({ type: 'sewer' })
  }))
    .catch(() => toast('하수도로 가는 길을 불러오지 못했어. 잠시 뒤 다시 해 줘.', 'info'))
    .finally(() => {
      travelling = false
    })
}

/** One floor of the trip: a fresh DungeonRun wired to the delve. */
function buildFloor(mod: typeof import('./world/dungeon/run'), plan: FloorPlan): void {
  const field = plan.objective === 'field'
  const area = plan.area as AreaId | undefined
  run = new mod.DungeonRun(
    {
      scene: stage.scene,
      camera: stage.camera,
      hero,
      mochi,
      vfx,
      sfx: (cue, gain) => audio.sfx(cue, gain),
      steps: footsteps,
      leave: (why) => leaveSewer(why),
      stairs: () => nextFloor(),
      kill: (elite, kind) => {
        delve?.kill(elite)
        giveXp(killXp(plan.depth, elite))
        if (field) questHit({ type: 'kill', kind, elite })
        else if (area === 'maze') dreamHit(mazeEvent(game.save, 'kill'))
        else if (!area) contractHit({ type: 'kill', depth: plan.depth, elite })
        guideHit({ type: 'kill' })
      },
      extraDrops: () => (field && (fieldNeeds(game.save).fluff || wantsSparks(game.save)) && Math.random() < 0.4 ? [{ kind: 'material', matId: FLUFF, amount: 1 }] : []),
      spot: (id) => spotUsed(id),
      questFoe: (id) => {
        if (id === 'm_elite') dreamHit(mazeEvent(game.save, 'elite'))
      },
      stairsBlock: () => (area === 'maze' && delve?.areaLast && !mazeCleared(game.save) ? '모찌: 아직 미로가 우릴 놓아주지 않아. 모찌 퀘스트를 마저 하자!' : null),
      named: (ev) => {
        if (ev === 'down') questHit({ type: 'named' })
      },
      recalled: () => guideHit({ type: 'recall' }),
      nestDown: () => {
        giveXp(nestXp(plan.depth))
        contractHit({ type: 'nest', depth: plan.depth })
      },
      chestOpened: () => contractHit({ type: 'chest', depth: plan.depth }),
      objectiveDone: () => {
        giveXp(objectiveXp(plan.depth))
        if (plan.objective !== 'boss' && !area) contractHit({ type: 'floor', depth: plan.depth })
      },
      scroll: () => {
        if (!useScroll(game.save)) return false
        game.persist(store)
        return true
      },
      runKills: () => delve?.kills ?? 0,
      luck: () => stats.luck,
      foeDied: (x, z) => skills.onKill(x, z, run?.skillWorld ?? null),
      pickup: (drop) => {
        const sold = delve?.autoSold ?? 0
        const r = delve ? delve.pickup(game.save, drop, Math.random, (item) => autoSellPick(game.save, item, qol)) : { heal: 0, text: '' }
        if (drop.kind === 'item' && drop.item && (delve?.autoSold ?? 0) === sold) lootPing(drop.item)
        if (drop.kind === 'material' && drop.matId === FLUFF) {
          questHit({ type: 'collect', amount: drop.amount })
          if (field) dreamHit(storyEvent(game.save, { type: 'spark', amount: drop.amount }))
        }
        return r
      },
      bossDown: () => {
        if (!delve) return
        if (area) {
          // 달빛 둥지: the moth sleeps — the story's finale (no sewer depth opens).
          keepFloor(null)
          delve.bossCleared(game.save)
          delveUnlocked = 0 // the summary reads 'clear' (no new depth opens)
          giveXp(bossXp(2))
          dreamHit(storyEvent(game.save, { type: 'boss', area }))
          game.persist(store)
          return
        }
        if (field) {
          keepFloor(null)
          delve.kill(false) // the bloom counts (delve.bossCleared counts it below)
          giveXp(bossXp(2))
          questHit({ type: 'boss' })
          game.persist(store)
          return
        }
        guideHit({ type: 'boss', depth: plan.depth })
        keepFloor(null)
        delveUnlocked = delve.bossCleared(game.save)
        giveXp(bossXp(plan.depth))
        contractHit({ type: 'boss', depth: plan.depth })
        game.persist(store)
      },
      runGold: () => delve?.gold ?? 0,
      float: (text, at, color) => float(text, at, color),
      hud: crosshair?.parentElement ?? null,
      lights: stage.touch ? 2 : 4,
      hurt: (amount, from) => sewerHurt(amount, from),
      banner: (title, sub) => zoneBanner(title, sub),
      gun: (cue, gain, pitch) => gunSfx(cue, gain, pitch),
      hitStop: (seconds) => {
        hitStop.request(seconds)
      },
      shooter,
    },
    plan,
  )
  skills.reset()
  if (area && delve?.areaLast) run.stairsHint = area === 'maze' ? '미로 밖으로 (몽실 마을)' : '끝까지 왔어 · 몽실 마을로'
  if (area === 'maze') placeMazeQuest(plan.areaFloor === 1)
}

/** A gear pickup: a jingle by rarity and a coloured toast with its name. */
function lootPing(item: ItemInstance): void {
  if (item.rarity === 'legendary') chime('loot_legendary')
  else if (item.rarity === 'epic') chime('loot_epic')
  else if (item.rarity === 'rare') chime('loot_rare')
  else audio.sfx('quest')
  lootToast(item)
}

/** Pickup toast in the item's rarity colour (bottom-left stack, fades by itself). */
function lootToast(item: ItemInstance): void {
  const box = document.getElementById('loot-toasts')
  if (!box) return
  const el = document.createElement('div')
  el.className = `loot-toast r-${item.rarity}`
  el.style.setProperty('--rar', RARITY_COLOR[item.rarity])
  el.dataset.uid = item.uid
  el.innerHTML = `<b></b><small></small>`
  ;(el.firstChild as HTMLElement).textContent = itemName(item)
  ;(el.lastChild as HTMLElement).textContent = `${ilvText(item.itemLevel)} · I 가방에서 비교`
  // Quick equip: what it would change, and a button (G) to wear it right away.
  if (findItem(game.save, item.uid) && !isEquipped(game.save, item.uid)) {
    lastPickup = item.uid
    const rows = compareEquip(game.save, item.uid)
    const key = rows.find((r) => r.key === 'dps') ?? rows.find((r) => r.key === 'maxHp') ?? rows[0]
    if (key) {
      const gain = document.createElement('span')
      gain.className = 'gain'
      gain.textContent = `${key.label} ${key.from} → ${key.to}`
      if (key.delta < 0) gain.style.color = '#ffb0c0'
      el.append(gain)
    }
    const quick = document.createElement('button')
    quick.type = 'button'
    quick.className = 'quick'
    quick.textContent = stage.touch ? '바로 장착' : 'G 바로 장착'
    quick.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      quickEquip(item.uid)
    })
    el.append(quick)
  }
  box.prepend(el)
  while (box.children.length > 4) box.lastElementChild?.remove()
  window.setTimeout(() => el.remove(), 6200)
}

/** Stairs portal: on to the next floor (checkpoint saved there). */
function nextFloor(): void {
  if (!run || !delve || travelling || delve.onBoss) return
  if (delve.areaLast) {
    areaOut()
    return
  }
  travelling = true
  audio.sfx('windup', 0.8)
  const trip = delve
  if (trip.plan.objective === 'exit') {
    giveXp(objectiveXp(trip.depth))
    contractHit({ type: 'floor', depth: trip.depth })
  }
  void loadDungeon().then((mod) => fadeThrough(() => {
    run?.dispose()
    run = null
    const plan = trip.nextFloor(game.save)
    keepFloor(null)
    game.persist(store)
    buildFloor(mod, plan)
  })).finally(() => {
    travelling = false
  })
}

/** Close the trip: bank run gold (a fall drops some), save, and queue the summary card. */
function endDelve(end: DelveEnd): DelveSummary | null {
  if (!delve) return null
  const trip = delve
  delve = null
  // Beating the boss counts even if she walks home through the start portal afterwards.
  const how: DelveEnd = delveUnlocked >= 0 && end !== 'down' ? 'clear' : end
  const sum = trip.finish(game.save, how, Math.max(0, delveUnlocked))
  delveUnlocked = -1
  game.persist(store)
  return sum
}

/** Back up to the island hub (the village square), then the run summary. */
function leaveSewer(why: DelveEnd = 'recall'): void {
  if (!run || travelling) return
  travelling = true
  audio.sfx('windup', 0.7)
  // 편의성: a recall mid-floor leaves a return portal (not after the boss, not when she fell).
  // 던전 유지: a fall keeps the floor too (she wakes in town, the portal takes her back).
  if (delve?.town) return
  const home = tripHome(delve)
  const keep = home === 'island' && (why === 'recall' || why === 'down') && delveUnlocked < 0 && !!delve && !delve.bossBeaten && !!dungeonMod
  const parkAs = keep && delve && run && dungeonMod ? { run, mod: dungeonMod, depth: delve.depth, floor: delve.floor, salt: delve.salt, field: delve.fieldPlan, area: delve.area, areaFloor: delve.area ? delve.floor : undefined } : null
  const snap = parkAs && delve ? parkAs.run.snapshot(delve.salt) : null
  const sum = endDelve(why)
  keepFloor(snap)
  game.persist(store)
  void fadeThrough(() => {
    if (parkAs) {
      if (parked) parked.run.dispose()
      parkAs.run.park()
      parked = parkAs
    } else run?.dispose()
    run = null
    document.body.classList.remove('sewer', 'field', 'mongsil')
    if (home === 'mongsil' && dungeonMod) {
      stageMongsil(dungeonMod)
      return
    }
    dreamOf(game.save).home = 'island'
    landmarks.group.visible = true
    stage.setWorld('island')
    armTown()
    enterZone('village', PLAZA)
    showHint()
    paintReturnPortal()
  }).then(() => {
    travelling = false
    if (parkAs) toast(`별문 옆에 돌아가기 포털이 열렸어 (${keptLabel()})`, 'quest')
    if (!sum) return
    mode = 'menu'
    releaseLook()
    if (import.meta.env.DEV) lastSummary = sum
    audio.sfx(sum.end === 'down' ? 'ui' : 'quest')
    showSummary(sum, () => {
      mode = 'play'
      paintContracts()
      if (chaptersOf(game.save).card) queueClearCard()
    })
  })
}
/** Last summary shown (dev QA hook). */
let lastSummary: DelveSummary | null = null

// ---- 챕터 2: 꿈 미로 → 몽실 마을 → 꿈의 비밀 ----
/** Standing in 몽실 마을 (a run world with no foes). */
function inMongsil(): boolean {
  return !!delve?.town && !!run
}

/** Where a trip comes home to: 몽실 for its areas (and the field once the maze is behind her). */
function tripHome(trip: Delve | null): 'island' | 'mongsil' {
  if (!trip) return 'island'
  if (trip.area) return AREAS[trip.area].home === 'mongsil' ? 'mongsil' : 'island'
  if (trip.fieldPlan && dreamOf(game.save).maze.passed) return 'mongsil'
  return 'island'
}

/** Into a run world (an area floor or 몽실 itself): island bits off, fog and mood from its plan. */
function stageTrip(mod: typeof import('./world/dungeon/run'), trip: Delve): void {
  talk.close()
  combat.setRoster([])
  combat.places = []
  landmarks.group.visible = false
  const plan = trip.plan
  const theme = mod.themeOf(plan)
  stage.setWorld('sewer', mod.planFog(plan))
  setMood({ fog: theme.fog, sky: theme.sky, clear: theme.fog })
  zonePlaces = []
  delve = trip
  delveUnlocked = -1
  hero.revive()
  hero.hp = hero.maxHp
  buildFloor(mod, plan)
  document.body.classList.add('sewer')
  document.body.classList.toggle('mongsil', !!trip.town)
  paintReturnPortal()
  paintContracts()
  showHint()
}

/** Build 몽실 마을 right here (inside a fade). */
function stageMongsil(mod: typeof import('./world/dungeon/run')): void {
  const d = dreamOf(game.save)
  d.home = 'mongsil'
  stageTrip(mod, Delve.town(game.save))
  game.persist(store)
  if (!game.save.flags.mongsilMet) {
    game.save.flags.mongsilMet = true
    window.setTimeout(() => chapterUI.say('모찌', '여기가 몽실 마을이야냥! 이장 몽이에게 먼저 인사하자.'), 900)
  }
}

/** Leave 몽실 quietly (no summary): its run is just thrown away. */
function dropTown(): void {
  if (!delve?.town) return
  run?.dispose()
  run = null
  delve = null
  document.body.classList.remove('sewer', 'mongsil')
}

/** Through a 별문 into a 챕터 2 area (꿈 미로 from the island; the rest from 몽실). */
function enterArea(id: AreaId): void {
  if ((run && !inMongsil()) || travelling) return
  if (!chapter2Open(game.save)) {
    toast('가이드 챕터를 마치면 열리는 길이야.', 'info')
    return
  }
  if (id !== 'maze' && !openAreas(game.save).includes(id)) {
    toast('아직 이야기가 거기까지 닿지 않았어.', 'info')
    return
  }
  if (AREAS[id].home === 'island') dropParked()
  travelling = true
  audio.sfx('windup', 0.7)
  const trip = Delve.area(game.save, id)
  void loadDungeon()
    .then((mod) =>
      fadeThrough(() => {
        dropTown()
        stageTrip(mod, trip)
        game.persist(store)
        if (id !== 'maze') zoneBanner(AREAS[id].name, AREAS[id].blurb)
      }),
    )
    .catch(() => toast('길을 불러오지 못했어. 잠시 뒤 다시 해 줘.', 'info'))
    .finally(() => {
      travelling = false
    })
}

/** To 몽실 마을 (from the island 별문, or straight in on a resume). */
function enterMongsil(quiet = false): void {
  if ((run && !inMongsil()) || travelling) return
  if (!dreamOf(game.save).maze.passed) {
    toast('꿈 미로를 지나야 닿는 마을이야.', 'info')
    return
  }
  travelling = true
  if (!quiet) audio.sfx('windup', 0.7)
  void loadDungeon()
    .then((mod) =>
      fadeThrough(() => {
        dropTown()
        stageMongsil(mod)
      }),
    )
    .catch(() => toast('몽실 마을로 가는 길을 불러오지 못했어.', 'info'))
    .finally(() => {
      travelling = false
    })
}

/** 몽실's 별문 → 섬 마을 (the first village). */
function mongsilToIsland(): void {
  if (!inMongsil() || travelling) return
  travelling = true
  audio.sfx('windup', 0.7)
  void fadeThrough(() => {
    dropTown()
    dreamOf(game.save).home = 'island'
    landmarks.group.visible = true
    stage.setWorld('island')
    armTown()
    enterZone('village', PLAZA)
    showHint()
    paintReturnPortal()
    paintContracts()
  }).finally(() => {
    travelling = false
  })
}

/** An area's last stairs: the maze lets her out into 몽실; loft / tower count for the story. */
function areaOut(): void {
  if (!delve?.area || travelling) return
  const area = delve.area
  if (area === 'maze') {
    passMaze(game.save)
    giveXp(objectiveXp(2))
  } else dreamHit(storyEvent(game.save, { type: 'area', area }))
  keepFloor(null)
  delveUnlocked = 0 // walked to its end: the summary reads 'clear'
  leaveSewer('clear')
  if (area === 'maze') window.setTimeout(() => chapterUI.say('모찌', '미로를 빠져나왔어! 저기 불빛… 새 마을이야냥!'), 1600)
}

/** A 챕터 2 happening: 모찌's line, toasts, rewards; the next maze quest gets placed. */
function dreamHit(o: DreamOut): void {
  if (o.result) showResult(o.result)
  for (const t of o.toasts) toast(t, /완료|달성/.test(t) ? 'quest' : 'info')
  if (o.toasts.some((t) => /완료|달성/.test(t))) chime('contract')
  if (o.say) chapterUI.say(o.say.who, o.say.text)
  if (o.next && delve?.area === 'maze') placeMazeQuest(false)
  if (o.cleared) queueClearCard()
  paintContracts()
  game.persist(store)
}

/** Put 모찌's current maze quest on this floor (fragment, 뭉게 in the web, or the 미로지기). */
function placeMazeQuest(say: boolean): void {
  if (!run || delve?.area !== 'maze') return
  const q = mazeQuest(game.save)
  if (!q) return
  if (say) window.setTimeout(() => chapterUI.say('모찌', q.give), 1200)
  if (q.kind === 'frag' && !run.spots.some((x) => x.id === 'm_frag')) {
    const at = run.farSpot(0.7, (delve?.floor ?? 1) + 3)
    if (at) run.addSpot({ id: 'm_frag', x: at.x, z: at.z, r: 1.7, hint: '꿈 조각 줍기', arrow: true, obj: run.questProp('frag') })
  } else if (q.kind === 'rescue' && !run.spots.some((x) => x.id === 'm_rescue')) {
    const at = run.farSpot(0.75, (delve?.floor ?? 1) + 5)
    if (at) run.addSpot({ id: 'm_rescue', x: at.x, z: at.z, r: 1.9, hint: `${RESCUE_NAME} 풀어 주기`, name: RESCUE_NAME, arrow: true, obj: run.questProp('rescue'), tagY: 1.8 }, 0.8)
  } else if (q.kind === 'elite') run.spawnQuestFoe('m_elite', MAZE_ELITE.kind, MAZE_ELITE.name, MAZE_ELITE.hp)
}

/** E at a spot: townsfolk, the 별문, or a maze quest thing. */
function spotUsed(id: string): void {
  if (!run) return
  if (id === 'm_frag') {
    run.removeSpot('m_frag')
    vfx.burst(hero.object.position.clone().setY(1.2), 0xbfe6ff, { count: 18, speed: 2, up: 2, life: 0.8, size: 0.16, gravity: -0.4, drag: 1.4 })
    audio.sfx('quest')
    dreamHit(mazeEvent(game.save, 'frag'))
    return
  }
  if (id === 'm_rescue') {
    run.removeSpot('m_rescue')
    audio.sfx('quest')
    run.ambush(4, 'bat')
    zoneBanner('매복!', `${RESCUE_NAME}를 노리던 악몽들이 덤벼들어`)
    dreamHit(mazeEvent(game.save, 'rescue'))
    return
  }
  if (!inMongsil()) return
  if (id === 'mongi') mongiTalk()
  else if (id === 'somsom') openTown('shop')
  else if (id === 'toto') openTown('stash')
  else if (id === 'bolt') openTown('workshop')
  else if (id === 'board') openTown('board')
  else if (id === 'gate') {
    talk.start(mongsilGate())
    audio.sfx('talk_open')
  }
}

const PORTRAIT: Record<string, string> = { 모찌: 'mochi', 별하: 'byeolha', 몽이: 'npc_mongi', '???': 'prop_portal' }
/** 이장 몽이: the 꿈의 비밀 story (offer, nudge, hand-in with its reveal). */
function mongiTalk(): void {
  const t = storyTalk(game.save)
  talk.start({ lines: t.lines.map((l) => ({ speaker: l.who, portrait: PORTRAIT[l.who] ?? 'npc_mongi', text: l.text })) })
  audio.sfx('talk_open')
  dreamHit(t.out)
}

/** 몽실's 별문: back to the island, the field, and the areas the story opened. */
function mongsilGate(): TalkDef {
  const areas = openAreas(game.save)
  return {
    lines: [{ speaker: '별문', portrait: 'prop_portal', text: '몽실 마을의 별문이 반짝인다. 어디로 갈까?' }],
    choices: [
      ...areas.map((a) => ({ text: `${AREAS[a].name} · ${AREAS[a].blurb}`, go: `area:${a}` })),
      { text: '몽실 들판 (게시판 퀘스트 · 등불 불씨)', go: 'field' },
      { text: '섬 마을 (첫 마을로)', go: 'island' },
      { text: '그만두기' },
    ],
  }
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
  if (result.leveled) levelUpFx()
  paintTracker(game.tracker())
  paintStats(game.save)
}

/** A dialogue just ended: run its actions on the save, then any portal hop or ending. */
function talkDone(actions: Action[], choice: TalkChoice | null, id: string | TalkDef): void {
  const out = game.run(actions)
  showResult(out.result)
  if (actions.some((a) => a.type === 'heal-full')) {
    hero.hp = hero.maxHp
    float('+기운', hero.object.position.clone().setY(1.7), '#b8f0c8')
    audio.sfx('heal')
  }
  game.persist(store)
  if (out.openTinker) openTown('workshop')
  else if (out.openShop) openTown('shop')
  else if (out.openQuests) openTown('board')
  const dive = choice?.go?.match(/^sewer:(\d+):(\d+)$/)
  if (dive || choice?.go === 'field') {
    try {
      safeStore()?.setItem(LAST_GATE_KEY, choice?.go ?? '')
    } catch {
      /* private mode */
    }
  }
  if (dive) enterSewer(Number(dive[1]), Number(dive[2]))
  else if (choice?.go === 'sewer') enterSewer()
  else if (choice?.go === 'field') enterField()
  else if (choice?.go === 'return') returnThrough()
  else if (choice?.go === 'mongsil') enterMongsil()
  else if (choice?.go === 'island') mongsilToIsland()
  else if (choice?.go?.startsWith('area:')) enterArea(choice.go.slice(5) as AreaId)
  else if (choice?.go) travel(choice.go as ZoneId)
  if (id === 'luna_bloom_done' && game.finished && !game.save.flags.ending) {
    game.save.flags.ending = true
    game.persist(store)
    mode = 'menu'
    releaseLook()
    window.setTimeout(() => showEnding(game.save, () => (mode = 'play')), 600)
  }
}

/** The portal's little menu, built from where the story lets her go. */
function gateTalk(): TalkDef {
  const dests = destinations(game.save, game.zone, combat.bossAwake)
  if (!dests.length && game.zone !== 'village') return { lines: [{ speaker: '모찌', portrait: 'mochi', text: gateLocked(game.zone) }] }
  return {
    lines: [{ speaker: '별문', portrait: 'prop_portal', text: '별빛 문이 일렁인다. 어디로 갈까?' }],
    choices: [
      ...(keptLabel() && game.zone === 'village' ? [{ text: `돌아가기 포털 · ${keptLabel()} (그 자리로)`, go: 'return' }] : []),
      ...dests.map((d) => ({ text: d.label, go: d.to })),
      ...rememberFirst(
        [
          ...(game.zone === 'village' ? portalChoices(game.save).map((c) => ({ text: c.label, go: `sewer:${c.depth}:${c.floor}` })) : []),
          ...(game.zone === 'village' && chapter2Open(game.save) ? [dreamOf(game.save).maze.passed ? { text: '챕터 2 · 몽실 마을 (꿈의 비밀)', go: 'mongsil' } : { text: '챕터 2 · 꿈 미로 (모찌와 함께)', go: 'area:maze' }] : []),
        ],
        safeStore()?.getItem(LAST_GATE_KEY),
      ),
      { text: '그만두기' },
    ],
  }
}

function frame(): void {
  requestAnimationFrame(frame)
  // Real time up to 0.1 s per frame (10 FPS) so a slow frame never slows the game itself; the
  // dungeon splits long frames into ≤ 1/20 s sim steps.
  const raw = Math.min(MAX_FRAME, clock.getDelta())
  let dt = raw
  if (import.meta.env.DEV) dt *= view.timeScale
  // Town foes still write combat.hitStop directly; fold it into the budgeted freeze.
  if (combat.hitStop > 0) {
    hitStop.request(combat.hitStop)
    combat.hitStop = 0
  }
  dt *= hitStop.step(raw)
  quality.frame(raw)
  handleKeys()
  // Auto-run stops for trips, a fall, talks and menus.
  if (autoRunOn() && (travelling || !hero.alive || talk.open || menuUp() || mode !== 'play')) setAutoRun(false)
  relockBtn?.classList.toggle('hidden', !syncCursor(shoulder.on && mode === 'play', stage.touch))
  if (mode !== 'play') {
    stage.render()
    return
  }
  game.save.playSeconds += raw
  chapterTick()
  if (run) {
    sewerFrame(dt, raw)
    return
  }
  saveClock += raw
  if (saveClock > 20) {
    saveClock = 0
    game.persist(store)
  }
  combat.shake = Math.max(0, combat.shake - raw * 1.5)
  countFps(raw)
  const frozen = menuUp()
  const talking = talk.open || frozen
  // Dialogue and menus need the cursor: hand it back while one is up.
  if (talking) releaseLook()
  const move = talking ? { x: 0, y: 0 } : axis()
  // WASD / the stick relative to the view, exactly as in the sewer.
  const wish = rig.wish(move.x, move.y)
  if (import.meta.env.DEV && view.on && view.aimYaw !== undefined) {
    const p = hero.object.position
    aim.set(p.x + Math.sin(view.aimYaw) * 5, 1.05, p.z + Math.cos(view.aimYaw) * 5)
  }
  const dash = consumeDash()
  if (dash && hero.alive && !talking) {
    audio.sfx('dash')
    vfx.dust(hero.object.position, 2.4)
    vfx.ring(hero.object.position.clone().setY(0.05), 0xffd0ea, 0.3, 1.2, 0.3, 0.5)
  }
  const firing = pad.fire && !talking && hero.alive
  hero.update(dt, { wishX: wish.x, wishZ: wish.z, aim, firing, dash: dash && !talking, run: runningHeld(), face: true })
  {
    // Landmarks are solid; she slides round the house corner instead of walking through it.
    const p = hero.object.position
    const out = pushOutOfPlaces(p.x, p.z, 0.32, zonePlaces)
    p.x = out.x
    p.z = out.z
  }
  if (hero.dashing) ghost()
  const heroPos = hero.object.position
  if (!skills.rushing) mochiFollow(dt, heroPos)
  landmarks.update(dt, heroPos)
  if (returnPortal.active) returnPortal.update(performance.now() / 1000)
  const notes = combat.update(frozen ? 0 : dt, heroPos, 0.7, (amount, from) => {
    const hurt = hero.hurt(amount, from)
    if (!hurt) return
    audio.sfx('hurt')
    hurtFlash()
    vfx.hit(heroPos.clone().setY(1.0), 0xff9eb8, true)
    combat.shake = Math.max(combat.shake, 0.07)
    float(`-${hero.lastDamage}`, heroPos.clone().setY(1.6), '#ff9eb8')
    if (!hero.alive) {
      audio.sfx('down')
      releaseLook()
      const { lost, home } = game.died()
      const text = document.getElementById('down-text')
      if (text) text.textContent = `별하가 잠시 눈을 감았다.${lost ? ` 골드 ${lost}을 흘렸어.` : ''} ${zone3d(home).name}에서 다시 일어나자.`
      game.persist(store)
      showDown()
    }
  })
  for (const item of notes) {
    float(item.text, item.at, item.text.startsWith('+') ? '#ffe08a' : '#fffaf6')
    if (item.text.startsWith('+')) audio.sfx('coin')
    else audio.sfx('hit')
  }
  footsteps(dt, heroPos)
  audio.setScene('town')
  audio.update(dt, threatNear(heroPos))
  vfx.update(dt)
  if (!frozen) autoCandy(raw)
  if (hpFill) hpFill.style.width = `${Math.max(0, (hero.hp / hero.maxHp) * 100)}%`
  // Camera on her shoulder, then the crosshair ray from it, then the gun (same order as the sewer).
  if (combat.shake > 0.02) rig.shake = Math.max(rig.shake, combat.shake * 0.35)
  hero.object.visible = rig.place(dt, heroPos.x, heroPos.y, heroPos.z, townRay)
  hero.fade(rig.ghost)
  FADE_FOCUS.value.set(heroPos.x, heroPos.y + 1.0, heroPos.z)
  rig.aimFrom(townWorld, dt)
  shooter.update(dt, firing, townWorld)
  skills.update(dt, townSkillWorld)
  paintHotbar()
  if (import.meta.env.DEV && view.on) inspectCamera(heroPos)
  if (frozen) consumeTalk()
  // Tags are projected after the camera moved this frame, so they sit on the heads instead of trailing.
  stage.camera.updateMatrixWorld()
  updateTalk()
  paintMarkers()
  waypointFrame(dt)
  tickFloats(dt)
  stage.render()
}

/** One frame down in the sewer: the run drives hero, Mochi and the shoulder camera. */
function sewerFrame(dt: number, raw: number): void {
  if (!run) return
  combat.shake = Math.max(0, combat.shake - raw * 1.5)
  countFps(raw)
  if (travelling) {
    stage.render()
    return
  }
  // A dialogue (몽이, the 별문 menu) holds the run world; E / tap moves it on.
  if (talk.open) {
    releaseLook()
    if (consumeTalk()) {
      talk.advance()
      audio.sfx('talk_next')
    }
    vfx.update(dt)
    stage.camera.updateMatrixWorld()
    tickFloats(dt)
    stage.render()
    return
  }
  // A slow frame (up to MAX_FRAME) runs as two half steps, so collisions and shots stay exact
  // without slowing game time.
  const steps = dt > SIM_STEP ? 2 : 1
  const step = dt / steps
  for (let i = 0; i < steps && run; i += 1) {
    run.update(step)
    skills.update(step, run.skillWorld)
  }
  if (!run) return
  autoCandy(raw)
  paintHotbar()
  if (delve && hero.alive) delve.seconds += raw
  saveClock += raw
  if (saveClock > 10 && delve && !delve.town) {
    // Keep the open trip (run gold, kills) on disk so a reload mid-run banks it.
    saveClock = 0
    delve.sync(game.save)
    // 던전 유지: the floor as it stands now, so a reload mid-floor comes back to it.
    keepFloor(tripHome(delve) === 'island' && !delve.bossBeaten && delveUnlocked < 0 && hero.alive ? run.snapshot(delve.salt) : null)
    game.persist(store)
  }
  vfx.update(dt)
  audio.setScene(run.boss && run.boss.awake && run.boss.alive ? 'boss' : 'dungeon', run.plan.depth)
  audio.update(dt, run.threat)
  if (hpFill) hpFill.style.width = `${Math.max(0, (hero.hp / hero.maxHp) * 100)}%`
  talkTip?.classList.toggle('hidden', !run.nearPortal)
  if (run.nearPortal && talkTip) {
    tipAt.copy(hero.object.position).setY(2.0).project(stage.camera)
    talkTip.style.left = `${(tipAt.x * 0.5 + 0.5) * window.innerWidth}px`
    talkTip.style.top = `${(-tipAt.y * 0.5 + 0.5) * window.innerHeight}px`
    talkTip.textContent = stage.touch ? run.portalHint : `E ${run.portalHint}`
  }
  talkBtn?.classList.toggle('hidden', !run.nearPortal)
  if (talkBtn && run.nearPortal) talkBtn.textContent = '포털'
  waypointFrame(raw)
  stage.camera.updateMatrixWorld()
  tickFloats(dt)
  stage.render()
}

function countFps(raw: number): void {
  frames += 1
  fpsTime += raw
  if (fpsTime >= 0.5) {
    fps = Math.round(frames / fpsTime)
    fpsTime = 0
    frames = 0
    if (fpsEl && showFps) fpsEl.textContent = quality.level > 0 ? `${fps} FPS · 품질 ${QUALITY_KO[quality.level]}` : `${fps} FPS`
  }
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
  const spots = returnPortal.active ? [...zonePlaces, RETURN_PLACE] : zonePlaces
  const near = hero.alive && !travelling ? nearestTalk(p.x, p.z, 2.4, spots) : null
  if (consumeTalk()) {
    if (talk.open) {
      talk.advance()
      audio.sfx('talk_next')
    } else if (near?.talk === 'return') {
      returnThrough()
    } else if (near?.talk && DIRECT[near.talk]) {
      openTown(DIRECT[near.talk]!)
    } else if (near?.talk) {
      talk.start(near.talk === 'gate' ? gateTalk() : game.dialogueFor(near.talk))
      audio.sfx('talk_open')
    }
  }
  const showTip = Boolean(near && !talk.open)
  talkTip?.classList.toggle('hidden', !showTip)
  talkBtn?.classList.toggle('hidden', !near || menuUp())
  if (talkBtn && near) talkBtn.textContent = VERB[near.talk ?? ''] ?? '대화'
  if (!showTip || !near || !talkTip) return
  tipAt.set(near.x, TIP_HEIGHT[near.kind] ?? 2.2, near.z).project(stage.camera)
  talkTip.style.left = `${(tipAt.x * 0.5 + 0.5) * window.innerWidth}px`
  talkTip.style.top = `${(-tipAt.y * 0.5 + 0.5) * window.innerHeight}px`
  const verb = VERB[near.talk ?? ''] ?? '대화'
  talkTip.textContent = stage.touch ? verb : `E ${verb}`
}

const TIP_HEIGHT: Partial<Record<Place['kind'], number>> = { kiki: 1.75, luna: 1.95, board: 1.95, portal: 2.6, popo: 2.6, stash: 1.2 }
/** Talk spots that open a town panel straight away (no dialogue first). */
const DIRECT: Record<string, TownPanel | undefined> = { popo: 'shop', board: 'board', stash: 'stash' }
const VERB: Record<string, string> = { return: '돌아가기 포털', gate: '별문', well: '우물', board: '게시판', popo: '상점', stash: '보관함' }
const markAt = new Vector3()
/** Quest markers (! new errand, ? ready to report) over the villagers. */
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
  if (prey && mochiCd <= 0 && hero.alive && !menuUp()) {
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
    const projected = floatAt.copy(item.at)
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
  // A crowd of town foes can pop dozens at once; the oldest goes first past the cap.
  if (floats.length >= FLOAT_CAP) floats.shift()?.el.remove()
  floats.push({ el, life: 0.7, y: 0, at: at.clone() })
}
const FLOAT_CAP = 40
const floatAt = new Vector3()

/** A sewer foe or boss orb landed on her. */
let gunSound: GunSound | null = null
/** Synth gun layer on the shared sfx bus, built the first time audio is live. */
function gunSfx(cue: GunCue, gain?: number, pitch?: number): void {
  if (audio.master <= 0.001) return
  const c = audio.context()
  if (!c) return
  gunSound ??= new GunSound(c.ctx, c.bus)
  gunSound.play(cue, gain, pitch)
}

function sewerHurt(amount: number, from: Vector3): void {
  const at = hero.object.position
  if (!hero.hurt(amount, from)) return
  audio.sfx('hurt')
  hurtFlash()
  vfx.hit(at.clone().setY(1.0), 0xff9eb8, true)
  combat.shake = Math.max(combat.shake, 0.05)
  float(`-${hero.lastDamage}`, at.clone().setY(1.6), '#ff9eb8')
  if (hero.alive) return
  audio.sfx('down')
  contractHit({ type: 'down' })
  if (document.pointerLockElement) document.exitPointerLock?.()
  const text = document.getElementById('down-text')
  if (text) text.textContent = '별하가 꿈 하수도에서 잠시 눈을 감았다. 이번 탐험 골드를 조금 흘렸지만, 주운 물건과 층 기록은 그대로야. 마을 광장에서 다시 일어나자.'
  showDown()
}

/** The down card, then she gets up by herself after AUTO_RISE seconds (or on the button). */
let riseTimer = 0
function showDown(): void {
  document.getElementById('down')?.classList.remove('hidden')
  const btn = document.getElementById('retry')
  let left = AUTO_RISE
  const paint = () => {
    if (btn) btn.textContent = `다시 일어나기 (${left})`
  }
  paint()
  window.clearInterval(riseTimer)
  riseTimer = window.setInterval(() => {
    if (document.getElementById('down')?.classList.contains('hidden')) {
      window.clearInterval(riseTimer)
      return
    }
    left -= 1
    paint()
    if (left <= 0) {
      window.clearInterval(riseTimer)
      restart()
    }
  }, 1000)
}

function restart(): void {
  window.clearInterval(riseTimer)
  const retryBtn = document.getElementById('retry')
  if (retryBtn) retryBtn.textContent = '다시 일어나기'
  if (run) {
    hero.hp = hero.maxHp
    hero.revive()
    document.getElementById('down')?.classList.add('hidden')
    leaveSewer('down')
    audio.sfx('heal')
    return
  }
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

/** Closing or reloading the tab mid-trip: write the open run so its gold comes home next load. */
window.addEventListener('pagehide', () => {
  if (mode === 'title') return
  if (delve) delve.sync(game.save)
  game.persist(store)
})
