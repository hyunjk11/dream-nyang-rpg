import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { skipGuide, takeQuest } from '../src/sim/chapters'
import { enterMaze, passMaze, storyTalk } from '../src/sim/dreamstory'
import { GROUP_KO, questArchive, questBook, trackedQuests, type QuestEntry } from '../src/sim/questbook'
import { REPEAT_ICON, boardOf, claimContract, contractRuns, runsText, takeContract } from '../src/sim/contracts'
import { townOf } from '../src/sim/town'
import { rng } from '../src/world/dungeon/maze'

function withContracts() {
  const s = freshSave()
  skipGuide(s)
  enterMaze(s)
  passMaze(s)
  storyTalk(s, rng(3))
  takeQuest(s, 'c2_slime')
  const board = boardOf(s, rng(7))
  takeContract(s, board[0].id)
  takeContract(s, board[1].id)
  return { s, board }
}

describe('🔁 반복 의뢰 분리 표시', () => {
  it('하수도 게시판 의뢰는 🔁 반복 그룹, 제목에 🔁 배지', () => {
    const { s } = withContracts()
    const reps = questBook(s).filter((q) => q.repeat)
    expect(reps.length).toBe(2)
    for (const q of reps) {
      expect(q.group).toBe('repeat')
      expect(q.title.startsWith(REPEAT_ICON)).toBe(true)
    }
    expect(GROUP_KO.repeat).toContain('반복')
    // 들판 챕터 퀘스트는 반복이 아니다.
    expect(questBook(s).find((q) => q.id === 'c2_slime')?.repeat).toBeFalsy()
  })

  it('보상을 받을 때마다 종류별 완료 n회가 늘고 옛 저장은 0회로 시작', () => {
    const { s, board } = withContracts()
    const c = townOf(s).contracts.find((x) => x.id === board[0].id)!
    expect(contractRuns(s, c.kind)).toBe(0)
    expect(runsText(0)).toBe('')
    c.status = 'done'
    expect(claimContract(s, c.id).ok).toBe(true)
    expect(contractRuns(s, c.kind)).toBe(1)
    expect(runsText(contractRuns(s, c.kind))).toBe('완료 1회')
    const old = freshSave()
    old.town = { scrolls: 0, stock: [], stockAt: -1, buyback: [], stash: [], contracts: [], boardAt: -1, contractsDone: 4 } as never
    expect(townOf(old).contractRuns).toEqual({})
    expect(questArchive(s).some((d) => d.group === 'repeat' && d.title.includes('반복'))).toBe(true)
  })

  it('HUD 는 이야기·챕터 퀘스트가 반복 의뢰보다 먼저 (반복을 고정해도)', () => {
    const q = (id: string, repeat = false, ready = false): QuestEntry => ({ id, group: id === 'main' ? 'main' : repeat ? 'repeat' : 'bounty', title: id, line: '', prog: '', ready, turnIn: '', reward: '', area: '', repeat })
    const book = [q('main'), q('r1', true, true), q('r2', true), q('story1'), q('story2')]
    const { shown } = trackedQuests(book, ['r1'])
    expect(shown.map((x) => x.id)).toEqual(['main', 'story1', 'story2'])
    const few = trackedQuests([q('main'), q('r1', true), q('story1')], ['r1'])
    expect(few.shown.map((x) => x.id)).toEqual(['main', 'story1', 'r1'])
  })
})
