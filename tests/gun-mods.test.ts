import { describe, expect, it } from 'vitest'
import { WATER_LOOK } from '../src/actors/toygun'
import { ITEMS } from '../src/data/items'
import { MOD_IDS } from '../src/data/mods'
import { chestDrops, delveDrops } from '../src/sim/delve'
import { addItem, bagItems, findItem } from '../src/sim/inventory'
import { dismantleYield, itemLines, itemPower, makeItem } from '../src/sim/loot'
import { attachMod, detachMod, gunLookWithMods, gunMods, isMod, makeMod, modSlots, modUpgradeCost, upgradeMod } from '../src/sim/mods'
import { dismantleOwned, freshSave, sellOwned } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { computeStats } from '../src/sim/stats'
import { sellItem, stashPut, townOf } from '../src/sim/town'
import { ICON_KEYS } from '../src/ui/icons'
import type { ItemInstance, SaveData } from '../src/sim/types'

function rich(): SaveData {
  const save = freshSave()
  save.gold = 100_000
  save.materials = { dream_dust: 50, toy_part: 50, star_shard: 50 }
  return save
}

function wornGun(save: SaveData, rarity: ItemInstance['rarity'] = 'rare', ilv = 5): ItemInstance {
  const gun = makeItem('gun_water', rarity, mulberry32(7), ilv)
  gun.affixes = []
  addItem(save, gun)
  save.equipment.weapon = gun.uid
  return gun
}

describe('총 개조: 부품과 칸', () => {
  it('부품 여섯 종은 장착 칸이 없는 아이템이고, 아이콘이 있다', () => {
    expect(MOD_IDS.length).toBe(6)
    for (const id of MOD_IDS) {
      expect(ITEMS[id].mod).toBe(true)
      expect(ITEMS[id].slot).toBeUndefined()
      expect(ICON_KEYS).toContain(ITEMS[id].icon)
    }
  })

  it('개조 칸은 등급으로 1~4개, iLv 10부터 하나 더 (최대 4)', () => {
    const g = (r: ItemInstance['rarity'], l: number) => modSlots(makeItem('gun_star', r, mulberry32(1), l))
    expect(g('common', 1)).toBe(1)
    expect(g('uncommon', 1)).toBe(1)
    expect(g('rare', 1)).toBe(2)
    expect(g('epic', 1)).toBe(3)
    expect(g('legendary', 1)).toBe(4)
    expect(g('rare', 10)).toBe(3)
    expect(g('legendary', 12)).toBe(4)
    expect(modSlots(makeItem('hat_beret', 'legendary', mulberry32(1), 10))).toBe(0)
  })

  it('부품 수치는 등급과 iLv로 커진다 (같은 값 → 예측 가능)', () => {
    const a = makeMod('mod_barrel', 'common', 1).affixes[0].value
    const b = makeMod('mod_barrel', 'epic', 1).affixes[0].value
    const c = makeMod('mod_barrel', 'epic', 9).affixes[0].value
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(makeMod('mod_barrel', 'rare', 4).affixes).toEqual(makeMod('mod_barrel', 'rare', 4).affixes)
  })
})

describe('총 개조: 끼우기 · 빼기 · 바꾸기', () => {
  it('총열을 끼우면 피해가 오르고, 빼면 가방으로 돌아온다', () => {
    const save = rich()
    const gun = wornGun(save)
    const before = computeStats(save).damageMul
    const mod = makeMod('mod_barrel', 'rare', 5)
    addItem(save, mod)
    const r = attachMod(save, gun.uid, mod.uid)
    expect(r.ok).toBe(true)
    expect(findItem(save, mod.uid)).toBeUndefined()
    expect(gunMods(gun).map((m) => m.uid)).toEqual([mod.uid])
    expect(computeStats(save).damageMul).toBeGreaterThan(before)
    expect(itemPower(gun)).toBeGreaterThan(itemPower({ ...gun, mods: [] }))
    const d = detachMod(save, gun.uid, mod.uid)
    expect(d.ok).toBe(true)
    expect(findItem(save, mod.uid)).toBeDefined()
    expect(computeStats(save).damageMul).toBeCloseTo(before)
  })

  it('같은 종류 부품은 서로 바뀌고, 칸이 차면 다른 종류는 못 끼운다', () => {
    const save = rich()
    const gun = wornGun(save, 'common')
    const a = makeMod('mod_scope', 'common', 1)
    const b = makeMod('mod_scope', 'rare', 1)
    const c = makeMod('mod_mag', 'rare', 1)
    for (const m of [a, b, c]) addItem(save, m)
    expect(attachMod(save, gun.uid, a.uid).ok).toBe(true)
    const sw = attachMod(save, gun.uid, b.uid)
    expect(sw.ok).toBe(true)
    expect(sw.swapped?.uid).toBe(a.uid)
    expect(findItem(save, a.uid)).toBeDefined()
    const full = attachMod(save, gun.uid, c.uid)
    expect(full.ok).toBe(false)
    expect(full.reason).toContain('빈 개조 칸')
  })

  it('속성 칩은 속성 확률을 주고 총 색과 탄 색을 바꾼다, 부품 모양이 총에 붙는다', () => {
    const save = rich()
    const gun = wornGun(save, 'legendary')
    for (const id of ['mod_chip_ice', 'mod_scope', 'mod_mag', 'mod_barrel']) {
      const m = makeMod(id, 'epic', 5)
      addItem(save, m)
      expect(attachMod(save, gun.uid, m.uid).ok).toBe(true)
    }
    expect(computeStats(save).ice).toBeGreaterThan(0)
    const look = gunLookWithMods(WATER_LOOK, gun)
    expect(look.tracer).not.toBe(WATER_LOOK.tracer)
    expect(look.chip).toBeDefined()
    expect(look.scope).toBeDefined()
    expect(look.mag).toBeDefined()
    expect(look.barrelLen).toBeGreaterThan(WATER_LOOK.barrelLen)
    expect(gunLookWithMods(WATER_LOOK, makeItem('gun_water', 'rare', mulberry32(2), 1))).toBe(WATER_LOOK)
    expect(itemLines(gun).some((l) => l.startsWith('개조 칸 4/4'))).toBe(true)
  })

  it('창고의 총에도 끼울 수 있다, 골드가 모자라면 실패', () => {
    const save = rich()
    wornGun(save)
    const spare = makeItem('gun_dart', 'epic', mulberry32(4), 3)
    addItem(save, spare)
    expect(stashPut(save, spare.uid).ok).toBe(true)
    const m = makeMod('mod_mag', 'common', 1)
    addItem(save, m)
    expect(attachMod(save, spare.uid, m.uid).ok).toBe(true)
    expect(townOf(save).stash.find((i) => i.uid === spare.uid)?.mods?.length).toBe(1)
    const poor = freshSave()
    const g = wornGun(poor)
    const m2 = makeMod('mod_mag', 'legendary', 1)
    addItem(poor, m2)
    poor.gold = 0
    expect(attachMod(poor, g.uid, m2.uid).ok).toBe(false)
  })

  it('총을 팔거나 분해해도 부품은 가방으로 돌아온다', () => {
    for (const how of ['sell', 'shop', 'break'] as const) {
      const save = rich()
      wornGun(save)
      const spare = makeItem('gun_star', 'rare', mulberry32(5), 3)
      addItem(save, spare)
      const m = makeMod('mod_scope', 'rare', 3)
      addItem(save, m)
      attachMod(save, spare.uid, m.uid)
      const r = how === 'sell' ? sellOwned(save, spare.uid) : how === 'shop' ? sellItem(save, spare.uid) : dismantleOwned(save, spare.uid)
      expect(r.ok).toBe(true)
      expect(findItem(save, m.uid)).toBeDefined()
    }
  })
})

describe('총 개조: 분해와 부품 강화', () => {
  it('부품 분해는 장난감 부품(영웅부터 별조각)을 준다', () => {
    expect(dismantleYield(makeMod('mod_scope', 'common', 1))).toEqual({ toy_part: 1 })
    expect(dismantleYield(makeMod('mod_scope', 'epic', 1)).star_shard).toBe(1)
  })

  it('부품 강화는 등급을 하나 올리고 수치를 다시 계산한다 (총에 낀 채로도)', () => {
    const save = rich()
    const gun = wornGun(save)
    const m = makeMod('mod_barrel', 'common', 4)
    addItem(save, m)
    attachMod(save, gun.uid, m.uid)
    const v0 = m.affixes[0].value
    const dmg0 = computeStats(save).damageMul
    const parts = save.materials.toy_part
    const r = upgradeMod(save, m.uid)
    expect(r.ok).toBe(true)
    expect(m.rarity).toBe('uncommon')
    expect(m.affixes[0].value).toBeGreaterThan(v0)
    expect(save.materials.toy_part).toBe(parts - 1)
    expect(computeStats(save).damageMul).toBeGreaterThan(dmg0)
    expect(modUpgradeCost(makeMod('mod_barrel', 'rare', 1))?.mats.star_shard).toBe(1)
    expect(modUpgradeCost(makeMod('mod_barrel', 'legendary', 1))).toBeNull()
    const broke = freshSave()
    const m2 = makeMod('mod_mag', 'common', 1)
    addItem(broke, m2)
    expect(upgradeMod(broke, m2.uid).ok).toBe(false)
  })
})

describe('총 개조: 드롭', () => {
  it('던전 몹·상자·보스에서 부품이 나온다 (보스·비밀 상자가 더 자주)', () => {
    const rng = mulberry32(11)
    const count = (fn: () => ReturnType<typeof delveDrops>) => {
      let n = 0
      for (let i = 0; i < 400; i += 1) n += fn().filter((d) => d.kind === 'item' && isMod(d.item)).length
      return n / 400
    }
    const foe = count(() => delveDrops(1, false, false, rng))
    const boss = count(() => delveDrops(2, false, true, rng, 2, 4))
    const secret = count(() => chestDrops(2, 2, 'secret', rng))
    expect(foe).toBeGreaterThan(0)
    expect(foe).toBeLessThan(0.05)
    expect(boss).toBeGreaterThan(0.4)
    expect(secret).toBeGreaterThan(0.5)
  })

  it('옛 세이브의 총(개조 없음)은 그대로 동작한다', () => {
    const save = freshSave()
    const gun = save.items.find((i) => ITEMS[i.defId]?.slot === 'weapon')
    expect(gun).toBeDefined()
    expect(gunMods(gun!)).toEqual([])
    expect(bagItems(save).every((i) => !i.mods)).toBe(true)
    expect(computeStats(save).shotDamage).toBeGreaterThan(0)
  })
})
