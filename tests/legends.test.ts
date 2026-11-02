import { describe, expect, it } from 'vitest'
import { ITEMS } from '../src/data/items'
import { LEGEND_BY_ID, LEGENDS } from '../src/data/legends'
import { addItem } from '../src/sim/inventory'
import { itemLines, itemName, itemPower, makeItem } from '../src/sim/loot'
import { codexRows, DUPE_SHARE, LEGEND_ODDS, legendChance, legendsFor, legendsOf, makeLegend, recordLegend, rollLegend, syncCodex } from '../src/sim/legends'
import { attachMod, makeMod } from '../src/sim/mods'
import { freshSave } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { computeStats } from '../src/sim/stats'
import { townOf } from '../src/sim/town'
import { changeElement, rerollAffix } from '../src/sim/workshop'
import { dpsOf } from '../src/ui/inventory'
import type { ItemInstance, SaveData } from '../src/sim/types'

const BASE = { water: 'gun_water', bubble: 'gun_bubble', star: 'gun_star', dart: 'gun_dart' } as const
const never = () => 0.999999
const always = () => 0

function rich(): SaveData {
  const save = freshSave()
  save.gold = 100_000
  save.materials = { dream_dust: 50, toy_part: 50, star_shard: 50 }
  return save
}

function wear(save: SaveData, item: ItemInstance): void {
  addItem(save, item)
  save.equipment.weapon = item.uid
}

describe('고정 전설 데이터', () => {
  it('6~10종이 있고 이름·총 바탕·출처가 모두 정해져 있다', () => {
    expect(LEGENDS.length).toBeGreaterThanOrEqual(6)
    expect(LEGENDS.length).toBeLessThanOrEqual(10)
    expect(new Set(LEGENDS.map((l) => l.name)).size).toBe(LEGENDS.length)
    for (const l of LEGENDS) {
      const def = ITEMS[l.id]
      expect(def?.legend).toBe(true)
      expect(def?.slot).toBe('weapon')
      expect(def?.gun).toBe(l.gun)
      expect(l.sources.length).toBeGreaterThan(0)
      expect(l.where.length).toBeGreaterThan(3)
    }
  })

  it('요청한 이름들(별비 개틀링·솜사탕 교란기·꿈결 던바·관통 저격·모찌 총)이 들어 있다', () => {
    const names = LEGENDS.map((l) => l.name)
    for (const n of ['별비 개틀링', '솜사탕 교란기', '꿈결 던바']) expect(names).toContain(n)
    expect(LEGEND_BY_ID.leg_pierce.stats.pierce).toBeGreaterThanOrEqual(2)
    expect(LEGEND_BY_ID.leg_mochi.stats.mochi).toBeGreaterThan(0)
  })

  it('출처마다 떨어지는 전설이 겹치지 않게 정해져 있다', () => {
    expect(legendsFor({ kind: 'boss', depth: 1 }).map((x) => x.def.id)).toEqual(['leg_starrain'])
    expect(legendsFor({ kind: 'boss', depth: 2 }).map((x) => x.def.id)).toEqual(['leg_cotton'])
    expect(legendsFor({ kind: 'boss', depth: 3 }).map((x) => x.def.id)).toEqual(['leg_dunbar'])
    expect(legendsFor({ kind: 'boss', depth: 1, area: 'moon' }).map((x) => x.def.id)).toEqual(['leg_moth'])
    expect(legendsFor({ kind: 'chest', area: 'tower' }).map((x) => x.def.id)).toEqual(['leg_pierce'])
    expect(legendsFor({ kind: 'chest', area: 'loft' }).map((x) => x.def.id).sort()).toEqual(['leg_mochi', 'leg_whisper'])
    expect(legendsFor({ kind: 'mazeElite' }).map((x) => x.def.id)).toEqual(['leg_mochi'])
    // 일반 하수도 상자·깊이 4 보스는 고정 전설을 주지 않는다.
    expect(legendsFor({ kind: 'chest' })).toEqual([])
    expect(legendsFor({ kind: 'boss', depth: 4 })).toEqual([])
  })
})

describe('고정 전설 아이템', () => {
  it('항상 전설 등급이고 옵션은 고정(두 번 만들어도 같다)', () => {
    for (const l of LEGENDS) {
      const a = makeLegend(l.id, 8)
      const b = makeLegend(l.id, 8)
      expect(a.rarity).toBe('legendary')
      expect(a.affixes).toEqual(b.affixes)
      expect(a.uid).not.toBe(b.uid)
    }
  })

  it('이름은 접두사 없이 고정 이름, 설명에 고정 전설·출처가 나온다', () => {
    const g = makeLegend('leg_dunbar', 5)
    expect(itemName(g)).toBe('꿈결 던바')
    const lines = itemLines(g).join('\n')
    expect(lines).toContain('고정 전설')
    expect(lines).toContain('출처: 깊이 3 보스')
  })

  it('아이템 레벨이 높을수록 옵션이 세진다(관통은 그대로)', () => {
    const lo = makeLegend('leg_pierce', 1)
    const hi = makeLegend('leg_pierce', 20)
    const v = (it: ItemInstance, s: string) => it.affixes.find((a) => a.stat === s)!.value
    expect(v(hi, 'damage')).toBeGreaterThan(v(lo, 'damage'))
    expect(v(hi, 'pierce')).toBe(v(lo, 'pierce'))
  })

  it('옵션 다시 굴리기와 속성 바꾸기는 막히고, 개조 부품은 4칸 끼울 수 있다', () => {
    const save = rich()
    const g = makeLegend('leg_moth', 5)
    wear(save, g)
    expect(rerollAffix(save, g.uid, 0).ok).toBe(false)
    expect(changeElement(save, g.uid, 'sparkle').ok).toBe(false)
    for (const id of ['mod_scope', 'mod_barrel', 'mod_mag', 'mod_chip_ice']) {
      const m = makeMod(id, 'rare', 5)
      addItem(save, m)
      expect(attachMod(save, g.uid, m.uid).ok).toBe(true)
    }
  })

  it('모찌 발바닥 물총을 들면 모찌 돌진 배율이 오른다', () => {
    const save = freshSave()
    expect(computeStats(save).mochiMul).toBe(1)
    wear(save, makeLegend('leg_mochi', 5))
    expect(computeStats(save).mochiMul).toBeGreaterThan(1.5)
  })
})

describe('드롭과 천장(피티)', () => {
  it('보스 상자는 계속 빗나가도 6번째에는 반드시 떨어진다', () => {
    const save = freshSave()
    let got: ItemInstance | null = null
    let tries = 0
    while (!got && tries < 20) {
      tries += 1
      got = rollLegend(save, { kind: 'boss', depth: 1 }, 4, never)
    }
    expect(got?.defId).toBe('leg_starrain')
    expect(tries).toBe(6)
    expect(got!.itemLevel).toBe(5)
  })

  it('미로 정예는 처음엔 확정, 이미 찾았으면 더 주지 않는다', () => {
    const save = freshSave()
    const g = rollLegend(save, { kind: 'mazeElite' }, 3, never)
    expect(g?.defId).toBe('leg_mochi')
    recordLegend(save, g!)
    expect(rollLegend(save, { kind: 'mazeElite' }, 3, always)).toBeNull()
  })

  it('찾은 전설은 낮은 확률로만 다시 나오고 천장이 없다', () => {
    const save = freshSave()
    const def = LEGEND_BY_ID.leg_cotton
    const src = def.sources[0]
    recordLegend(save, makeLegend('leg_cotton', 5))
    expect(legendChance(save, def, src)).toBeCloseTo(LEGEND_ODDS.boss.base * DUPE_SHARE)
    for (let i = 0; i < 10; i++) rollLegend(save, { kind: 'boss', depth: 2 }, 5, never)
    expect(legendChance(save, def, src)).toBeCloseTo(LEGEND_ODDS.boss.base * DUPE_SHARE)
  })

  it('시뮬레이션: 보스 첫 전설까지 평균 2~4번, 지역 상자는 평균 20개 안쪽', () => {
    const rng = mulberry32(42)
    const runs = 2000
    let boss = 0
    let chest = 0
    for (let r = 0; r < runs; r++) {
      const s1 = freshSave()
      for (let n = 1; n <= 50; n++) if (rollLegend(s1, { kind: 'boss', depth: 3 }, 9, rng)) { boss += n; break }
      const s2 = freshSave()
      for (let n = 1; n <= 200; n++) if (rollLegend(s2, { kind: 'chest', area: 'tower' }, 9, rng)) { chest += n; break }
    }
    expect(boss / runs).toBeGreaterThan(2)
    expect(boss / runs).toBeLessThan(4)
    expect(chest / runs).toBeGreaterThan(4)
    expect(chest / runs).toBeLessThan(20)
  })
})

describe('전설 도감', () => {
  it('주우면 도감에 오르고, 같은 걸 또 주우면 개수만 오른다', () => {
    const save = freshSave()
    expect(codexRows(save).filter((r) => r.found)).toHaveLength(0)
    expect(recordLegend(save, makeLegend('leg_dunbar', 3))).toBe(true)
    expect(recordLegend(save, makeLegend('leg_dunbar', 6))).toBe(false)
    const row = codexRows(save).find((r) => r.def.id === 'leg_dunbar')!
    expect(row.found).toBe(true)
    expect(row.count).toBe(2)
    expect(recordLegend(save, makeItem('gun_star', 'legendary', mulberry32(1), 3))).toBe(false)
  })

  it('예전 저장의 가방·보관함 전설도 불러올 때 도감에 채워진다', () => {
    const save = freshSave()
    addItem(save, makeLegend('leg_whisper', 4))
    townOf(save).stash.push(makeLegend('leg_pierce', 4))
    delete save.legends
    syncCodex(save)
    expect(legendsOf(save).found.sort()).toEqual(['leg_pierce', 'leg_whisper'])
  })
})

describe('밸런스 시뮬레이션', () => {
  it('같은 iLv 무작위 전설 300자루와 비교해 초당 피해·아이템 힘이 정해진 범위 안이다', () => {
    const ilv = 10
    const dps = (item: ItemInstance) => {
      const s = freshSave()
      s.level = 10
      wear(s, item)
      return dpsOf(computeStats(s))
    }
    for (const l of LEGENDS) {
      const rng = mulberry32(3)
      let sumDps = 0
      let sumPow = 0
      let best = 0
      const N = 300
      for (let i = 0; i < N; i++) {
        const it = makeItem(BASE[l.gun], 'legendary', rng, ilv)
        const d = dps(it)
        sumDps += d
        sumPow += itemPower(it)
        best = Math.max(best, d)
      }
      const leg = makeLegend(l.id, ilv)
      const dRatio = dps(leg) / (sumDps / N)
      const pRatio = itemPower(leg) / (sumPow / N)
      // 고정 전설은 평균 전설보다 낫지만(유틸형은 비슷), 최고 굴림을 크게 넘지 않는다.
      expect(dRatio, l.id).toBeGreaterThan(0.9)
      expect(dRatio, l.id).toBeLessThan(1.35)
      expect(dps(leg) / best, l.id).toBeLessThan(1.08)
      expect(pRatio, l.id).toBeGreaterThan(0.9)
      expect(pRatio, l.id).toBeLessThan(1.45)
    }
  })
})
