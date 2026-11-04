import { describe, expect, it } from 'vitest'
import { MOD_IDS } from '../src/data/mods'
import { addItem, findItem } from '../src/sim/inventory'
import { itemName, makeItem } from '../src/sim/loot'
import { attachMod, fitPreview, gunMods, makeMod, partTier } from '../src/sim/mods'
import { freshSave } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { upgradeLines } from '../src/ui/itemcell'

function setup() {
  const save = freshSave()
  save.gold = 9999
  const gun = findItem(save, save.equipment.weapon)!
  gun.itemLevel = 20
  gun.rarity = 'epic'
  return { save, gun }
}

describe('부품 장착 · 강화 레벨 표시', () => {
  it('강화 수치가 이름 맨 앞에 붙는다 (+3 …)', () => {
    const g = { ...makeItem('gun_water', 'rare', mulberry32(1), 5), plus: 3 }
    expect(itemName(g).startsWith('+3 ')).toBe(true)
  })
  it('총 툴팁에 현재/최대 강화와 다음 강화 효과·비용이 나온다', () => {
    const g = { ...makeItem('gun_water', 'rare', mulberry32(1), 5), plus: 3 }
    const lines = upgradeLines(g)
    expect(lines[0]).toMatch(/^강화 \+3 \/ \+10 · 총 피해 ×/)
    expect(lines[1]).toMatch(/^다음 \+4: 총 피해 ×[\d.]+ · 성공 100% · \d+골드/)
    expect(upgradeLines({ ...g, plus: 10 })[1]).toBe('최대 강화 완료!')
  })
  it('부품은 희귀도 단계(1~5)가 강화 레벨로 보인다', () => {
    const m = makeMod(MOD_IDS[0], 'rare', 5)
    expect(partTier(m)).toEqual({ now: 3, max: 5 })
    expect(upgradeLines(m)[0]).toBe('부품 강화 3/5단계')
  })
  it('끼우기 미리보기: 들어갈 칸, 비용, 바뀌는 부품을 미리 알려 준다', () => {
    const { save, gun } = setup()
    const a = makeMod(MOD_IDS[0], 'common', 5)
    addItem(save, a)
    const pv = fitPreview(gun, a)
    expect(pv.block).toBeNull()
    expect(pv.slot).toBe(gunMods(gun).length)
    expect(pv.swap).toBeNull()
    expect(attachMod(save, gun.uid, a.uid).ok).toBe(true)
    const b = makeMod(MOD_IDS[0], 'rare', 5)
    addItem(save, b)
    const pv2 = fitPreview(gun, b)
    expect(pv2.swap?.uid).toBe(a.uid)
    expect(pv2.slot).toBe(gunMods(gun).findIndex((m) => m.uid === a.uid))
  })
})
