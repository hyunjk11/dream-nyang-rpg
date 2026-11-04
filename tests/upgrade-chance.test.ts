import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { migrateItem } from '../src/sim/migrate-item'
import { mulberry32 } from '../src/sim/rng'
import { expectedCostToMax, expectedTries, MAX_PLUS, UPGRADE_CHANCE, upgradeChance, upgradeGun } from '../src/sim/workshop'
import type { SaveData } from '../src/sim/types'

function rich(): SaveData {
  const s = freshSave()
  s.gold = 10_000_000
  s.materials = { dream_dust: 100_000, toy_part: 0, star_shard: 100_000 }
  return s
}

describe('확률 강화', () => {
  it('성공 확률: +1~+5 100%, +6 80%, +7 65%, +8 50%, +9 35%, +10 25%', () => {
    expect(UPGRADE_CHANCE.slice(1)).toEqual([1, 1, 1, 1, 1, 0.8, 0.65, 0.5, 0.35, 0.25])
    const s = rich()
    const gun = s.items.find((i) => i.uid === s.equipment.weapon)!
    gun.plus = 9
    expect(upgradeChance(gun)).toBe(0.25)
    gun.plus = MAX_PLUS
    expect(upgradeChance(gun)).toBeNull()
  })

  it('실패하면 골드·재료만 들고 +N은 그대로, 다음 확률은 +10%p (성공하면 0으로)', () => {
    const s = rich()
    const gun = s.items.find((i) => i.uid === s.equipment.weapon)!
    gun.plus = 9
    const gold = s.gold
    const r = upgradeGun(s, gun.uid, () => 0.99)
    expect(r).toMatchObject({ ok: true, success: false, chance: 0.25 })
    expect(r.nextChance).toBeCloseTo(0.35)
    expect(gun.plus).toBe(9)
    expect(gun.upFails).toBe(1)
    expect(s.gold).toBe(gold - 2200)
    upgradeGun(s, gun.uid, () => 0.99)
    expect(upgradeChance(gun)).toBeCloseTo(0.45)
    expect(upgradeGun(s, gun.uid, () => 0.4).success).toBe(true)
    expect(gun.plus).toBe(10)
    expect(gun.upFails).toBe(0)
  })

  it('보정이 쌓이면 결국 100%: 굴림이 아무리 나빠도 +10 단계는 9번째에 꼭 성공', () => {
    const s = rich()
    const gun = s.items.find((i) => i.uid === s.equipment.weapon)!
    gun.plus = 9
    let tries = 0
    while (gun.plus === 9) {
      upgradeGun(s, gun.uid, () => 0.999999)
      tries += 1
    }
    expect(tries).toBe(9)
  })

  it('시드 고정 1000자루: 평균 시도 수가 기댓값과 맞고, 총 비용은 예전 4180골드의 3~4배', () => {
    const rng = mulberry32(2026)
    let attempts = 0
    let gold = 0
    const N = 1000
    for (let k = 0; k < N; k += 1) {
      const s = rich()
      const gun = s.items.find((i) => i.uid === s.equipment.weapon)!
      const g0 = s.gold
      while ((gun.plus ?? 0) < MAX_PLUS) {
        upgradeGun(s, gun.uid, rng)
        attempts += 1
      }
      gold += g0 - s.gold
    }
    const exp = 5 + [0.8, 0.65, 0.5, 0.35, 0.25].reduce((a, p) => a + expectedTries(p), 0)
    expect(attempts / N).toBeCloseTo(exp, 0)
    const e = expectedCostToMax()
    expect(gold / N / e.gold).toBeGreaterThan(0.95)
    expect(gold / N / e.gold).toBeLessThan(1.05)
    expect(e.gold / 4180).toBeGreaterThan(3)
    expect(e.gold / 4180).toBeLessThan(4)
    expect(e.mats.dream_dust / 55).toBeGreaterThan(3)
    expect(e.mats.star_shard / 6).toBeGreaterThan(3)
    expect(e.mats.star_shard / 6).toBeLessThan(4)
  })

  it('예전 저장의 강화 총은 실패 누적 0으로 옮겨진다', () => {
    const old = { uid: 'x', defId: 'gun_water', rarity: 'rare', itemLevel: 3, affixes: [], v: 2, plus: 7 } as never
    expect(migrateItem(old).upFails).toBe(0)
  })
})
