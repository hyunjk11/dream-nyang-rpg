import { describe, expect, it } from 'vitest'
import { DIFFICULTY, DIFF_MODES } from '../src/combat/difficulty'
import { HORDE, hordeHp } from '../src/world/dungeon/horde'
import { BOSS } from '../src/world/dungeon/boss'
import { EXPLORE } from '../src/world/dungeon/layout'
import { floorPlan } from '../src/sim/delve'
import { FOE_SPECS } from '../src/combat/foes'
import { TALLY, addTally, newTally, tallyVisible } from '../src/ui/hudfx'

/** 시작 물총 한 방울(치명타 없음). */
const DROP = 9
const hits = (hp: number) => Math.ceil(hp / DROP)
const exploreHp = (d: number, f: number) => floorPlan(d, f).scale.hp * EXPLORE.hp

describe('몬스터가 단단해짐 (한 방에 죽지 않음)', () => {
  it('깊이 1 1층 일반 몬스터는 시작 물총(실측 137 DPS)으로 2~4초 걸린다', () => {
    for (const kind of ['slime', 'bat', 'bug', 'skeleton'] as const) {
      const s = hordeHp(kind, exploreHp(1, 1), false, 1) / 137
      expect(s, kind).toBeGreaterThanOrEqual(2)
      expect(s, kind).toBeLessThanOrEqual(4.5)
    }
  })

  it('정예는 시작 물총으로 30방 이상이다', () => {
    for (const kind of ['slime', 'bat', 'bug'] as const) expect(hits(hordeHp(kind, exploreHp(1, 1), true, 1)), kind).toBeGreaterThanOrEqual(30)
  })

  it('보스는 긴 싸움이다 (시작 물총 250방 이상)', () => {
    expect(hits(BOSS.hp * floorPlan(1, 4).scale.boss.hp)).toBeGreaterThanOrEqual(250)
  })

  it('예전 슬라임(4방)보다 확실히 단단하다', () => {
    const before = Math.round(HORDE.slime.hp * 0.78 * exploreHp(1, 1))
    expect(hordeHp('slime', exploreHp(1, 1), false, 1)).toBeGreaterThan(before * 1.5)
  })

  it('단단해진 만큼 한 대의 피해는 줄어 공정하다', () => {
    expect(DIFFICULTY.horde.damage).toBeLessThan(0.62)
    expect(DIFFICULTY.elite.damage).toBeLessThan(1.6)
    expect(DIFFICULTY.boss.damage).toBeLessThan(0.75)
  })

  it('마을 몬스터도 한 방에 죽지 않는다', () => {
    expect(hits(FOE_SPECS.slime.hp * DIFFICULTY.town.hp)).toBeGreaterThanOrEqual(5)
  })

  it('쉬움/보통/어려움 선택이 그대로 체력에 반영된다', () => {
    const at = (m: keyof typeof DIFF_MODES) => hordeHp('slime', 1, false, DIFF_MODES[m].foeHp)
    expect(at('easy')).toBeLessThan(at('normal'))
    expect(at('normal')).toBeLessThan(at('hard'))
    expect(Object.values(DIFF_MODES).map((m) => m.label)).toEqual(['쉬움', '보통', '어려움'])
  })
})

describe('데미지 숫자 누적', () => {
  it('같은 적을 연달아 맞히면 합계가 쌓인다', () => {
    const foe = {}
    const s = newTally()
    for (let i = 0; i < 5; i += 1) addTally(s, 9, foe, false)
    expect(s.total).toBe(45)
    expect(s.hits).toBe(5)
    expect(tallyVisible(s)).toBe(true)
  })

  it('다른 적으로 바꾸거나 오래 쉬면 새로 센다', () => {
    const a = {}
    const s = newTally()
    addTally(s, 9, a, false)
    addTally(s, 9, a, false)
    addTally(s, 9, {}, false)
    expect(s.total).toBe(9)
    addTally(s, 9, s.ref, false)
    s.idle = TALLY.gap + 0.1
    addTally(s, 5, s.ref, false)
    expect(s.total).toBe(5)
  })

  it('처치하면 최종 합계를 잠깐 보여준 뒤 사라진다', () => {
    const foe = {}
    const s = newTally()
    for (let i = 0; i < 4; i += 1) addTally(s, 10, foe, i === 3)
    expect(s.done).toBe(true)
    s.idle = TALLY.hold - 0.1
    expect(tallyVisible(s)).toBe(true)
    s.idle = TALLY.hold + 0.1
    expect(tallyVisible(s)).toBe(false)
    addTally(s, 7, foe, false)
    expect(s.total).toBe(7)
  })

  it('한두 방은 누적 표시하지 않는다', () => {
    const s = newTally()
    addTally(s, 9, {}, false)
    expect(tallyVisible(s)).toBe(false)
  })
})
