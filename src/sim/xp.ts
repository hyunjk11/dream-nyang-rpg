/** XP sources in the 3D game (kills, floor objectives, bosses). Level curve is formulas.xpToNext. */
import { xpToNext } from './formulas'
import { LEVEL_CAP } from '../data/tree'

/** Deeper depths pay more per kill (+40% per depth). */
export function depthXpScale(depth: number): number {
  return 1 + 0.4 * (Math.max(1, depth) - 1)
}

export const XP = { kill: 2, elite: 10, nest: 8, objective: 20, boss: 80, townKill: 3, townElite: 12 }

export function killXp(depth: number, elite: boolean): number {
  return Math.round((elite ? XP.elite : XP.kill) * depthXpScale(depth))
}
export function nestXp(depth: number): number {
  return Math.round(XP.nest * depthXpScale(depth))
}
export function objectiveXp(depth: number): number {
  return Math.round(XP.objective * depthXpScale(depth))
}
export function bossXp(depth: number): number {
  return Math.round(XP.boss * depthXpScale(depth))
}
export function townKillXp(elite: boolean): number {
  return elite ? XP.townElite : XP.townKill
}

/** Total XP to go from level 1 to `level`. */
export function totalXpFor(level: number): number {
  let sum = 0
  for (let l = 1; l < Math.min(level, LEVEL_CAP); l += 1) sum += xpToNext(l)
  return sum
}

/** 0..1 progress through the current level (1 at the cap). */
export function xpProgress(level: number, xp: number): number {
  if (level >= LEVEL_CAP) return 1
  return Math.max(0, Math.min(1, xp / xpToNext(level)))
}
