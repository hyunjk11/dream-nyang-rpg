/**
 * 퀘스트 게시판: repeatable dungeon contracts. Three slots on the board; taking one makes it
 * active (tracked in the HUD), sewer events push its progress, and a finished one is claimed at
 * the board for gold, XP and materials. Untaken and claimed slots are re-rolled each time she
 * comes home from a trip (delve.runs moved); active and finished ones stay put.
 */
import { MATERIAL_KO } from '../data/items'
import { delveOf } from './delve'
import { gainXp } from './stats'
import { townOf } from './town'
import { objectiveXp } from './xp'
import { emptyResult, type MutationResult, type SaveData } from './types'

export type ContractKind = 'kills' | 'elites' | 'nests' | 'chests' | 'clean' | 'boss'
export type ContractStatus = 'offered' | 'active' | 'done' | 'claimed'

export interface ContractReward {
  gold: number
  xp: number
  mats: Record<string, number>
}

export interface Contract {
  id: string
  kind: ContractKind
  /** Counts at this depth or deeper. */
  depth: number
  goal: number
  progress: number
  status: ContractStatus
  reward: ContractReward
}

export const BOARD_SLOTS = 3

/** Sewer happenings that move contracts. */
export type ContractEvent =
  | { type: 'kill'; depth: number; elite: boolean }
  | { type: 'nest'; depth: number }
  /** A treasure chest opened on an explore floor. */
  | { type: 'chest'; depth: number }
  /** A floor's objective met and the stairs taken (or the boss beaten). */
  | { type: 'floor'; depth: number }
  | { type: 'boss'; depth: number }
  /** She fell: a 'clean' contract's run streak starts over. */
  | { type: 'down' }

const KIND_POOL: ContractKind[] = ['kills', 'elites', 'nests', 'chests', 'clean', 'boss']

export function contractGoal(kind: ContractKind, depth: number): number {
  const d = Math.max(1, depth)
  switch (kind) {
    case 'kills':
      return 30 + 10 * (d - 1)
    case 'elites':
      return 3 + Math.min(4, d - 1)
    case 'nests':
      // Nests are optional now (2–3 a floor), so the ask is small.
      return 2
    case 'chests':
      return 4
    case 'clean':
      return 2
    case 'boss':
      return 1
  }
}

const KIND_GOLD: Record<ContractKind, number> = { kills: 45, elites: 55, nests: 50, chests: 45, clean: 70, boss: 110 }
const KIND_XP: Record<ContractKind, number> = { kills: 1.5, elites: 1.8, nests: 1.6, chests: 1.4, clean: 2.2, boss: 3 }

export function contractReward(kind: ContractKind, depth: number, rng: () => number): ContractReward {
  const d = Math.max(1, depth)
  const gold = Math.round(KIND_GOLD[kind] * (1 + 0.5 * (d - 1)) * (0.9 + rng() * 0.2))
  const xp = Math.round(objectiveXp(d) * KIND_XP[kind])
  const mats: Record<string, number> = { dream_dust: 2 + d }
  if (kind === 'elites' || kind === 'boss' || rng() < 0.35) mats.toy_part = 1
  if (kind === 'boss' || (d >= 2 && rng() < 0.3)) mats.star_shard = 1
  return { gold, xp, mats }
}

/** One fresh contract for the depths she has open. */
export function rollContract(save: SaveData, rng: () => number, avoid: ContractKind[] = []): Contract {
  const unlocked = delveOf(save).unlocked
  const free = KIND_POOL.filter((k) => !avoid.includes(k))
  const pool = free.length ? free : KIND_POOL
  const kind = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  // Mostly the deepest open depth, sometimes one shallower for an easy pick.
  const depth = Math.max(1, unlocked - (unlocked > 1 && rng() < 0.4 ? 1 : 0))
  const id = `c${delveOf(save).runs}-${Math.floor(rng() * 1e6).toString(36)}`
  return { id, kind, depth, goal: contractGoal(kind, depth), progress: 0, status: 'offered', reward: contractReward(kind, depth, rng) }
}

/** The board, refreshed when she has been down since it was last filled. */
export function boardOf(save: SaveData, rng: () => number = Math.random): Contract[] {
  const t = townOf(save)
  const runs = delveOf(save).runs
  if (t.boardAt !== runs || t.contracts.length < BOARD_SLOTS) {
    const keep = t.contracts.filter((c) => c.status === 'active' || c.status === 'done')
    const kinds = keep.map((c) => c.kind)
    while (keep.length < BOARD_SLOTS) {
      const c = rollContract(save, rng, kinds)
      kinds.push(c.kind)
      keep.push(c)
    }
    t.contracts = keep
    t.boardAt = runs
  }
  return t.contracts
}

export function activeContracts(save: SaveData): Contract[] {
  return townOf(save).contracts.filter((c) => c.status === 'active' || c.status === 'done')
}

export function takeContract(save: SaveData, id: string): { ok: boolean; reason?: string } {
  const c = townOf(save).contracts.find((x) => x.id === id)
  if (!c) return { ok: false, reason: '게시판에 없는 의뢰야.' }
  if (c.status !== 'offered') return { ok: false, reason: '이미 맡은 의뢰야.' }
  c.status = 'active'
  return { ok: true }
}

/** Push one sewer event into every active contract; returns the ones it just finished. */
export function contractEvent(save: SaveData, e: ContractEvent): Contract[] {
  const done: Contract[] = []
  for (const c of townOf(save).contracts) {
    if (c.status !== 'active') continue
    if (e.type === 'down') {
      if (c.kind === 'clean') c.progress = 0
      continue
    }
    if (e.depth < c.depth) continue
    const hit =
      (c.kind === 'kills' && e.type === 'kill') ||
      (c.kind === 'elites' && e.type === 'kill' && e.elite) ||
      (c.kind === 'nests' && e.type === 'nest') ||
      (c.kind === 'chests' && e.type === 'chest') ||
      (c.kind === 'clean' && (e.type === 'floor' || e.type === 'boss')) ||
      (c.kind === 'boss' && e.type === 'boss')
    if (!hit) continue
    c.progress = Math.min(c.goal, c.progress + 1)
    if (c.progress >= c.goal) {
      c.status = 'done'
      done.push(c)
    }
  }
  return done
}

export function claimContract(save: SaveData, id: string): { ok: boolean; reason?: string; result: MutationResult; reward?: ContractReward } {
  const t = townOf(save)
  const c = t.contracts.find((x) => x.id === id)
  if (!c) return { ok: false, reason: '게시판에 없는 의뢰야.', result: emptyResult() }
  if (c.status !== 'done') return { ok: false, reason: '아직 끝나지 않은 의뢰야.', result: emptyResult() }
  c.status = 'claimed'
  t.contractsDone += 1
  save.gold += c.reward.gold
  for (const [m, n] of Object.entries(c.reward.mats)) save.materials[m] = (save.materials[m] ?? 0) + n
  const result = gainXp(save, c.reward.xp)
  return { ok: true, result, reward: c.reward }
}

/** Abandon an active contract (it goes back on the board untouched). */
export function dropContract(save: SaveData, id: string): boolean {
  const c = townOf(save).contracts.find((x) => x.id === id)
  if (!c || c.status !== 'active') return false
  c.status = 'offered'
  c.progress = 0
  return true
}

export function contractTitle(c: Pick<Contract, 'kind' | 'depth' | 'goal'>): string {
  const d = `깊이 ${c.depth}${c.depth > 1 ? ' 이상' : ''}`
  switch (c.kind) {
    case 'kills':
      return `${d}에서 괴물 ${c.goal}마리 재우기`
    case 'elites':
      return `${d}에서 정예 ${c.goal}마리 쓰러뜨리기`
    case 'nests':
      return `${d}에서 둥지 파이프 ${c.goal}개 막기`
    case 'chests':
      return `${d}에서 보물 상자 ${c.goal}개 열기`
    case 'clean':
      return `${d}에서 쓰러지지 않고 ${c.goal}개 층 돌파`
    case 'boss':
      return `${d}의 악몽 꽃 재우기`
  }
}

/** Short HUD line: "정예 2/4 · 깊이 1". */
export function contractLine(c: Contract): string {
  const what: Record<ContractKind, string> = { kills: '괴물', elites: '정예', nests: '둥지', chests: '상자', clean: '무사 돌파', boss: '보스' }
  return c.status === 'done' ? `${what[c.kind]} 완료! 게시판에서 보상` : `${what[c.kind]} ${c.progress}/${c.goal} · 깊이 ${c.depth}+`
}

export function rewardText(r: ContractReward): string {
  const mats = Object.entries(r.mats)
    .filter(([, n]) => n > 0)
    .map(([m, n]) => `${MATERIAL_KO[m] ?? m} ${n}`)
  return [`골드 ${r.gold}`, `경험치 ${r.xp}`, ...mats].join(' · ')
}
