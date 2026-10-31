import { describe, expect, it } from 'vitest'
import { GameState, SAVE_KEY_3D } from '../src/core/loop'
import { WEAPON_IDS } from '../src/data/items'
import { boardOf, claimContract, contractEvent, contractGoal, contractTitle, takeContract } from '../src/sim/contracts'
import { delveOf } from '../src/sim/delve'
import { addItem } from '../src/sim/inventory'
import { baseValue, makeItem, maxRarityFor, rollDrops, rollRarity, sellValue } from '../src/sim/loot'
import { RARITIES } from '../src/sim/types'
import { freshSave } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { computeStats } from '../src/sim/stats'
import {
  BUYBACK_CAP,
  buyBack,
  buyConsumable,
  buyPrice,
  buyStock,
  candyHeal,
  eatCandy,
  sellItem,
  shopStock,
  stashPut,
  stashTake,
  townOf,
  useScroll,
} from '../src/sim/town'
import { changeElement, elementOf, MAX_PLUS, rerollAffix, rerollChoices, upgradeCost, upgradeGun } from '../src/sim/workshop'
import type { SaveData } from '../src/sim/types'

const rank = (r: string) => RARITIES.indexOf(r as never)

function richSave(): SaveData {
  const save = freshSave()
  save.gold = 100_000
  save.materials = { dream_dust: 500, toy_part: 50, star_shard: 50 }
  return save
}

describe('포포 상점 가격', () => {
  it('사는 값은 언제나 파는 값보다 비싸고, 아이템 레벨이 높을수록 비싸다', () => {
    const rng = mulberry32(3)
    for (const r of ['uncommon', 'rare', 'epic'] as const) {
      const low = makeItem(WEAPON_IDS[0], r, rng, 1)
      const high = makeItem(WEAPON_IDS[0], r, rng, 9)
      expect(buyPrice(low)).toBeGreaterThan(sellValue(low))
      expect(buyPrice(high)).toBeGreaterThan(buyPrice(low))
      expect(buyPrice(low)).toBe(Math.round(baseValue(low.defId, r) * 1.5))
    }
  })

  it('진열대는 6칸, 첫 칸은 총이고 희귀를 넘지 않으며 원정을 다녀오면 바뀐다', () => {
    const save = richSave()
    const a = shopStock(save, mulberry32(1))
    expect(a).toHaveLength(6)
    expect(WEAPON_IDS).toContain(a[0].item.defId)
    expect(a.every((e) => rank(e.item.rarity) <= rank('rare') && e.item.rarity !== 'common')).toBe(true)
    expect(shopStock(save, mulberry32(2))).toBe(a) // same trip → same shelf
    delveOf(save).runs += 1
    expect(shopStock(save, mulberry32(2))).not.toBe(a)
  })

  it('물건을 사면 가방에 들어오고 진열대에서 팔림 표시가 된다', () => {
    const save = richSave()
    const stock = shopStock(save, mulberry32(5))
    const gold = save.gold
    const r = buyStock(save, 0)
    expect(r.ok).toBe(true)
    expect(save.gold).toBe(gold - stock[0].price)
    expect(save.items.some((i) => i.uid === stock[0].item.uid)).toBe(true)
    expect(buyStock(save, 0).ok).toBe(false)
  })

  it('판 물건은 같은 값에 되살 수 있고, 최근 5개만 남는다', () => {
    const save = richSave()
    const rng = mulberry32(9)
    const made = Array.from({ length: 7 }, () => makeItem(WEAPON_IDS[1], 'rare', rng, 3))
    for (const m of made) addItem(save, m)
    for (const m of made) expect(sellItem(save, m.uid).ok).toBe(true)
    const t = townOf(save)
    expect(t.buyback).toHaveLength(BUYBACK_CAP)
    expect(t.buyback[0].item.uid).toBe(made[6].uid)
    const gold = save.gold
    const price = t.buyback[0].price
    expect(price).toBe(sellValue(made[6]))
    expect(buyBack(save, 0).ok).toBe(true)
    expect(save.gold).toBe(gold - price)
    expect(save.items.some((i) => i.uid === made[6].uid)).toBe(true)
  })

  it('쓰고 있는 총은 팔 수 없다', () => {
    const save = richSave()
    expect(sellItem(save, save.equipment.weapon!).ok).toBe(false)
  })

  it('하트 사탕과 귀환 두루마리는 한도까지만 산다', () => {
    const save = richSave()
    save.potions = 18
    expect(buyConsumable(save, 'candy', 5).ok).toBe(true)
    expect(save.potions).toBe(20)
    expect(buyConsumable(save, 'candy').ok).toBe(false)
    expect(buyConsumable(save, 'scroll', 2).ok).toBe(true)
    expect(townOf(save).scrolls).toBe(2)
    expect(useScroll(save)).toBe(true)
    expect(townOf(save).scrolls).toBe(1)
    const poor = freshSave()
    poor.gold = 10
    expect(buyConsumable(poor, 'scroll').ok).toBe(false)
  })

  it('하트 사탕은 최대 체력의 40%(최소 30)를 회복한다', () => {
    expect(candyHeal(200)).toBe(80)
    expect(candyHeal(50)).toBe(30)
    const save = freshSave()
    save.potions = 1
    expect(eatCandy(save, 100, 100).ok).toBe(false)
    const r = eatCandy(save, 90, 100)
    expect(r.heal).toBe(10)
    expect(save.potions).toBe(0)
  })
})

describe('보관함', () => {
  it('가방 ↔ 보관함, 착용 중인 장비는 넣지 않는다', () => {
    const save = richSave()
    const item = makeItem(WEAPON_IDS[0], 'rare', mulberry32(4), 2)
    addItem(save, item)
    expect(stashPut(save, save.equipment.weapon!).ok).toBe(false)
    expect(stashPut(save, item.uid).ok).toBe(true)
    expect(save.items.some((i) => i.uid === item.uid)).toBe(false)
    expect(townOf(save).stash[0].uid).toBe(item.uid)
    expect(stashTake(save, item.uid).ok).toBe(true)
    expect(townOf(save).stash).toHaveLength(0)
  })
})

describe('키키 공방', () => {
  it('강화 비용: 골드 20n+8n², 꿈가루 n, +8부터 별조각', () => {
    const item = makeItem(WEAPON_IDS[0], 'rare', mulberry32(1), 1)
    expect(upgradeCost(item)).toEqual({ gold: 28, mats: { dream_dust: 1 } })
    item.plus = 7
    expect(upgradeCost(item)).toEqual({ gold: 20 * 8 + 8 * 64, mats: { dream_dust: 8, star_shard: 1 } })
    item.plus = MAX_PLUS
    expect(upgradeCost(item)).toBeNull()
  })

  it('강화는 실패하지 않고, +1마다 총 피해가 7%씩 오른다', () => {
    const save = richSave()
    const uid = save.equipment.weapon!
    const base = computeStats(save).gun.damage
    for (let i = 0; i < MAX_PLUS; i += 1) expect(upgradeGun(save, uid).ok).toBe(true)
    expect(upgradeGun(save, uid).ok).toBe(false)
    const gun = save.items.find((i) => i.uid === uid)!
    expect(gun.plus).toBe(10)
    expect(computeStats(save).gun.damage / base).toBeCloseTo(1.7, 2)
    expect(sellValue(gun)).toBeGreaterThan(0)
  })

  it('골드나 재료가 모자라면 아무것도 잃지 않는다', () => {
    const save = freshSave()
    save.gold = 5
    const before = JSON.stringify(save)
    expect(upgradeGun(save, save.equipment.weapon!).ok).toBe(false)
    expect(JSON.stringify(save)).toBe(before)
  })

  it('옵션 하나만 다시 굴리고, 다른 옵션·속성 중복은 피한다', () => {
    const save = richSave()
    const item = makeItem(WEAPON_IDS[0], 'epic', mulberry32(12), 4)
    addItem(save, item)
    const keep = item.affixes.slice(1).map((a) => a.id)
    const old = item.affixes[0].id
    expect(rerollAffix(save, item.uid, 0, mulberry32(77)).ok).toBe(true)
    expect(item.affixes.slice(1).map((a) => a.id)).toEqual(keep)
    expect(item.affixes[0].id).not.toBe(old)
    const ids = item.affixes.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(item.affixes.filter((a) => ['sparkle', 'ice', 'candy'].includes(a.id)).length).toBeLessThanOrEqual(1)
    for (const c of rerollChoices(item, 0)) expect(c.gearOnly).toBeFalsy()
  })

  it('속성 변경은 속성 옵션이 있는 총만, 수치 비율은 유지', () => {
    const save = richSave()
    const item = makeItem(WEAPON_IDS[0], 'rare', mulberry32(1), 3)
    item.affixes = [{ id: 'ice', name: '서늘한', stat: 'ice', value: 0.15 * 1 }]
    item.itemLevel = 1
    addItem(save, item)
    expect(elementOf(item)).toBe('ice')
    expect(changeElement(save, item.uid, 'ice').ok).toBe(false)
    expect(changeElement(save, item.uid, 'candy').ok).toBe(true)
    expect(elementOf(item)).toBe('candy')
    const plain = makeItem(WEAPON_IDS[0], 'common', mulberry32(1), 1)
    addItem(save, plain)
    expect(changeElement(save, plain.uid, 'sparkle').ok).toBe(false)
  })
})

describe('퀘스트 게시판', () => {
  it('3개를 걸고, 원정을 다녀오면 맡지 않은 것만 새로 바뀐다', () => {
    const save = richSave()
    const board = boardOf(save, mulberry32(2))
    expect(board).toHaveLength(3)
    expect(new Set(board.map((c) => c.kind)).size).toBe(3)
    expect(takeContract(save, board[0].id).ok).toBe(true)
    const kept = board[0].id
    const other = board[1].id
    delveOf(save).runs += 1
    const next = boardOf(save, mulberry32(3))
    expect(next.map((c) => c.id)).toContain(kept)
    expect(next.map((c) => c.id)).not.toContain(other)
  })

  it('정예 의뢰: 깊이 조건을 지키며 진행되고 완료 후 보상을 받는다', () => {
    const save = richSave()
    boardOf(save, mulberry32(1))
    const t = townOf(save)
    t.contracts[0] = { ...t.contracts[0], kind: 'elites', depth: 2, goal: contractGoal('elites', 2), progress: 0, status: 'offered' }
    const c = t.contracts[0]
    expect(contractTitle(c)).toContain('정예')
    takeContract(save, c.id)
    contractEvent(save, { type: 'kill', depth: 1, elite: true })
    contractEvent(save, { type: 'kill', depth: 2, elite: false })
    expect(c.progress).toBe(0)
    let done: unknown[] = []
    for (let i = 0; i < c.goal; i += 1) done = contractEvent(save, { type: 'kill', depth: 3, elite: true })
    expect(done).toHaveLength(1)
    expect(c.status).toBe('done')
    const gold = save.gold
    const dust = save.materials.dream_dust
    const r = claimContract(save, c.id)
    expect(r.ok).toBe(true)
    expect(save.gold).toBe(gold + c.reward.gold)
    expect(save.materials.dream_dust).toBe(dust + c.reward.mats.dream_dust)
    expect(c.status).toBe('claimed')
    expect(claimContract(save, c.id).ok).toBe(false)
  })

  it('무사 돌파 의뢰는 쓰러지면 처음부터', () => {
    const save = richSave()
    boardOf(save, mulberry32(1))
    const c = townOf(save).contracts[1]
    Object.assign(c, { kind: 'clean', depth: 1, goal: 2, progress: 0 })
    takeContract(save, c.id)
    contractEvent(save, { type: 'floor', depth: 1 })
    expect(c.progress).toBe(1)
    contractEvent(save, { type: 'down' })
    expect(c.progress).toBe(0)
  })

  it('맡지 않은 의뢰는 진행되지 않는다', () => {
    const save = richSave()
    const [c] = boardOf(save, mulberry32(1))
    contractEvent(save, { type: 'kill', depth: 5, elite: true })
    contractEvent(save, { type: 'nest', depth: 5 })
    expect(c.progress).toBe(0)
  })
})

describe('깊이별 희귀도 상한', () => {
  it('깊이 1은 희귀까지(보스는 영웅), 깊이 3부터 전설', () => {
    expect(maxRarityFor(1)).toBe('rare')
    expect(maxRarityFor(1, true)).toBe('epic')
    expect(maxRarityFor(2)).toBe('epic')
    expect(maxRarityFor(3)).toBe('legendary')
    const rng = mulberry32(8)
    for (let i = 0; i < 3000; i += 1) expect(rank(rollRarity(400, rng, 60, 'rare'))).toBeLessThanOrEqual(rank('rare'))
  })

  it('rollDrops 도 상한을 지킨다', () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 400; i += 1) {
      const drops = rollDrops({ table: { gold: [1, 1], gear: 1, weapon: 1, dust: 0, part: 0, potion: 0 }, luck: 300, elite: true, itemLevel: 1, rng, cap: 'rare' })
      for (const d of drops) if (d.item) expect(rank(d.item.rarity)).toBeLessThanOrEqual(rank('rare'))
    }
  })
})

describe('세이브 이전', () => {
  it('마을 블록이 없는 옛 세이브도 불러오고, 마을 상태는 저장·복원된다', () => {
    const old = freshSave() as SaveData & { town?: unknown }
    delete old.town
    const store: Record<string, string> = { [SAVE_KEY_3D]: JSON.stringify(old) }
    const mem = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    const g = GameState.load(mem)!
    const t = townOf(g.save)
    expect(t.stash).toEqual([])
    expect(t.scrolls).toBe(0)
    t.scrolls = 3
    g.save.town!.stash.push(makeItem(WEAPON_IDS[0], 'rare', mulberry32(1), 1))
    g.persist(mem)
    const again = GameState.load(mem)!
    expect(townOf(again.save).scrolls).toBe(3)
    expect(townOf(again.save).stash).toHaveLength(1)
  })

  it('망가진 마을 블록은 안전하게 고친다', () => {
    const save = freshSave()
    ;(save as unknown as { town: unknown }).town = { scrolls: -4, stash: [null, 3], buyback: 'x', contracts: [{}] }
    const t = townOf(save)
    expect(t.scrolls).toBe(0)
    expect(t.stash).toEqual([])
    expect(t.buyback).toEqual([])
    expect(t.contracts).toEqual([])
  })
})
