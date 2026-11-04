import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { makeItem } from '../src/sim/loot'
import { mulberry32 } from '../src/sim/rng'
import { migrateSave } from '../src/sim/migrate'
import { computeStats } from '../src/sim/stats'
import { equipItem } from '../src/sim/inventory'
import { DUAL_PACE, equipOffhand, handDps, handStats, offGun, pairRate, unequipOffhand } from '../src/sim/hands'
import type { ItemInstance, SaveData } from '../src/sim/types'

function withGuns(...made: ItemInstance[]): SaveData {
  const s = freshSave()
  s.items.push(...made)
  return s
}
const water = (seed: number, rarity: ItemInstance['rarity'] = 'rare', lv = 6) => {
  const i = makeItem('gun_water', rarity, mulberry32(seed), lv)
  i.affixes = []
  return i
}

describe('보조 손 · 쌍권총', () => {
  it('한 손 총 하나는 주 손만, 하나 더 차면 쌍권총 (손마다 자기 총 스탯)', () => {
    const a = water(1, 'rare', 6)
    const b = water(2, 'epic', 6)
    b.plus = 5
    const s = withGuns(a, b)
    equipItem(s, a.uid)
    expect(handStats(s).off).toBeNull()
    expect(equipOffhand(s, b.uid).ok).toBe(true)
    expect(offGun(s)?.uid).toBe(b.uid)
    const h = handStats(s)
    expect(h.off).not.toBeNull()
    expect(h.off!.shotDamage).toBeGreaterThan(h.main.shotDamage)
    const d = handDps(s)
    expect(d.off).toBeGreaterThan(d.main)
    expect(d.total).toBeCloseTo(d.main + d.off)
  })

  it('똑같은 총 두 자루 = 한 자루의 1.6~1.8배 초당 피해', () => {
    const a = water(3)
    const b = structuredClone(a)
    b.uid = 'twin'
    const s = withGuns(a, b)
    equipItem(s, a.uid)
    const solo = handDps(s).total
    equipOffhand(s, b.uid)
    const d = handDps(s)
    expect(d.vsOne).toBeGreaterThanOrEqual(1.6)
    expect(d.vsOne).toBeLessThanOrEqual(1.8)
    expect(d.total / solo).toBeCloseTo(DUAL_PACE, 5)
    expect(d.main).toBeCloseTo(d.off)
    // 공유 방아쇠 속도: 같은 총이면 1.7배
    const h = handStats(s)
    expect(pairRate(h.main, h.off)).toBeCloseTo(h.main.fireRate * DUAL_PACE, 5)
  })

  it('양손 총은 보조 손에 못 차고, 주 손에 양손 총을 들면 보조 손이 비워진다', () => {
    const a = water(4)
    const b = water(5)
    const sniper = makeItem('gun_dart', 'rare', mulberry32(6), 6)
    const s = withGuns(a, b, sniper)
    equipItem(s, a.uid)
    const r = equipOffhand(s, sniper.uid)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('양손 총')
    equipOffhand(s, b.uid)
    expect(equipItem(s, sniper.uid).ok).toBe(true)
    expect(s.equipment.offhand).toBeUndefined()
    const r2 = equipOffhand(s, b.uid)
    expect(r2.ok).toBe(false)
    expect(r2.reason).toContain('주 손')
  })

  it('스킬은 주 손 기준: 보조 손 총의 옵션은 주 손 스탯에 섞이지 않는다', () => {
    const a = water(7)
    const b = makeItem('gun_water', 'legendary', mulberry32(8), 12)
    const s = withGuns(a, b)
    equipItem(s, a.uid)
    const before = computeStats(s)
    equipOffhand(s, b.uid)
    expect(computeStats(s)).toEqual(before)
    expect(unequipOffhand(s).ok).toBe(true)
    expect(handStats(s).off).toBeNull()
  })

  it('옛 저장: 거울 쌍권총은 주 손만, 잘못된 보조 손(양손 총)은 빠진다', () => {
    const old = freshSave()
    migrateSave(old)
    expect(old.equipment.offhand).toBeUndefined()
    expect(handDps(old).vsOne).toBe(1)
    const bad = freshSave()
    const sniper = makeItem('gun_dart', 'rare', mulberry32(9), 3)
    bad.items.push(sniper)
    bad.equipment.offhand = sniper.uid
    migrateSave(bad)
    expect(bad.equipment.offhand).toBeUndefined()
  })
})
