/**
 * 자동 사냥 (편의성): in a combat zone, walk toward the nearest threat, hold the trigger, and
 * spend a basic skill when it is safe. The gun's own cadence still paces the shots, so a sniper
 * (탕!), a burst rifle and dual pistols all keep their fire style. Town, dialogue, menus and
 * death idle it. Pure, so the mobile / QA behaviour is tested without a browser.
 */
import type { WeaponKind } from './types'
import { TPS, anglesTo } from '../core/tps'

/** Foes farther than this are someone else's problem (no pathfinding across the maze). */
export const HUNT_ENGAGE = 40
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
  /** Gun identity: where she likes to stand and how far a held trigger still connects. */
  kind: WeaponKind
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

export interface Standoff {
  /** Preferred gap (m). */
  range: number
  /** Back up inside this (m). */
  kite: number
  /** Hold fire out to this (m). Shotgun stays short; the sniper reaches. */
  fire: number
}

/** Where each gun wants to stand. Dual pistols are the water gun's range. */
export function standoff(kind: WeaponKind): Standoff {
  switch (kind) {
    case 'bubble':
      return { range: 4.2, kite: 2.0, fire: 8 }
    case 'star':
      return { range: 9, kite: 4.2, fire: 26 }
    case 'dart':
      return { range: 13, kite: 7.5, fire: 30 }
    default:
      return { range: 7, kite: 3.2, fire: 24 }
  }
}

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

function pickFoe(foes: readonly HuntFoe[], px: number, pz: number): Pick | null {
  let best: Pick | null = null
  let bestScore = Infinity
  for (const foe of foes) {
    if (foe.hp <= 0) continue
    const d = hypot(foe.x - px, foe.z - pz)
    if (d > HUNT_ENGAGE) continue
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
  if (over && dist < standoff(q.kind).fire) return over.slot
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

/** One frame of auto-hunt. `active: false` means the caller should leave input alone. */
export function planHunt(q: HuntQuery): HuntPlan {
  if (!q.active) return { active: false, ...IDLE, aimYaw: q.yaw, aimPitch: q.pitch }
  const stand = standoff(q.kind)
  const foe = pickFoe(q.foes, q.px, q.pz)
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
    const u = unit(tx - q.px, tz - q.pz)
    wishX = u.x
    wishZ = u.z
    running = dist > 1.2
  } else if (foe) {
    const dx = foe.foe.x - q.px
    const dz = foe.foe.z - q.pz
    const u = unit(dx, dz)
    const side = Math.sin(q.time * 1.4)
    const sway = side === 0 ? 1 : Math.sign(side)
    let x = 0
    let z = 0
    if (dist > stand.range + 0.8) {
      x = u.x * 0.92 + -u.z * side * 0.28
      z = u.z * 0.92 + u.x * side * 0.28
    } else if (dist < stand.kite) {
      x = -u.x * 0.85 + -u.z * side * 0.4
      z = -u.z * 0.85 + u.x * side * 0.4
    } else {
      x = -u.z * sway
      z = u.x * sway
    }
    const n = unit(x, z)
    wishX = n.x
    wishZ = n.z
    running = true
  }
  const hp = q.maxHp > 0 ? q.hp / q.maxHp : 1
  return {
    active: true,
    wishX,
    wishZ,
    aimYaw: aim.yaw,
    aimPitch: aim.pitch,
    fire: !grabLoot && !!foe && dist <= stand.fire,
    skill: pickSkill(q, grabLoot ? null : foe, dist),
    dash: !q.manual && !grabLoot && !!foe && dist < stand.kite && hp < 0.8 && q.sinceDash >= 2.2,
    running,
  }
}
