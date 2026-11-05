import { describe, expect, it } from 'vitest'
import { UPGRADE_MUL, upgradeMul } from '../src/sim/loot'
import { MOD_RARITY, makeMod } from '../src/sim/mods'
import { freshSave } from '../src/sim/mutate'
import { computeStats } from '../src/sim/stats'

/**
 * 강화 곡선 (before → after). +1..+5 always succeed and used to be +7% each
 * (+5 = ×1.35, +10 = ×1.70). Early steps are now +4% of the base gun; the
 * risky +6..+10 steps hold most of the reward; +10 stops at ×1.60.
 */
const BEFORE = [1, 1.07, 1.14, 1.21, 1.28, 1.35, 1.42, 1.49, 1.56, 1.63, 1.7]

describe('강화 곡선', () => {
  it('+0..+10 은 예전보다 낮고, 뒤 단계가 더 크게 오른다', () => {
    expect([...UPGRADE_MUL]).toEqual([1, 1.04, 1.08, 1.12, 1.16, 1.2, 1.26, 1.33, 1.41, 1.5, 1.6])
    for (let n = 0; n <= 10; n += 1) {
      expect(upgradeMul(n)).toBe(UPGRADE_MUL[n])
      expect(upgradeMul(n)).toBeLessThanOrEqual(BEFORE[n])
      if (n > 0) expect(upgradeMul(n)).toBeGreaterThan(upgradeMul(n - 1))
    }
    const early = upgradeMul(1) - upgradeMul(0)
    const late = upgradeMul(10) - upgradeMul(9)
    expect(early).toBeCloseTo(0.04)
    expect(late).toBeGreaterThan(early)
    // A few cheap upgrades help (~+12% at +3) and do not approach the old +21%.
    expect(upgradeMul(3)).toBeLessThan(1.15)
    expect(upgradeMul(5)).toBeLessThan(1.25)
    expect(upgradeMul(10)).toBeGreaterThan(upgradeMul(5))
    expect(upgradeMul(10)).toBeLessThan(1.65)
  })

  it('총 피해만 올라가고, 강화는 방어를 올리지 않는다', () => {
    const save = freshSave()
    const gun = save.items.find((i) => i.uid === save.equipment.weapon)!
    gun.plus = 0
    const base = computeStats(save)
    gun.plus = 5
    const up = computeStats(save)
    expect(up.shotDamage / base.shotDamage).toBeCloseTo(upgradeMul(5), 2)
    expect(up.armor).toBeCloseTo(base.armor)
    expect(up.maxHp).toBe(base.maxHp)
  })

  it('부품 강화는 등급마다 오르되, 전설이 보통의 두 배가 되지 않는다', () => {
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
    for (let i = 1; i < order.length; i += 1) expect(MOD_RARITY[order[i]]).toBeGreaterThan(MOD_RARITY[order[i - 1]])
    expect(MOD_RARITY.uncommon).toBeLessThan(1.12)
    expect(MOD_RARITY.legendary / MOD_RARITY.common).toBeLessThan(1.5)
    expect(MOD_RARITY.legendary / MOD_RARITY.common).toBeGreaterThan(1.3)
    const common = makeMod('mod_barrel', 'common', 8).affixes[0].value
    const legend = makeMod('mod_barrel', 'legendary', 8).affixes[0].value
    expect(legend).toBeGreaterThan(common)
    expect(legend / common).toBeGreaterThan(1.35)
    expect(legend / common).toBeLessThan(MOD_RARITY.legendary + 0.02)
  })
})
