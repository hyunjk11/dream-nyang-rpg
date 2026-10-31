/** Learning, ranks and respec for the skill tree (data/tree.ts). Pure save rules. */
import { LEVEL_CAP, TIER_LEVEL, TREE, TREE_BY_ID, type Branch } from '../data/tree'
import type { SaveData } from './types'

export type Build = NonNullable<SaveData['build']>

/** The save's tree block, created on first use: one point per level (old saves too). */
export function buildOf(save: SaveData): Build {
  if (!save.build || typeof save.build !== 'object') {
    // Old saves: one point per level, plus quest-reward points (byeolhaPoints tracks both).
    const level = Math.max(1, Math.min(LEVEL_CAP, Math.floor(save.level || 1)))
    save.build = { points: Math.max(level, Math.floor(save.byeolhaPoints || 0)), ranks: {} }
  }
  const b = save.build
  if (!b.ranks || typeof b.ranks !== 'object') b.ranks = {}
  for (const [id, r] of Object.entries(b.ranks)) {
    const def = TREE_BY_ID[id]
    if (!def || !Number.isFinite(r) || r <= 0) delete b.ranks[id]
    else b.ranks[id] = Math.min(def.max, Math.floor(r))
  }
  b.points = Math.max(0, Math.floor(Number.isFinite(b.points) ? b.points : 0))
  return b
}

export function rank(save: SaveData, id: string): number {
  return buildOf(save).ranks[id] ?? 0
}

export function spentIn(save: SaveData, branch: Branch): number {
  const b = buildOf(save)
  return TREE.filter((s) => s.branch === branch).reduce((sum, s) => sum + (b.ranks[s.id] ?? 0), 0)
}

export function spentTotal(save: SaveData): number {
  return Object.values(buildOf(save).ranks).reduce((a, b) => a + b, 0)
}

/** Why a point can't go into this skill now ('' = it can). */
export function learnBlock(save: SaveData, id: string): string {
  const def = TREE_BY_ID[id]
  if (!def) return '없는 기술이야.'
  const b = buildOf(save)
  if ((b.ranks[id] ?? 0) >= def.max) return '이미 최고 단계야.'
  if (save.level < TIER_LEVEL[def.tier]) return `레벨 ${TIER_LEVEL[def.tier]}부터 배울 수 있어.`
  if (spentIn(save, def.branch) < def.tier * 2) return `이 갈래에 포인트 ${def.tier * 2}개가 먼저 필요해.`
  if (b.points < 1) return '스킬 포인트가 없어.'
  return ''
}

export function learn(save: SaveData, id: string): { ok: boolean; reason?: string } {
  const why = learnBlock(save, id)
  if (why) return { ok: false, reason: why }
  const b = buildOf(save)
  b.points -= 1
  b.ranks[id] = (b.ranks[id] ?? 0) + 1
  return { ok: true }
}

/** Cheap respec in town: 10 gold per level (free at level 1–2). */
export function respecCost(save: SaveData): number {
  return save.level <= 2 ? 0 : save.level * 10
}

export function respec(save: SaveData): { ok: boolean; reason?: string; refunded?: number } {
  const spent = spentTotal(save)
  if (spent === 0) return { ok: false, reason: '되돌릴 기술이 없어.' }
  const cost = respecCost(save)
  if (save.gold < cost) return { ok: false, reason: `골드가 모자라. ${cost} 골드가 필요해.` }
  save.gold -= cost
  const b = buildOf(save)
  b.ranks = {}
  b.points += spent
  return { ok: true, refunded: spent }
}
