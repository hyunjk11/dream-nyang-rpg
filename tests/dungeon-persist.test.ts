import { describe, expect, it } from 'vitest'
import { Delve, delveDrops, delveOf, fieldPlan, itemLevelFor } from '../src/sim/delve'
import { floorStateLabel, packSeen, sanitizeFloor, unpackSeen, type FloorState } from '../src/sim/floorsnap'
import { fallbackItemLevel, migrateItem } from '../src/sim/migrate-item'
import { migrateSave } from '../src/sim/migrate'
import { freshSave } from '../src/sim/mutate'
import { ilvText, makeItem } from '../src/sim/loot'
import { townOf } from '../src/sim/town'
import type { ItemInstance } from '../src/sim/types'

const fsName = 'node:fs'
async function src(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: string, e: string) => string }
  return fs.readFileSync(path, 'utf8')
}

function state(over: Partial<FloorState> = {}): FloorState {
  return {
    depth: 2, floor: 3, salt: 7, seed: 99, field: null, at: { x: 1.5, z: -2, yaw: 0.4 }, dead: [1, 4], initial: 12, hurt: [[3, 20]],
    nests: [[0, 5]], key: true, doors: true, secret: false, chests: ['4_5'], shrine: true, arrived: false, boss: null, seen: 'f0a',
    ...over,
  }
}

describe('던전 유지: 층 상태 저장', () => {
  it('미니맵 본 칸은 16진 비트로 접었다 펴도 그대로다', () => {
    const seen = new Uint8Array(37)
    for (const i of [0, 3, 5, 17, 36]) seen[i] = 1
    const back = new Uint8Array(37)
    unpackSeen(packSeen(seen), back)
    expect(Array.from(back)).toEqual(Array.from(seen))
  })

  it('망가진 층 상태는 버리고, 멀쩡한 건 그대로 살린다', () => {
    expect(sanitizeFloor(null)).toBeNull()
    expect(sanitizeFloor({ depth: 0, floor: 1 })).toBeNull()
    expect(sanitizeFloor(state())).toEqual(state())
    const odd = sanitizeFloor({ depth: 1, floor: 1, dead: [1, 'x', NaN], seen: 'zz', boss: NaN, hurt: [[1], [2, 3]] })
    expect(odd?.dead).toEqual([1])
    expect(odd?.seen).toBe('')
    expect(odd?.boss).toBeNull()
    expect(odd?.hurt).toEqual([[2, 3]])
  })

  it('저장 블록은 열린 깊이의 층만 기억하고, 들판 층은 언제나 기억한다', () => {
    const save = freshSave()
    save.delve = { unlocked: 2, cleared: 1, checkpoint: null, runs: 3, open: null, floorState: state() }
    expect(delveOf(save).floorState?.chests).toEqual(['4_5'])
    save.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 3, open: null, floorState: state() }
    expect(delveOf(save).floorState).toBeUndefined()
    const field = { kinds: ['slime' as const], fluff: true, named: false, boss: false }
    save.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 3, open: null, floorState: state({ depth: 1, floor: 2, field }) }
    expect(delveOf(save).floorState?.field).toEqual(field)
    expect(floorStateLabel(state())).toBe('깊이 2 · 3층')
    expect(floorStateLabel(state({ field }))).toBe('몽실 들판')
  })

  it('들판으로 돌아가도 같은 소금(salt)으로 같은 들판이 만들어진다', () => {
    const save = freshSave()
    const needs = { kinds: [], fluff: false, named: false, boss: false }
    const first = Delve.field(save, needs)
    const again = Delve.reopenField(save, fieldPlan(first.salt, needs), first.salt)
    expect(again.salt).toBe(first.salt)
    expect(again.plan.seed).toBe(first.plan.seed)
  })

  it('복귀·죽음 모두 층을 남기고, 보스·다음 층·새 여행은 지운다 (main 연결)', async () => {
    const main = await src('src/main.ts')
    expect(main).toMatch(/why === 'recall' \|\| why === 'down'/)
    expect(main).toMatch(/keepFloor\(snap\)/)
    expect(main).toMatch(/run\.restore\(kept\)/)
    expect((main.match(/keepFloor\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
    const run = await src('src/world/dungeon/run.ts')
    expect(run).toMatch(/snapshot\(salt: number\): FloorState/)
    expect(run).toMatch(/restore\(s: FloorState\): boolean/)
  })
})

describe('아이템 레벨 (iLv)', () => {
  it('깊이·층·엘리트·보스가 높을수록 아이템 레벨이 오른다', () => {
    expect(itemLevelFor(1, 1)).toBe(1)
    expect(itemLevelFor(1, 3)).toBe(3)
    expect(itemLevelFor(2, 1)).toBe(5)
    expect(itemLevelFor(2, 1, true)).toBeGreaterThan(itemLevelFor(2, 1))
    const lv = (elite: boolean) => {
      for (let s = 1; s < 400; s += 1) {
        let x = s
        const rng = () => ((x = (x * 16807) % 2147483647) / 2147483647)
        const item = delveDrops(2, elite, false, rng, 40, 2).find((d) => d.kind === 'item')?.item
        if (item) return item.itemLevel
      }
      return 0
    }
    expect(lv(false)).toBe(itemLevelFor(2, 2))
    expect(lv(true)).toBe(itemLevelFor(2, 2) + 1)
  })

  it('표시는 "iLv N" 이다', () => {
    expect(ilvText(7)).toBe('iLv 7')
    expect(ilvText(0)).toBe('iLv 1')
  })

  it('레벨이 없는 옛 아이템은 진행도에 맞는 레벨을 받는다', () => {
    expect(fallbackItemLevel({ level: 1 })).toBe(1)
    expect(fallbackItemLevel({ level: 20, delve: { unlocked: 3 } })).toBe(9)
    expect(fallbackItemLevel({ level: 2, delve: { unlocked: 3 } })).toBe(4)
    const broken = { ...makeItem('gun_water', 'common', () => 0.3, 1), itemLevel: NaN } as ItemInstance
    expect(migrateItem(broken, 6).itemLevel).toBe(6)
    const good = makeItem('gun_water', 'common', () => 0.3, 4)
    expect(migrateItem(good, 9).itemLevel).toBe(4)
  })

  it('저장을 불러오면 가방과 창고의 깨진 레벨이 고쳐진다', () => {
    const save = freshSave()
    save.level = 30
    save.delve = { unlocked: 2, cleared: 1, checkpoint: null, runs: 0, open: null }
    const a = { ...makeItem('gun_water', 'rare', () => 0.3, 3), itemLevel: undefined } as unknown as ItemInstance
    save.items.push(a)
    const b = { ...makeItem('gun_water', 'rare', () => 0.4, 3), uid: 'stash-b', itemLevel: -2 } as ItemInstance
    save.town = { scrolls: 0, stock: [], stockAt: -1, buyback: [], stash: [b], contracts: [], boardAt: -1, contractsDone: 0, contractRuns: {} }
    migrateSave(save)
    expect(save.items.find((i) => i.uid === a.uid)?.itemLevel).toBe(5)
    expect(townOf(save).stash[0].itemLevel).toBe(5)
  })

  it('가방 칸, 툴팁, 상점·창고 카드, 비교, 줍기 알림 모두 iLv 를 쓴다', async () => {
    const cell = await src('src/ui/itemcell.ts')
    expect(cell).toMatch(/span\('ilvl', ilvText/)
    expect(cell).toMatch(/export function ilvRow/)
    expect(await src('src/ui/inventory.ts')).toMatch(/ilvRow\(current, item\)/)
    expect(await src('src/ui/town.ts')).toMatch(/ilvRow\(/)
    expect(await src('src/main.ts')).toMatch(/ilvText\(item\.itemLevel\)} · I 가방에서 비교/)
  })
})
