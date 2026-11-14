/**
 * 챕터: the story spine over the island and the sewer. Pure rules + save shape (no DOM/three).
 *
 *  - 챕터 1 '가이드 챕터': the existing island + dream sewer, walked through step by step (move,
 *    shoot, dash, a kill, skills, gear, candy, the shop/workshop/board, the portal, T recall)
 *    with short 별하/모찌 lines, ending on the depth-1 boss and a chapter-clear card.
 *  - 챕터 2 '몽실 들판': quest-driven hunting. Quests are taken at the town quest board, played out
 *    in the open dream field through the portal (packs keep coming back), and turned in at the
 *    board for XP, gold and gear. The last one is the chapter boss.
 *
 * Old saves get a chapter block on load; a player with real progress is offered the skip.
 */
import { GEAR_IDS, ITEMS, MATERIAL_KO, WEAPON_IDS } from '../data/items'
import type { PlaceId } from './places'
import type { HordeKind } from '../world/dungeon/horde'
import { addItem } from './inventory'
// Cycle with dreamstory (it reads chapter2Open): both only call each other inside functions.
import { dreamOf } from './dreamstory'
import { makeItem } from './loot'
import { grantGuideSkill } from './skilltree'
import { gainGold, gainXp } from './stats'
import { RARITY_KO, emptyResult, type MutationResult, type Rarity, type SaveData } from './types'

// ---------------------------------------------------------------- 챕터 1: 가이드

export type GuideEventType = 'move' | 'shoot' | 'dash' | 'kill' | 'skill' | 'equip' | 'candy' | 'shop' | 'workshop' | 'board' | 'sewer' | 'recall' | 'boss'

export interface GuideEvent {
  type: GuideEventType
  /** How much (metres walked, shots fired…); 1 when left out. */
  amount?: number
  /** Boss depth (only depth 1 counts). */
  depth?: number
}

export interface GuideStep {
  id: GuideEventType
  /** HUD prompt. */
  title: string
  /** Keys / buttons, desktop and touch. */
  keys: string
  touch: string
  /** Amount needed. */
  goal: number
  /** Short line when the step begins (별하 or 모찌). */
  say: { who: '별하' | '모찌'; text: string }
  /** Gift handed over as the step begins (so the step can always be done). */
  gift?: 'gear' | 'candy' | 'dust' | 'skill'
  /** Quest-row place ("n장 · 이름"). */
  at: PlaceId
  /** Extra tail on that place ("북쪽 포포", "깊이 1"). */
  spot?: string
}

export const GUIDE: GuideStep[] = [
  { id: 'move', title: '걸어 보기', keys: 'WASD로 움직이기 · 꿈의 초원', touch: '왼쪽 스틱으로 움직이기 · 꿈의 초원', goal: 5, at: 'meadow', say: { who: '모찌', text: '여기가 꿈의 초원이야. 천천히 걸어 봐냥.' } },
  { id: 'shoot', title: '조준하고 쏘기', keys: '클릭을 누르고 연사 8발 · 다음은 대시로 피하기', touch: '공격 길게 8발 · 다음은 대시', goal: 8, at: 'meadow', say: { who: '별하', text: '물총이네. 잠깐만 연사해 봐. 그 다음엔 대시로 피하는 법을 알려 줄게.' } },
  { id: 'dash', title: '대시로 피하기', keys: 'Space로 대시', touch: '대시 버튼', goal: 2, at: 'meadow', say: { who: '모찌', text: '공격이 오면 휙 비켜! 대시는 짧게 무적이야.' } },
  { id: 'kill', title: '초원 슬라임 3마리', keys: '꿈의 초원 솜사탕 슬라임 3마리 · 서쪽 별문으로 나가기 전에', touch: '초원 슬라임 3마리 · 나가기 전에', goal: 3, at: 'meadow', spot: '슬라임 3', say: { who: '별하', text: '초원에 솜사탕 슬라임이 셋이야. 서쪽 별문으로 마을에 가기 전에 셋 다 잠재우자.' } },
  { id: 'skill', title: '스킬 써 보기', keys: '1 거품 폭탄 · 방금 배워 둠', touch: '아래 1번 거품 폭탄', goal: 1, at: 'meadow', say: { who: '모찌', text: '거품 폭탄을 미리 배워 뒀어. 1을 한 번 눌러 봐. K는 나중에 다른 걸 배울 때!' }, gift: 'skill' },
  { id: 'equip', title: '장비 장착하기', keys: 'G로 바로 장착 · I 가방에서 비교', touch: '"바로 장착" 또는 가방에서 장착', goal: 1, at: 'meadow', say: { who: '모찌', text: '반짝이는 거 주웠어! 별하한테 어울릴 것 같아.' }, gift: 'gear' },
  { id: 'candy', title: '하트 사탕 먹기', keys: 'Q로 사탕 먹기 · 체력이 가득해도 돼', touch: '사탕 버튼 · 가득해도 돼', goal: 1, at: 'meadow', say: { who: '모찌', text: '하트 사탕이야. 안 아플 때도 한 입은 괜찮아. Q로 먹어 봐냥.' }, gift: 'candy' },
  { id: 'shop', title: '포포 상점 둘러보기', keys: '서쪽 별문 → 꿈의 마을 · 북쪽 포포에게 E', touch: '서쪽 별문 → 마을 · 북쪽 포포', goal: 1, at: 'village', spot: '북쪽 포포', say: { who: '별하', text: '서쪽 별문이 꿈의 마을로 열려. 포포는 마을 북쪽, 사탕이랑 두루마리는 거기서.' } },
  { id: 'workshop', title: '키키 공방 들르기', keys: '꿈의 마을 북쪽 키키에게 E · 총 +1 강화', touch: '북쪽 키키에게 대화 · 총 +1', goal: 1, at: 'village', spot: '북쪽 키키', gift: 'dust', say: { who: '모찌', text: '키키도 마을 북쪽이야. 꿈가루 두 줌 챙겼어. +1은 골드랑 가루 한 줌이면 돼.' } },
  { id: 'board', title: '퀘스트 게시판 보기', keys: '꿈의 마을 게시판 앞에서 E', touch: '마을 게시판 앞에서 대화', goal: 1, at: 'village', spot: '게시판', say: { who: '별하', text: '게시판은 마을에 있어. 의뢰를 맡으면 다녀와서 보상을 받아.' } },
  { id: 'sewer', title: '무한 탐험 깊이 1', keys: '서쪽 별문 → 무한 탐험 → 깊이 1 · 꿈 하수도', touch: '별문 → 무한 탐험 → 깊이 1', goal: 1, at: 'sewer', spot: '깊이 1', say: { who: '모찌', text: '별문에서 "무한 탐험"을 골라. 초원·숲 같은 이야기 길이랑 다른 문이야. 깊이 1로 내려가자!' } },
  { id: 'recall', title: 'T로 마을 귀환', keys: '하수도에서 T (맞으면 끊겨) · 마을 돌아가기 포털', touch: '귀환 버튼 · 마을 돌아가기 포털', goal: 1, at: 'sewer', spot: '깊이 1', say: { who: '별하', text: '위험하면 T로 마을에 돌아와. 별문 옆에 돌아가기 포털이 그 자리를 남겨 둬.' } },
  { id: 'boss', title: '깊이 1 악몽 꽃', keys: '별문 → 무한 탐험 → 깊이 1 · 탐험 3층 다음 보스층', touch: '무한 탐험 깊이 1 · 보스층', goal: 1, at: 'sewer', spot: '깊이 1 · 보스', say: { who: '모찌', text: '깊이 1은 탐험 세 층 다음에 보스층이야. 악몽 꽃을 끝내면 1장이 닫혀.' } },
]

// ---------------------------------------------------------------- 챕터 2: 몽실 들판

export type ChapterQuestKind = 'kill' | 'collect' | 'named' | 'boss'

export interface ChapterQuestDef {
  id: string
  title: string
  /** Board card blurb. */
  text: string
  kind: ChapterQuestKind
  /** Foe kind to hunt (kill), 'any' for any foe. */
  target: HordeKind | 'any' | 'fluff' | 'named' | 'boss'
  goal: number
  reward: { gold: number; xp: number; gear?: Rarity; mats?: Record<string, number> }
  /** 🔁 Comes back on the board after it is turned in. */
  repeat?: boolean
}

/** The field's collectible: dropped by field foes while a collect quest is on. */
export const FLUFF = 'fluff'
/** Named field elite for the hunt quest. */
export const NAMED = { kind: 'slime' as HordeKind, name: '솜사탕 대장 몽글이', hp: 2.2 }

export const CHAPTER2: ChapterQuestDef[] = [
  { id: 'c2_slime', title: '솜사탕 슬라임 퇴치', text: '몽실 들판(몽실 마을 별문)을 덮은 솜사탕 슬라임을 줄여 줘.', kind: 'kill', target: 'slime', goal: 10, reward: { gold: 60, xp: 120, mats: { dream_dust: 3 } } },
  { id: 'c2_bat', title: '꿈박쥐 쫓기', text: '몽실 들판(몽실 마을 별문)에 밤하늘에서 내려온 꿈박쥐가 잠을 깨운대.', kind: 'kill', target: 'bat', goal: 8, reward: { gold: 70, xp: 140, gear: 'uncommon' } },
  { id: 'c2_fluff', title: '몽실 솜사탕 모으기', text: '몽실 들판 괴물이 떨어뜨리는 몽실 솜사탕을 모아 와.', kind: 'collect', target: 'fluff', goal: 8, reward: { gold: 80, xp: 160, mats: { toy_part: 2 } } },
  { id: 'c2_sweep', title: '몽실 들판 대청소', text: '몽실 들판 괴물이면 종류는 상관없어. 끝나면 다시 맡는 반복 의뢰야.', kind: 'kill', target: 'any', goal: 25, reward: { gold: 100, xp: 220, gear: 'rare' }, repeat: true },
  { id: 'c2_named', title: '솜사탕 대장 몽글이', text: '몽실 들판 어딘가에 거대한 대장 슬라임이 있대. 찾아서 쓰러뜨려.', kind: 'named', target: 'named', goal: 1, reward: { gold: 130, xp: 260, gear: 'rare', mats: { star_shard: 1 } } },
  { id: 'c2_knight', title: '구름 기사단', text: '구름 기사들이 몽실 들판 길목을 막고 있어. 토벌이 끝나면 다시 의뢰가 붙는 반복이야.', kind: 'kill', target: 'knight', goal: 4, reward: { gold: 120, xp: 260, mats: { toy_part: 2, dream_dust: 4 } }, repeat: true },
  { id: 'c2_boss', title: '몽실 들판의 악몽 꽃', text: '들판 동쪽 끝에 핀 악몽 꽃. 이야기(달빛 둥지)와 다른, 들판만의 토벌이야.', kind: 'boss', target: 'boss', goal: 1, reward: { gold: 220, xp: 420, gear: 'epic', mats: { star_shard: 2 } } },
]

/** At most this many chapter quests taken at once. */
export const ACTIVE_CAP = 2

export type ChapterQuestStatus = 'locked' | 'offered' | 'active' | 'done' | 'claimed'

export interface ChapterQuestState {
  status: ChapterQuestStatus
  progress: number
  /** Times a 🔁 quest was turned in. */
  runs?: number
}

export interface ChapterSave {
  /** Chapter she is on (1 = 가이드, 2 = 몽실 들판, 3 = 다음 이야기 준비 중). */
  current: number
  guide: { step: number; count: number; done: boolean; skipped: boolean }
  /** Chapters cleared. */
  cleared: number[]
  quests: Record<string, ChapterQuestState>
  /** A clear card to show (chapter number), or 0. */
  card: number
  /** The skip offer for players who were already here before chapters existed. */
  offerSkip: boolean
}

export const CHAPTER_TITLE: Record<number, string> = { 1: '가이드 챕터', 2: '꿈의 비밀', 3: '꿈 바깥의 목소리' }

/** Already played before chapters (the skip is offered). */
export function isVeteran(save: SaveData): boolean {
  return (save.delve?.cleared ?? 0) >= 1 || (save.delve?.runs ?? 0) >= 1 || save.level >= 3
}

function freshQuests(): Record<string, ChapterQuestState> {
  const q: Record<string, ChapterQuestState> = {}
  CHAPTER2.forEach((d, i) => (q[d.id] = { status: i < 2 ? 'offered' : 'locked', progress: 0 }))
  return q
}

export function freshChapters(veteran = false): ChapterSave {
  return { current: 1, guide: { step: 0, count: 0, done: false, skipped: false }, cleared: [], quests: freshQuests(), card: 0, offerSkip: veteran }
}

/** The save's chapter block, made whole (old saves get one; bad values are clamped). */
const whole = new WeakSet<object>()

export function chaptersOf(save: SaveData): ChapterSave {
  const raw = save.chapters as Partial<ChapterSave> | undefined
  if (raw && whole.has(raw)) return raw as ChapterSave
  if (!raw || typeof raw !== 'object') {
    save.chapters = freshChapters(isVeteran(save))
    whole.add(save.chapters)
    return save.chapters
  }
  const int = (v: unknown, min: number, max: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fb)
  const g = (raw.guide ?? {}) as Partial<ChapterSave['guide']>
  const quests = freshQuests()
  const statuses: ChapterQuestStatus[] = ['locked', 'offered', 'active', 'done', 'claimed']
  for (const d of CHAPTER2) {
    const q = raw.quests?.[d.id]
    if (q && statuses.includes(q.status)) {
      const runs = int((q as { runs?: unknown }).runs, 0, 1e6, 0)
      quests[d.id] = runs > 0 ? { status: q.status, progress: int(q.progress, 0, d.goal, 0), runs } : { status: q.status, progress: int(q.progress, 0, d.goal, 0) }
    }
  }
  const c: ChapterSave = {
    current: int(raw.current, 1, 3, 1),
    guide: { step: int(g.step, 0, GUIDE.length, 0), count: int(g.count, 0, 1e6, 0), done: !!g.done, skipped: !!g.skipped },
    cleared: Array.isArray(raw.cleared) ? raw.cleared.filter((n): n is number => typeof n === 'number') : [],
    quests,
    card: int(raw.card, 0, 3, 0),
    offerSkip: !!raw.offerSkip,
  }
  gateChapters(c)
  save.chapters = c
  whole.add(c)
  return c
}

/**
 * Keep the chapter number honest with what was cleared: chapter 2 needs chapter 1 (the guide) done,
 * chapter 3 needs chapter 2 cleared. A save that jumped ahead (an early-accepted chapter-2 quest, a
 * hand-edited number) drops back; its quest progress stays in the save, parked, until it unlocks.
 */
function gateChapters(c: ChapterSave): void {
  const one = c.guide.done || c.cleared.includes(1)
  if (one) {
    c.guide.done = true
    if (!c.cleared.includes(1)) c.cleared.push(1)
  }
  const max = !one ? 1 : c.cleared.includes(2) ? 3 : 2
  c.current = one ? Math.max(2, Math.min(c.current, max)) : 1
  if (!one) c.cleared = c.cleared.filter((n) => n !== 2)
}

export interface ChapterOut {
  /** The guide moved on (new step index), or -1. */
  advanced: number
  /** A line to show (speaker + text). */
  say: { who: string; text: string } | null
  /** A chapter was just cleared (its number), or 0. */
  cleared: number
  /** Toasts (quest progress, rewards). */
  toasts: string[]
  /** A gift was handed over for the new step. */
  gift: 'gear' | 'candy' | 'dust' | 'skill' | null
}

const out = (): ChapterOut => ({ advanced: -1, say: null, cleared: 0, toasts: [], gift: null })

export function guideStep(save: SaveData): GuideStep | null {
  const c = chaptersOf(save)
  if (c.current !== 1 || c.guide.done) return null
  return GUIDE[c.guide.step] ?? null
}

/**
 * Meadow tutorial slimes stay through the kill step.
 * Leaving for the village after the first used to despawn the other two, and the step asks for three.
 */
export function tutorialRest(save: SaveData): boolean {
  const step = guideStep(save)
  return !!step && (step.id === 'move' || step.id === 'shoot' || step.id === 'dash' || step.id === 'kill')
}

/** Gold the first gun upgrade asks for (+1). The workshop step tops her up to this if she spent it. */
export const GUIDE_PLUS1_GOLD = 28
/** 꿈가루 handed over with the workshop step: one for +1, one left in the pocket. */
export const GUIDE_DUST = 2

/** Put the step's gift in her hands (gear, a heart candy, or the first 강화's 꿈가루). */
function giveGift(save: SaveData, step: GuideStep, rng: () => number): 'gear' | 'candy' | 'dust' | 'skill' | null {
  if (step.gift === 'skill') return grantGuideSkill(save) ? 'skill' : null
  if (step.gift === 'gear') {
    const id = GEAR_IDS[Math.floor(rng() * GEAR_IDS.length)] ?? 'hat_pin'
    addItem(save, makeItem(id, 'uncommon', rng, Math.max(1, save.level)))
    return 'gear'
  }
  if (step.gift === 'candy') {
    save.potions = Math.max(1, save.potions)
    return 'candy'
  }
  if (step.gift === 'dust') {
    // A real pinch on top of anything she already found. The floor only covers a short purse.
    save.materials.dream_dust = (save.materials.dream_dust ?? 0) + GUIDE_DUST
    ensureGuideStarter(save)
    return 'dust'
  }
  return null
}

/**
 * Workshop +1 starter, without stacking: dream dust at least GUIDE_DUST, gold at least
 * GUIDE_PLUS1_GOLD. A skip after the workshop gift leaves the gift where it is.
 */
export function ensureGuideStarter(save: SaveData): { dust: boolean; gold: boolean } {
  const had = save.materials.dream_dust ?? 0
  const dust = had < GUIDE_DUST
  if (dust) save.materials.dream_dust = GUIDE_DUST
  const gold = save.gold < GUIDE_PLUS1_GOLD
  if (gold) save.gold = GUIDE_PLUS1_GOLD
  return { dust, gold }
}

/** Mark chapter n cleared: the clear card, and the next chapter opens. */
function clearChapter(c: ChapterSave, n: number): void {
  if (!c.cleared.includes(n)) c.cleared.push(n)
  c.current = Math.max(c.current, n + 1)
  c.card = n
}

/** Something happened that the guide may be waiting for. */
export function guideEvent(save: SaveData, e: GuideEvent, rng: () => number = Math.random): ChapterOut {
  const o = out()
  const c = chaptersOf(save)
  const step = guideStep(save)
  if (!step || step.id !== e.type) return o
  if (e.type === 'boss' && (e.depth ?? 1) !== 1) return o
  c.guide.count += e.amount ?? 1
  if (c.guide.count < step.goal) return o
  c.guide.step += 1
  c.guide.count = 0
  const next = GUIDE[c.guide.step]
  if (!next) {
    c.guide.done = true
    c.offerSkip = false
    clearChapter(c, 1)
    o.cleared = 1
    o.say = { who: '별하', text: '해냈다… 모찌, 꿈이 조금 밝아진 것 같아.' }
    return o
  }
  o.advanced = c.guide.step
  o.say = next.say
  o.gift = giveGift(save, next, rng)
  return o
}

/**
 * Skip the guide (existing players, or anyone from the settings): chapter 2 opens.
 * Tops dust and gold up to the workshop +1 starter so the skip does not lock out 강화.
 * Returns which purse actually rose (both false when she already had enough, or the guide was done).
 */
export function skipGuide(save: SaveData): { dust: boolean; gold: boolean } {
  const c = chaptersOf(save)
  c.offerSkip = false
  if (c.guide.done) return { dust: false, gold: false }
  c.guide.done = true
  c.guide.skipped = true
  if (!c.cleared.includes(1)) c.cleared.push(1)
  c.current = Math.max(c.current, 2)
  return ensureGuideStarter(save)
}

/** Keep the guide (the skip card said no). */
export function keepGuide(save: SaveData): void {
  chaptersOf(save).offerSkip = false
}

/** "가이드 3/13 · 대시로 피하기" and the key line, or null when the guide is over. */
export function guideHud(save: SaveData, touch: boolean): { head: string; keys: string; count: string } | null {
  const step = guideStep(save)
  if (!step) return null
  const c = chaptersOf(save)
  return {
    head: `가이드 ${c.guide.step + 1}/${GUIDE.length} · ${step.title}`,
    keys: touch ? step.touch : step.keys,
    count: step.goal > 1 ? `${Math.min(step.goal, Math.floor(c.guide.count))}/${step.goal}` : '',
  }
}

// ---------------------------------------------------------------- 챕터 2 퀘스트

export function questDef(id: string): ChapterQuestDef | undefined {
  return CHAPTER2.find((d) => d.id === id)
}

/** Chapter 2 is open (the guide is done or skipped). */
export function chapter2Open(save: SaveData): boolean {
  return chaptersOf(save).current >= 2
}

/**
 * 몽실 들판 can be reached: chapter 2 is open and 모찌's 꿈 미로 is behind her (the field's only door
 * is 몽실 마을's 별문). The board offers, tracks and counts its quests only from then on.
 */
export function fieldOpen(save: SaveData): boolean {
  return chapter2Open(save) && dreamOf(save).maze.passed
}

/** Chapter 3 (꿈 바깥의 목소리) is open: chapter 2's story is over. */
export function chapter3Open(save: SaveData): boolean {
  const c = chaptersOf(save)
  return c.current >= 3 && c.cleared.includes(2)
}

/** Board field quests on the go. Parked (none) before chapter 2, whatever an old save holds. */
export function activeQuests(save: SaveData): ChapterQuestDef[] {
  const c = chaptersOf(save)
  if (!fieldOpen(save)) return []
  return CHAPTER2.filter((d) => c.quests[d.id].status === 'active')
}

export function takeQuest(save: SaveData, id: string): { ok: boolean; reason?: string } {
  const c = chaptersOf(save)
  const q = c.quests[id]
  if (!chapter2Open(save)) return { ok: false, reason: '가이드 챕터를 먼저 마쳐 줘.' }
  if (!fieldOpen(save)) return { ok: false, reason: '꿈 미로를 지나 몽실 마을에 닿으면 몽실 들판 퀘스트를 맡을 수 있어.' }
  if (!q || q.status !== 'offered') return { ok: false, reason: '지금은 맡을 수 없는 퀘스트야.' }
  if (activeQuests(save).length >= ACTIVE_CAP) return { ok: false, reason: `퀘스트는 한 번에 ${ACTIVE_CAP}개까지 맡을 수 있어.` }
  q.status = 'active'
  q.progress = 0
  return { ok: true }
}

export type FieldEvent =
  | { type: 'kill'; kind: HordeKind; elite: boolean }
  | { type: 'collect'; amount?: number }
  | { type: 'named' }
  | { type: 'boss' }

/** A field happening: move every active quest it fits. Returns toasts for finished ones. */
export function questEvent(save: SaveData, e: FieldEvent): ChapterOut {
  const o = out()
  const c = chaptersOf(save)
  for (const d of activeQuests(save)) {
    const q = c.quests[d.id]
    const fits =
      (e.type === 'kill' && d.kind === 'kill' && (d.target === 'any' || d.target === e.kind)) ||
      (e.type === 'collect' && d.kind === 'collect') ||
      (e.type === 'named' && d.kind === 'named') ||
      (e.type === 'boss' && d.kind === 'boss')
    if (!fits) continue
    q.progress = Math.min(d.goal, q.progress + (e.type === 'collect' ? (e.amount ?? 1) : 1))
    if (q.progress >= d.goal) {
      q.status = 'done'
      o.toasts.push(`퀘스트 완료! ${d.title} · 마을 게시판에서 보상 받기`)
    }
  }
  return o
}

/** What a quest's reward reads as on the board. */
export function questRewardText(d: ChapterQuestDef): string {
  const bits = [`골드 ${d.reward.gold}`, `경험치 ${d.reward.xp}`]
  if (d.repeat) bits.unshift('🔁')
  if (d.reward.gear) bits.push(`${RARITY_KO[d.reward.gear]} 장비`)
  for (const [m, n] of Object.entries(d.reward.mats ?? {})) bits.push(`${MATERIAL_KO[m] ?? m} ${n}`)
  return bits.join(' · ')
}

/** Claim a finished quest at the board: XP, gold, gear; the next quest in line opens. */
export function claimQuest(save: SaveData, id: string, rng: () => number = Math.random): { ok: boolean; reason?: string; result: MutationResult; cleared: number; gear: string | null } {
  const c = chaptersOf(save)
  const q = c.quests[id]
  const d = questDef(id)
  const none = { result: emptyResult(), cleared: 0, gear: null }
  if (!chapter2Open(save)) return { ok: false, reason: '가이드 챕터를 먼저 마쳐 줘.', ...none }
  if (!q || !d || q.status !== 'done') return { ok: false, reason: '아직 끝나지 않은 퀘스트야.', ...none }
  q.runs = (q.runs ?? 0) + (d.repeat ? 1 : 0)
  q.status = d.repeat ? 'offered' : 'claimed'
  q.progress = d.repeat ? 0 : q.progress
  gainGold(save, d.reward.gold)
  const result = gainXp(save, d.reward.xp)
  result.toasts.unshift(`골드 +${d.reward.gold}`, `경험치 +${d.reward.xp}`)
  for (const [m, n] of Object.entries(d.reward.mats ?? {})) save.materials[m] = (save.materials[m] ?? 0) + n
  let gear: string | null = null
  if (d.reward.gear) {
    const pool = rng() < 0.35 ? WEAPON_IDS : GEAR_IDS
    const defId = pool[Math.floor(rng() * pool.length)] ?? 'hat_pin'
    const item = makeItem(defId, d.reward.gear, rng, Math.max(2, save.level))
    if (addItem(save, item)) {
      gear = `${RARITY_KO[d.reward.gear]} ${ITEMS[defId]?.name ?? defId}`
      result.toasts.push(`${gear} 획득!`)
    } else {
      save.gold += 40
      result.toasts.push('가방이 가득해서 장비 대신 골드 40')
    }
  }
  // Open the next locked quest in line.
  const next = CHAPTER2.find((x) => c.quests[x.id].status === 'locked')
  if (next) c.quests[next.id].status = 'offered'
  // 챕터 2 itself now ends with 몽이's story (꿈의 비밀); the field board is side quests.
  return { ok: true, result, cleared: 0, gear }
}

/** Tracker lines for the HUD: active quests and progress. */
export function questHud(save: SaveData): { id: string; title: string; prog: string; done: boolean }[] {
  const c = chaptersOf(save)
  if (!fieldOpen(save)) return []
  return CHAPTER2.filter((d) => c.quests[d.id].status === 'active' || c.quests[d.id].status === 'done').map((d) => ({
    id: d.id,
    title: d.title,
    prog: c.quests[d.id].status === 'done' ? '완료 · 게시판에서 보상' : `${c.quests[d.id].progress}/${d.goal}`,
    done: c.quests[d.id].status === 'done',
  }))
}

/** What the field needs this trip, from the active quests. */
export function fieldNeeds(save: SaveData): { kinds: HordeKind[]; fluff: boolean; named: boolean; boss: boolean } {
  const act = activeQuests(save)
  const kinds = new Set<HordeKind>(['slime', 'bat', 'bug'])
  for (const d of act) if (d.kind === 'kill' && d.target !== 'any') kinds.add(d.target as HordeKind)
  // From the knight quest on, the field has knights in the mix anyway.
  const c = chaptersOf(save)
  if (c.quests.c2_knight.status !== 'locked') kinds.add('knight')
  return { kinds: [...kinds], fluff: act.some((d) => d.kind === 'collect'), named: act.some((d) => d.kind === 'named'), boss: act.some((d) => d.kind === 'boss') }
}

/** Chapter 2 progress: claimed / total. */
export function chapterProgress(save: SaveData): { claimed: number; total: number } {
  const c = chaptersOf(save)
  return { claimed: CHAPTER2.filter((d) => c.quests[d.id].status === 'claimed').length, total: CHAPTER2.length }
}
