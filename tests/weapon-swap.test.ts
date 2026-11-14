import { describe, expect, it } from 'vitest'
import { dismantleOwned, freshSave, sellOwned } from '../src/sim/mutate'
import { makeItem } from '../src/sim/loot'
import { mulberry32 } from '../src/sim/rng'
import { migrateSave } from '../src/sim/migrate'
import { bagItems, equipItem, gunHeld, rescueMods } from '../src/sim/inventory'
import { BAG_CAP, type ItemInstance, type SaveData } from '../src/sim/types'
import { makeMod } from '../src/sim/mods'
import { sellItem } from '../src/sim/town'
import { Delve } from '../src/sim/delve'
import { ensureSets, parkWeapon, swapLoadout } from '../src/sim/weaponset'

function water(seed: number): ItemInstance {
  return makeItem('gun_water', 'rare', mulberry32(seed), 4)
}
function fillBag(save: SaveData, n: number): void {
  for (let i = 0; i < n; i += 1) save.items.push(makeItem('acc_charm', 'common', mulberry32(100 + i), 1))
}
function uids(save: SaveData): string[] {
  const nested = save.items.flatMap((i) => (i.mods ?? []).map((m) => m.uid))
  return [...save.items.map((i) => i.uid), ...nested].sort()
}

describe('한 손 · 양손 교체 때 아이템이 사라지지 않는다', () => {
  it('쌍권총에서 양손 총으로, 다시 한 손 총으로 바꿔도 총과 부품이 가방에 남는다', () => {
    const save = freshSave()
    const a = water(1)
    const b = water(2)
    const sniper = makeItem('gun_dart', 'epic', mulberry32(3), 8)
    const part = makeMod('mod_scope', 'rare', 6)
    a.mods = [part]
    save.items.push(a, b, sniper)
    const before = uids(save)
    expect(equipItem(save, a.uid).ok).toBe(true)
    expect(equipItem(save, b.uid, 'offhand').ok).toBe(true)
    const swapped = equipItem(save, sniper.uid)
    expect(swapped.ok).toBe(true)
    expect(save.equipment.weapon).toBe(sniper.uid)
    expect(save.equipment.offhand).toBeUndefined()
    expect(swapped.toBag?.map((i) => i.uid).sort()).toEqual([a.uid, b.uid].sort())
    expect(a.mods?.map((m) => m.uid)).toEqual([part.uid])
    expect(bagItems(save).some((i) => i.uid === a.uid)).toBe(true)
    expect(bagItems(save).some((i) => i.uid === b.uid)).toBe(true)
    expect(equipItem(save, a.uid).ok).toBe(true)
    expect(save.equipment.weapon).toBe(a.uid)
    expect(bagItems(save).some((i) => i.uid === sniper.uid)).toBe(true)
    expect(findMods(save, a.uid)).toEqual([part.uid])
    expect(uids(save)).toEqual(before)
  })

  it('가방이 가득이면 장착을 막고, 총과 부품을 지우지 않는다', () => {
    const save = freshSave()
    const a = water(4)
    const b = water(5)
    const sniper = makeItem('gun_dart', 'rare', mulberry32(6), 5)
    const part = makeMod('mod_barrel', 'epic', 5)
    b.mods = [part]
    save.items.push(a, b, sniper)
    equipItem(save, a.uid)
    equipItem(save, b.uid, 'offhand')
    // Bag holds the sniper plus fillers up to the cap.
    fillBag(save, BAG_CAP - bagItems(save).length)
    expect(bagItems(save)).toHaveLength(BAG_CAP)
    const before = uids(save)
    const r = equipItem(save, sniper.uid)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('가방이 가득')
    expect(r.overflow?.some((i) => i.uid === b.uid)).toBe(true)
    expect(save.equipment.weapon).toBe(a.uid)
    expect(save.equipment.offhand).toBe(b.uid)
    expect(b.mods?.[0].uid).toBe(part.uid)
    expect(uids(save)).toEqual(before)
  })

  it('보조 손 총을 주 손으로 끌어도 가득 찬 가방에 밀어 넣지 않는다', () => {
    const save = freshSave()
    const a = water(7)
    const b = water(8)
    save.items.push(a, b)
    equipItem(save, a.uid)
    equipItem(save, b.uid, 'offhand')
    fillBag(save, BAG_CAP - bagItems(save).length)
    const before = uids(save)
    const r = equipItem(save, b.uid)
    expect(r.ok).toBe(false)
    expect(save.equipment.weapon).toBe(a.uid)
    expect(save.equipment.offhand).toBe(b.uid)
    expect(uids(save)).toEqual(before)
  })

  it('가방이 가득일 때 주운 총의 부품은 골드로 바뀌지 않고 가방에 남는다', () => {
    const save = freshSave()
    fillBag(save, BAG_CAP - bagItems(save).length)
    const gun = makeItem('gun_star', 'rare', mulberry32(9), 4)
    const part = makeMod('mod_mag', 'uncommon', 4)
    gun.mods = [part]
    const run = Delve.start(save, 1)!
    const r = run.pickup(save, { kind: 'item', amount: 1, item: gun })
    expect(r.text).toContain('가방이 가득')
    expect(save.items.some((i) => i.uid === part.uid)).toBe(true)
    expect(gun.mods).toBeUndefined()
    expect(rescueMods(save, gun)).toEqual([])
  })
})

describe('무기 세트 (A / B)', () => {
  it('교체하면 손의 총이 바뀌고 부품은 총에 남고, 저장을 왕복해도 유지된다', () => {
    const save = freshSave()
    const a = water(11)
    const b = water(12)
    const sniper = makeItem('gun_dart', 'legendary', mulberry32(13), 9)
    const part = makeMod('mod_trick_star', 'rare', 3)
    sniper.mods = [part]
    save.items.push(a, b, sniper)
    equipItem(save, a.uid)
    equipItem(save, b.uid, 'offhand')
    const parked = parkWeapon(save, sniper.uid, 'weapon')
    expect(parked.ok).toBe(true)
    expect(gunHeld(save, sniper.uid)).toBe(true)
    expect(bagItems(save).some((i) => i.uid === sniper.uid)).toBe(false)
    expect(sellOwned(save, sniper.uid).ok).toBe(false)
    expect(sellItem(save, sniper.uid).ok).toBe(false)
    expect(dismantleOwned(save, sniper.uid).ok).toBe(false)
    const before = uids(save)
    const sw = swapLoadout(save)
    expect(sw.ok).toBe(true)
    expect(sw.active).toBe(1)
    expect(save.equipment.weapon).toBe(sniper.uid)
    expect(save.equipment.offhand).toBeUndefined()
    expect(save.weaponSets?.stowed.weapon).toBe(a.uid)
    expect(save.weaponSets?.stowed.offhand).toBe(b.uid)
    expect(sniper.mods?.[0].uid).toBe(part.uid)
    const back = swapLoadout(save)
    expect(back.active).toBe(0)
    expect(save.equipment.weapon).toBe(a.uid)
    expect(save.equipment.offhand).toBe(b.uid)
    expect(uids(save)).toEqual(before)
    const raw = JSON.parse(JSON.stringify(save)) as SaveData
    migrateSave(raw)
    expect(raw.weaponSets?.active).toBe(0)
    expect(raw.equipment.weapon).toBe(a.uid)
    expect(raw.equipment.offhand).toBe(b.uid)
    expect(raw.weaponSets?.stowed.weapon).toBe(sniper.uid)
    const kept = raw.items.find((i) => i.uid === sniper.uid)
    expect(kept?.mods?.[0].uid).toBe(part.uid)
  })

  it('옛 저장은 빈 홀스터를 얻고, 들고 있던 총은 그대로다', () => {
    const save = freshSave()
    save.weaponSets = undefined
    const weapon = save.equipment.weapon
    migrateSave(save)
    const sets = ensureSets(save)
    expect(sets.active).toBe(0)
    expect(sets.stowed.weapon).toBeUndefined()
    expect(save.equipment.weapon).toBe(weapon)
  })

  it('빈 세트로 바꿔도 이전 총은 홀스터에 남는다', () => {
    const save = freshSave()
    const weapon = save.equipment.weapon!
    const r = swapLoadout(save)
    expect(r.now).toContain('비어')
    expect(save.equipment.weapon).toBeUndefined()
    expect(save.weaponSets?.stowed.weapon).toBe(weapon)
    expect(save.items.some((i) => i.uid === weapon)).toBe(true)
  })
})

function findMods(save: SaveData, uid: string): string[] {
  return save.items.find((i) => i.uid === uid)?.mods?.map((m) => m.uid) ?? []
}
