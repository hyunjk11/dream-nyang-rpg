/**
 * The delve: one trip down the dream sewer. A depth is three normal floors and a boss floor;
 * beating a depth's boss unlocks the next depth at the town portal. Pure rules + save shape, no
 * DOM or three.js — DungeonRun plays one floor at a time, main.ts carries a Delve between them.
 *
 * Rules (also in the PR body):
 *  - Floor 1 survive waves, floor 2 plug nest pipes, floor 3 find the exit room, floor 4 boss.
 *  - Gold picked up down there is "run gold": banked when she comes home. Falling drops a share
 *    of it (DIFFICULTY.delve.deathGoldLoss); items and materials go straight to the bag and stay.
 *  - Checkpoint: the start of the floor she reached. Coming home by portal/scroll or falling keeps
 *    it, so the town portal offers "이어가기" from that floor (fresh maze, fresh foes). Beating the
 *    boss clears it and unlocks the next depth.
 */
import { DIFFICULTY } from '../combat/difficulty'
import { MATERIAL_KO } from '../data/items'
import { addItem } from './inventory'
import { itemName, maxRarityFor, rollDrops, sellValue, type Drop } from './loot'
import { addMaterial } from './quests'
import type { OpenRun, ItemInstance, Rarity, SaveData } from './types'

export type Objective = 'survive' | 'nests' | 'exit' | 'boss'

export interface DelveCheckpoint {
  depth: number
  floor: number
}

export interface DelveSave {
  /** Deepest depth the town portal offers (1 = only the first). */
  unlocked: number
  /** Deepest boss beaten (0 = none yet). */
  cleared: number
  /** Where "이어가기" starts, or null. */
  checkpoint: DelveCheckpoint | null
  /** Trips started (for the maze salt). */
  runs: number
  /** A trip still underway: snapshotted so a reload doesn't eat its gold. */
  open: OpenRun | null
}

export type { OpenRun }

export const BOSS_FLOOR = DIFFICULTY.delve.floors + 1

export function freshDelve(): DelveSave {
  return { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null }
}

/** The save's delve block, made whole (old saves have none; bad values are clamped). */
export function delveOf(save: SaveData): DelveSave {
  const raw = (save.delve ?? {}) as Partial<DelveSave>
  const int = (v: unknown, min: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback)
  const unlocked = int(raw.unlocked, 1, 1)
  const cp = raw.checkpoint
  const checkpoint =
    cp && typeof cp === 'object' && int(cp.depth, 1, 0) >= 1 && int(cp.depth, 1, 0) <= unlocked
      ? { depth: int(cp.depth, 1, 1), floor: Math.min(BOSS_FLOOR, int(cp.floor, 1, 1)) }
      : null
  const o = raw.open
  const open: OpenRun | null =
    o && typeof o === 'object'
      ? {
          depth: int(o.depth, 1, 1),
          floor: Math.min(BOSS_FLOOR, int(o.floor, 1, 1)),
          gold: int(o.gold, 0, 0),
          kills: int(o.kills, 0, 0),
          elites: int(o.elites, 0, 0),
          seconds: int(o.seconds, 0, 0),
          floorsCleared: int(o.floorsCleared, 0, 0),
        }
      : null
  const d: DelveSave = { unlocked, cleared: Math.min(unlocked, int(raw.cleared, 0, 0)), checkpoint, runs: int(raw.runs, 0, 0), open }
  save.delve = d
  return d
}

export interface FloorScale {
  /** Foe hp / damage multipliers on top of DIFFICULTY.horde. */
  hp: number
  damage: number
  /** The wave roster starts at this wave number (1 = the gentle opening). */
  firstWave: number
  boss: { hp: number; damage: number }
  gold: number
}

export interface FloorPlan {
  depth: number
  floor: number
  objective: Objective
  /** Waves to survive, pipes to plug, 1 for exit/boss. */
  goal: number
  seed: number
  /** Maze cells (the boss floor is a short approach to a big arena). */
  cells: number
  bossRoom: number
  scale: FloorScale
}

const OBJECTIVES: Objective[] = ['survive', 'nests', 'exit']

export function floorScale(depth: number, floor: number): FloorScale {
  const k = DIFFICULTY.delve
  const d = Math.max(0, depth - 1)
  const f = Math.max(0, Math.min(floor, BOSS_FLOOR) - 1)
  return {
    hp: 1 + d * k.hpPerDepth + f * k.hpPerFloor,
    damage: 1 + d * k.damagePerDepth + f * k.damagePerFloor,
    firstWave: 1 + d * k.wavesPerDepth + Math.min(f, k.floors - 1) * k.wavesPerFloor,
    boss: { hp: 1 + d * k.bossHpPerDepth, damage: 1 + d * k.bossDamagePerDepth },
    gold: 1 + d * k.goldPerDepth,
  }
}

/** Mix depth, floor and the trip salt into a maze seed. */
export function floorSeed(depth: number, floor: number, salt: number): number {
  let h = (Math.imul(depth, 0x9e3779b1) ^ Math.imul(floor, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return (h ^ (h >>> 13)) >>> 0 || 1
}

export function floorPlan(depth: number, floor: number, salt = 0): FloorPlan {
  const objective: Objective = floor >= BOSS_FLOOR ? 'boss' : OBJECTIVES[(floor - 1) % OBJECTIVES.length]
  const k = DIFFICULTY.delve
  const goal = objective === 'survive' ? k.surviveWaves + Math.min(2, depth - 1) : objective === 'nests' ? k.nests : 1
  return {
    depth,
    floor,
    objective,
    goal,
    seed: floorSeed(depth, floor, salt),
    cells: objective === 'boss' ? 6 : 9,
    bossRoom: objective === 'boss' ? 7 : 5,
    scale: floorScale(depth, floor),
  }
}

/** "깊이 1 · 2층" / "깊이 1 · 보스층". */
export function floorLabel(depth: number, floor: number): string {
  return `깊이 ${depth} · ${floor >= BOSS_FLOOR ? '보스층' : `${floor}층`}`
}

/** One-line objective for the HUD (progress = waves survived / pipes plugged / 0|1). */
export function objectiveText(plan: Pick<FloorPlan, 'objective' | 'goal'>, progress: number, done = false): string {
  if (done) return plan.objective === 'boss' ? '보물 상자를 열고 출구 포털로!' : '계단 포털이 열렸어 · 들어가면 다음 층'
  const n = Math.min(progress, plan.goal)
  switch (plan.objective) {
    case 'survive':
      return `웨이브 버티기 ${n}/${plan.goal}`
    case 'nests':
      return `둥지 파이프 막기 ${n}/${plan.goal}`
    case 'exit':
      return '출구 방 찾기 · 미니맵의 금빛 별'
    case 'boss':
      return '악몽 꽃 쓰러뜨리기'
  }
}

/** Banner title/sub when a floor begins. */
export function floorIntro(plan: FloorPlan): { title: string; sub: string } {
  const title = floorLabel(plan.depth, plan.floor)
  switch (plan.objective) {
    case 'survive':
      return { title, sub: `몰려오는 웨이브를 ${plan.goal}번 버텨 봐` }
    case 'nests':
      return { title, sub: `둥지 파이프 ${plan.goal}개를 물총으로 막아 줘` }
    case 'exit':
      return { title, sub: '미궁 끝의 출구 방을 찾아가자' }
    case 'boss':
      return { title, sub: '달빛 방에 악몽 꽃이 잠들어 있어' }
  }
}

export interface LootLine {
  name: string
  rarity: Rarity | 'material' | 'potion'
}

export type DelveEnd = 'clear' | 'recall' | 'down'

export interface DelveSummary {
  end: DelveEnd
  depth: number
  /** Floor she reached (the boss floor counts when cleared). */
  floor: number
  floorsCleared: number
  kills: number
  elites: number
  seconds: number
  /** Gold banked / dropped. */
  gold: number
  lost: number
  loot: LootLine[]
  /** Depth newly opened at the portal (0 = none). */
  unlocked: number
  /** XP earned this trip and the level she came home at. */
  xp?: number
  level?: number
}

/** Dungeon drop table per foe (scaled by depth). Bosses roll it with boss=true. */
export const DELVE_TABLE = { gold: [1, 3] as [number, number], gear: 0.03, weapon: 0.014, dust: 0.08, part: 0.02, potion: 0.03 }

/** What a single kill leaves on the floor. Potions come out as hearts (healing on touch). */
/** Item level of drops: depth weighs most, floors nudge it, the boss adds one. */
export function itemLevelFor(depth: number, floor = 1, boss = false): number {
  return 1 + 4 * (Math.max(1, depth) - 1) + (Math.max(1, Math.min(floor, BOSS_FLOOR)) - 1) + (boss ? 1 : 0)
}

export function delveDrops(depth: number, elite: boolean, boss: boolean, rng: () => number, luck = 2, floor = 1): Drop[] {
  const s = floorScale(depth, 1)
  const table = boss
    ? { gold: [40, 60] as [number, number], gear: 0.98, weapon: 0.6, dust: 1, part: 1, potion: 1 }
    : { ...DELVE_TABLE, gold: [DELVE_TABLE.gold[0], Math.round(DELVE_TABLE.gold[1] * s.gold)] as [number, number] }
  const drops = rollDrops({ table, luck, elite, boss, rng, itemLevel: itemLevelFor(depth, floor, boss), bias: (depth - 1) * 5, cap: maxRarityFor(depth, boss) })
  if (boss) for (const d of drops) if (d.kind === 'gold') d.amount = Math.round(d.amount * s.gold)
  return drops
}

/** One trip: counts, run gold and the loot list, across floors. */
export class Delve {
  readonly depth: number
  floor: number
  readonly salt: number
  floorsCleared = 0
  kills = 0
  elites = 0
  seconds = 0
  gold = 0
  /** XP earned this trip (summary card). */
  xp = 0
  readonly loot: LootLine[] = []
  ended: DelveSummary | null = null
  /** This trip's boss is down (a fall afterwards keeps the checkpoint cleared). */
  bossBeaten = false

  constructor(depth: number, floor = 1, salt = 0) {
    this.depth = Math.max(1, Math.floor(depth))
    this.floor = Math.max(1, Math.min(BOSS_FLOOR, Math.floor(floor)))
    this.salt = salt
  }

  /** Start a trip from the town portal; refuses depths that aren't open yet. */
  static start(save: SaveData, depth: number, floor = 1): Delve | null {
    const d = delveOf(save)
    if (depth < 1 || depth > d.unlocked) return null
    d.runs += 1
    const run = new Delve(depth, floor, d.runs)
    d.checkpoint = { depth: run.depth, floor: run.floor }
    run.sync(save)
    return run
  }

  /** Resume from the saved checkpoint (null when there is none). */
  static resume(save: SaveData): Delve | null {
    const cp = delveOf(save).checkpoint
    return cp ? Delve.start(save, cp.depth, cp.floor) : null
  }

  get plan(): FloorPlan {
    return floorPlan(this.depth, this.floor, this.salt)
  }

  get onBoss(): boolean {
    return this.floor >= BOSS_FLOOR
  }

  /** Floor objective met and she took the stairs: next floor (checkpoint saved). */
  nextFloor(save: SaveData): FloorPlan {
    if (this.onBoss) throw new Error('boss floor has no stairs')
    this.floor += 1
    this.floorsCleared += 1
    delveOf(save).checkpoint = { depth: this.depth, floor: this.floor }
    this.sync(save)
    return this.plan
  }

  /** Snapshot the trip into the save (run gold survives a reload; see settleOpenRun). */
  sync(save: SaveData): void {
    if (this.ended) return
    delveOf(save).open = {
      depth: this.depth,
      floor: this.floor,
      gold: this.gold,
      kills: this.kills,
      elites: this.elites,
      seconds: Math.round(this.seconds),
      floorsCleared: this.floorsCleared,
    }
  }

  /** A kill down there (floor-level counts are folded in here). */
  kill(elite: boolean): void {
    this.kills += 1
    if (elite) this.elites += 1
  }

  /**
   * Pick up a drop. Gold is held as run gold; items go to the bag (a full bag sells them on the
   * spot, as run gold); materials go to the save. Potions heal on touch, so return their share.
   */
  pickup(save: SaveData, drop: Drop, rng: () => number = Math.random): { heal: number; text: string } {
    if (drop.kind === 'gold') {
      this.gold += drop.amount
      return { heal: 0, text: `+${drop.amount} 골드` }
    }
    if (drop.kind === 'potion') {
      this.loot.push({ name: '하트 사탕', rarity: 'potion' })
      return { heal: 0.25, text: '하트 사탕 · 체력 회복' }
    }
    if (drop.kind === 'material' && drop.matId) {
      addMaterial(save, drop.matId, drop.amount, rng)
      const name = MATERIAL_KO[drop.matId] ?? drop.matId
      this.loot.push({ name: `${name} ×${drop.amount}`, rarity: 'material' })
      return { heal: 0, text: `+${drop.amount} ${name}` }
    }
    if (drop.kind === 'item' && drop.item) return this.takeItem(save, drop.item)
    return { heal: 0, text: '' }
  }

  private takeItem(save: SaveData, item: ItemInstance): { heal: number; text: string } {
    const name = itemName(item)
    if (addItem(save, item)) {
      this.loot.push({ name, rarity: item.rarity })
      return { heal: 0, text: `${name} 획득!` }
    }
    const v = sellValue(item)
    this.gold += v
    return { heal: 0, text: `가방이 가득 · ${name} → ${v} 골드` }
  }

  /** The boss went down: unlock the next depth and close the checkpoint. */
  bossCleared(save: SaveData): number {
    const d = delveOf(save)
    this.floorsCleared += this.onBoss ? 1 : 0
    this.bossBeaten = true
    d.cleared = Math.max(d.cleared, this.depth)
    const opened = d.unlocked < this.depth + 1 ? this.depth + 1 : 0
    d.unlocked = Math.max(d.unlocked, this.depth + 1)
    d.checkpoint = null
    return opened
  }

  /** Home again (portal after the boss = 'clear', mid-run return = 'recall', fell = 'down'). */
  finish(save: SaveData, end: DelveEnd, unlocked = 0): DelveSummary {
    if (this.ended) return this.ended
    const lost = end === 'down' ? Math.floor(this.gold * DIFFICULTY.delve.deathGoldLoss) : 0
    const gold = this.gold - lost
    save.gold = Math.max(0, save.gold + gold)
    const d = delveOf(save)
    d.open = null
    if (end !== 'clear' && !this.bossBeaten) d.checkpoint = { depth: this.depth, floor: this.floor }
    this.ended = {
      end,
      depth: this.depth,
      floor: this.floor,
      floorsCleared: this.floorsCleared,
      kills: this.kills,
      elites: this.elites,
      seconds: Math.round(this.seconds),
      gold,
      lost,
      loot: [...this.loot],
      unlocked,
      xp: this.xp,
      level: save.level,
    }
    return this.ended
  }
}

/**
 * A save loaded with a trip still open (the tab closed or reloaded mid-run): bank its run gold
 * as if she had recalled, keep the checkpoint, and say how much came home. Null = nothing open.
 */
export function settleOpenRun(save: SaveData): OpenRun | null {
  const d = delveOf(save)
  const open = d.open
  if (!open) return null
  d.open = null
  save.gold = Math.max(0, save.gold + open.gold)
  if (!d.checkpoint && open.depth <= d.unlocked && open.depth > d.cleared) d.checkpoint = { depth: open.depth, floor: open.floor }
  return open
}

/** "3분 07초". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return m ? `${m}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`
}

/** Portal menu entries: resume (if any), then each open depth, deepest first. */
export function portalChoices(save: SaveData): { label: string; depth: number; floor: number; resume: boolean }[] {
  const d = delveOf(save)
  const out: { label: string; depth: number; floor: number; resume: boolean }[] = []
  // Floor 1 is the same as picking the depth itself, so only deeper checkpoints get a line.
  if (d.checkpoint && d.checkpoint.floor > 1) {
    out.push({ label: `이어가기 · ${floorLabel(d.checkpoint.depth, d.checkpoint.floor)}`, depth: d.checkpoint.depth, floor: d.checkpoint.floor, resume: true })
  }
  for (let depth = d.unlocked; depth >= Math.max(1, d.unlocked - 2); depth -= 1) {
    out.push({ label: `꿈 하수도 깊이 ${depth}${depth > d.cleared ? '' : ' ✓'}`, depth, floor: 1, resume: false })
  }
  return out
}
