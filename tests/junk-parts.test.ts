import { describe, expect, it } from 'vitest'
import { freshSave, sellOwned } from '../src/sim/mutate'
import { makeMod } from '../src/sim/mods'
import { junkIds, junkPartIds, junkToast } from '../src/sim/qol'
import { findItem } from '../src/sim/inventory'

function setup() {
  const save = freshSave()
  const gun = save.items.find((i) => i.uid === save.equipment.weapon)!
  const socketed = makeMod('mod_barrel', 'common', 5)
  gun.mods = [socketed]
  const loose = makeMod('mod_scope', 'common', 5)
  const looseUn = makeMod('mod_mag', 'uncommon', 5)
  const rare = makeMod('mod_barrel', 'rare', 5)
  const trick = makeMod('mod_trick_star', 'common', 5)
  save.items.push(loose, looseUn, rare, trick)
  return { save, gun, socketed, loose, looseUn, rare, trick }
}

describe('잡동사니 판매 · 부품', () => {
  it('총에 끼우지 않은 일반·고급 부품만 판다', () => {
    const { save, loose, looseUn } = setup()
    expect(junkPartIds(save).sort()).toEqual([loose.uid, looseUn.uid].sort())
  })
  it('총에 낀 부품·희귀 이상·특수 부품은 절대 고르지 않는다', () => {
    const { save, socketed, rare, trick } = setup()
    const ids = junkPartIds(save)
    for (const m of [socketed, rare, trick]) expect(ids).not.toContain(m.uid)
  })
  it('장비 잡동사니 목록에는 부품이 섞이지 않는다', () => {
    const { save, loose } = setup()
    expect(junkIds(save)).not.toContain(loose.uid)
  })
  it('부품을 팔면 골드가 들고, 총에 낀 부품은 남는다', () => {
    const { save, gun, socketed } = setup()
    const before = save.gold
    let gold = 0
    for (const id of junkPartIds(save)) gold += sellOwned(save, id).gold ?? 0
    expect(gold).toBeGreaterThan(0)
    expect(save.gold - before).toBe(gold)
    expect(gun.mods?.map((m) => m.uid)).toEqual([socketed.uid])
    expect(junkPartIds(save)).toEqual([])
    expect(findItem(save, gun.uid)).toBeTruthy()
  })
  it('토스트에 골드와 판 부품 수가 나온다', () => {
    expect(junkToast(3, 2, 140)).toBe('잡동사니 판매: 장비 3개 · 부품 2개 · +140 골드')
    expect(junkToast(0, 4, 60)).toBe('잡동사니 판매: 부품 4개 · +60 골드')
  })
})
