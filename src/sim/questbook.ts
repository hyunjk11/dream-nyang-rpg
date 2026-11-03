/**
 * 퀘스트 수첩: every quest source in one tidy list (pure; no DOM).
 *
 *  - 메인 (one per chapter, always on top): 챕터 1 = the guide, 챕터 2 = 모찌의 꿈 미로 then 몽이의 꿈의 비밀,
 *    챕터 3 = 꿈 바깥의 목소리 (준비 중).
 *  - 이야기: the island folk's side stories.
 *  - 의뢰: the board's 몽실 들판 quests (챕터 2, once 몽실 마을 is reached) and the sewer bounties.
 *
 * Each entry: a short title, one objective line, a progress count, and when it is ready, where to turn
 * it in and what it pays. The HUD tracker shows at most TRACK_CAP rows (main + pins / ready ones).
 */
import { CHAPTER2, GUIDE, chapter2Open, chapter3Open, fieldOpen, chaptersOf, guideStep, questRewardText, type ChapterQuestDef } from './chapters'
import { activeContracts, rewardText as contractReward, type Contract } from './contracts'
import { AREAS, MAZE_CHAIN, STORY, dreamOf, mazeOpen, mongsilOpen, type StoryQuest } from './dreamstory'
import { objectiveLine, rewardText as islandReward } from './quests'
import { QUESTS, QUEST_ORDER } from '../data/quests'
import { townOf } from './town'
import type { SaveData } from './types'

export type QuestGroup = 'main' | 'story' | 'bounty'

export const GROUP_KO: Record<QuestGroup, string> = { main: '메인', story: '이야기', bounty: '의뢰' }

export interface QuestEntry {
  id: string
  group: QuestGroup
  title: string
  /** One objective line. */
  line: string
  /** "3/10", or '' for a one-shot. */
  prog: string
  /** Finished: waiting to be turned in. */
  ready: boolean
  /** Where it is turned in. */
  turnIn: string
  reward: string
}

/** Rows the HUD tracker shows at once (main + 2). */
export const TRACK_CAP = 3

const MAZE_SHORT: Record<string, string> = { m_kill: '미로의 악몽 잠재우기', m_frag: '꿈 조각 찾기', m_rescue: '구름양 뭉게 구하기', m_elite: '미로지기 쓰러뜨리기' }
const FIELD_LINE: Record<string, string> = { slime: '몽실 들판의 솜사탕 슬라임 잡기', bat: '몽실 들판의 꿈박쥐 잡기', knight: '몽실 들판의 구름 기사 잡기', any: '몽실 들판 괴물 아무거나 잡기', fluff: '몽실 들판에서 몽실 솜사탕 줍기', named: '몽실 들판의 대장 몽글이 쓰러뜨리기', boss: '몽실 들판의 악몽 꽃 잠재우기' }
const BOUNTY_TITLE: Record<Contract['kind'], string> = { kills: '괴물 사냥', elites: '정예 사냥', nests: '둥지 부수기', chests: '상자 열기', clean: '무사 돌파', boss: '보스 잡기' }
const BOARD = '마을 게시판에서 보상 받기'

function storyLine(q: StoryQuest): string {
  if (q.kind === 'spark') return '몽실 들판에서 등불 불씨 모으기'
  if (q.kind === 'boss') return `${AREAS.moon.name}에서 ${AREAS.moon.boss?.name ?? '보스'} 잠재우기`
  return `${AREAS[q.where as keyof typeof AREAS]?.name ?? ''} 끝까지 가기`
}

/** The chapter's one main quest. */
export function mainQuest(save: SaveData): QuestEntry {
  const c = chaptersOf(save)
  const base = { id: 'main', group: 'main' as const, ready: false, turnIn: '', reward: '' }
  const step = guideStep(save)
  if (c.current === 1 || step) {
    const s = step ?? GUIDE[GUIDE.length - 1]
    const count = s.goal > 1 ? `${Math.min(s.goal, Math.floor(c.guide.count))}/${s.goal}` : ''
    return { ...base, title: `챕터 1 · 가이드 ${c.guide.step + 1}/${GUIDE.length}`, line: s.title, prog: count, reward: '마치면 챕터 2 · 꿈 미로가 열려' }
  }
  if (chapter3Open(save)) return { ...base, title: '챕터 3 · 꿈 바깥의 목소리', line: '다음 꿈은 준비 중이야', prog: '' }
  const d = dreamOf(save)
  if (!d.maze.passed) {
    if (!mazeOpen(save)) return { ...base, title: '챕터 2 · 꿈 미로로', line: '섬 별문에서 꿈 미로 들어가기', prog: '', reward: '모찌의 미로 퀘스트 시작' }
    const q = MAZE_CHAIN[d.maze.step]
    if (!q) return { ...base, title: `챕터 2 · 꿈 미로 ${MAZE_CHAIN.length}/${MAZE_CHAIN.length}`, line: '마지막 층 금빛 계단으로 미로 밖에', prog: '', reward: '몽실 마을 도착' }
    return { ...base, title: `챕터 2 · 꿈 미로 ${d.maze.step + 1}/${MAZE_CHAIN.length}`, line: MAZE_SHORT[q.id] ?? q.title, prog: q.goal > 1 ? `${d.maze.count}/${q.goal}` : '0/1', reward: `골드 ${q.reward.gold} · 경험치 ${q.reward.xp}`, turnIn: '끝나면 모찌가 바로 보상' }
  }
  const q = STORY[d.story.step]
  if (!q || !mongsilOpen(save)) return { ...base, title: '챕터 2 · 꿈의 비밀', line: '몽이에게 말 걸기', prog: '' }
  const reward = `골드 ${q.reward.gold} · 경험치 ${q.reward.xp} · 장비`
  const title = `챕터 2 · 꿈의 비밀 ${d.story.step + 1}/${STORY.length}`
  if (d.story.state === 'offer') return { ...base, title, line: `${q.title} · 몽실 마을 몽이에게 말 걸기`, prog: '', reward }
  if (d.story.state === 'ready') return { ...base, title, line: q.title, prog: '완료', ready: true, turnIn: '몽실 마을 몽이에게 보고', reward }
  return { ...base, title, line: `${q.title} · ${storyLine(q)}`, prog: q.kind === 'spark' ? `${d.story.count}/${q.goal}` : '0/1', turnIn: '몽실 마을 몽이에게 보고', reward }
}

function fieldEntry(save: SaveData, d: ChapterQuestDef): QuestEntry {
  const q = chaptersOf(save).quests[d.id]
  const ready = q.status === 'done'
  return { id: d.id, group: 'bounty', title: d.title, line: FIELD_LINE[d.target] ?? d.text, prog: ready ? '완료' : `${q.progress}/${d.goal}`, ready, turnIn: BOARD, reward: questRewardText(d) }
}

/** An objective line that is already met ('… 완료', or '… 5/5'). */
function lineDone(l: string): boolean {
  const m = /(\d+)\/(\d+)$/.exec(l)
  return /완료$/.test(l) || (!!m && Number(m[1]) >= Number(m[2]))
}

/** Every quest on the go, grouped: 메인 first, then 이야기, then 의뢰. */
export function questBook(save: SaveData): QuestEntry[] {
  const out: QuestEntry[] = [mainQuest(save)]
  // 이야기: island folk. 'q_awaken' is the prologue the guide already walks through, so it is not listed twice.
  for (const id of QUEST_ORDER) {
    const def = QUESTS[id]
    const st = save.quests[id]
    if (!def || !st || id === 'q_awaken') continue
    if (st.status !== 'active' && st.status !== 'completed') continue
    const ready = st.status === 'completed'
    const lines = def.objectives.map((o) => objectiveLine(save, id, o))
    const todo = lines.find((l) => !lineDone(l)) ?? lines[0] ?? ''
    const m = /\s(\d+\/\d+)$/.exec(todo)
    out.push({ id, group: 'story', title: def.title, line: m ? todo.slice(0, m.index) : todo, prog: ready ? '완료' : (m?.[1] ?? ''), ready, turnIn: def.autoTurnIn ? '끝나면 바로 보상' : '마을에 보고', reward: islandReward(def.rewards) })
  }
  if (fieldOpen(save)) {
    const c = chaptersOf(save)
    for (const d of CHAPTER2) if (c.quests[d.id].status === 'active' || c.quests[d.id].status === 'done') out.push(fieldEntry(save, d))
  }
  for (const k of activeContracts(save)) {
    const ready = k.status === 'done'
    out.push({ id: k.id, group: 'bounty', title: BOUNTY_TITLE[k.kind], line: `꿈 하수도 깊이 ${k.depth} 이상에서`, prog: ready ? '완료' : `${k.progress}/${k.goal}`, ready, turnIn: BOARD, reward: contractReward(k.reward) })
  }
  return out
}

/** Pinned quest ids (kept in the save's flags as 'pin:<id>'). */
export function pinsOf(save: SaveData): string[] {
  return Object.keys(save.flags ?? {}).filter((k) => k.startsWith('pin:') && save.flags[k]).map((k) => k.slice(4))
}

/** Pin / unpin a quest for the HUD. At most TRACK_CAP - 1 pins (the main row is always there). */
export function togglePin(save: SaveData, id: string): { ok: boolean; pinned: boolean; reason?: string } {
  if (id === 'main') return { ok: false, pinned: true, reason: '메인 퀘스트는 늘 맨 위에 있어.' }
  const key = `pin:${id}`
  if (save.flags[key]) {
    delete save.flags[key]
    return { ok: true, pinned: false }
  }
  const live = new Set(questBook(save).map((q) => q.id))
  for (const p of pinsOf(save)) if (!live.has(p)) delete save.flags[`pin:${p}`]
  if (pinsOf(save).length >= TRACK_CAP - 1) return { ok: false, pinned: false, reason: `고정은 ${TRACK_CAP - 1}개까지야. 하나를 먼저 풀어 줘.` }
  save.flags[key] = true
  return { ok: true, pinned: true }
}

/** What the HUD shows: main, then pinned, then ready-to-turn-in, then the rest; capped. */
export function trackedQuests(book: QuestEntry[], pins: string[], cap = TRACK_CAP): { shown: QuestEntry[]; more: number } {
  const [main, ...rest] = book
  const rank = (q: QuestEntry) => (pins.includes(q.id) ? 0 : q.ready ? 1 : 2)
  const sorted = rest.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map((x) => x.q)
  const shown = [main, ...sorted].filter(Boolean).slice(0, cap)
  return { shown, more: Math.max(0, book.length - shown.length) }
}

export interface DoneEntry {
  group: QuestGroup
  title: string
  note: string
}

/** Finished quests for the log's folded "완료" section. */
export function questArchive(save: SaveData): DoneEntry[] {
  const out: DoneEntry[] = []
  const c = chaptersOf(save)
  const d = dreamOf(save)
  if (c.cleared.includes(1)) out.push({ group: 'main', title: '챕터 1 · 가이드 챕터', note: c.guide.skipped ? '건너뜀' : '클리어' })
  if (chapter2Open(save)) {
    MAZE_CHAIN.slice(0, d.maze.step).forEach((q, i) => out.push({ group: 'main', title: `꿈 미로 ${i + 1}/${MAZE_CHAIN.length} · ${MAZE_SHORT[q.id] ?? q.title}`, note: `골드 ${q.reward.gold} · 경험치 ${q.reward.xp}` }))
    STORY.slice(0, d.story.done ? STORY.length : d.story.step).forEach((q, i) => out.push({ group: 'main', title: `꿈의 비밀 ${i + 1}/${STORY.length} · ${q.title}`, note: `골드 ${q.reward.gold} · 경험치 ${q.reward.xp}` }))
    for (const q of CHAPTER2) if (c.quests[q.id].status === 'claimed') out.push({ group: 'bounty', title: q.title, note: questRewardText(q) })
  }
  for (const id of QUEST_ORDER) if (save.quests[id]?.status === 'turnedIn' && QUESTS[id]) out.push({ group: 'story', title: QUESTS[id].title, note: '보고 완료' })
  const n = townOf(save).contractsDone
  if (n) out.push({ group: 'bounty', title: `하수도 의뢰 ${n}개`, note: '보상 받음' })
  return out
}
