import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { makeItem } from '../src/sim/loot'
import { makeMod } from '../src/sim/mods'
import { LEGENDS } from '../src/data/legends'
import { findItem, isEquipped } from '../src/sim/inventory'
import { bulkIds, fastBlock, fastNeedsConfirm, fastProcess, rarityPickLabel, toggleLock, undoFast } from '../src/sim/fastsell'
import { sellItem, townOf } from '../src/sim/town'
import { tryEquip } from '../src/sim/mutate'

const rng = () => 0.5

function setup() {
  const save = freshSave()
  const best = makeItem('hat_beret', 'epic', rng, 40)
  save.items.push(best)
  tryEquip(save, best.uid)
  const commons = [0, 1, 2].map(() => makeItem('hat_pin', 'common', rng, 1))
  const magic = makeItem('hat_mushroom', 'uncommon', rng, 1)
  const rare = makeItem('hat_pin', 'rare', rng, 1)
  const unique = makeItem(LEGENDS[0].id, 'legendary', rng, 1)
  const locked = makeItem('hat_pin', 'common', rng, 1)
  locked.locked = true
  const gunWithPart = makeItem(findItem(save, save.equipment.weapon)!.defId, 'common', rng, 1)
  gunWithPart.mods = [makeMod('mod_barrel', 'common', 1)]
  save.items.push(...commons, magic, rare, unique, locked, gunWithPart)
  return { save, best, commons, magic, rare, unique, locked, gunWithPart }
}

describe('빠른 판매 · 분해', () => {
  it('보통 일괄은 보통만, 매직 이하는 매직까지 고른다', () => {
    const { save, commons, magic } = setup()
    expect(bulkIds(save, ['common']).sort()).toEqual(commons.map((c) => c.uid).sort())
    expect(bulkIds(save, ['common', 'uncommon'])).toContain(magic.uid)
  })
  it('일괄 처리는 착용·잠금·유니크·부품 낀 총을 절대 건드리지 않는다', () => {
    const { save, best, unique, locked, gunWithPart } = setup()
    const ids = bulkIds(save, ['common', 'uncommon', 'rare', 'epic', 'legendary'])
    for (const it of [best, unique, locked, gunWithPart]) expect(ids).not.toContain(it.uid)
    expect(ids).not.toContain(save.equipment.weapon)
  })
  it('더 좋은 장비(▲)는 일괄 대상에서 빠진다', () => {
    const save = freshSave()
    const up = makeItem('hat_beret', 'common', rng, 5)
    save.items.push(up)
    expect(bulkIds(save, ['common'])).not.toContain(up.uid)
  })
  it('잠긴 물건은 한 번 판매·분해도 막힌다', () => {
    const { save, locked } = setup()
    expect(fastBlock(save, locked, 'sell')).toContain('잠긴')
    expect(sellItem(save, locked.uid).ok).toBe(false)
    expect(fastProcess(save, 'salvage', [locked.uid]).ok).toBe(false)
    expect(findItem(save, locked.uid)).toBeTruthy()
  })
  it('잠금 토글은 켜고 끈다', () => {
    const { save, magic } = setup()
    expect(toggleLock(save, magic.uid)).toBe(true)
    expect(bulkIds(save, ['uncommon'])).not.toContain(magic.uid)
    expect(toggleLock(save, magic.uid)).toBe(false)
  })
  it('판매는 골드를 주고 되사기 칸에 들어가며, 되돌리기는 골드를 돌려 내고 물건을 되찾는다', () => {
    const { save, commons } = setup()
    const g0 = save.gold
    const r = fastProcess(save, 'sell', commons.map((c) => c.uid))
    expect(r.ok).toBe(true)
    expect(save.gold).toBe(g0 + r.entry!.gold)
    expect(townOf(save).buyback.length).toBe(3)
    expect(undoFast(save, r.entry!).ok).toBe(true)
    expect(save.gold).toBe(g0)
    expect(townOf(save).buyback.length).toBe(0)
    for (const c of commons) expect(findItem(save, c.uid)).toBeTruthy()
  })
  it('분해는 재료를 주고, 되돌리기는 재료를 반납한다', () => {
    const { save, magic } = setup()
    const before = { ...save.materials }
    const r = fastProcess(save, 'salvage', [magic.uid])
    expect(Object.keys(r.entry!.got).length).toBeGreaterThan(0)
    expect(undoFast(save, r.entry!).ok).toBe(true)
    for (const [m, n] of Object.entries(r.entry!.got)) expect(save.materials[m] ?? 0).toBe((before[m] ?? 0) + n - n)
    expect(findItem(save, magic.uid)).toBeTruthy()
  })
  it('재료를 써 버렸으면 분해 되돌리기는 거절한다', () => {
    const { save, magic } = setup()
    const r = fastProcess(save, 'salvage', [magic.uid])
    for (const m of Object.keys(r.entry!.got)) save.materials[m] = 0
    expect(undoFast(save, r.entry!).ok).toBe(false)
  })
  it('부품 낀 총을 팔고 되돌리면 부품도 다시 총에 끼워진다', () => {
    const { save, gunWithPart } = setup()
    const part = gunWithPart.mods![0]
    const r = fastProcess(save, 'sell', [gunWithPart.uid])
    expect(findItem(save, part.uid)).toBeTruthy()
    undoFast(save, r.entry!)
    expect(findItem(save, gunWithPart.uid)?.mods?.[0]?.uid).toBe(part.uid)
  })
  it('희귀 이상과 유니크만 한 번 더 확인한다', () => {
    const { commons, magic, rare, unique } = setup()
    expect(fastNeedsConfirm(commons[0])).toBe(false)
    expect(fastNeedsConfirm(magic)).toBe(false)
    expect(fastNeedsConfirm(rare)).toBe(true)
    expect(fastNeedsConfirm(unique)).toBe(true)
  })
  it('착용 중인 장비는 빠른 처리에서 막힌다', () => {
    const { save, best } = setup()
    expect(isEquipped(save, best.uid)).toBe(true)
    expect(fastProcess(save, 'sell', [best.uid]).ok).toBe(false)
  })
  it('일괄 버튼 이름: 보통 · 매직 이하 · 보통·희귀', () => {
    expect(rarityPickLabel(['common'])).toBe('보통')
    expect(rarityPickLabel(['common', 'uncommon'])).toBe('매직 이하')
    expect(rarityPickLabel(['common', 'rare'])).toBe('보통·희귀')
  })
})
