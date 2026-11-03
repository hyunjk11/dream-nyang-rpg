import { describe, expect, it } from 'vitest'
import { FIELD, FieldDirector, fieldMaze } from '../src/world/dungeon/field'
import { Horde, SWING_CAP } from '../src/world/dungeon/horde'
import { floorMaze, planLayout } from '../src/world/dungeon/layout'
import { rng, tileCentre } from '../src/world/dungeon/maze'
import { floorPlan } from '../src/sim/delve'
import { areaPlan } from '../src/sim/dreamstory'

describe('몹 밀도 (2026-11)', () => {
  it('몽실 들판은 도착하자마자 예전(12마리)의 2.5배 이상이 들판 전체에 퍼져 있다', () => {
    const m = fieldMaze(9)
    const horde = new Horde(m)
    const fd = new FieldDirector(m, horde, rng(4), { kinds: ['slime', 'bug'], named: null, mobile: false })
    const s = tileCentre(m, m.start.x, m.start.y)
    fd.update(0.6, s.x, s.z, true)
    expect(horde.alive).toBeGreaterThanOrEqual(30)
    const far = horde.foes.filter((f) => Math.hypot(f.x - s.x, f.z - s.z) > 45).length
    expect(far).toBeGreaterThanOrEqual(6)
    expect(FIELD.alive[1]).toBeGreaterThanOrEqual(22)
  })

  it('들판은 처치해도 조금씩 계속 다시 채워진다', () => {
    const m = fieldMaze(5)
    const horde = new Horde(m)
    const fd = new FieldDirector(m, horde, rng(11), { kinds: ['slime'], named: null, mobile: false })
    const s = tileCentre(m, m.start.x, m.start.y)
    fd.update(1, s.x, s.z, true)
    horde.clear()
    fd.update(FIELD.every, s.x, s.z, true)
    const one = horde.alive
    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThanOrEqual(FIELD.pack[1])
    for (let t = 0; t < 20; t += 1) fd.update(FIELD.every, s.x, s.z, true)
    expect(horde.alive).toBeGreaterThan(fd.target / 2)
  })

  it('미로·하수도 탐험 층은 무리가 더 많다 (층마다 평균 7무리 이상)', () => {
    for (const make of [(s: number) => floorPlan(1, 1, s), (s: number) => areaPlan('maze', 1, s)]) {
      let packs = 0
      for (let s = 0; s < 5; s += 1) {
        const p = make(s)
        packs += planLayout(floorMaze(p), p, rng(p.seed ^ 0x5bd1e995)).packs.length
      }
      expect(packs / 5).toBeGreaterThanOrEqual(7)
    }
  })

  it('둘러싸여도 동시에 휘두르는 몹은 SWING_CAP 이하이고, 모두 차례로 때린다', () => {
    const m = fieldMaze(3)
    const h = new Horde(m)
    const c = tileCentre(m, Math.floor(m.w / 2), Math.floor(m.h / 2))
    const ids = new Set<number>()
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2
      const f = h.spawn('slime', c.x + Math.sin(a) * 1.1, c.z + Math.cos(a) * 1.1)!
      f.age = 10
    }
    const hero = { x: c.x, z: c.z, alive: true }
    let most = 0
    let hits = 0
    for (let t = 0; t < 600; t += 1) {
      h.update(1 / 60, hero, (_amt, x, z) => {
        hits += 1
        const f = h.foes.find((g) => Math.abs(g.x - x) < 1e-6 && Math.abs(g.z - z) < 1e-6)
        if (f) ids.add(f.id)
      })
      most = Math.max(most, h.foes.filter((f) => f.windup > 0).length)
    }
    expect(most).toBeLessThanOrEqual(SWING_CAP)
    expect(hits).toBeGreaterThan(8)
    expect(ids.size).toBeGreaterThanOrEqual(6)
  })
})
