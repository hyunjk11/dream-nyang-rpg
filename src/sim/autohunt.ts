/**
 * 자동 사냥 (편의성): in a combat zone, walk toward the nearest threat, hold the trigger, and
 * spend a basic skill when it is safe. The gun's own cadence still paces the shots, so a sniper
 * (탕!), a burst rifle and dual pistols all keep their fire style. Town, dialogue, menus and
 * death idle it. Pure, so the mobile / QA behaviour is tested without a browser.
 */
import type { WeaponKind } from './types'
import { engageFor } from '../data/guns'
import { TPS, anglesTo } from '../core/tps'
import { routePoint, worldClear, type HuntGrid } from './huntpath'

/** Open ground (the island): ignore foes past this. A maze passes `reach` instead and paths the floor. */
export const HUNT_ENGAGE = 40
/** Whole dungeon floor: packs spawn across the maze, often farther than HUNT_ENGAGE. */
export const HUNT_FLOOR = 180
/** Walk to a pickup only when it is this close and nothing is already a fight. */
export const HUNT_LOOT = 8
/** A pile underfoot is grabbed before chasing a foe that is still a way off. */
export const HUNT_LOOT_FIRST = 3.2
export const HUNT_LOOT_THREAT = 12
/** Metres of "closer" an elite / boss counts as, so a champion beats a trash mob a few steps nearer. */
const PRIORITY_M = [0, 6, 12] as const
/** How fast the view swings onto a foe (rad/s). Fast enough to track, slow enough not to snap. */
export const HUNT_TURN = 12

export type HuntSkillKind = 'bomb' | 'overdrive' | 'rush' | 'aura'

export interface HuntFoe {
  x: number
  z: number
  r: number
  hp: number
  /** 0 normal, 1 elite, 2 boss. */
  priority: number
}

export interface HuntDrop {
  x: number
  z: number
}

export interface HuntSkill {
  slot: number
  kind: HuntSkillKind
  ready: boolean
}

export interface HuntQuery {
  /** Toggle on, and the world allows it (alive, not town / menu / dialogue). */
  active: boolean
  px: number
  pz: number
  yaw: number
  pitch: number
  /** Seconds, for the strafe sway. */
  time: number
  hp: number
  maxHp: number
  /** Gun identity. Distance comes from engageFor(kind, paired), not a second table. */
  kind: WeaponKind
  /** Second one-handed gun in the off hand (쌍권총): engageFor uses the closer dual band. */
  paired?: boolean
  /** Maze grid. Without it she walks in a straight line and will not chase past engage.far. */
  grid?: HuntGrid | null
  foes: readonly HuntFoe[]
  drops: readonly HuntDrop[]
  skills: readonly HuntSkill[]
  /** Stick or WASD this frame: keep that move, still aim and shoot. */
  manual: boolean
  manualX: number
  manualZ: number
  /** Seconds since the last automatic dash. */
  sinceDash: number
}

export interface HuntPlan {
  active: boolean
  wishX: number
  wishZ: number
  aimYaw: number
  aimPitch: number
  /** Hold the trigger. Every gun (연사, 점사, 저격, 쌍권총) already fires from a held trigger. */
  fire: boolean
  /** Hotbar slot, or -1. */
  skill: number
  dash: boolean
  /** Sprint while the hunt is the one walking. */
  running: boolean
}

/**
 * Village hub, 몽실, or a floor left parked at home. A live run (`inRun`, not `parked`) is a
 * hunting ground even when the save's zone name is still the village she recalled from.
 */
export function huntIsTown(s: { parked: boolean; mongsil: boolean; inRun: boolean; village: boolean }): boolean {
  if (s.parked || s.mongsil) return true
  return !s.inRun && s.village
}

/** Back up when she is this far inside the sweet spot (share of engage.sweet). */
const KITE_AT = 0.55

/** May auto-hunt run this frame? Town hubs, talks, menus, death and the recall channel idle it. */
export function huntAllowed(s: { on: boolean; alive: boolean; talking: boolean; menu: boolean; town: boolean; recalling: boolean }): boolean {
  return s.on && s.alive && !s.talking && !s.menu && !s.town && !s.recalling
}

/** V toggles. Repeats and every other key leave it alone (movement does not cancel it). */
export function autoHuntAfterKey(on: boolean, code: string, repeat: boolean): boolean {
  if (repeat || code !== 'KeyV') return on
  return !on
}

function hypot(x: number, z: number): number {
  return Math.hypot(x, z)
}

function unit(x: number, z: number): { x: number; z: number } {
  const l = hypot(x, z)
  if (l < 1e-4) return { x: 0, z: 0 }
  return { x: x / l, z: z / l }
}

/** Yaw/pitch that puts the crosshair on a ground target, from the chase camera behind her. */
export function aimAt(px: number, pz: number, tx: number, tz: number, targetY = 0.9): { yaw: number; pitch: number } {
  const yaw = Math.atan2(tx - px, tz - pz)
  const camX = px - Math.sin(yaw) * TPS.back
  const camZ = pz - Math.cos(yaw) * TPS.back
  const camY = TPS.height + TPS.up
  const a = anglesTo(camX, camY, camZ, tx, targetY, tz)
  return { yaw: a.yaw, pitch: Math.max(TPS.minPitch, Math.min(TPS.maxPitch, a.pitch)) }
}

/** Swing the view toward the wanted angles, at most HUNT_TURN rad this frame. */
export function stepAim(yaw: number, pitch: number, wantYaw: number, wantPitch: number, dt: number): { yaw: number; pitch: number } {
  const max = HUNT_TURN * Math.max(0, dt)
  let dy = Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw))
  dy = Math.max(-max, Math.min(max, dy))
  const dp = Math.max(-max, Math.min(max, wantPitch - pitch))
  return { yaw: yaw + dy, pitch: Math.max(TPS.minPitch, Math.min(TPS.maxPitch, pitch + dp)) }
}

interface Pick {
  foe: HuntFoe
  d: number
}

function pickFoe(foes: readonly HuntFoe[], px: number, pz: number, limit: number): Pick | null {
  let best: Pick | null = null
  let bestScore = Infinity
  for (const foe of foes) {
    if (foe.hp <= 0) continue
    const d = hypot(foe.x - px, foe.z - pz)
    if (d > limit) continue
    const pri = PRIORITY_M[Math.max(0, Math.min(2, foe.priority))] ?? 0
    const score = d - pri
    if (score < bestScore) {
      bestScore = score
      best = { foe, d }
    }
  }
  return best
}

function nearestDrop(drops: readonly HuntDrop[], px: number, pz: number): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null
  for (const drop of drops) {
    const d = hypot(drop.x - px, drop.z - pz)
    if (d > HUNT_LOOT) continue
    if (!best || d < best.d) best = { x: drop.x, z: drop.z, d }
  }
  return best
}

function ready(skills: readonly HuntSkill[], kind: HuntSkillKind): HuntSkill | undefined {
  return skills.find((s) => s.kind === kind && s.ready)
}

function pickSkill(q: HuntQuery, foe: Pick | null, dist: number): number {
  const hp = q.maxHp > 0 ? q.hp / q.maxHp : 1
  const aura = ready(q.skills, 'aura')
  if (aura && hp < 0.62 && (foe || hp < 0.4)) return aura.slot
  if (!foe) return -1
  const over = ready(q.skills, 'overdrive')
  if (over && dist <= engageFor(q.kind, !!q.paired).far) return over.slot
  let near = 0
  for (const f of q.foes) {
    if (f.hp <= 0) continue
    if (hypot(f.x - q.px, f.z - q.pz) < 8) near += 1
  }
  const bomb = ready(q.skills, 'bomb')
  if (bomb && dist < 11 && (near >= 2 || foe.foe.priority > 0)) return bomb.slot
  const rush = ready(q.skills, 'rush')
  if (rush && dist < 8 && hp > 0.35) return rush.slot
  return -1
}

const IDLE: Omit<HuntPlan, 'active' | 'aimYaw' | 'aimPitch'> = {
  wishX: 0,
  wishZ: 0,
  fire: false,
  skill: -1,
  dash: false,
  running: false,
}

/** Walk target for one foe. `sweet` is where she wants to stand; past `far` she only seeks on a maze. */
function foeMove(q: HuntQuery, fx: number, fz: number, dist: number, sweet: number, far: number): { wishX: number; wishZ: number; running: boolean } {
  const away = unit(q.px - fx, q.pz - fz)
  const ax = away.x || 1
  const az = away.z || 0
  const kite = sweet * KITE_AT
  const grid = q.grid
  let gx = fx
  let gz = fz
  let mode: 'seek' | 'close' | 'hold' | 'kite' = 'close'
  if (!grid && dist > far) return { wishX: 0, wishZ: 0, running: false }
  if (dist > far) mode = 'seek'
  else if (dist > sweet + 0.6) mode = 'close'
  else if (dist < kite) mode = 'kite'
  else mode = 'hold'
  if (mode === 'hold') {
    const s = Math.sign(Math.sin(q.time * 1.3) || 1)
    const sx = -az * s
    const sz = ax * s
    if (grid) {
      const here = grid.toTile(q.px, q.pz)
      const probe = grid.toTile(q.px + sx * 1.7, q.pz + sz * 1.7)
      if (!grid.open(probe.x, probe.y) || (probe.x === here.x && probe.y === here.y)) return { wishX: 0, wishZ: 0, running: false }
    }
    return { wishX: sx, wishZ: sz, running: false }
  }
  if (mode === 'kite' || mode === 'close') {
    gx = fx + ax * sweet
    gz = fz + az * sweet
  }
  let destX = gx
  let destZ = gz
  if (grid) {
    const routed = routePoint(q.px, q.pz, gx, gz, grid)
    if (mode === 'kite' && hypot(routed.x - fx, routed.z - fz) < dist - 0.2) return { wishX: 0, wishZ: 0, running: false }
    destX = routed.x
    destZ = routed.z
  }
  if (hypot(destX - q.px, destZ - q.pz) < 0.35) return { wishX: 0, wishZ: 0, running: false }
  const u = unit(destX - q.px, destZ - q.pz)
  return { wishX: u.x, wishZ: u.z, running: true }
}

/** One frame of auto-hunt. `active: false` means the caller should leave input alone. */
export function planHunt(q: HuntQuery): HuntPlan {
  if (!q.active) return { active: false, ...IDLE, aimYaw: q.yaw, aimPitch: q.pitch }
  const band = engageFor(q.kind, !!q.paired)
  const foe = pickFoe(q.foes, q.px, q.pz, q.grid ? HUNT_FLOOR : band.far)
  const loot = nearestDrop(q.drops, q.px, q.pz)
  const grabLoot = loot && (!foe || (loot.d < HUNT_LOOT_FIRST && foe.d > HUNT_LOOT_THREAT))
  if (!foe && !grabLoot) {
    const skill = pickSkill(q, null, Infinity)
    return { active: true, ...IDLE, skill, aimYaw: q.yaw, aimPitch: q.pitch }
  }
  const tx = grabLoot ? loot.x : foe!.foe.x
  const tz = grabLoot ? loot.z : foe!.foe.z
  const dist = grabLoot ? loot.d : foe!.d
  const aim = aimAt(q.px, q.pz, tx, tz, grabLoot ? 0.4 : 0.9)
  let wishX = 0
  let wishZ = 0
  let running = false
  if (q.manual) {
    wishX = q.manualX
    wishZ = q.manualZ
  } else if (grabLoot) {
    const dest = q.grid ? routePoint(q.px, q.pz, tx, tz, q.grid) : { x: tx, z: tz }
    const u = unit(dest.x - q.px, dest.z - q.pz)
    wishX = u.x
    wishZ = u.z
    running = dist > 1.2
  } else if (foe) {
    const step = foeMove(q, foe.foe.x, foe.foe.z, dist, band.sweet, band.far)
    wishX = step.wishX
    wishZ = step.wishZ
    running = step.running
  }
  const seen = !!foe && dist <= band.far && (!q.grid || worldClear(q.px, q.pz, foe.foe.x, foe.foe.z, q.grid))
  const hp = q.maxHp > 0 ? q.hp / q.maxHp : 1
  const kite = band.sweet * KITE_AT
  return {
    active: true,
    wishX,
    wishZ,
    aimYaw: aim.yaw,
    aimPitch: aim.pitch,
    fire: !grabLoot && seen,
    skill: pickSkill(q, grabLoot ? null : foe, dist),
    dash: !q.manual && !grabLoot && !!foe && dist < kite && hp < 0.8 && q.sinceDash >= 2.2,
    running,
  }
}
