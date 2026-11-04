import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { skipGuide, takeQuest } from '../src/sim/chapters'
import { enterMaze, passMaze, storyTalk } from '../src/sim/dreamstory'
import { questBook, trackedQuests, pinsOf } from '../src/sim/questbook'
import { PLACES, placeLabel, lockedLabel, placeRank } from '../src/sim/places'
import { areaLabel } from '../src/sim/areas'
import { floorLabel, portalChoices } from '../src/sim/delve'
import { rng } from '../src/world/dungeon/maze'
import type { SaveData } from '../src/sim/types'

const ORDER = { main: 0, story: 1, bounty: 2 } as const
function mongsilSave(): SaveData {
  const s = freshSave()
  skipGuide(s)
  enterMaze(s)
  passMaze(s)
  storyTalk(s, rng(3))
  takeQuest(s, 'c2_slime')
  takeQuest(s, 'c2_bat')
  return s
}

describe('퀘스트 정리 2: 순서 · 장소 · 미래 챕터 숨김', () => {
  it('수첩은 메인 → 이야기 → 의뢰 순서이고 메인은 하나뿐이다', () => {
    for (const s of [freshSave(), mongsilSave()]) {
      const g = questBook(s).map((q) => ORDER[q.group])
      expect([...g].sort((a, b) => a - b)).toEqual(g)
      expect(questBook(s).filter((q) => q.group === 'main')).toHaveLength(1)
    }
  })

  it('모든 퀘스트가 "n장 · 장소" 지역을 보여 준다', () => {
    for (const q of questBook(mongsilSave())) expect(q.area).toMatch(/^[12]장 · \S/)
    expect(questBook(freshSave())[0]!.area).toBe('1장 · 꿈의 마을')
  })

  it('같은 퀘스트가 두 번 나오지 않는다', () => {
    const ids = questBook(mongsilSave()).map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('1장에서는 2장 · 3장 이름이 수첩 어디에도 없다', () => {
    const text = JSON.stringify(questBook(freshSave()))
    expect(text).not.toMatch(/2장 ·|3장|꿈 미로|몽실/)
  })

  it('3장이 열려도 내용 없는 3장 티저 대신 "2장 완료"만 보인다', () => {
    const s = mongsilSave()
    s.chapters!.current = 3
    s.chapters!.cleared.push(2)
    const main = questBook(s)[0]!
    expect(main.title).toBe('2장 완료')
    expect(JSON.stringify(questBook(s))).not.toContain('3장')
  })

  it('HUD는 메인 + 최대 2개', () => {
    const book = questBook(mongsilSave())
    const shown = trackedQuests(book, []).shown
    expect(shown[0]!.group).toBe('main')
    expect(shown.length).toBeLessThanOrEqual(3)
    expect(trackedQuests(book, pinsOf(mongsilSave())).shown.length).toBeLessThanOrEqual(3)
  })
})

describe('포털 이름: "n장 · 이름" · 이야기 순서 · 잠금', () => {
  it('장소 목록은 이야기 순서 (1장 → 2장)', () => {
    const ch = PLACES.map((p) => p.chapter)
    expect([...ch].sort()).toEqual(ch)
    expect(placeRank('meadow')).toBeLessThan(placeRank('moon'))
  })

  it('이름표 형식은 "n장 · 이름 · 꼬리"이고 잠금은 "🔒 … · n장 필요"', () => {
    expect(placeLabel('field')).toBe('2장 · 몽실 들판')
    expect(placeLabel('sewer', '깊이 2')).toBe('1장 · 꿈 하수도 · 깊이 2')
    expect(lockedLabel('maze')).toBe('🔒 2장 · 꿈 미로 · 2장 필요')
  })

  it('층 이름표 · 지역 이름표 · 포털 메뉴가 같은 이름을 쓴다', () => {
    expect(floorLabel(1, 1)).toContain(placeLabel('sewer'))
    expect(areaLabel('maze', 1)).toContain(placeLabel('maze'))
    const s = freshSave()
    for (const c of portalChoices(s)) expect(c.label.startsWith(placeLabel('sewer'))).toBe(true)
  })
})
