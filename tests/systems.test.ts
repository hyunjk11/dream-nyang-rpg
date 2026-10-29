import { beforeEach, describe, expect, it } from 'vitest'
import { calcDamage, xpToNext } from '../src/sim/formulas'
import { makeItem, rarityWeights, rollAffixes, rollDrops, rollRarity, sellValue } from '../src/sim/loot'
import { freshSave, learnSkill, onDeath, rerollWeapon, sellOwned, usePotion } from '../src/sim/mutate'
import { buyEntry } from '../src/sim/mutate'
import { clearGame, loadGame, saveGame } from '../src/sim/persist'
import { addMaterial, onEnter, onKill, onTalk, startQuest, turnIn } from '../src/sim/quests'
import { mulberry32 } from '../src/sim/rng'
import { computeStats, gainXp } from '../src/sim/stats'
import { RARITIES, type Rarity } from '../src/sim/types'
import { addItem } from '../src/sim/inventory'

const mem = new Map<string, string>()
const storage = {
  getItem: (key: string) => mem.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mem.set(key, String(value))
  },
  removeItem: (key: string) => {
    mem.delete(key)
  },
  clear: () => mem.clear(),
  key: (index: number) => [...mem.keys()][index] ?? null,
  get length() {
    return mem.size
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

describe('피해 계산', () => {
  it('방어력으로 줄고 치명타는 배율이 붙으며 최소 1이다', () => {
    const base = calcDamage({
      atk: 0,
      weaponDamage: 100,
      multiplier: 1,
      targetDef: 0,
      critChance: 0,
      critMultiplier: 1.5,
      rng: () => 0.99,
    })
    expect(base).toEqual({ amount: 100, crit: false })
    const mitigated = calcDamage({
      atk: 0,
      weaponDamage: 100,
      multiplier: 1,
      targetDef: 50,
      critChance: 0,
      critMultiplier: 1.5,
      rng: () => 0.99,
    })
    expect(mitigated.amount).toBe(50)
    const crit = calcDamage({
      atk: 0,
      weaponDamage: 100,
      multiplier: 1,
      targetDef: 0,
      critChance: 0,
      critMultiplier: 1.5,
      forceCrit: true,
    })
    expect(crit).toEqual({ amount: 150, crit: true })
    const chip = calcDamage({
      atk: 0,
      weaponDamage: 0,
      multiplier: 1,
      targetDef: 0,
      critChance: 0,
      critMultiplier: 1,
      rng: () => 0.5,
    })
    expect(chip.amount).toBe(1)
  })
})

describe('전리품', () => {
  it('희귀도 개수와 행운 가중치가 맞다', () => {
    expect(rollAffixes('weapon', 'common', () => 0.5)).toHaveLength(0)
    expect(rollAffixes('weapon', 'rare', () => 0.5)).toHaveLength(2)
    expect(rollAffixes('hat', 'legendary', () => 0.2).every((affix) => affix.stat !== 'weaponDamage')).toBe(true)
    expect(rollRarity(0, () => 0)).toBe('common')
    const weights = rarityWeights(0)
    expect(weights.common).toBeGreaterThan(weights.legendary)
    const mean = (luck: number) => {
      const rng = mulberry32(7)
      let sum = 0
      for (let i = 0; i < 1500; i += 1) sum += RARITIES.indexOf(rollRarity(luck, rng))
      return sum / 1500
    }
    expect(mean(45)).toBeGreaterThan(mean(0))
  })

  it('드랍에 골드가 항상 포함된다', () => {
    const drops = rollDrops({
      table: { gold: [4, 4], gear: 0, weapon: 0, dust: 0, part: 0, potion: 0 },
      luck: 0,
      elite: false,
      rng: () => 0.5,
      itemLevel: 1,
    })
    expect(drops.some((drop) => drop.kind === 'gold' && drop.amount === 4)).toBe(true)
  })
})

describe('성장과 가방', () => {
  it('경험치로 레벨과 포인트가 오른다', () => {
    const save = freshSave()
    expect(xpToNext(1)).toBe(52)
    const early = gainXp(save, 51)
    expect(early.leveled).toBe(false)
    expect(save.level).toBe(1)
    const up = gainXp(save, 1)
    expect(up.leveled).toBe(true)
    expect(save.level).toBe(2)
    expect(save.byeolhaPoints).toBe(2)
    expect(save.mochiPoints).toBe(2)
  })

  it('장비 스탯과 스킬 선행이 적용된다', () => {
    const save = freshSave()
    const before = computeStats(save).maxHp
    const hat = makeItem('hat_beret', 'common', () => 0, 1)
    addItem(save, hat, true)
    save.equipment.hat = hat.uid
    expect(computeStats(save).maxHp).toBe(before + 22)
    expect(learnSkill(save, 'shield').ok).toBe(true)
    expect(learnSkill(save, 'focus').ok).toBe(false)
    expect(learnSkill(save, 'sense').reason).toContain('먼저')
  })

  it('가방이 가득 차면 거절하고 판매하면 골드가 는다', () => {
    const save = freshSave()
    for (let i = 0; i < 24; i += 1) addItem(save, makeItem('acc_ring', 'common', () => 0.2, 1))
    expect(addItem(save, makeItem('acc_ring', 'common', () => 0.2, 1))).toBe(false)
    const bag = save.items.filter((item) => item.uid !== save.equipment.weapon)
    const gold = save.gold
    const sold = sellOwned(save, bag[0].uid)
    expect(sold.ok).toBe(true)
    expect(save.gold).toBe(gold + sellValue(bag[0]))
  })
})

describe('퀘스트', () => {
  it('첫 기록은 조건이 모이면 한 번만 보상한다', () => {
    const save = freshSave()
    onTalk(save, 'mochi')
    onKill(save, 'slime', ['tutorial'])
    const gold = save.gold
    const done = onEnter(save, 'village')
    expect(save.quests.q_awaken.status).toBe('turnedIn')
    expect(save.gold).toBe(gold + 40)
    expect(done.questPop).toBe(true)
    expect(save.hp).toBe(computeStats(save).maxHp)
    const after = save.gold
    onEnter(save, 'village')
    expect(save.gold).toBe(after)
  })

  it('부품 의뢰는 보고 시 재료를 사용한다', () => {
    const save = freshSave()
    save.quests.q_awaken.status = 'turnedIn'
    startQuest(save, 'q_parts')
    addMaterial(save, 'toy_part', 3)
    expect(save.quests.q_parts.status).toBe('completed')
    turnIn(save, 'q_parts', () => 0.4)
    expect(save.quests.q_parts.status).toBe('turnedIn')
    expect(save.materials.toy_part).toBe(0)
    expect(save.items.some((item) => item.defId === 'gun_dart')).toBe(true)
    const gold = save.gold
    turnIn(save, 'q_parts')
    expect(save.gold).toBe(gold)
  })
})

describe('상점과 세이브', () => {
  beforeEach(() => mem.clear())

  it('골드가 부족하면 사지 못하고 저장이 왕복된다', () => {
    const save = freshSave()
    save.gold = 10
    expect(buyEntry(save, 0).ok).toBe(false)
    save.gold = 500
    expect(buyEntry(save, 0).ok).toBe(true)
    expect(save.potions).toBe(3)
    save.gold = 999
    const gun = makeItem('gun_water', 'uncommon' as Rarity, () => 0.9, 2)
    const before = JSON.stringify(gun.affixes)
    save.items.push(gun)
    save.equipment.weapon = gun.uid
    expect(rerollWeapon(save, () => 0.05).ok).toBe(true)
    expect(JSON.stringify(gun.affixes)).not.toBe(before)
    save.hp = 20
    expect(usePotion(save).ok).toBe(true)
    const beforeDeath = save.gold
    const lost = onDeath(save)
    expect(lost).toBe(Math.floor(beforeDeath * 0.1))
    expect(save.gold).toBe(beforeDeath - lost)
    expect(save.zoneId).toBe('meadow')
    saveGame(save)
    const loaded = loadGame()
    expect(loaded?.gold).toBe(save.gold)
    expect(loaded?.items.length).toBe(save.items.length)
    clearGame()
    expect(loadGame()).toBeNull()
  })
})
