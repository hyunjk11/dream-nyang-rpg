import { describe, expect, it } from 'vitest'
import { threatTable, type FightRow } from '../tools/sim-threat'
import { HORDE } from '../src/world/dungeon/horde'
import { FOE_SPECS } from '../src/combat/foes'

const rows = threatTable()
const row = (area: string, gear: FightRow['gear'], who: string) => {
  const found = rows.find((r) => r.area === area && r.gear === gear && r.who === who)
  expect(found, `${area} ${gear} ${who}`).toBeTruthy()
  return found!
}

describe('적 공격 상향: 싸우는 동안 체력이 빠진다 (체력은 그대로)', () => {
  it('몬스터 체력 표는 올리지 않았다', () => {
    expect(HORDE.slime.hp).toBe(26)
    expect(FOE_SPECS.slime.hp).toBe(34)
    expect(FOE_SPECS.bug.hp).toBe(46)
  })

  it('챕터 1 단일 싸움은 눈에 띄게 아프고, 가이드는 그다음 구역보다 가볍다', () => {
    const guide = row('가이드 초원', '+0', '단일 slime')
    const forest = row('몽환의 숲', '+0', '단일 bug')
    const vale = row('버섯 골짜기', '+0', '단일 rabbit')
    expect(guide.lost).toBeGreaterThanOrEqual(8)
    expect(guide.lost).toBeLessThan(40)
    expect(guide.dead).toBe(false)
    expect(forest.lost).toBeGreaterThan(guide.lost)
    expect(forest.lost).toBeLessThan(50)
    expect(vale.lost).toBeGreaterThanOrEqual(8)
    expect(vale.dead).toBe(false)
    expect(row('별빛 제단', '+0', '단일 bloom').lost).toBeGreaterThan(40)
    expect(row('별빛 제단', '+0', '단일 bloom').dead).toBe(false)
  })

  it('챕터 1 무리는 사탕이 아쉬울 만큼 깎지만 즉사는 아니다', () => {
    for (const [area, who] of [
      ['몽환의 숲', '무리 3 bug'],
      ['버섯 골짜기', '무리 3 rabbit'],
    ] as const) {
      const r = row(area, '+0', who)
      expect(r.lost, area).toBeGreaterThanOrEqual(20)
      expect(r.dead, area).toBe(false)
    }
  })

  it('하수도·들판 단일은 맞고, 깊이가 깊을수록 더 아프다', () => {
    const d1 = row('하수도 깊이1', '+0', '근접')
    const d1r = row('하수도 깊이1', '+0', '원거리')
    const d3 = row('무한탑 깊이3', '+0', '근접')
    const d3r = row('무한탑 깊이3', '+0', '원거리')
    for (const r of [d1, d1r]) {
      expect(r.lost).toBeGreaterThanOrEqual(12)
      expect(r.lost).toBeLessThan(45)
      expect(r.dead).toBe(false)
    }
    expect(d3.lost).toBeGreaterThan(d1.lost)
    expect(d3r.lost).toBeGreaterThan(d1r.lost)
    expect(d3.lost).toBeGreaterThanOrEqual(30)
    expect(row('들판', '+0', '근접').lost).toBeGreaterThanOrEqual(12)
    expect(row('들판', '+0', '원거리').lost).toBeGreaterThanOrEqual(12)
  })

  it('무리 싸움은 단일보다 위험하고, 깊이 3 무리는 대시 없이 버티기 어렵다', () => {
    const d1 = row('하수도 깊이1', '+0', '무리4')
    const d3 = row('무한탑 깊이3', '+0', '무리4')
    expect(d1.lost).toBeGreaterThan(row('하수도 깊이1', '+0', '근접').lost)
    expect(d1.lost).toBeGreaterThanOrEqual(50)
    expect(d3.lost).toBeGreaterThanOrEqual(d1.lost)
    expect(d3.dead || d3.lost >= 120).toBe(true)
  })

  it('+3 강화로도 깊이 3은 단일·무리 모두 실피해다', () => {
    const single = row('무한탑 깊이3', '+3', '근접')
    const ranged = row('무한탑 깊이3', '+3', '원거리')
    const pack = row('무한탑 깊이3', '+3', '무리4')
    expect(single.lost).toBeGreaterThanOrEqual(30)
    expect(ranged.lost).toBeGreaterThanOrEqual(30)
    expect(single.dead).toBe(false)
    expect(pack.lost).toBeGreaterThanOrEqual(100)
  })
})
