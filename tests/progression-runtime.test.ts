import { describe, expect, it } from 'vitest'
import { Gun, OVERDRIVE_RATE } from '../src/combat/gunfeel'
import { GUN_PROFILES, gunDps } from '../src/data/guns'
import { skillSlotFor } from '../src/core/input'
import { ACTIVES, TREE_BY_ID } from '../src/data/tree'
import { addItem } from '../src/sim/inventory'
import { makeItem } from '../src/sim/loot'
import { freshSave, tryEquip } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { computeStats } from '../src/sim/stats'
import { BEAM_HEIGHT } from '../src/world/dungeon/loot-view'
import { compareEquip, dpsOf } from '../src/ui/inventory'

/** Shots fired over `seconds` of held trigger at 60 fps. */
function shotsOver(g: Gun, seconds: number): number[] {
  const times: number[] = []
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const n = g.update(dt, true)
    for (let i = 0; i < n; i += 1) times.push(t)
  }
  return times
}

describe('총 종류별 사격감', () => {
  it('점사 소총은 3발씩 끊어 쏘고 사이에 쉰다', () => {
    const g = new Gun()
    const p = GUN_PROFILES.star
    g.setFeel(p, 1)
    const times = shotsOver(g, 1.5)
    expect(p.burst).toBe(3)
    // Gaps inside a burst are short; every third gap is the long rest.
    const gaps = times.slice(1).map((t, i) => t - times[i])
    expect(gaps[0]).toBeLessThan(p.gap + 0.02)
    expect(gaps[2]).toBeGreaterThan(p.gap + p.burstRest - 0.02)
  })

  it('연사 속도 배율과 과열 폭주는 발사 간격을 줄인다', () => {
    const slow = new Gun()
    slow.setFeel(GUN_PROFILES.dart, 1)
    const fast = new Gun()
    fast.setFeel(GUN_PROFILES.dart, 1.5)
    expect(shotsOver(fast, 3).length).toBeGreaterThan(shotsOver(slow, 3).length)
    const od = new Gun()
    od.setFeel(GUN_PROFILES.dart, 1)
    od.overdrive = 5
    expect(shotsOver(od, 3).length).toBeGreaterThan(shotsOver(slow, 3).length * (OVERDRIVE_RATE - 0.35))
  })

  it('샷건은 한 번에 여러 알, 저격총은 한 발이 세다', () => {
    expect(GUN_PROFILES.bubble.pellets).toBeGreaterThan(3)
    expect(GUN_PROFILES.dart.damage).toBeGreaterThan(GUN_PROFILES.water.damage * 3)
    // Every base lands in the same DPS ballpark (feel differs, power doesn't run away).
    const base = gunDps(GUN_PROFILES.water)
    for (const p of Object.values(GUN_PROFILES)) expect(gunDps(p) / base).toBeGreaterThan(0.7)
    for (const p of Object.values(GUN_PROFILES)) expect(gunDps(p) / base).toBeLessThan(1.35)
  })
})

describe('액티브 단축키', () => {
  it('1–4는 액티브 네 개, E와 T는 비켜 간다', () => {
    expect(skillSlotFor('Digit1')).toBe(0)
    expect(skillSlotFor('Numpad4')).toBe(3)
    expect(skillSlotFor('KeyE')).toBe(-1)
    expect(skillSlotFor('KeyT')).toBe(-1)
    ACTIVES.forEach((id, i) => expect(TREE_BY_ID[id].key).toBe(String(i + 1)))
  })
})

describe('장비 비교', () => {
  it('비교표는 실제 장착 결과와 같은 차이를 보여 준다', () => {
    const save = freshSave()
    const gun = makeItem('gun_dart', 'epic', mulberry32(4), 10)
    addItem(save, gun)
    const before = computeStats(save)
    const diff = compareEquip(save, gun.uid)
    expect(diff.length).toBeGreaterThan(0)
    expect(save.equipment.weapon).not.toBe(gun.uid)
    tryEquip(save, gun.uid)
    const after = computeStats(save)
    const shot = diff.find((d) => d.key === 'shot')
    expect(shot?.delta).toBeCloseTo(after.shotDamage - before.shotDamage, 5)
    expect(after.weaponKind).toBe('dart')
    expect(dpsOf(after)).toBeGreaterThan(dpsOf(before))
  })

  it('희귀도가 높을수록 빛기둥이 높다', () => {
    expect(BEAM_HEIGHT.common).toBe(0)
    expect(BEAM_HEIGHT.legendary).toBeGreaterThan(BEAM_HEIGHT.epic)
    expect(BEAM_HEIGHT.epic).toBeGreaterThan(BEAM_HEIGHT.rare)
    expect(BEAM_HEIGHT.rare).toBeGreaterThan(BEAM_HEIGHT.uncommon)
  })
})
