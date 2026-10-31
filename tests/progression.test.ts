import { describe, expect, it } from 'vitest'
import { GUN } from '../src/combat/gunfeel'
import { GameState, SAVE_KEY_3D } from '../src/core/loop'
import { GUN_PROFILES } from '../src/data/guns'
import { LEVEL_CAP, TREE } from '../src/data/tree'
import { Delve, delveOf, itemLevelFor } from '../src/sim/delve'
import { addItem, slotFor } from '../src/sim/inventory'
import { dismantleYield, itemName, makeItem, rollAffixes } from '../src/sim/loot'
import { migrateItem } from '../src/sim/migrate'
import { dismantleOwned, freshSave, sellOwned, tryEquip, tryUnequip } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { buildOf, learn, learnBlock, rank, respec, respecCost } from '../src/sim/skilltree'
import { computeStats, gainXp } from '../src/sim/stats'
import { bossXp, killXp, totalXpFor, xpProgress } from '../src/sim/xp'
import type { ItemInstance, SaveData } from '../src/sim/types'

function memStore(init: Record<string, string> = {}) {
  const data = { ...init }
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data }
}

describe('경험치와 레벨', () => {
  it('레벨 곡선은 갈수록 가팔라지고 30에서 멈춘다', () => {
    expect(totalXpFor(2)).toBe(52)
    expect(totalXpFor(10)).toBeGreaterThan(totalXpFor(9) + 400)
    const save = freshSave()
    gainXp(save, 10_000_000)
    expect(save.level).toBe(LEVEL_CAP)
    expect(save.xp).toBe(0)
    expect(xpProgress(save.level, save.xp)).toBe(1)
    expect(gainXp(save, 500).leveled).toBe(false)
  })

  it('레벨이 오르면 스킬 포인트가 하나씩 생긴다', () => {
    const save = freshSave()
    expect(buildOf(save).points).toBe(1)
    const r = gainXp(save, 52 + 82)
    expect(save.level).toBe(3)
    expect(r.leveled).toBe(true)
    expect(buildOf(save).points).toBe(3)
  })

  it('깊을수록 처치 경험치가 커지고 깊이 1을 한 번 돌면 레벨 4 근처', () => {
    expect(killXp(1, false)).toBe(2)
    expect(killXp(3, false)).toBeGreaterThan(killXp(1, false))
    expect(killXp(1, true)).toBe(10)
    const run = 55 * killXp(1, false) + 4 * killXp(1, true) + 2 * 8 + 3 * 20 + bossXp(1)
    const save = freshSave()
    gainXp(save, run)
    expect(save.level).toBeGreaterThanOrEqual(3)
    expect(save.level).toBeLessThanOrEqual(5)
  })

  it('레벨에 따라 체력과 피해가 자란다', () => {
    const save = freshSave()
    const one = computeStats(save)
    save.level = 11
    const eleven = computeStats(save)
    expect(eleven.maxHp).toBeGreaterThan(one.maxHp * 1.3)
    expect(eleven.damageMul).toBeCloseTo(1.2)
  })
})

describe('장비 스탯 계산', () => {
  it('레벨 1 + 기본 물총은 예전 손맛 그대로', () => {
    const s = computeStats(freshSave())
    expect(s.maxHp).toBe(150)
    expect(s.weaponKind).toBe('water')
    expect(s.shotDamage).toBe(GUN.damage)
    expect(s.gun.gap).toBe(GUN.gap)
    expect(s.critChance).toBe(GUN.critChance)
    expect(s.fireRate).toBe(1)
    expect(s.moveMul).toBe(1)
    expect(s.armor).toBe(0)
  })

  it('장비의 기본 능력치와 옵션이 더해진다', () => {
    const save = freshSave()
    const gun = makeItem('gun_star', 'rare', mulberry32(3), 9)
    gun.affixes = [{ id: 'power', name: '힘찬', stat: 'damage', value: 0.1 }, { id: 'swift', name: '재빠른', stat: 'fireRate', value: 0.08 }]
    const shoes = makeItem('shoes_sneakers', 'common', mulberry32(1), 1)
    shoes.affixes = [{ id: 'vital', name: '튼튼한', stat: 'hp', value: 20 }]
    addItem(save, gun)
    addItem(save, shoes)
    expect(tryEquip(save, gun.uid).ok).toBe(true)
    expect(tryEquip(save, shoes.uid).ok).toBe(true)
    const s = computeStats(save)
    expect(s.weaponKind).toBe('star')
    // 17 × 레어 1.22 × (1 + 0.06·8) = 30.69…
    expect(s.gun.damage).toBeCloseTo(GUN_PROFILES.star.damage * 1.22 * 1.48, 1)
    expect(s.damageMul).toBeCloseTo(1.1)
    expect(s.fireRate).toBeCloseTo(1.08)
    expect(s.moveMul).toBeCloseTo(1.05)
    expect(s.maxHp).toBe(170)
    expect(s.pierce).toBe(1)
  })

  it('장신구는 빈 장신구 칸부터 채운다', () => {
    const save = freshSave()
    const a = makeItem('acc_ring', 'common', mulberry32(1), 1)
    const b = makeItem('acc_charm', 'common', mulberry32(2), 1)
    addItem(save, a)
    addItem(save, b)
    tryEquip(save, a.uid)
    expect(slotFor(save, b)).toBe('accessory2')
    tryEquip(save, b.uid)
    expect(save.equipment.accessory).toBe(a.uid)
    expect(save.equipment.accessory2).toBe(b.uid)
    expect(computeStats(save).damageMul).toBeCloseTo(1.04)
    expect(tryUnequip(save, 'accessory').ok).toBe(true)
    expect(tryUnequip(save, 'weapon').ok).toBe(false)
  })

  it('갑옷과 이동 속도에는 상한이 있다', () => {
    const save = freshSave()
    for (const id of ['hat_beret', 'outfit_knit', 'shoes_sneakers']) {
      const it = makeItem(id, 'legendary', mulberry32(5), 40)
      it.affixes = [{ id: 'guard', name: '단단한', stat: 'armor', value: 0.4 }, { id: 'light', name: '가벼운', stat: 'moveSpeed', value: 0.3 }]
      addItem(save, it)
      tryEquip(save, it.uid)
    }
    const s = computeStats(save)
    expect(s.armor).toBe(0.5)
    expect(s.moveMul).toBe(1.35)
  })

  it('판매와 분해: 쓰고 있는 총은 지키고 재료를 돌려준다', () => {
    const save = freshSave()
    expect(sellOwned(save, save.equipment.weapon!).ok).toBe(false)
    const epic = makeItem('hat_pin', 'epic', mulberry32(9), 5)
    addItem(save, epic)
    const r = dismantleOwned(save, epic.uid)
    expect(r.ok).toBe(true)
    expect(save.materials.star_shard).toBe(1)
    expect(save.materials.dream_dust).toBe(3)
    expect(dismantleYield(makeItem('acc_bell', 'legendary', mulberry32(1), 1)).star_shard).toBe(3)
  })
})

describe('랜덤 옵션', () => {
  it('같은 시드면 같은 옵션이 나온다', () => {
    const a = rollAffixes('weapon', 'legendary', mulberry32(42), 10)
    const b = rollAffixes('weapon', 'legendary', mulberry32(42), 10)
    expect(a).toEqual(b)
    expect(a).toHaveLength(4)
  })

  it('총에는 속성이 하나만, 장비에는 총 전용 옵션이 안 붙는다', () => {
    for (let seed = 1; seed < 400; seed += 1) {
      const gun = rollAffixes('weapon', 'legendary', mulberry32(seed), 12)
      expect(gun.filter((a) => a.stat === 'sparkle' || a.stat === 'ice' || a.stat === 'candy').length).toBeLessThanOrEqual(1)
      expect(gun.some((a) => a.stat === 'hp' || a.stat === 'armor' || a.stat === 'moveSpeed')).toBe(false)
      const hat = rollAffixes('hat', 'legendary', mulberry32(seed), 12)
      expect(hat.some((a) => a.stat === 'pierce' || a.stat === 'sparkle' || a.stat === 'ice' || a.stat === 'candy')).toBe(false)
    }
  })

  it('아이템 레벨이 높을수록 옵션 수치가 크다', () => {
    const low = rollAffixes('hat', 'rare', mulberry32(7), 1)
    const high = rollAffixes('hat', 'rare', mulberry32(7), 21)
    expect(high.map((a) => a.id)).toEqual(low.map((a) => a.id))
    for (let i = 0; i < low.length; i += 1) expect(high[i].value).toBeGreaterThan(low[i].value)
  })

  it('이름은 첫 옵션의 꾸밈말로 시작하고 아이템 레벨은 깊이에서 온다', () => {
    const it = makeItem('gun_bubble', 'rare', mulberry32(11), 5)
    expect(itemName(it).endsWith('방울 샷건')).toBe(true)
    expect(itemName(it).startsWith(it.affixes[0].name)).toBe(true)
    expect(it.v).toBe(2)
    expect(itemLevelFor(1, 1)).toBe(1)
    expect(itemLevelFor(3, 2)).toBe(10)
    expect(itemLevelFor(3, 4, true)).toBe(13)
  })
})

describe('스킬 나무', () => {
  it('포인트와 레벨, 갈래 투자 조건을 지킨다', () => {
    const save = freshSave()
    expect(learn(save, 'polish').ok).toBe(true)
    expect(rank(save, 'polish')).toBe(1)
    expect(learnBlock(save, 'polish')).toContain('포인트')
    expect(learnBlock(save, 'rhythm')).toContain('레벨 3')
    gainXp(save, totalXpFor(6))
    expect(save.level).toBe(6)
    expect(learnBlock(save, 'overdrive')).toContain('포인트 4개')
    learn(save, 'polish')
    learn(save, 'rhythm')
    learn(save, 'rhythm')
    expect(learn(save, 'overdrive').ok).toBe(true)
    expect(computeStats(save).fireRate).toBeCloseTo(1.1)
  })

  it('갈래마다 4~5개, 액티브 4개는 1~4 키에 하나씩', () => {
    for (const b of ['gun', 'bubble', 'mochi']) expect(TREE.filter((s) => s.branch === b).length).toBeGreaterThanOrEqual(4)
    const keys = TREE.filter((s) => s.kind === 'active').map((s) => s.key).sort()
    expect(keys).toEqual(['1', '2', '3', '4'])
  })

  it('마을 재분배는 싸고 포인트를 모두 돌려준다', () => {
    const save = freshSave()
    gainXp(save, totalXpFor(5))
    learn(save, 'fluffy')
    learn(save, 'fluffy')
    learn(save, 'bubble_bomb')
    const points = buildOf(save).points
    expect(respecCost(save)).toBe(50)
    save.gold = 49
    expect(respec(save).ok).toBe(false)
    save.gold = 60
    expect(respec(save).ok).toBe(true)
    expect(save.gold).toBe(10)
    expect(buildOf(save).points).toBe(points + 3)
    expect(rank(save, 'fluffy')).toBe(0)
  })
})

describe('저장 이전', () => {
  function legacySave(): SaveData {
    const save = freshSave() as SaveData & { build?: unknown }
    delete save.build
    save.level = 4
    save.byeolhaPoints = 5
    const old: ItemInstance = {
      uid: 'old-hat',
      defId: 'hat_beret',
      rarity: 'rare',
      itemLevel: 3,
      affixes: [
        { id: 'tough', name: '튼튼한', stat: 'def', value: 6 },
        { id: 'swift', name: '빠른', stat: 'moveSpeed', value: 14 },
        { id: 'mystery', name: '?', stat: 'nonsense' as never, value: 1 },
      ],
    }
    save.items.push(old)
    save.equipment.hat = old.uid
    const d = save.delve as { open?: unknown }
    delete d.open
    return save
  }

  it('예전 저장도 불러오고 스킬 포인트와 아이템을 새 규칙으로 바꾼다', () => {
    const store = memStore({ [SAVE_KEY_3D]: JSON.stringify(legacySave()) })
    const state = GameState.load(store)!
    expect(state).not.toBeNull()
    expect(state.save.build).toEqual({ points: 5, ranks: {} })
    const hat = state.save.items.find((i) => i.uid === 'old-hat')!
    expect(hat.v).toBe(2)
    expect(hat.affixes.map((a) => a.stat)).toEqual(['armor', 'moveSpeed'])
    expect(hat.affixes[0].value).toBeCloseTo(0.042)
    expect(hat.affixes[1].value).toBeCloseTo(0.035)
    expect(state.save.materials.star_shard).toBe(0)
    expect(state.banked).toBeNull()
    expect(migrateItem(hat)).toBe(hat)
  })

  it('탐험 중 새로고침해도 모은 골드를 잃지 않는다', () => {
    const save = freshSave()
    const run = Delve.start(save, 1)!
    run.pickup(save, { kind: 'gold', amount: 37 })
    run.kill(false)
    run.sync(save)
    const gold = save.gold
    const store = memStore({ [SAVE_KEY_3D]: JSON.stringify(save) })
    const back = GameState.load(store)!
    expect(back.banked?.gold).toBe(37)
    expect(back.banked?.kills).toBe(1)
    expect(back.save.gold).toBe(gold + 37)
    expect(delveOf(back.save).open).toBeNull()
    expect(delveOf(back.save).checkpoint).toEqual({ depth: 1, floor: 1 })
  })

  it('정상 귀환하면 열린 탐험 기록이 지워진다', () => {
    const save = freshSave()
    const run = Delve.start(save, 1)!
    run.pickup(save, { kind: 'gold', amount: 5 })
    run.sync(save)
    run.finish(save, 'recall')
    expect(delveOf(save).open).toBeNull()
  })
})
