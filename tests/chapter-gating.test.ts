import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { chapter2Open, chapter3Open, chaptersOf, claimQuest, guideEvent, questEvent, questHud, skipGuide, takeQuest, GUIDE } from '../src/sim/chapters'
import { dreamOf, enterMaze, mazeEvent, mazeHud, mazeOpen, mazeQuest, mongsilOpen, openAreas, passMaze, storyHud, storyQuest, storyTalk } from '../src/sim/dreamstory'
import { mainQuest, pinsOf, questArchive, questBook, togglePin, trackedQuests, TRACK_CAP, type QuestEntry } from '../src/sim/questbook'
import { rng } from '../src/world/dungeon/maze'
import type { SaveData } from '../src/sim/types'

const kill = { type: 'kill' as const, kind: 'slime' as const, elite: false }

/** Walk the guide forward n steps. */
function walkGuide(save: SaveData, n: number): void {
  for (let k = 0; k < n; k++) {
    const step = GUIDE[chaptersOf(save).guide.step]
    guideEvent(save, { type: step.id, amount: step.goal, depth: 1 }, rng(k + 1))
  }
}

/** An old save that took a chapter-2 board quest during the guide (the bug). */
function legacySave(): SaveData {
  const save = freshSave()
  save.chapters = {
    current: 2,
    guide: { step: 6, count: 0, done: false, skipped: false },
    cleared: [],
    quests: { c2_slime: { status: 'active', progress: 4 }, c2_bat: { status: 'offered', progress: 0 } },
    card: 0,
    offerSkip: false,
  } as unknown as SaveData['chapters']
  save.dream = undefined
  return save
}

describe('챕터 게이팅 · 새 저장', () => {
  it('새 저장은 챕터 1이고 챕터 2 퀘스트가 하나도 안 보인다', () => {
    const save = freshSave()
    expect(chaptersOf(save).current).toBe(1)
    expect(chapter2Open(save)).toBe(false)
    expect(questHud(save)).toEqual([])
    expect(mazeHud(save)).toBeNull()
    expect(mazeQuest(save)).toBeNull()
    expect(storyQuest(save)).toBeNull()
    expect(storyHud(save)).toBeNull()
    expect(openAreas(save)).toEqual([])
  })

  it('새 저장의 퀘스트 수첩에는 챕터 1 메인 퀘스트만 있다', () => {
    const book = questBook(freshSave())
    expect(book.map((q) => q.id)).toEqual(['main'])
    expect(book[0].title).toMatch(/^1장 · 가이드 1\/13/)
  })

  it('챕터 1에서는 미로 · 들판 이벤트가 진행되지 않는다', () => {
    const save = freshSave()
    expect(mazeEvent(save, 'kill', 5).toasts).toEqual([])
    expect(dreamOf(save).maze.count).toBe(0)
    enterMaze(save)
    expect(dreamOf(save).maze.entered).toBe(false)
  })

  it('챕터 1에서 몽이에게 말 걸어도 이야기 퀘스트를 받지 않는다', () => {
    const save = freshSave()
    const t = storyTalk(save, rng(3))
    expect(t.took).toBe(false)
    expect(dreamOf(save).story.state).toBe('offer')
  })
})

describe('챕터 게이팅 · 챕터 1 중간 저장', () => {
  it('가이드 중간에는 게시판 챕터 2 퀘스트를 받을 수 없다', () => {
    const save = freshSave()
    walkGuide(save, 7)
    expect(chaptersOf(save).guide.step).toBe(7)
    expect(takeQuest(save, 'c2_slime').ok).toBe(false)
    expect(chaptersOf(save).quests.c2_slime.status).toBe('offered')
  })

  it('가이드 중간 메인 퀘스트는 지금 단계와 진행도를 보여 준다', () => {
    const save = freshSave()
    walkGuide(save, 7)
    const m = mainQuest(save)
    expect(m.title).toBe(`1장 · 가이드 8/${GUIDE.length}`)
    expect(m.line).toBe(GUIDE[7].title)
    expect(questBook(save).every((q) => !q.id.startsWith('c2_'))).toBe(true)
  })

  it('가이드 중간에는 보상도 받을 수 없다', () => {
    const save = freshSave()
    walkGuide(save, 3)
    chaptersOf(save).quests.c2_slime = { status: 'done', progress: 10 }
    expect(claimQuest(save, 'c2_slime', rng(2)).ok).toBe(false)
  })
})

describe('챕터 게이팅 · 챕터 2 저장', () => {
  it('챕터 1을 마치면 메인 퀘스트가 꿈 미로로 바뀐다', () => {
    const save = freshSave()
    skipGuide(save)
    expect(chapter2Open(save)).toBe(true)
    expect(mazeOpen(save)).toBe(false)
    expect(mazeHud(save)).toBeNull()
    expect(mainQuest(save).title).toBe('2장 · 꿈 미로로')
  })

  it('미로에 들어가면 모찌의 퀘스트가 열리고 메인에 보인다', () => {
    const save = freshSave()
    skipGuide(save)
    enterMaze(save)
    expect(mazeOpen(save)).toBe(true)
    expect(mazeQuest(save)?.id).toBe('m_kill')
    expect(mainQuest(save).title).toBe('2장 · 꿈 미로 1/4')
  })

  it('미로를 건너면 몽실 이야기가 메인이 된다', () => {
    const save = freshSave()
    skipGuide(save)
    passMaze(save)
    expect(mongsilOpen(save)).toBe(true)
    expect(storyHud(save)).not.toBeNull()
    expect(mainQuest(save).title).toMatch(/^2장 · 꿈의 비밀 1\/6/)
  })

  it('챕터 2에서는 게시판 퀘스트를 받고 진행할 수 있다', () => {
    const save = freshSave()
    skipGuide(save)
    expect(takeQuest(save, 'c2_slime').ok).toBe(false)
    passMaze(save)
    expect(takeQuest(save, 'c2_slime').ok).toBe(true)
    questEvent(save, kill)
    expect(chaptersOf(save).quests.c2_slime.progress).toBe(1)
    expect(questBook(save).some((q) => q.id === 'c2_slime' && q.prog === '1/10')).toBe(true)
  })
})

describe('챕터 게이팅 · 미리 받아 둔 옛 저장', () => {
  it('가이드를 안 끝낸 채 받은 챕터 2 퀘스트는 챕터 1로 돌아가 숨겨진다', () => {
    const save = legacySave()
    const c = chaptersOf(save)
    expect(c.current).toBe(1)
    expect(questHud(save)).toEqual([])
    expect(questBook(save).map((q) => q.id)).toEqual(['main'])
    const d = dreamOf(save)
    expect(d.maze.passed).toBe(false)
    expect(d.home).toBe('island')
  })

  it('숨긴 동안 진행도는 그대로 남고 더 오르지 않는다', () => {
    const save = legacySave()
    questEvent(save, kill)
    expect(chaptersOf(save).quests.c2_slime).toEqual({ status: 'active', progress: 4 })
  })

  it('챕터 1을 마치면 미리 받은 퀘스트가 진행도 그대로 다시 보인다', () => {
    const save = legacySave()
    chaptersOf(save)
    skipGuide(save)
    expect(questHud(save).map((q) => q.id)).toEqual(['c2_slime'])
    expect(questBook(save).find((q) => q.id === 'c2_slime')?.prog).toBe('4/10')
  })

  it('진짜 챕터 2 옛 저장(가이드 완료)은 진행을 잃지 않는다', () => {
    const save = legacySave()
    ;(save.chapters as unknown as { guide: { done: boolean } }).guide.done = true
    const c = chaptersOf(save)
    expect(c.current).toBe(2)
    expect(c.cleared).toContain(1)
    expect(dreamOf(save).maze.passed).toBe(true)
    expect(mongsilOpen(save)).toBe(true)
    expect(c.quests.c2_slime.progress).toBe(4)
  })
})

describe('챕터 게이팅 · 챕터 3', () => {
  it('챕터 2를 안 깬 저장의 챕터 3은 챕터 2로 내려온다', () => {
    const save = freshSave()
    save.chapters = { current: 3, guide: { step: 13, count: 0, done: true, skipped: false }, cleared: [1], quests: {}, card: 0, offerSkip: false } as unknown as SaveData['chapters']
    expect(chaptersOf(save).current).toBe(2)
    expect(chapter3Open(save)).toBe(false)
  })

  it('가이드도 안 끝낸 챕터 3 저장은 챕터 1로 돌아온다', () => {
    const save = freshSave()
    save.chapters = { current: 3, guide: { step: 2, count: 0, done: false, skipped: false }, cleared: [2], quests: {}, card: 0, offerSkip: false } as unknown as SaveData['chapters']
    const c = chaptersOf(save)
    expect(c.current).toBe(1)
    expect(c.cleared).not.toContain(2)
  })

  it('챕터 2까지 깬 저장만 챕터 3이 열린다', () => {
    const save = freshSave()
    save.chapters = { current: 3, guide: { step: 13, count: 0, done: true, skipped: false }, cleared: [1, 2], quests: {}, card: 0, offerSkip: false } as unknown as SaveData['chapters']
    expect(chapter3Open(save)).toBe(true)
  })
})

describe('퀘스트 정리', () => {
  const q = (id: string, ready = false): QuestEntry => ({ id, group: id === 'main' ? 'main' : 'bounty', title: id, line: '', prog: '', ready, turnIn: '', reward: '', area: '' })

  it('HUD는 메인을 맨 위에 두고 최대 3개만 보여 준다', () => {
    const book = [q('main'), q('a'), q('b'), q('c'), q('d')]
    const t = trackedQuests(book, [])
    expect(t.shown.map((x) => x.id)).toEqual(['main', 'a', 'b'])
    expect(t.more).toBe(2)
    expect(TRACK_CAP).toBe(3)
  })

  it('고정한 퀘스트, 그다음 보상 받을 퀘스트가 먼저 보인다', () => {
    const book = [q('main'), q('a'), q('b'), q('c', true), q('d')]
    expect(trackedQuests(book, ['d']).shown.map((x) => x.id)).toEqual(['main', 'd', 'c'])
  })

  it('고정은 2개까지, 메인은 고정할 수 없다', () => {
    const save = freshSave()
    skipGuide(save)
    passMaze(save)
    for (const id of ['c2_slime', 'c2_bat']) takeQuest(save, id)
    expect(togglePin(save, 'main').ok).toBe(false)
    expect(togglePin(save, 'c2_slime').pinned).toBe(true)
    expect(togglePin(save, 'c2_bat').pinned).toBe(true)
    expect(togglePin(save, 'q_dust').ok).toBe(false)
    expect(togglePin(save, 'c2_slime').pinned).toBe(false)
    expect(pinsOf(save)).toEqual(['c2_bat'])
  })

  it('가이드(q_awaken)는 메인과 겹치지 않게 한 번만 나온다', () => {
    const save = freshSave()
    save.quests.q_awaken = { status: 'active', progress: {} } as unknown as SaveData['quests'][string]
    expect(questBook(save).some((x) => x.id === 'q_awaken')).toBe(false)
  })

  it('챕터 1을 마치면 완료 목록에 접혀 들어간다', () => {
    const save = freshSave()
    skipGuide(save)
    expect(questArchive(save).some((x) => x.title.startsWith('1장'))).toBe(true)
  })
})
