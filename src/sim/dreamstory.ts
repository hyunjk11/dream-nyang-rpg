/**
 * 챕터 2 · 꿈의 비밀. The chapter now begins in the dungeon:
 *
 *   섬 마을(배우기) → 꿈 미로 (4층, 모찌가 이어 주는 퀘스트 넷) → 미로 밖 몽실 마을 도착 →
 *   이장 몽이의 이야기 퀘스트 넷 (몽실 들판 · 구름 다락 · 멈춘 시계탑 · 달빛 둥지) → 챕터 3 열림.
 *
 * Pure save logic: area plans, the maze chain, the story chain, migration of old chapter-2 saves.
 * The 3D side (run.ts spots, main.ts travel) only reports events here and paints what comes back.
 */
import { BOSS_FLOOR, floorScale, floorSeed, type FloorPlan, type FloorScale } from './delve'
import { GEAR_IDS, ITEMS, WEAPON_IDS } from '../data/items'
import { AREAS, AREA_IDS, areaLabel, isArea, type AreaId } from './areas'
import { chaptersOf } from './chapters'
import { addItem } from './inventory'
import { makeItem } from './loot'
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

export interface DreamSave {
  maze: { step: number; count: number; passed: boolean }
  story: { step: number; state: StoryState; count: number; done: boolean }
  /** Where she wakes up after a reload: the island, or in 몽실 마을. */
  home: 'island' | 'mongsil'
  /** Story areas whose waypoint she has reached (the 별문 network lists them). */
  gates: AreaId[]
}

const fresh = (): DreamSave => ({ maze: { step: 0, count: 0, passed: false }, story: { step: 0, state: 'offer', count: 0, done: false }, home: 'island', gates: [] })

const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : d)

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
    d.maze = { step: int(m.step, 0, MAZE_CHAIN.length, 0), count: int(m.count, 0, 1e6, 0), passed: !!m.passed }
    d.story = { step: int(s.step, 0, STORY.length, 0), state: s.state === 'active' || s.state === 'ready' ? s.state : 'offer', count: int(s.count, 0, 1e6, 0), done: !!s.done }
    d.home = raw.home === 'mongsil' && d.maze.passed ? 'mongsil' : 'island'
    d.gates = Array.isArray(raw.gates) ? [...new Set(raw.gates.filter(isArea))] : []
    if (d.story.done) d.story.step = STORY.length
  } else {
    const c = chaptersOf(save)
    const played = c.cleared.includes(2) || Object.values(c.quests).some((q) => q.status !== 'locked' && q.status !== 'offered')
    if (played) {
      d.maze = { step: MAZE_CHAIN.length, count: 0, passed: true }
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

export function mazeQuest(save: SaveData): MazeQuest | null {
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
  const q = MAZE_CHAIN[d.maze.step]
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
  d.maze.step = MAZE_CHAIN.length
  d.home = 'mongsil'
}

/** HUD tracker row for the maze, or null. */
export function mazeHud(save: SaveData): { title: string; prog: string } | null {
  const d = dreamOf(save)
  if (d.maze.passed) return null
  const q = MAZE_CHAIN[d.maze.step]
  if (!q) return { title: '미로 밖으로', prog: '마지막 층 금빛 계단' }
  return { title: `모찌 · ${q.title}`, prog: q.goal > 1 ? `${d.maze.count}/${q.goal}` : '0/1' }
}

// ---------------------------------------------------------------- 꿈의 비밀 (몽이의 이야기)

export type StoryKind = 'spark' | 'area' | 'boss'

export interface StoryQuest {
  id: string
  title: string
  kind: StoryKind
  /** Where it happens: the field (sparks), or an area. */
  where: 'field' | AreaId
  goal: number
  /** 몽이 explains (offer) and what she learns when handing it in (reveal). */
  offer: { who: string; text: string }[]
  reveal: { who: string; text: string }[]
  reward: { gold: number; xp: number; gear: Rarity }
}

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
    offer: [{ who: '몽이', text: '구름 다락은 별문으로 갈 수 있어요. 다락 끝까지 올라가서 속삭임의 정체를 알아봐 줘요.' }],
    reveal: [
      { who: '별하', text: '다락 끝에서 누가 계속 같은 말을 했어. "3시 33분…" 그게 무슨 뜻이지?' },
      { who: '몽이', text: '마을 동쪽 시계탑이 딱 그 시각에 멈췄어요. 아무도 이유를 몰라요.' },
    ],
    reward: { gold: 120, xp: 240, gear: 'rare' },
  },
  {
    id: 's3',
    title: '멈춘 시계탑',
    kind: 'area',
    where: 'tower',
    goal: 1,
    offer: [{ who: '몽이', text: '시계탑 꼭대기에 시계의 심장이 있다고 해요. 그걸 찾으면 시간이 다시 흐를지도 몰라요.' }],
    reveal: [
      { who: '별하', text: '시계의 심장이… 방울 모양이야. 모찌, 네 목에 달린 거랑 똑같아.' },
      { who: '모찌', text: '…기억났어. 3시 33분은 별하가 책상에서 잠든 시각이야. 그리고 나는, 별하가 어릴 때 꾼 꿈에서 태어났어. 너를 지키려고.' },
      { who: '몽이', text: '그럼 등불을 먹는 건… 달빛 둥지의 밤나방이에요. 그 나방이 별하 씨의 꿈까지 먹고 있었던 거예요.' },
    ],
    reward: { gold: 150, xp: 300, gear: 'epic' },
  },
  {
    id: 's4',
    title: '달빛 둥지',
    kind: 'boss',
    where: 'moon',
    goal: 1,
    offer: [{ who: '몽이', text: '달빛 둥지로 가는 별문을 열어 둘게요. 꿈먹는 밤나방을 잠재워 줘요. 꼭 돌아와요.' }],
    reveal: [
      { who: '몽이', text: '등불이 전부 다시 켜졌어요! 마을이 이렇게 밝은 건 처음이에요.' },
      { who: '???', text: '…별하야. 별하야, 일어나…' },
      { who: '별하', text: '방금… 꿈 바깥에서 누가 날 불렀어. 모찌, 들었어?' },
      { who: '모찌', text: '응. 꿈 바깥의 목소리야. 다음 꿈으로 가는 문이 열렸어.' },
    ],
    reward: { gold: 220, xp: 420, gear: 'epic' },
  },
]

export function storyQuest(save: SaveData): StoryQuest | null {
  const d = dreamOf(save)
  return d.story.done ? null : (STORY[d.story.step] ?? null)
}

/** 몽이's talk: offer → active; ready → reward, reveal, next offer. */
export function storyTalk(save: SaveData, rng: () => number = Math.random): { lines: { who: string; text: string }[]; out: DreamOut; took: boolean } {
  const o = dout()
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!q) return { lines: [{ who: '몽이', text: '등불이 오늘도 따뜻해요. 꿈 바깥의 목소리… 별하 씨라면 따라갈 수 있을 거예요.' }], out: o, took: false }
  if (d.story.state === 'offer') {
    d.story.state = 'active'
    d.story.count = 0
    o.toasts.push(`이야기 퀘스트 · ${q.title}`)
    return { lines: q.offer, out: o, took: true }
  }
  if (d.story.state === 'active') {
    return { lines: [{ who: '몽이', text: `${q.title}… ${storyGoal(q, d.story.count)}. 별문에서 길이 이어져요.` }], out: o, took: false }
  }
  // ready: hand in.
  reward(save, q.reward.gold, q.reward.xp, o)
  const pool = rng() < 0.4 ? WEAPON_IDS : GEAR_IDS
  const defId = pool[Math.floor(rng() * pool.length)] ?? 'hat_pin'
  const item = makeItem(defId, q.reward.gear, rng, Math.max(3, save.level))
  if (addItem(save, item)) o.result?.toasts.push(`${ITEMS[defId]?.name ?? defId} 획득!`)
  else gainGold(save, 60)
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
  if (q.kind === 'boss') return `${AREAS.moon.boss?.name ?? '보스'} 잠재우기`
  return `${AREAS[q.where as AreaId]?.name ?? ''} 끝까지 가기`
}

/** A story happening out there: sparks in the field, an area walked to its end, the moth down. */
export function storyEvent(save: SaveData, e: { type: 'spark'; amount?: number } | { type: 'area'; area: AreaId } | { type: 'boss'; area: AreaId }): DreamOut {
  const o = dout()
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!q || d.story.state !== 'active') return o
  const fits = (e.type === 'spark' && q.kind === 'spark') || (e.type === 'area' && q.kind === 'area' && q.where === e.area) || (e.type === 'boss' && q.kind === 'boss' && q.where === e.area)
  if (!fits) return o
  d.story.count = Math.min(q.goal, d.story.count + (e.type === 'spark' ? (e.amount ?? 1) : 1))
  if (d.story.count < q.goal) {
    o.toasts.push(`등불 불씨 ${d.story.count}/${q.goal}`)
    return o
  }
  d.story.state = 'ready'
  o.toasts.push(`이야기 퀘스트 달성! ${q.title} · 몽실 마을 몽이에게`)
  return o
}

/** Areas the 별문 in 몽실 offers: those the story reached so far (plus the field). */
export function openAreas(save: SaveData): AreaId[] {
  const d = dreamOf(save)
  if (!d.maze.passed) return []
  const out: AreaId[] = []
  const reach = d.story.done ? STORY.length : d.story.step + (d.story.state === 'offer' ? 0 : 1)
  for (let i = 0; i < reach; i += 1) {
    const w = STORY[i]?.where
    if (w && w !== 'field' && !out.includes(w)) out.push(w)
  }
  return out
}

/** Does this trip need the field's sparks (s1 active)? */
export function wantsSparks(save: SaveData): boolean {
  const q = storyQuest(save)
  return !!q && q.kind === 'spark' && dreamOf(save).story.state === 'active'
}

/** HUD tracker row for the story, or null. */
export function storyHud(save: SaveData): { title: string; prog: string; done: boolean } | null {
  const d = dreamOf(save)
  const q = storyQuest(save)
  if (!d.maze.passed || !q) return null
  if (d.story.state === 'offer') return { title: `이야기 · ${q.title}`, prog: '몽이에게 말 걸기', done: false }
  if (d.story.state === 'ready') return { title: `이야기 · ${q.title}`, prog: '완료 · 몽이에게', done: true }
  return { title: `이야기 · ${q.title}`, prog: storyGoal(q, d.story.count), done: false }
}

