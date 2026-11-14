/**
 * 챕터 2 · 꿈의 비밀. The chapter now begins in the dungeon:
 *
 *   섬 마을(배우기) → 꿈 미로 (4층, 모찌가 이어 주는 퀘스트 넷) → 미로 밖 몽실 마을 도착 →
 *   이장 몽이의 이야기 (등불 · 다락 · 볼트 개조 · 시계탑 파수꾼 · 나방의 실 · 달빛 둥지) → 챕터 3 예고.
 *
 * Pure save logic: area plans, the maze chain, the story chain, migration of old chapter-2 saves.
 * The 3D side (run.ts spots, main.ts travel) only reports events here and paints what comes back.
 */
import { BOSS_FLOOR, floorScale, floorSeed, type FloorPlan, type FloorScale } from './delve'
import { HALO_SET } from '../data/legends'
import { GEAR_IDS, ITEMS, WEAPON_IDS } from '../data/items'
import { makeLegend, legendsOf, recordLegend } from './legends'
import { makeMod } from './mods'
import { AREAS, AREA_IDS, areaLabel, isArea, type AreaId } from './areas'
import { chapter2Open, chaptersOf } from './chapters'
import { addItem } from './inventory'
import { makeItem, plusOf } from './loot'
import { gainGold, gainXp } from './stats'
import type { MutationResult, Rarity, SaveData } from './types'

// ---------------------------------------------------------------- 지역 (areas)

export { AREAS, AREA_IDS, areaLabel, isArea, type AreaDef, type AreaId } from './areas'

/** One area floor as a run plan (numbers from the sewer floor it borrows; no star door). */
export function areaPlan(area: AreaId, floor: number, salt = 0): FloorPlan {
  const a = AREAS[area]
  const f = Math.max(1, Math.min(a.floors, Math.floor(floor)))
  const boss = !!a.boss && f >= a.floors
  const sf = a.scaleFloors[f - 1] || BOSS_FLOOR
  const scale: FloorScale = floorScale(a.depth, sf)
  if (boss && a.boss) scale.boss = { ...scale.boss, hp: scale.boss.hp * a.boss.hp }
  return {
    depth: a.depth,
    floor: sf,
    objective: boss ? 'boss' : 'exit',
    goal: 1,
    key: false,
    seed: floorSeed(20 + AREA_IDS.indexOf(area), f, salt),
    cells: boss ? 6 : area === 'maze' ? 12 : 10,
    bossRoom: boss ? 7 : 5,
    scale,
    area,
    areaFloor: f,
    label: areaLabel(area, f),
    theme: a.theme,
  }
}

/** 몽실 마을: an open, foe-less night market (the run's 'town' objective). */
export function townPlan(salt = 0): FloorPlan {
  return { depth: 1, floor: 1, objective: 'town', goal: 1, key: false, seed: floorSeed(30, 1, salt), cells: 9, bossRoom: 5, scale: floorScale(1, 1), label: '몽실 마을', theme: 'market' }
}

// ---------------------------------------------------------------- 저장

export type StoryState = 'offer' | 'active' | 'ready'

/** 볼트의 개조 퀘스트가 시작될 때의 총 상태. 그보다 강화가 오르거나 부품이 늘면 완료. */
export interface GunMark {
  plus: number
  mods: number
}

export interface DreamSave {
  /** entered: she has walked into the 꿈 미로 at least once (모찌's chain starts there). */
  maze: { step: number; count: number; passed: boolean; entered: boolean }
  story: { step: number; state: StoryState; count: number; done: boolean; mark: GunMark; v: number }
  /** Where she wakes up after a reload: the island, or in 몽실 마을. */
  home: 'island' | 'mongsil'
  /** Story areas whose waypoint she has reached (the 별문 network lists them). */
  gates: AreaId[]
}

/** Story block version. 1 = the four-beat 꿈의 비밀 (s1 들판, s2 다락, s3 시계탑, s4 둥지). */
export const STORY_V = 2
const LEGACY_STORY = ['s1', 's2', 's3', 's4'] as const

const fresh = (): DreamSave => ({ maze: { step: 0, count: 0, passed: false, entered: false }, story: { step: 0, state: 'offer', count: 0, done: false, mark: { plus: 0, mods: 0 }, v: STORY_V }, home: 'island', gates: [] })

const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : d)

/**
 * Old four-beat index → today's quest. A player who had not started the next dungeon yet
 * picks up the new beat (개조, then 나방의 실) instead of skipping it. One already inside a
 * dungeon stays on that quest.
 */
function placeLegacy(step: number, state: StoryState, done: boolean): { step: number; state: StoryState } {
  if (done) return { step: STORY.length, state: 'offer' }
  let id: string = LEGACY_STORY[Math.min(LEGACY_STORY.length - 1, Math.max(0, step))] ?? 's1'
  if (step >= LEGACY_STORY.length) id = 's4'
  if (id === 's3' && state === 'offer') id = 's_bolt'
  if (id === 's4' && state === 'offer') id = 's_silk'
  const i = STORY.findIndex((q) => q.id === id)
  return { step: i < 0 ? 0 : i, state }
}

/**
 * The save's chapter-2 story block, made whole. A save from before the maze that already played
 * chapter 2 on the board (any quest taken, or the chapter cleared) has the maze passed for it and
 * keeps going from 몽실 마을; a chapter-2 clear from the old board boss is reopened, since the
 * chapter now ends with the story.
 */
export function dreamOf(save: SaveData): DreamSave {
  const raw = save.dream as Partial<DreamSave> | undefined
  if (raw && seen.has(raw)) return raw as DreamSave
  const d = fresh()
  if (raw && typeof raw === 'object') {
    const m = (raw.maze ?? {}) as Partial<DreamSave['maze']>
    const s = (raw.story ?? {}) as Partial<DreamSave['story']>
    d.maze = { step: int(m.step, 0, MAZE_CHAIN.length, 0), count: int(m.count, 0, 1e6, 0), passed: !!m.passed, entered: false }
    // Older saves had no 'entered': any maze progress means she was in there.
    d.maze.entered = !!m.entered || d.maze.passed || d.maze.step > 0 || d.maze.count > 0
    const legacy = (s as { v?: unknown }).v !== STORY_V
    const state: StoryState = s.state === 'active' || s.state === 'ready' ? s.state : 'offer'
    const placed = legacy ? placeLegacy(int(s.step, 0, LEGACY_STORY.length, 0), state, !!s.done) : { step: int(s.step, 0, STORY.length, 0), state }
    const markRaw = (s as { mark?: Partial<GunMark> }).mark
    const mark: GunMark = {
      plus: int(markRaw?.plus, 0, 99, 0),
      mods: int(markRaw?.mods, 0, 99, 0),
    }
    d.story = { step: placed.step, state: placed.state, count: int(s.count, 0, 1e6, 0), done: !!s.done, mark, v: STORY_V }
    d.home = raw.home === 'mongsil' && d.maze.passed ? 'mongsil' : 'island'
    d.gates = Array.isArray(raw.gates) ? [...new Set(raw.gates.filter(isArea))] : []
    if (d.story.done) d.story.step = STORY.length
  } else {
    const c = chaptersOf(save)
    // Only a save that really reached chapter 2 counts: one that took a board quest during the guide stays put.
    const played = c.current >= 2 && (c.cleared.includes(2) || Object.values(c.quests).some((q) => q.status !== 'locked' && q.status !== 'offered'))
    if (played) {
      d.maze = { step: MAZE_CHAIN.length, count: 0, passed: true, entered: true }
      if (c.cleared.includes(2)) {
        c.cleared = c.cleared.filter((n) => n !== 2)
        c.current = 2
        if (c.card === 2) c.card = 0
      }
    }
  }
  save.dream = d
  seen.add(d)
  return d
}

const seen = new WeakSet<object>()

// ---------------------------------------------------------------- 모찌의 미로 퀘스트

export type MazeQuestKind = 'kill' | 'frag' | 'rescue' | 'elite'

export interface MazeQuest {
  id: string
  kind: MazeQuestKind
  title: string
  goal: number
  /** 모찌 hands it over with this line. */
  give: string
  /** …and says this when it is done. */
  done: string
  reward: { gold: number; xp: number }
}

export const MAZE_ELITE = { kind: 'knight' as const, name: '미로지기 악몽 기사', hp: 2.6 }
export const RESCUE_NAME = '구름양 뭉게'

export const MAZE_CHAIN: MazeQuest[] = [
  { id: 'm_kill', kind: 'kill', title: '미로의 악몽 잠재우기', goal: 12, give: '미로가 우리를 시험하고 있어. 길을 막는 악몽 열둘만 잠재워 줘. 그럼 길이 조금 열릴 거야.', done: '좋아, 미로가 숨을 고르고 있어. 어? 저 끝에서 뭔가 반짝이는데…', reward: { gold: 40, xp: 90 } },
  { id: 'm_frag', kind: 'frag', title: '꿈 조각 찾기', goal: 1, give: '꿈 조각이야! 미로 깊은 막다른 곳에 떨어져 있어. 화살표를 따라가서 E로 주워 줘.', done: '이 조각… 어린 별하가 그린 그림이 비쳐. 왜 이게 여기 있지? 일단 챙겨 두자.', reward: { gold: 50, xp: 110 } },
  { id: 'm_rescue', kind: 'rescue', title: `${RESCUE_NAME} 구하기`, goal: 1, give: '누가 울고 있어. 구름양이 악몽 거미줄에 걸렸나 봐! 찾아서 E로 풀어 주자. 풀어 주면 악몽이 몰려올 거야, 조심!', done: '뭉게가 그러는데, 미로 밖에 구름양들의 마을이 있대. 몽실 마을! 문지기만 넘으면 돼.', reward: { gold: 60, xp: 130 } },
  { id: 'm_elite', kind: 'elite', title: `${MAZE_ELITE.name} 쓰러뜨리기`, goal: 1, give: '미로의 문지기가 깨어났어. 저 기사를 쓰러뜨리면 출구가 열려. 같이 하자, 별하!', done: '출구가 열렸어! 마지막 층의 금빛 계단으로 미로 밖으로 나가자.', reward: { gold: 80, xp: 160 } },
]

/** 모찌's maze chain is on: chapter 2 is open and she has stepped into the 꿈 미로. */
export function mazeOpen(save: SaveData): boolean {
  const d = dreamOf(save)
  return chapter2Open(save) && (d.maze.entered || d.maze.passed)
}

/** 몽실 마을 (and 몽이's story) is reachable: chapter 2 open and the maze walked out of. */
export function mongsilOpen(save: SaveData): boolean {
  return chapter2Open(save) && dreamOf(save).maze.passed
}

/** Walked into the 꿈 미로 (only counts once chapter 2 is open). */
export function enterMaze(save: SaveData): void {
  if (chapter2Open(save)) dreamOf(save).maze.entered = true
}

export function mazeQuest(save: SaveData): MazeQuest | null {
  if (!mazeOpen(save)) return null
  return MAZE_CHAIN[dreamOf(save).maze.step] ?? null
}

/** The maze's last stairs open once 모찌's four quests are done. */
export function mazeCleared(save: SaveData): boolean {
  return dreamOf(save).maze.step >= MAZE_CHAIN.length
}

export interface DreamOut {
  /** 모찌 (or 몽이) line to show. */
  say: { who: string; text: string } | null
  toasts: string[]
  result: MutationResult | null
  /** A new maze quest became active (the run places its spot / elite). */
  next: MazeQuest | null
  /** The chapter was just cleared. */
  cleared: number
}

const dout = (): DreamOut => ({ say: null, toasts: [], result: null, next: null, cleared: 0 })

function reward(save: SaveData, gold: number, xp: number, o: DreamOut): void {
  gainGold(save, gold)
  const r = gainXp(save, xp)
  r.toasts.unshift(`골드 +${gold}`, `경험치 +${xp}`)
  o.result = r
}

/** Something happened in the maze that 모찌's current quest may want. */
export function mazeEvent(save: SaveData, kind: MazeQuestKind, amount = 1): DreamOut {
  const o = dout()
  const d = dreamOf(save)
  const q = mazeOpen(save) ? MAZE_CHAIN[d.maze.step] : undefined
  if (!q || q.kind !== kind) return o
  d.maze.count = Math.min(q.goal, d.maze.count + amount)
  if (d.maze.count < q.goal) {
    if (q.goal > 1 && (d.maze.count % 4 === 0 || d.maze.count === q.goal - 1)) o.toasts.push(`${q.title} ${d.maze.count}/${q.goal}`)
    return o
  }
  d.maze.step += 1
  d.maze.count = 0
  reward(save, q.reward.gold, q.reward.xp, o)
  o.toasts.unshift(`모찌 퀘스트 완료! ${q.title}`)
  const next = MAZE_CHAIN[d.maze.step] ?? null
  o.next = next
  o.say = { who: '모찌', text: next ? `${q.done} …그리고, ${next.give}` : q.done }
  return o
}

/** Took the last stairs out: 몽실 마을 is reached for good. */
export function passMaze(save: SaveData): void {
  const d = dreamOf(save)
  d.maze.passed = true
  d.maze.entered = true
  d.maze.step = MAZE_CHAIN.length
  d.home = 'mongsil'
}

/** HUD tracker row for the maze, or null. */
export function mazeHud(save: SaveData): { title: string; prog: string } | null {
  const d = dreamOf(save)
  if (d.maze.passed || !mazeOpen(save)) return null
  const q = MAZE_CHAIN[d.maze.step]
  if (!q) return { title: '미로 밖으로', prog: '마지막 층 금빛 계단' }
  return { title: `모찌 · ${q.title}`, prog: q.goal > 1 ? `${d.maze.count}/${q.goal}` : '0/1' }
}

// ---------------------------------------------------------------- 꿈의 비밀 (몽이의 이야기)

export type StoryKind = 'spark' | 'area' | 'boss' | 'tinker' | 'hunt'

export interface StoryQuest {
  id: string
  title: string
  kind: StoryKind
  /** Where it happens: the field, 몽실(볼트), or an area. */
  where: 'field' | 'mongsil' | AreaId
  goal: number
  /** Hunt quests count this foe kind. */
  foe?: string
  /** 몽이 explains (offer) and what she learns when handing it in (reveal). */
  offer: { who: string; text: string }[]
  reveal: { who: string; text: string }[]
  reward: { gold: number; xp: number; gear: Rarity }
}

/** 시계탑 마지막 층의 미니보스. 출구 계단은 이놈이 쓰러진 뒤에 열린다. */
export const TOWER_WARDEN = { kind: 'cog' as const, name: '똑딱 파수꾼', hp: 1.45 }
export const MOTH_KIND = 'mothling'
export const MOTH_KO = '달가루 나방'

export const STORY: StoryQuest[] = [
  {
    id: 's1',
    title: '꺼진 등불',
    kind: 'spark',
    where: 'field',
    goal: 6,
    offer: [
      { who: '몽이', text: '어서 와요, 미로를 건너온 손님. 나는 몽이, 이 마을 이장이에요. 요즘 야시장 등불이 하나씩 꺼지고 있어요.' },
      { who: '몽이', text: '몽실 들판에 흩어진 등불 불씨 여섯 개만 모아 줄래요? 별문에서 들판으로 갈 수 있어요.' },
    ],
    reveal: [
      { who: '몽이', text: '불씨가 따뜻하네요. 이건 비밀인데… 등불 하나하나가 누군가 잊어버린 꿈이에요.' },
      { who: '모찌', text: '잊힌 꿈이 등불이 된다고? 그럼 꺼진 등불은…' },
      { who: '몽이', text: '배고픈 꿈이 되어 괴물로 깨어나요. 구름 다락에서 요즘 속삭임이 들려요. 가 봐 줄래요?' },
    ],
    reward: { gold: 90, xp: 180, gear: 'rare' },
  },
  {
    id: 's2',
    title: '구름 다락의 속삭임',
    kind: 'area',
    where: 'loft',
    goal: 1,
    offer: [{ who: '몽이', text: '구름 다락은 별문 두 번째 문이에요. 다락 끝까지 올라가서, 속삭임이 무슨 말인지 들어 줘요.' }],
    reveal: [
      { who: '별하', text: '다락 끝에서 누가 계속 같은 말을 했어. "3시 33분…" 그게 무슨 뜻이지?' },
      { who: '몽이', text: '그 속삭임은 잠들기 직전의 숨이에요. 총을 만지는 볼트가, 꿈을 총의 모양으로 붙잡는 법을 알아요. 먼저 볼트에게 가 봐요.' },
    ],
    reward: { gold: 120, xp: 240, gear: 'rare' },
  },
  {
    id: 's_bolt',
    title: '볼트의 첫 개조',
    kind: 'tinker',
    where: 'mongsil',
    goal: 1,
    offer: [
      { who: '몽이', text: '볼트는 광장 동쪽 총포상이에요. 꿈을 부품으로 깎아 총에 끼우거나, 지금 총보다 한 단계 더 강화해 와요.' },
      { who: '볼트', text: '흐흐, 총열 하나랑 꿈가루를 챙겨 뒀어. 끼우거나 +를 올리면, 꿈이 총에 달라붙어. 몽이에게 보여 줘.' },
    ],
    reveal: [
      { who: '볼트', text: '봤지? 강화는 숫자를 올리는 게 아니야. 별하가 꾼 꿈을, 총이 기억하게 하는 거지.' },
      { who: '몽이', text: '그래서 시계탑이 멈춘 거예요. 3시 33분, 별하 씨가 잠든 시각을 누군가 붙잡고 있어요. 꼭대기의 똑딱 파수꾼을 잠재워 줘요.' },
    ],
    reward: { gold: 80, xp: 160, gear: 'rare' },
  },
  {
    id: 's3',
    title: '멈춘 시계탑',
    kind: 'area',
    where: 'tower',
    goal: 1,
    offer: [{ who: '몽이', text: '시계탑은 별문에서 이어져요. 꼭대기 출구를 똑딱 파수꾼이 막고 있어요. 화살표를 따라 파수꾼을 쓰러뜨리고, 금빛 계단으로 나와 줘요.' }],
    reveal: [
      { who: '별하', text: '시계의 심장이… 방울 모양이야. 모찌, 네 목에 달린 거랑 똑같아.' },
      { who: '모찌', text: '…기억났어. 3시 33분은 별하가 책상에서 잠든 시각이야. 그리고 나는, 별하가 어릴 때 꾼 꿈에서 태어났어. 너를 지키려고.' },
      { who: '몽이', text: '파수꾼이 떨어뜨린 자장가 물총을 챙겨 두세요. 짝이 되는 달무리 물총은, 나방의 둥지에서만 완성된대요.' },
    ],
    reward: { gold: 150, xp: 300, gear: 'epic' },
  },
  {
    id: 's_silk',
    title: '나방의 실',
    kind: 'hunt',
    where: 'field',
    foe: MOTH_KIND,
    goal: 8,
    offer: [{ who: '몽이', text: '들판에 달가루 나방이 내려앉기 시작했어요. 여덟 마리를 잠재우면, 그 실이 둥지로 가는 길을 보여 줄 거예요. 나방은 멀리서 달빛 탄을 쏘니, 옆으로 피하세요.' }],
    reveal: [
      { who: '별하', text: '나방 날개에 내 이름이 실로 수놓여 있었어. 누군가 내 꿈을 짜고 있어.' },
      { who: '몽이', text: '그 베틀의 주인이 꿈먹는 밤나방이에요. 달빛 둥지 별문을 열었어요. 자장가 물총을 들고 가 주면, 짝이 될 달무리 물총을 드릴게요.' },
    ],
    reward: { gold: 140, xp: 260, gear: 'rare' },
  },
  {
    id: 's4',
    title: '달빛 둥지',
    kind: 'boss',
    where: 'moon',
    goal: 1,
    offer: [{ who: '몽이', text: '달빛 둥지는 별문 맨 끝이에요. 밤나방은 고리 탄에 길을 비워 두고, 마지막엔 부채처럼 조준해요. 빈칸과 옆으로 빠지는 걸 보고 잠재워 줘요.' }],
    reveal: [
      { who: '몽이', text: '등불이 전부 다시 켜졌어요! 마을이 이렇게 밝은 건 처음이에요. 달무리 물총, 자장가와 양손에 차 보세요.' },
      { who: '???', text: '…별하야. 별하야, 일어나…' },
      { who: '별하', text: '방금… 꿈 바깥에서 누가 날 불렀어. 모찌, 들었어?' },
      { who: '모찌', text: '응. 꿈 바깥의 목소리야. 별문에 다음 장으로 가는 문이 생겼는데… 아직 잠겨 있어. 다음 꿈을 준비하는 중이야.' },
    ],
    reward: { gold: 220, xp: 420, gear: 'epic' },
  },
]

export function storyQuest(save: SaveData): StoryQuest | null {
  const d = dreamOf(save)
  if (!mongsilOpen(save)) return null
  return d.story.done ? null : (STORY[d.story.step] ?? null)
}

/** 몽이's talk: offer → active; ready → reward, reveal, next offer. */
export function storyTalk(save: SaveData, rng: () => number = Math.random): { lines: { who: string; text: string }[]; out: DreamOut; took: boolean } {
  const o = dout()
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!mongsilOpen(save)) return { lines: [{ who: '몽이', text: '미로를 건너온 손님만 몽실 마을에 닿을 수 있어요. 꿈 미로에서 기다릴게요.' }], out: o, took: false }
  if (!q) return { lines: [{ who: '몽이', text: '등불이 오늘도 따뜻해요. 꿈 바깥의 목소리… 별하 씨라면 따라갈 수 있을 거예요.' }], out: o, took: false }
  if (d.story.state === 'offer') {
    d.story.state = 'active'
    d.story.count = 0
    if (q.kind === 'tinker') giftTinker(save, d, o)
    o.toasts.push(`이야기 퀘스트 · ${q.title}`)
    return { lines: q.offer, out: o, took: true }
  }
  if (d.story.state === 'active') {
    if (q.kind === 'tinker' && tinkerReady(save)) {
      d.story.state = 'ready'
      d.story.count = q.goal
    } else {
      const where = q.kind === 'tinker' ? '볼트의 공방에서 총을 손봐 줘.' : '별문에서 길이 이어져요.'
      return { lines: [{ who: '몽이', text: `${q.title}… ${storyGoal(q, d.story.count)}. ${where}` }], out: o, took: false }
    }
  }
  // ready: hand in.
  reward(save, q.reward.gold, q.reward.xp, o)
  const pool = rng() < 0.4 ? WEAPON_IDS : GEAR_IDS
  const defId = pool[Math.floor(rng() * pool.length)] ?? 'hat_pin'
  const item = makeItem(defId, q.reward.gear, rng, Math.max(3, save.level))
  if (addItem(save, item)) o.result?.toasts.push(`${ITEMS[defId]?.name ?? defId} 획득!`)
  else gainGold(save, 60)
  if (q.id === 's3') grantLegend(save, 'leg_lullaby', o)
  if (q.id === 's4') grantLegend(save, 'leg_halo', o)
  o.toasts.push(`이야기 퀘스트 완료! ${q.title}`)
  d.story.step += 1
  d.story.count = 0
  d.story.state = 'offer'
  if (d.story.step >= STORY.length) {
    d.story.done = true
    const c = chaptersOf(save)
    if (!c.cleared.includes(2)) c.cleared.push(2)
    c.current = Math.max(c.current, 3)
    c.card = 2
    o.cleared = 2
  }
  return { lines: q.reveal, out: o, took: false }
}

function storyGoal(q: StoryQuest, count: number): string {
  if (q.kind === 'spark') return `등불 불씨 ${count}/${q.goal}`
  if (q.kind === 'hunt') return `${MOTH_KO} ${count}/${q.goal}`
  if (q.kind === 'tinker') return '총을 한 단계 강화하거나 부품을 끼우기'
  if (q.kind === 'boss') return `${AREAS.moon.boss?.name ?? '보스'} 잠재우기`
  if (q.where === 'tower') return '똑딱 파수꾼을 쓰러뜨리고 출구 계단으로'
  return `${AREAS[q.where as AreaId]?.name ?? ''} 끝까지 가기`
}

/** Highest +N and how many parts sit in guns (bag and stash). */
export function gunWork(save: SaveData): GunMark {
  const stash = (save.town as { stash?: SaveData['items'] } | undefined)?.stash ?? []
  let plus = 0
  let mods = 0
  for (const item of [...save.items, ...stash]) {
    if (ITEMS[item.defId]?.slot !== 'weapon') continue
    plus = Math.max(plus, plusOf(item))
    mods += item.mods?.length ?? 0
  }
  return { plus, mods }
}

function tinkerReady(save: SaveData): boolean {
  const mark = dreamOf(save).story.mark
  const now = gunWork(save)
  return now.plus > mark.plus || now.mods > mark.mods
}

/** Dust, a floor of gold for +1, and a barrel so the step can always be done. */
function giftTinker(save: SaveData, d: DreamSave, o: DreamOut): void {
  d.story.mark = gunWork(save)
  save.materials.dream_dust = (save.materials.dream_dust ?? 0) + 2
  if (save.gold < 28) save.gold = 28
  const part = makeMod('mod_barrel', 'rare', Math.max(4, save.level))
  if (addItem(save, part)) o.toasts.push('긴 꿈 총열 · 꿈가루를 받았어. 볼트에게 끼우거나 강화해')
}

/**
 * Workshop closed (or a test): if the tinker step just became doable, mark it ready.
 * Returns the toast, or null.
 */
export function noteTinker(save: SaveData): string | null {
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!q || q.kind !== 'tinker' || d.story.state !== 'active' || !tinkerReady(save)) return null
  d.story.state = 'ready'
  d.story.count = q.goal
  return `이야기 퀘스트 달성! ${q.title} · 몽이에게 보고`
}

function ownsLegend(save: SaveData, id: string): boolean {
  if (legendsOf(save).found.includes(id)) return true
  if (save.items.some((i) => i.defId === id)) return true
  const stash = (save.town as { stash?: { defId: string }[] } | undefined)?.stash ?? []
  return stash.some((i) => i.defId === id)
}

function grantLegend(save: SaveData, id: string, o: DreamOut): void {
  if (ownsLegend(save, id)) return
  const item = makeLegend(id, Math.max(6, save.level + 1))
  if (!addItem(save, item)) {
    gainGold(save, 80)
    o.toasts.push('가방이 가득해서 세트 물총 대신 골드 80')
    return
  }
  recordLegend(save, item)
  o.toasts.push(`${ITEMS[id]?.name ?? id} 획득! · ${HALO_SET.name}`)
}

export type StoryHappen =
  | { type: 'spark'; amount?: number }
  | { type: 'area'; area: AreaId }
  | { type: 'boss'; area: AreaId }
  | { type: 'hunt'; kind: string; amount?: number }

/** A story happening out there: sparks in the field, an area walked to its end, mothlings, the moth. */
export function storyEvent(save: SaveData, e: StoryHappen): DreamOut {
  const o = dout()
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!q || d.story.state !== 'active') return o
  const fits =
    (e.type === 'spark' && q.kind === 'spark') ||
    (e.type === 'area' && q.kind === 'area' && q.where === e.area) ||
    (e.type === 'boss' && q.kind === 'boss' && q.where === e.area) ||
    (e.type === 'hunt' && q.kind === 'hunt' && e.kind === (q.foe ?? MOTH_KIND))
  if (!fits) return o
  const n = e.type === 'spark' || e.type === 'hunt' ? (e.amount ?? 1) : 1
  d.story.count = Math.min(q.goal, d.story.count + n)
  if (d.story.count < q.goal) {
    o.toasts.push(storyGoal(q, d.story.count))
    return o
  }
  d.story.state = 'ready'
  o.toasts.push(`이야기 퀘스트 달성! ${q.title} · 몽실 마을 몽이에게`)
  return o
}

/** Areas the 별문 in 몽실 offers: those the story reached so far (plus the field). */
export function openAreas(save: SaveData): AreaId[] {
  const d = dreamOf(save)
  if (!mongsilOpen(save)) return []
  const out: AreaId[] = []
  const reach = d.story.done ? STORY.length : d.story.step + (d.story.state === 'offer' ? 0 : 1)
  for (let i = 0; i < reach; i += 1) {
    const w = STORY[i]?.where
    if (w && isArea(w) && !out.includes(w)) out.push(w)
  }
  return out
}

/** Does this trip need the field's sparks (s1 active)? */
export function wantsSparks(save: SaveData): boolean {
  const q = storyQuest(save)
  return !!q && q.kind === 'spark' && dreamOf(save).story.state === 'active'
}

/** 나방의 실: the field should mix in 달가루 나방. */
export function wantsMoths(save: SaveData): boolean {
  const q = storyQuest(save)
  return !!q && q.kind === 'hunt' && dreamOf(save).story.state === 'active'
}

/** Tower's last floor should place the warden while that quest is the one she is on. */
export function wantsWarden(save: SaveData): boolean {
  const d = dreamOf(save)
  const q = storyQuest(save)
  return !!q && q.where === 'tower' && (d.story.state === 'active' || d.story.state === 'ready')
}

/** HUD tracker row for the story, or null. */
export function storyHud(save: SaveData): { title: string; prog: string; done: boolean } | null {
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!mongsilOpen(save) || !q) return null
  if (d.story.state === 'offer') return { title: `이야기 · ${q.title}`, prog: '몽이에게 말 걸기', done: false }
  if (d.story.state === 'ready') return { title: `이야기 · ${q.title}`, prog: '완료 · 몽이에게', done: true }
  return { title: `이야기 · ${q.title}`, prog: storyGoal(q, d.story.count), done: false }
}

