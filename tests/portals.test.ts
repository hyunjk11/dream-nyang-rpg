import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { skipGuide, tutorialRest } from '../src/sim/chapters'
import { Delve, delveOf, delveThemeName, floorLabel, portalChoices } from '../src/sim/delve'
import { enterMaze, passMaze } from '../src/sim/dreamstory'
import { delveGateRows, shouldParkFloor, storyGateRows } from '../src/sim/portals'
import { placeLabel } from '../src/sim/places'
import { themeFor } from '../src/world/dungeon/theme'

describe('별문: 이야기 길과 무한 탐험', () => {
  it('마을 별문은 깊이를 늘어놓지 않고 무한 탐험 한 줄만 둔다', () => {
    const save = freshSave()
    delveOf(save).unlocked = 4
    const rows = storyGateRows({
      where: 'village',
      save,
      zones: [{ label: placeLabel('meadow'), go: 'meadow' }],
      kept: '',
    })
    expect(rows.filter((r) => r.lane === 'delve')).toEqual([{ text: '무한 탐험 · 꿈 하수도', go: 'delve-menu', lane: 'delve' }])
    expect(rows.some((r) => r.text.includes('깊이 2'))).toBe(false)
    expect(rows.map((r) => r.lane)).toEqual(['story', 'story', 'delve'])
  })

  it('무한 탐험 메뉴는 테마 이름이고 이야기 장소가 없다', () => {
    const save = freshSave()
    delveOf(save).unlocked = 6
    delveOf(save).cleared = 4
    const rows = delveGateRows(save)
    expect(rows.filter((r) => r.lane === 'delve').map((r) => r.text)).toEqual([
      '무한 탐험 · 깊이 1 · 꿈 하수도 ✓',
      '무한 탐험 · 깊이 4 · 꿈 하수도 ✓',
      '무한 탐험 · 깊이 5 · 캔디 동굴',
      '무한 탐험 · 깊이 6 · 별빛 서재',
    ])
    expect(rows.at(-1)).toMatchObject({ go: 'story-menu', lane: 'nav' })
    expect(rows.some((r) => r.text.includes('몽실') || r.text.includes('꿈 미로'))).toBe(false)
    expect(portalChoices(save).map((c) => c.depth)).toEqual([1, 4, 5, 6])
  })

  it('테마 이름은 던전 룩과 같다', () => {
    for (const d of [1, 2, 3, 4]) expect(delveThemeName(d)).toBe(themeFor(d).name)
    expect(floorLabel(4, 4)).toBe('1장 · 깊이 4 · 꿈 하수도 · 보스층')
  })

  it('챕터 2 별문은 섬·들판·잠긴 장소, 그리고 돌아가기와 무한 탐험', () => {
    const save = freshSave()
    skipGuide(save)
    enterMaze(save)
    passMaze(save)
    const rows = storyGateRows({ where: 'mongsil', save, zones: [], kept: '깊이 2 · 3층' })
    expect(rows[0]).toMatchObject({ go: 'return', lane: 'return' })
    expect(rows.find((r) => r.go === 'island')?.text).toContain('꿈의 마을')
    expect(rows.find((r) => r.go === 'field')?.lane).toBe('story')
    expect(rows.find((r) => r.go === 'delve-menu')?.lane).toBe('delve')
    expect(rows.filter((r) => r.lane === 'delve')).toHaveLength(1)
    expect(rows.some((r) => r.locked)).toBe(true)
  })

  it('숲 별문은 마을로만 돌아가고 하수도 깊이를 열지 않는다', () => {
    const rows = storyGateRows({
      where: 'wild',
      save: freshSave(),
      zones: [{ label: placeLabel('village', '돌아가기'), go: 'village' }],
      kept: '깊이 1 · 2층',
    })
    expect(rows.map((r) => r.go)).toEqual(['village'])
  })
})

describe('돌아가기 포털', () => {
  it('귀환과 쓰러짐은 층을 남기고, 클리어·보스·마을은 남기지 않는다', () => {
    expect(shouldParkFloor('recall', { town: false, bossBeaten: false, justUnlocked: false })).toBe(true)
    expect(shouldParkFloor('down', { town: false, bossBeaten: false, justUnlocked: false })).toBe(true)
    expect(shouldParkFloor('clear', { town: false, bossBeaten: false, justUnlocked: false })).toBe(false)
    expect(shouldParkFloor('recall', { town: false, bossBeaten: true, justUnlocked: false })).toBe(false)
    expect(shouldParkFloor('recall', { town: true, bossBeaten: false, justUnlocked: false })).toBe(false)
    expect(shouldParkFloor('down', { town: false, bossBeaten: false, justUnlocked: true })).toBe(false)
  })

  it('챕터 1 처치 단계 전에는 초원 슬라임이 남는다', () => {
    const save = freshSave()
    expect(tutorialRest(save)).toBe(true)
    skipGuide(save)
    expect(tutorialRest(save)).toBe(false)
  })
})

describe('탐험은 체크포인트를 건드리지 않은 채 이어가기를 붙인다', () => {
  it('2층 체크포인트는 무한 탐험 목록 맨 아래다', () => {
    const save = freshSave()
    const run = Delve.start(save, 1)!
    run.nextFloor(save)
    run.finish(save, 'recall')
    expect(portalChoices(save).at(-1)?.label).toBe('이어가기 · 깊이 1 · 꿈 하수도 · 2층')
  })
})
