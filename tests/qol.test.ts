import { describe, expect, it } from 'vitest'
import { makeItem, itemPower } from '../src/sim/loot'
import { freshSave } from '../src/sim/mutate'
import { bagItems } from '../src/sim/inventory'
import { Delve } from '../src/sim/delve'
import { AUTO_CANDY_GAP, QOL_DEFAULTS, autoSellPick, bestUpgrades, isUpgrade, junkIds, loadQol, needsConfirm, rememberFirst, shouldAutoCandy, sortBag } from '../src/sim/qol'
import { HELP_KEYS, HELP_QOL } from '../src/ui/help'
import { MAGNET } from '../src/world/dungeon/loot-view'
import type { SaveData } from '../src/sim/types'

function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** Fresh save wearing a weak hat; bag gets the given items. */
function withBag(items: ReturnType<typeof makeItem>[]): SaveData {
  const save = freshSave()
  const hat = makeItem('hat_pin', 'common', rng(1), 1)
  save.items.push(hat)
  save.equipment.hat = hat.uid
  save.items.push(...items)
  return save
}

describe('잡동사니 판매 · 판매 확인', () => {
  it('일반·고급 중 ▲가 아닌 장비만 잡동사니로 고르고, 희귀 이상은 절대 고르지 않는다', () => {
    const weak = makeItem('hat_pin', 'common', rng(2), 1)
    const strong = makeItem('hat_beret', 'uncommon', rng(3), 30)
    const rare = makeItem('hat_pin', 'rare', rng(4), 1)
    const save = withBag([weak, strong, rare])
    // Make sure the "weak" one really is not an upgrade.
    if (isUpgrade(save, weak)) weak.itemLevel = 1
    const junk = junkIds(save)
    expect(junk).not.toContain(rare.uid)
    expect(junk).not.toContain(strong.uid)
    for (const id of junk) expect(['common', 'uncommon']).toContain(save.items.find((i) => i.uid === id)?.rarity)
  })

  it('희귀 이상 판매·분해는 한 번 더 확인한다', () => {
    expect(needsConfirm(makeItem('hat_pin', 'common', rng(5), 1))).toBe(false)
    expect(needsConfirm(makeItem('hat_pin', 'uncommon', rng(5), 1))).toBe(false)
    expect(needsConfirm(makeItem('hat_pin', 'rare', rng(5), 1))).toBe(true)
    expect(needsConfirm(makeItem('hat_pin', 'legendary', rng(5), 1))).toBe(true)
  })
})

describe('가방 정렬 · 좋은 장비 입기', () => {
  it('정렬하면 부위 → 희귀도 → 파워 순이고 장착 장비는 그대로다', () => {
    const save = withBag([
      makeItem('shoes_boots', 'common', rng(6), 1),
      makeItem('hat_beret', 'common', rng(7), 1),
      makeItem('hat_beret', 'epic', rng(8), 5),
      makeItem('gun_star', 'rare', rng(9), 3),
    ])
    const worn = { ...save.equipment }
    const count = save.items.length
    sortBag(save)
    const bag = bagItems(save)
    expect(bag[0].defId).toBe('gun_star')
    expect(bag[1].rarity).toBe('epic')
    expect(bag.at(-1)?.defId).toBe('shoes_boots')
    expect(save.equipment).toEqual(worn)
    expect(save.items.length).toBe(count)
  })

  it('부위마다 가장 센 ▲ 장비 하나씩만 고르고 총은 건드리지 않는다', () => {
    const a = makeItem('hat_beret', 'rare', rng(10), 20)
    const b = makeItem('hat_beret', 'epic', rng(11), 25)
    const gun = makeItem('gun_dart', 'legendary', rng(12), 30)
    const save = withBag([a, b, gun])
    const picks = bestUpgrades(save)
    const hats = picks.filter((id) => id === a.uid || id === b.uid)
    expect(hats.length).toBe(1)
    expect(hats[0]).toBe(itemPower(a) > itemPower(b) ? a.uid : b.uid)
    expect(picks).not.toContain(gun.uid)
  })
})

describe('자동 판매 · 자동 사탕 · 설정 기억', () => {
  it('일반 자동 판매는 켰을 때, 일반 등급이고 ▲가 아닐 때만 판다', () => {
    const save = withBag([])
    const junk = makeItem('hat_pin', 'common', rng(13), 1)
    const good = makeItem('hat_beret', 'common', rng(14), 40)
    const rare = makeItem('hat_pin', 'rare', rng(15), 1)
    const on = { ...QOL_DEFAULTS, autoSellCommon: true }
    expect(autoSellPick(save, junk, QOL_DEFAULTS)).toBe(false)
    expect(autoSellPick(save, junk, on)).toBe(!isUpgrade(save, junk))
    expect(autoSellPick(save, good, on)).toBe(false)
    expect(autoSellPick(save, rare, on)).toBe(false)
  })

  it('던전에서 자동 판매된 장비는 가방 대신 탐험 골드가 된다', () => {
    const save = withBag([])
    const d = new Delve(1, 1)
    const item = makeItem('hat_pin', 'common', rng(16), 1)
    const before = save.items.length
    const r = d.pickup(save, { kind: 'item', item, amount: 1 } as never, Math.random, () => true)
    expect(save.items.length).toBe(before)
    expect(d.gold).toBeGreaterThan(0)
    expect(d.autoSold).toBe(1)
    expect(r.text).toContain('자동 판매')
  })

  it('자동 사탕은 체력이 기준 아래이고 사탕이 있고 간격이 지났을 때만 먹는다', () => {
    const p = QOL_DEFAULTS
    expect(shouldAutoCandy(20, 100, 2, AUTO_CANDY_GAP, p)).toBe(true)
    expect(shouldAutoCandy(40, 100, 2, AUTO_CANDY_GAP, p)).toBe(false)
    expect(shouldAutoCandy(20, 100, 0, AUTO_CANDY_GAP, p)).toBe(false)
    expect(shouldAutoCandy(20, 100, 2, AUTO_CANDY_GAP - 1, p)).toBe(false)
    expect(shouldAutoCandy(0, 100, 2, AUTO_CANDY_GAP, p)).toBe(false)
    expect(shouldAutoCandy(20, 100, 2, AUTO_CANDY_GAP, { ...p, autoCandy: false })).toBe(false)
  })

  it('저장된 설정을 읽고, 깨진 값은 기본값으로 되돌린다', () => {
    expect(loadQol(null)).toEqual(QOL_DEFAULTS)
    expect(loadQol('{oops')).toEqual(QOL_DEFAULTS)
    expect(loadQol(JSON.stringify({ autoSellCommon: true, autoCandy: false, autoCandyAt: 0.5 }))).toEqual({ autoSellCommon: true, autoCandy: false, autoCandyAt: 0.5, autoAim: false, shake: true })
    expect(loadQol(null, true).autoAim).toBe(true)
    expect(loadQol(JSON.stringify({ autoAim: false }), true).autoAim).toBe(false)
    expect(loadQol(JSON.stringify({ autoCandyAt: 7 })).autoCandyAt).toBe(QOL_DEFAULTS.autoCandyAt)
  })

  it('포털 목록은 지난번 간 곳을 맨 위에 표시한다', () => {
    const list = [{ text: 'A', go: 'sewer:3:1' }, { text: 'B', go: 'sewer:2:1' }, { text: 'C', go: 'field' }, { text: '그만두기' }]
    const out = rememberFirst(list, 'field')
    expect(out[0]).toEqual({ text: 'C · 지난번', go: 'field' })
    expect(out.length).toBe(4)
    expect(rememberFirst(list, 'sewer:9:1')).toBe(list)
    expect(rememberFirst(list, null)).toBe(list)
  })
})

describe('도움말 · 줍기 범위', () => {
  it('H 도움말에 단축키와 편의 기능이 모두 있다', () => {
    const keys = HELP_KEYS.map(([k]) => k)
    for (const k of ['WASD', 'Q', 'G', 'I / Tab', 'T', 'H', 'Alt']) expect(keys).toContain(k)
    expect(HELP_QOL.length).toBeGreaterThanOrEqual(4)
  })

  it('자동 줍기 범위가 넓어졌다', () => {
    expect(MAGNET).toBeGreaterThanOrEqual(3.4)
  })
})
