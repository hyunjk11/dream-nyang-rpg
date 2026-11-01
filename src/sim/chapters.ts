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
import type { HordeKind } from '../world/dungeon/horde'
import { addItem } from './inventory'
import { makeItem } from './loot'
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
  gift?: 'gear' | 'candy'
}

export const GUIDE: GuideStep[] = [
  { id: 'move', title: '걸어 보기', keys: 'WASD로 움직이기', touch: '왼쪽 스틱으로 움직이기', goal: 5, say: { who: '모찌', text: '여기가 꿈 섬이야. 천천히 걸어 봐냥.' } },
  { id: 'shoot', title: '조준하고 쏘기', keys: '마우스로 조준 · 클릭을 누르고 있으면 연사', touch: '오른쪽 드래그로 조준 · 공격 길게 누르기', goal: 25, say: { who: '별하', text: '물총이네. 두두두… 생각보다 손맛 있는데?' } },
  { id: 'dash', title: '대시로 피하기', keys: 'Space로 대시', touch: '대시 버튼', goal: 2, say: { who: '모찌', text: '공격이 오면 휙 비켜! 대시는 짧게 무적이야.' } },
  { id: 'kill', title: '괴물 쓰러뜨리기', keys: '꿈을 갉는 괴물을 물총으로', touch: '꿈을 갉는 괴물을 물총으로', goal: 3, say: { who: '별하', text: '저 솜사탕 녀석들… 꿈을 갉아먹는 거지? 조준 들어간다.' } },
  { id: 'skill', title: '스킬 써 보기', keys: '1·2·3·4 키 (아래 스킬 칸)', touch: '아래 스킬 칸 누르기', goal: 2, say: { who: '모찌', text: '스킬 칸 보이지? 나도 같이 뛰어든다냥!' } },
  { id: 'equip', title: '장비 장착하기', keys: 'G로 바로 장착 · I 가방에서 비교', touch: '"바로 장착" 또는 가방에서 장착', goal: 1, say: { who: '모찌', text: '반짝이는 거 주웠어! 별하한테 어울릴 것 같아.' }, gift: 'gear' },
  { id: 'candy', title: '하트 사탕 먹기', keys: 'Q로 사탕 먹기', touch: '사탕 버튼', goal: 1, say: { who: '모찌', text: '아플 땐 하트 사탕! 한 개 챙겨 뒀어냥.' }, gift: 'candy' },
  { id: 'shop', title: '포포 상점 둘러보기', keys: '마을의 포포에게 E', touch: '마을의 포포에게 대화', goal: 1, say: { who: '별하', text: '마을이다. 사탕이랑 두루마리는 포포네서 사면 되겠다.' } },
  { id: 'workshop', title: '키키 공방 들르기', keys: '키키에게 E · 총 강화', touch: '키키에게 대화 · 총 강화', goal: 1, say: { who: '모찌', text: '키키는 총을 실패 없이 강화해 줘. 비싸지만!' } },
  { id: 'board', title: '퀘스트 게시판 보기', keys: '게시판 앞에서 E', touch: '게시판 앞에서 대화', goal: 1, say: { who: '별하', text: '의뢰도 받는구나. 다녀오면 보상이라… 좋아.' } },
  { id: 'sewer', title: '별문으로 꿈 하수도에', keys: '광장 별문에서 E · 꿈 하수도 깊이 1', touch: '별문에서 대화 · 꿈 하수도 깊이 1', goal: 1, say: { who: '모찌', text: '별문 너머가 꿈 하수도야. 같이 내려가자!' } },
  { id: 'recall', title: 'T로 마을 귀환', keys: 'T: 귀환 주문 (맞으면 끊겨)', touch: '귀환 버튼', goal: 1, say: { who: '별하', text: '위험하면 T로 돌아오면 되는 거지? 한번 해 볼게.' } },
  { id: 'boss', title: '깊이 1 악몽 꽃 쓰러뜨리기', keys: '별문 → 꿈 하수도 깊이 1 · 보스층까지', touch: '별문 → 꿈 하수도 깊이 1 · 보스층까지', goal: 1, say: { who: '모찌', text: '이제 진짜야. 깊이 1 끝의 악몽 꽃, 같이 끝내자냥!' } },
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
}

/** The field's collectible: dropped by field foes while a collect quest is on. */
export const FLUFF = 'fluff'
/** Named field elite for the hunt quest. */
export const NAMED = { kind: 'slime' as HordeKind, name: '솜사탕 대장 몽글이', hp: 2.2 }

export const CHAPTER2: ChapterQuestDef[] = [
  { id: 'c2_slime', title: '솜사탕 슬라임 퇴치', text: '들판을 덮은 솜사탕 슬라임을 줄여 줘.', kind: 'kill', target: 'slime', goal: 12, reward: { gold: 60, xp: 120, mats: { dream_dust: 3 } } },
  { id: 'c2_bat', title: '꿈박쥐 쫓기', text: '밤하늘에서 내려온 꿈박쥐가 잠을 깨운대.', kind: 'kill', target: 'bat', goal: 10, reward: { gold: 70, xp: 140, gear: 'uncommon' } },
  { id: 'c2_fluff', title: '몽실 솜사탕 모으기', text: '들판 괴물이 떨어뜨리는 몽실 솜사탕을 모아 와.', kind: 'collect', target: 'fluff', goal: 8, reward: { gold: 80, xp: 160, mats: { toy_part: 2 } } },
  { id: 'c2_sweep', title: '들판 대청소', text: '종류는 상관없어. 많이, 아주 많이!', kind: 'kill', target: 'any', goal: 35, reward: { gold: 100, xp: 220, gear: 'rare' } },
  { id: 'c2_named', title: '솜사탕 대장 몽글이', text: '들판 어딘가에 거대한 대장 슬라임이 있대. 찾아서 쓰러뜨려.', kind: 'named', target: 'named', goal: 1, reward: { gold: 130, xp: 260, gear: 'rare', mats: { star_shard: 1 } } },
  { id: 'c2_knight', title: '구름 기사단', text: '구름 기사들이 들판 길목을 막고 있어.', kind: 'kill', target: 'knight', goal: 6, reward: { gold: 120, xp: 260, mats: { toy_part: 2, dream_dust: 4 } } },
  { id: 'c2_boss', title: '들판의 악몽 꽃', text: '들판 한가운데에서 악몽 꽃이 피어났어. 챕터 2의 마지막!', kind: 'boss', target: 'boss', goal: 1, reward: { gold: 220, xp: 420, gear: 'epic', mats: { star_shard: 2 } } },
]

/** At most this many chapter quests taken at once. */
export const ACTIVE_CAP = 2

export type ChapterQuestStatus = 'locked' | 'offered' | 'active' | 'done' | 'claimed'

export interface ChapterQuestState {
  status: ChapterQuestStatus
  progress: number
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

export const CHAPTER_TITLE: Record<number, string> = { 1: '가이드 챕터', 2: '몽실 들판', 3: '다음 꿈' }

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
    if (q && statuses.includes(q.status)) quests[d.id] = { status: q.status, progress: int(q.progress, 0, d.goal, 0) }
  }
  const c: ChapterSave = {
    current: int(raw.current, 1, 3, 1),
    guide: { step: int(g.step, 0, GUIDE.length, 0), count: int(g.count, 0, 1e6, 0), done: !!g.done, skipped: !!g.skipped },
    cleared: Array.isArray(raw.cleared) ? raw.cleared.filter((n): n is number => typeof n === 'number') : [],
    quests,
    card: int(raw.card, 0, 3, 0),
    offerSkip: !!raw.offerSkip,
  }
  save.chapters = c
  whole.add(c)
  return c
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
  gift: 'gear' | 'candy' | null
}

const out = (): ChapterOut => ({ advanced: -1, say: null, cleared: 0, toasts: [], gift: null })

export function guideStep(save: SaveData): GuideStep | null {
  const c = chaptersOf(save)
  if (c.current !== 1 || c.guide.done) return null
  return GUIDE[c.guide.step] ?? null
}

/** Put the step's gift in her hands (gear in the bag, a heart candy). */
function giveGift(save: SaveData, step: GuideStep, rng: () => number): 'gear' | 'candy' | null {
  if (step.gift === 'gear') {
    const id = GEAR_IDS[Math.floor(rng() * GEAR_IDS.length)] ?? 'hat_pin'
    addItem(save, makeItem(id, 'uncommon', rng, Math.max(1, save.level)))
    return 'gear'
  }
  if (step.gift === 'candy') {
    save.potions = Math.max(1, save.potions)
    return 'candy'
  }
  return null
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

/** Skip the guide (existing players, or anyone from the settings): chapter 2 opens. */
export function skipGuide(save: SaveData): void {
  const c = chaptersOf(save)
  c.offerSkip = false
  if (c.guide.done) return
  c.guide.done = true
  c.guide.skipped = true
  if (!c.cleared.includes(1)) c.cleared.push(1)
  c.current = Math.max(c.current, 2)
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

export function activeQuests(save: SaveData): ChapterQuestDef[] {
  const c = chaptersOf(save)
  return CHAPTER2.filter((d) => c.quests[d.id].status === 'active')
}

export function takeQuest(save: SaveData, id: string): { ok: boolean; reason?: string } {
  const c = chaptersOf(save)
  const q = c.quests[id]
  if (!chapter2Open(save)) return { ok: false, reason: '가이드 챕터를 먼저 마쳐 줘.' }
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
  if (!q || !d || q.status !== 'done') return { ok: false, reason: '아직 끝나지 않은 퀘스트야.', ...none }
  q.status = 'claimed'
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
  let cleared = 0
  if (d.kind === 'boss' && !c.cleared.includes(2)) {
    clearChapter(c, 2)
    cleared = 2
  }
  return { ok: true, result, cleared, gear }
}

/** Tracker lines for the HUD: active quests and progress. */
export function questHud(save: SaveData): { id: string; title: string; prog: string; done: boolean }[] {
  const c = chaptersOf(save)
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
