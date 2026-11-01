import { describe, expect, it } from 'vitest'
import { DOUBLE_TAP_MS, StickTaps, autoRunAfterKey } from '../src/sim/autorun'
import { WAYPOINT_REACH, distanceText, goalForContract, goalForQuest, nearest, route, trailDots } from '../src/sim/waypoint'
import { AUTO_AIM, assistPick, type AimTarget } from '../src/core/tps'
import { Delve, delveOf, floorPlan, fieldPlan } from '../src/sim/delve'
import { freshSave } from '../src/sim/mutate'
import { HELP_KEYS, HELP_QOL } from '../src/ui/help'
import { ZONE_OF, aimZone, popoverFit } from '../src/ui/layout'

describe('퀘스트 길 안내 목표', () => {
  it('챕터 2 퀘스트는 종류에 맞는 목표를, 끝나면 게시판을, 마을에선 별문을 가리킨다', () => {
    expect(goalForQuest('kill', 'slime', false, true)).toEqual({ kind: 'foe', target: 'slime' })
    expect(goalForQuest('kill', 'any', false, true)).toEqual({ kind: 'foe', target: undefined })
    expect(goalForQuest('named', '', false, true)).toEqual({ kind: 'named' })
    expect(goalForQuest('boss', '', false, true)).toEqual({ kind: 'boss' })
    expect(goalForQuest('collect', 'fluff', false, true)).toEqual({ kind: 'foe' })
    expect(goalForQuest('kill', 'slime', true, true)).toEqual({ kind: 'board' })
    expect(goalForQuest('kill', 'slime', false, false)).toEqual({ kind: 'gate' })
  })

  it('의뢰는 둥지·상자·보스·출구로 나뉘고, 완료되면 게시판이다', () => {
    expect(goalForContract('nests', false, true)).toEqual({ kind: 'nest' })
    expect(goalForContract('chests', false, true)).toEqual({ kind: 'chest' })
    expect(goalForContract('boss', false, true)).toEqual({ kind: 'boss' })
    expect(goalForContract('clean', false, true)).toEqual({ kind: 'exit' })
    expect(goalForContract('kills', false, true)).toEqual({ kind: 'foe' })
    expect(goalForContract('kills', true, true)).toEqual({ kind: 'board' })
    expect(goalForContract('kills', false, false)).toEqual({ kind: 'gate' })
  })

  it('가장 가까운 점을 고르고 거리를 m / km 로 적는다', () => {
    expect(nearest([{ x: 5, z: 0 }, { x: 1, z: 1 }], 0, 0)).toEqual({ x: 1, z: 1 })
    expect(nearest([], 0, 0)).toBeNull()
    expect(distanceText(12.4)).toBe('12m')
    expect(distanceText(240)).toBe('0.2km')
    expect(WAYPOINT_REACH).toBeGreaterThan(1)
  })
})

describe('미로 길찾기와 바닥 화살표', () => {
  // 5x5, a wall down the middle with a gap at the bottom.
  const grid = ['.....', '..#..', '..#..', '..#..', '.....']
  const open = (x: number, y: number) => grid[y]![x] === '.'

  it('벽을 돌아가는 가장 짧은 길을 양 끝 포함으로 돌려준다', () => {
    const r = route(5, 5, open, 0, 2, 4, 2)
    expect(r[0]).toEqual({ x: 0, y: 2 })
    expect(r[r.length - 1]).toEqual({ x: 4, y: 2 })
    expect(r.length).toBe(9)
    for (const t of r) expect(open(t.x, t.y)).toBe(true)
    for (let i = 1; i < r.length; i++) expect(Math.abs(r[i]!.x - r[i - 1]!.x) + Math.abs(r[i]!.y - r[i - 1]!.y)).toBe(1)
  })

  it('막힌 곳은 빈 길이다', () => {
    const shut = (x: number, y: number) => x !== 2 && open(x, y)
    expect(route(5, 5, shut, 0, 2, 4, 2)).toEqual([])
  })

  it('화살표 점은 선을 따라 같은 간격으로 놓이고, 오프셋으로 흘러간다', () => {
    const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }]
    const dots = trailDots(line, 2, 16)
    expect(dots.map((d) => d.x)).toEqual([0, 2, 4, 6, 8, 10])
    expect(trailDots(line, 2, 16, 1)[0]!.x).toBe(1)
    expect(trailDots(line, 1, 4).length).toBe(4)
    expect(trailDots([{ x: 0, z: 0 }], 1, 4)).toEqual([])
  })
})

describe('자동 달리기', () => {
  it('R / NumLock 으로 켜고 끄며, 이동 키를 누르면 멈춘다', () => {
    expect(autoRunAfterKey(false, 'KeyR', false)).toBe(true)
    expect(autoRunAfterKey(true, 'KeyR', false)).toBe(false)
    expect(autoRunAfterKey(false, 'NumLock', false)).toBe(true)
    expect(autoRunAfterKey(true, 'KeyR', true)).toBe(true)
    expect(autoRunAfterKey(true, 'KeyW', false)).toBe(false)
    expect(autoRunAfterKey(true, 'ArrowLeft', false)).toBe(false)
    expect(autoRunAfterKey(true, 'Space', false)).toBe(true)
  })

  it('스틱을 빠르게 두 번 톡 치면 토글, 끌면 드래그다', () => {
    const taps = new StickTaps()
    expect(taps.release(0, 100, 0.1)).toBe('tap')
    expect(taps.release(100 + DOUBLE_TAP_MS - 10, 100 + DOUBLE_TAP_MS + 60, 0.1)).toBe('double')
    expect(taps.release(2000, 2080, 0.1)).toBe('tap')
    expect(taps.release(2080 + DOUBLE_TAP_MS + 50, 2080 + DOUBLE_TAP_MS + 120, 0.1)).toBe('tap')
    expect(taps.release(5000, 5600, 0.1)).toBe('drag')
    expect(taps.release(6000, 6050, 0.9)).toBe('drag')
  })
})

describe('자동 조준', () => {
  it('켜면 조준선에서 조금 비껴간 적에게도 붙고, 끄면 기본 보정만 남는다', () => {
    const o = { x: 0, y: 1.5, z: 0 }
    const side: AimTarget = { x: 1.3, z: 10, y0: 1, y1: 2, r: 0.4 }
    expect(assistPick(o.x, o.y, o.z, 0, 0, 1, [side], 60)).toBeNull()
    expect(assistPick(o.x, o.y, o.z, 0, 0, 1, [side], 60, AUTO_AIM.slack, AUTO_AIM.maxCone)).not.toBeNull()
  })

  it('여럿이면 조준선에 가장 가까운 적을 고른다', () => {
    const o = { x: 0, y: 1.5, z: 0 }
    const a: AimTarget = { x: 1.2, z: 10, y0: 1, y1: 2, r: 0.4 }
    const b: AimTarget = { x: -0.5, z: 12, y0: 1, y1: 2, r: 0.4 }
    expect(assistPick(o.x, o.y, o.z, 0, 0, 1, [a, b], 60, AUTO_AIM.slack, AUTO_AIM.maxCone)?.index).toBe(1)
  })
})

describe('돌아가기 포털', () => {
  it('같은 깊이·층·소금으로 다시 열면 같은 미로다', () => {
    const save = freshSave()
    const first = Delve.start(save, 1, 2)!
    const again = Delve.reopen(save, 1, 2, first.salt)!
    expect(again.plan.seed).toBe(first.plan.seed)
    expect(again.plan).toEqual(floorPlan(1, 2, first.salt))
    expect(delveOf(save).checkpoint).toEqual({ depth: 1, floor: 2 })
  })

  it('열리지 않은 깊이는 다시 열 수 없다', () => {
    expect(Delve.reopen(freshSave(), 3, 1, 0)).toBeNull()
  })

  it('들판도 같은 계획으로 돌아간다', () => {
    const save = freshSave()
    const plan = fieldPlan(4, { kinds: [], fluff: false, named: false, boss: false })
    expect(Delve.reopenField(save, plan).plan).toEqual(plan)
  })
})

describe('편의 기능 안내', () => {
  it('도움말에 R 자동 달리기와 길 안내가 있고, 길 안내 칩은 오른쪽 위에 있다', () => {
    expect(HELP_KEYS.some(([k]) => k === 'R')).toBe(true)
    expect(HELP_QOL.some(([k]) => k === '퀘스트')).toBe(true)
    expect(ZONE_OF.waypoint).toBe('tr')
  })
})

describe('퀘스트 펼침 창과 조준선', () => {
  it('조준선 보호 구역에 닿으면 위쪽 여유만큼 줄이거나 옆으로 좁힌다', () => {
    const aim = aimZone(390, 844)
    const fit = popoverFit({ left: 116, top: 56, right: 376, bottom: 420 }, aim)
    expect(fit.maxHeight).toBe(Math.floor(aim.top - 56 - 6))
    expect(fit.width).toBeNull()
    const wide = aimZone(844, 390)
    const side = popoverFit({ left: 570, top: 150, right: 830, bottom: 300 }, wide)
    expect(side).toEqual({ maxHeight: null, width: null })
    const land = popoverFit({ left: 470, top: 150, right: 830, bottom: 300 }, wide)
    expect(land.width).toBe(Math.floor(830 - wide.right - 6))
  })

  it('안 닿으면 그대로 둔다', () => {
    expect(popoverFit({ left: 300, top: 60, right: 380, bottom: 120 }, aimZone(390, 844))).toEqual({ maxHeight: null, width: null })
  })
})
