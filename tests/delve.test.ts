import { describe, expect, it } from 'vitest'
import { DIFFICULTY } from '../src/combat/difficulty'
import { GameState, SAVE_KEY_3D } from '../src/core/loop'
import { BOSS_FLOOR, Delve, delveDrops, delveOf, floorLabel, floorPlan, floorScale, formatTime, objectiveText, portalChoices } from '../src/sim/delve'
import { freshSave } from '../src/sim/mutate'
import { makeItem } from '../src/sim/loot'
import { rng } from '../src/world/dungeon/maze'

function memory() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

describe('탐험 층 구성', () => {
  it('깊이마다 세 층 + 보스층이고 목표가 버티기 → 둥지 → 출구 → 보스 순서다', () => {
    expect(BOSS_FLOOR).toBe(4)
    expect([1, 2, 3, 4].map((f) => floorPlan(1, f).objective)).toEqual(['survive', 'nests', 'exit', 'boss'])
    expect(floorPlan(1, 1).goal).toBe(DIFFICULTY.delve.surviveWaves)
    expect(floorPlan(1, 2).goal).toBe(DIFFICULTY.delve.nests)
    expect(floorPlan(1, 4).bossRoom).toBeGreaterThan(floorPlan(1, 3).bossRoom)
  })

  it('같은 깊이·층·소금이면 같은 미로 시드, 층이 바뀌면 다른 시드', () => {
    expect(floorPlan(2, 3, 9).seed).toBe(floorPlan(2, 3, 9).seed)
    expect(floorPlan(2, 3, 9).seed).not.toBe(floorPlan(2, 2, 9).seed)
    expect(floorPlan(2, 3, 9).seed).not.toBe(floorPlan(2, 3, 10).seed)
  })

  it('깊이 1의 1층은 지금 손맛 그대로(배율 1, 웨이브 1부터)', () => {
    const s = floorScale(1, 1)
    expect(s).toMatchObject({ hp: 1, damage: 1, firstWave: 1, gold: 1 })
    expect(s.boss).toEqual({ hp: 1, damage: 1 })
  })

  it('층과 깊이가 내려갈수록 조금씩만 세진다', () => {
    const a = floorScale(1, 3)
    expect(a.hp).toBeGreaterThan(1)
    expect(a.hp).toBeLessThan(1.15)
    const b = floorScale(2, 1)
    expect(b.hp).toBeGreaterThan(a.hp)
    expect(b.firstWave).toBeGreaterThanOrEqual(a.firstWave)
    expect(floorScale(3, 4).boss.hp).toBeGreaterThan(floorScale(2, 4).boss.hp)
  })

  it('HUD 문구가 한국어로 진행도를 보여준다', () => {
    expect(floorLabel(1, 2)).toBe('깊이 1 · 2층')
    expect(floorLabel(2, 4)).toBe('깊이 2 · 보스층')
    expect(objectiveText(floorPlan(1, 1), 1)).toBe('웨이브 버티기 1/3')
    expect(objectiveText(floorPlan(1, 2), 5)).toBe('둥지 파이프 막기 3/3')
    expect(objectiveText(floorPlan(1, 1), 3, true)).toContain('계단 포털')
    expect(formatTime(187)).toBe('3분 07초')
  })
})

describe('탐험 진행과 저장', () => {
  it('열리지 않은 깊이는 시작할 수 없다', () => {
    const save = freshSave()
    expect(Delve.start(save, 2)).toBeNull()
    expect(Delve.start(save, 1)).not.toBeNull()
  })

  it('층을 넘어가면 체크포인트가 그 층으로 저장된다', () => {
    const save = freshSave()
    const run = Delve.start(save, 1)!
    run.nextFloor(save)
    expect(run.floor).toBe(2)
    expect(delveOf(save).checkpoint).toEqual({ depth: 1, floor: 2 })
    run.nextFloor(save)
    run.nextFloor(save)
    expect(run.onBoss).toBe(true)
    expect(() => run.nextFloor(save)).toThrow()
  })

  it('보스를 쓰러뜨리면 다음 깊이가 열리고 체크포인트가 비워진다', () => {
    const save = freshSave()
    const run = Delve.start(save, 1, BOSS_FLOOR)!
    expect(run.bossCleared(save)).toBe(2)
    const sum = run.finish(save, 'clear', 2)
    expect(sum.unlocked).toBe(2)
    expect(delveOf(save)).toMatchObject({ unlocked: 2, cleared: 1, checkpoint: null })
    expect(portalChoices(save).map((c) => c.depth)).toEqual([2, 1])
  })

  it('보스를 쓰러뜨린 뒤 쓰러져도 다음 깊이는 열린 채, 체크포인트는 비어 있다', () => {
    const save = freshSave()
    const run = Delve.start(save, 1, BOSS_FLOOR)!
    run.bossCleared(save)
    run.finish(save, 'down')
    expect(delveOf(save)).toMatchObject({ unlocked: 2, checkpoint: null })
  })

  it('1층 체크포인트는 이어가기 줄을 따로 만들지 않는다', () => {
    const save = freshSave()
    Delve.start(save, 1)!.finish(save, 'recall')
    expect(portalChoices(save).some((c) => c.resume)).toBe(false)
  })

  it('쓰러지면 이번 탐험 골드 일부만 잃고, 아이템과 체크포인트는 남는다', () => {
    const save = freshSave()
    const before = save.gold
    const run = Delve.start(save, 1)!
    run.nextFloor(save)
    run.pickup(save, { kind: 'gold', amount: 100 })
    const item = makeItem('hat_beret', 'rare', rng(3), 1)
    run.pickup(save, { kind: 'item', amount: 1, item })
    const sum = run.finish(save, 'down')
    expect(sum.lost).toBe(Math.floor(100 * DIFFICULTY.delve.deathGoldLoss))
    expect(save.gold).toBe(before + 100 - sum.lost)
    expect(save.items.some((i) => i.uid === item.uid)).toBe(true)
    expect(delveOf(save).checkpoint).toEqual({ depth: 1, floor: 2 })
    expect(portalChoices(save)[0]).toMatchObject({ resume: true, depth: 1, floor: 2 })
  })

  it('중간 귀환은 골드를 모두 챙기고 같은 층에서 이어간다', () => {
    const save = freshSave()
    const before = save.gold
    const run = Delve.start(save, 1)!
    run.nextFloor(save)
    run.nextFloor(save)
    run.pickup(save, { kind: 'gold', amount: 40 })
    run.kill(false)
    run.kill(true)
    const sum = run.finish(save, 'recall')
    expect(sum).toMatchObject({ end: 'recall', gold: 40, lost: 0, kills: 2, elites: 1, floor: 3, floorsCleared: 2 })
    expect(save.gold).toBe(before + 40)
    const again = Delve.resume(save)!
    expect(again.floor).toBe(3)
    expect(again.salt).not.toBe(run.salt)
  })

  it('저장 후 다시 불러와도 열린 깊이와 체크포인트가 유지된다', () => {
    const store = memory()
    const game = new GameState()
    const run = Delve.start(game.save, 1, BOSS_FLOOR)!
    run.finish(game.save, 'clear', run.bossCleared(game.save))
    Delve.start(game.save, 2)!.finish(game.save, 'recall')
    game.persist(store)
    const back = GameState.load(store)!
    expect(delveOf(back.save)).toMatchObject({ unlocked: 2, cleared: 1, checkpoint: { depth: 2, floor: 1 } })
  })

  it('탐험 정보가 없는 예전 저장도 깊이 1로 채워 불러온다', () => {
    const store = memory()
    const old = freshSave() as unknown as Record<string, unknown>
    delete old.delve
    store.setItem(SAVE_KEY_3D, JSON.stringify(old))
    const back = GameState.load(store)!
    expect(back.save.delve).toEqual({ unlocked: 1, cleared: 0, checkpoint: null, runs: 0 })
  })

  it('망가진 탐험 값은 안전하게 고친다', () => {
    const save = freshSave()
    save.delve = { unlocked: -3, cleared: 9, checkpoint: { depth: 7, floor: 99 }, runs: Number.NaN }
    expect(delveOf(save)).toEqual({ unlocked: 1, cleared: 1, checkpoint: null, runs: 0 })
  })

  it('가방이 가득이면 주운 아이템은 골드로 바뀐다', () => {
    const save = freshSave()
    for (let i = 0; i < 30; i += 1) save.items.push(makeItem('acc_charm', 'common', rng(i), 1))
    const run = Delve.start(save, 1)!
    const r = run.pickup(save, { kind: 'item', amount: 1, item: makeItem('acc_ring', 'common', rng(1), 1) })
    expect(r.text).toContain('가방이 가득')
    expect(run.gold).toBeGreaterThan(0)
  })
})

describe('던전 전리품', () => {
  it('일반 몹은 대개 골드만, 보스는 골드와 아이템을 꼭 준다', () => {
    const r = rng(42)
    let gold = 0
    let items = 0
    for (let i = 0; i < 400; i += 1) {
      for (const d of delveDrops(1, false, false, r)) {
        if (d.kind === 'gold') gold += 1
        if (d.kind === 'item') items += 1
      }
    }
    expect(gold).toBe(400)
    expect(items).toBeLessThan(20)
    const boss = delveDrops(1, false, true, rng(7))
    expect(boss.some((d) => d.kind === 'gold' && d.amount >= 40)).toBe(true)
    expect(boss.some((d) => d.kind === 'item')).toBe(true)
  })

  it('깊은 곳일수록 골드가 많아진다', () => {
    const sum = (depth: number) => {
      const r = rng(5)
      let g = 0
      for (let i = 0; i < 300; i += 1) for (const d of delveDrops(depth, false, false, r)) if (d.kind === 'gold') g += d.amount
      return g
    }
    expect(sum(3)).toBeGreaterThan(sum(1))
  })
})
