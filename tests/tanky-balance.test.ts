import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { hordeHp } from '../src/world/dungeon/horde'
import { Horde } from '../src/world/dungeon/horde'
import { HordeView } from '../src/world/dungeon/horde-view'
import { BOSS } from '../src/world/dungeon/boss'
import { EXPLORE, floorMaze } from '../src/world/dungeon/layout'
import { floorPlan } from '../src/sim/delve'
import { STAT_CAPS } from '../src/sim/stats'
import { GUN_PROFILES } from '../src/data/guns'
import { REF_DPS } from '../tools/sim-ttk-ref'

const ttk = (kind: Parameters<typeof hordeHp>[0], d: number, f: number, elite = false) =>
  hordeHp(kind, floorPlan(d, f).scale.hp * EXPLORE.hp, elite) / REF_DPS[`d${d}f${f}`][0]

describe('몹 체력 재조정 (실측 DPS 기준 처치 시간)', () => {
  it('보통 장비로 일반 몹은 1~3.5초, 기사는 3~7.5초 걸린다 (깊이 1~3)', () => {
    for (const [d, f] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 3]]) {
      expect(ttk('slime', d, f), `d${d}f${f} 슬라임`).toBeGreaterThan(1)
      expect(ttk('slime', d, f), `d${d}f${f} 슬라임`).toBeLessThan(3.5)
      if (d * 10 + f >= 13) {
        expect(ttk('knight', d, f), `d${d}f${f} 기사`).toBeGreaterThan(3)
        expect(ttk('knight', d, f), `d${d}f${f} 기사`).toBeLessThan(7.5)
      }
    }
  })

  it('정예는 대략 10~25초, 종류가 커도 너무 길어지지 않는다', () => {
    for (const [d, f] of [[1, 2], [2, 2], [2, 3], [3, 1]]) {
      for (const k of ['slime', 'knight', 'golem'] as const) {
        expect(ttk(k, d, f, true), `d${d}f${f} 정예 ${k}`).toBeGreaterThan(10)
        expect(ttk(k, d, f, true), `d${d}f${f} 정예 ${k}`).toBeLessThan(26)
      }
    }
  })

  it('보스는 보통 장비로 1분~1분 35초 싸움이다 (사격 가능 시간 75%)', () => {
    for (const d of [1, 2, 3]) {
      const s = (BOSS.hp * floorPlan(d, 4).scale.boss.hp) / (REF_DPS[`d${d}f4`][0] * 0.75)
      expect(s, `깊이 ${d}`).toBeGreaterThan(55)
      expect(s, `깊이 ${d}`).toBeLessThan(95)
    }
  })

  it('치명타 확률·배율에 상한이 있고 별총 기본 피해는 낮췄다', () => {
    expect(STAT_CAPS.critChance).toBeLessThanOrEqual(0.45)
    expect(STAT_CAPS.critMul).toBeLessThanOrEqual(2.6)
    expect(GUN_PROFILES.star.damage).toBeLessThan(17)
  })
})

describe('몹 체력바', () => {
  it('맞은 몹 위에만 체력바가 뜨고, 남은 체력만큼 채워진다', () => {
    const maze = floorMaze(floorPlan(1, 1))
    const horde = new Horde(maze)
    const view = new HordeView()
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 200)
    const a = horde.spawn('slime', 0, 0, false)
    const b = horde.spawn('slime', 1.5, 0, false)
    expect(a && b).toBeTruthy()
    for (const f of horde.foes) { f.age = 99; f.x = f === a ? 0 : 1.5; f.z = -6 }
    cam.position.set(0, 1.6, 0)
    cam.lookAt(0.7, 0.5, -6)
    view.sync(horde, cam, 1)
    expect(view.barsDrawn).toBe(0)
    a!.hp = a!.maxHp / 2
    view.sync(horde, cam, 1.1)
    expect(view.barsDrawn).toBe(1)
    expect(view.fills.count).toBe(1)
  })
})
