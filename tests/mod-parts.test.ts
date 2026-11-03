import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { WATER_LOOK } from '../src/actors/toygun'
import { JUICE, Juice, juiceShare, rollCloud, rollStar, type JuiceWorld } from '../src/combat/juice'
import type { SkillBody } from '../src/combat/skills'
import type { Vfx } from '../src/core/vfx'
import { COMBOS, MAX_TRICKS, TRICK_PART, type ComboId } from '../src/data/mods'
import { addItem, bagItems } from '../src/sim/inventory'
import { makeLegend } from '../src/sim/legends'
import { itemLines, makeItem } from '../src/sim/loot'
import { migrateSave } from '../src/sim/migrate'
import { PARTS_GIFT_FLAG, migrateParts } from '../src/sim/migrate-parts'
import { attachMod, gunCombos, gunLookWithMods, gunMods, gunTraits, makeMod, modLabel } from '../src/sim/mods'
import { freshSave } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { STAT_CAPS, computeStats } from '../src/sim/stats'
import { townOf } from '../src/sim/town'
import type { ItemInstance, SaveData } from '../src/sim/types'
import { rerollChoices } from '../src/sim/workshop'

const vfx = { burst: () => {}, ring: () => {}, hit: () => {} } as unknown as Vfx
const open: JuiceWorld = { solid: (_ox, _oy, _oz, _dx, _dy, _dz, max) => max, normal: () => ({ x: 0, y: 1, z: 0 }) }

function rich(): SaveData {
  const save = freshSave()
  save.gold = 100_000
  save.level = 10
  return save
}

function gun(save: SaveData, defId = 'gun_water', rarity: ItemInstance['rarity'] = 'epic', ilv = 10): ItemInstance {
  const g = makeItem(defId, rarity, mulberry32(4), ilv)
  g.affixes = []
  addItem(save, g)
  save.equipment.weapon = g.uid
  return g
}

function fit(save: SaveData, g: ItemInstance, defId: string, rarity: ItemInstance['rarity'] = 'common') {
  const m = makeMod(defId, rarity, g.itemLevel)
  addItem(save, m)
  return attachMod(save, g.uid, m.uid)
}

describe('특수 부품: 도탄 · 뭉게뭉게 · 관통 · 쪽쪽', () => {
  it('새로 나오는 총은 도탄·뭉게·관통 옵션을 굴리지 않고, 재굴림 후보에도 없다', () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 400; i += 1) {
      const g = makeItem(['gun_water', 'gun_bubble', 'gun_star', 'gun_dart'][i % 4], 'legendary', rng, 12)
      for (const a of g.affixes) expect(['ricochet', 'fluff', 'pierce']).not.toContain(a.id)
      for (const spec of rerollChoices(g, 0)) expect(['ricochet', 'fluff', 'pierce']).not.toContain(spec.id)
    }
  })

  it('부품이 없는 물총은 별도 구름도 안 나오고, 도탄 부품을 끼우면 7발마다 별이 튄다', () => {
    const save = rich()
    const g = gun(save)
    const s0 = computeStats(save)
    expect(s0.starShot).toBe(0)
    expect(s0.cloud).toBe(0)
    expect(Array.from({ length: 70 }, (_, i) => rollStar(i + 1, s0.starShot, 0.99)).some(Boolean)).toBe(false)
    expect(rollCloud(true, s0.cloud, 0)).toBe(false)
    expect(fit(save, g, TRICK_PART.star).ok).toBe(true)
    const s1 = computeStats(save)
    expect(s1.starShot).toBeGreaterThan(0.05)
    expect(Array.from({ length: 70 }, (_, i) => rollStar(i + 1, s1.starShot, 0.99)).filter(Boolean).length).toBe(10)
  })

  it('별똥 점사총과 방울 샷건은 부품 없이도 제 맛(별 · 구름)을 낸다', () => {
    const a = rich()
    gun(a, 'gun_star')
    expect(computeStats(a).starShot).toBeGreaterThan(0)
    const b = rich()
    gun(b, 'gun_bubble')
    expect(computeStats(b).cloud).toBeGreaterThan(0)
  })

  it(`특수 부품은 서로 다른 것 ${MAX_TRICKS}개까지, 같은 부품은 바꿔 끼워진다`, () => {
    const save = rich()
    const g = gun(save, 'gun_water', 'legendary', 12)
    expect(fit(save, g, TRICK_PART.star).ok).toBe(true)
    expect(fit(save, g, TRICK_PART.cloud).ok).toBe(true)
    const third = fit(save, g, TRICK_PART.pierce)
    expect(third.ok).toBe(false)
    expect(third.reason).toContain('특수 부품')
    const swap = fit(save, g, TRICK_PART.star, 'rare')
    expect(swap.ok).toBe(true)
    expect(swap.swapped?.defId).toBe(TRICK_PART.star)
    expect(gunMods(g).filter((m) => m.defId.startsWith('mod_trick')).length).toBe(2)
    // 다른 종류 부품은 그대로 함께 들어간다.
    expect(fit(save, g, 'mod_scope').ok).toBe(true)
  })

  it('관통 부품은 1마리 더, 영웅부터 2마리 더 꿰뚫고 이름표·툴팁에 숫자가 보인다', () => {
    const save = rich()
    const g = gun(save, 'gun_water', 'epic')
    const before = computeStats(save).pierce
    expect(makeMod(TRICK_PART.pierce, 'rare', 10).affixes[0].value).toBe(1)
    expect(makeMod(TRICK_PART.pierce, 'epic', 10).affixes[0].value).toBe(2)
    expect(fit(save, g, TRICK_PART.pierce).ok).toBe(true)
    expect(computeStats(save).pierce).toBe(before + 1)
    const part = makeMod(TRICK_PART.star, 'rare', 10)
    expect(modLabel(part)).toBe('특수 · 도탄')
    expect(itemLines(part).join('\n')).toMatch(/%/)
  })

  it('조합: 도탄+뭉게 = 통통 솜사탕, 별똥 점사총+관통 = 꿰뚫는 별똥, 솜사탕 교란기 = 달콤 구름', () => {
    const save = rich()
    const g = gun(save, 'gun_water', 'legendary', 12)
    fit(save, g, TRICK_PART.star)
    fit(save, g, TRICK_PART.cloud)
    expect(gunCombos(g).map((c) => c.id)).toEqual(['fluffstar'])
    const s2 = rich()
    const r = gun(s2, 'gun_star', 'rare')
    fit(s2, r, TRICK_PART.pierce)
    expect(gunCombos(r).map((c) => c.id)).toContain('piercestar')
    expect(gunTraits(makeLegend('leg_cotton', 10)).has('sip')).toBe(true)
    expect(gunCombos(makeLegend('leg_cotton', 10)).map((c) => c.id)).toContain('sweetcloud')
    for (const c of COMBOS) expect(c.text.length).toBeGreaterThan(8)
  })

  it('부품을 끼우면 총 옆에 효과 장식(참)이 달린다', () => {
    const save = rich()
    const g = gun(save, 'gun_water', 'legendary', 12)
    fit(save, g, TRICK_PART.star)
    fit(save, g, TRICK_PART.cloud)
    expect(gunLookWithMods(WATER_LOOK, g).tricks?.length).toBe(2)
  })
})

function bodies(n: number, log: { id: string; amount: number; slow: number }[]): SkillBody[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    x: 3 + i * 1.2,
    z: 0,
    r: 0.5,
    tone: 'n' as const,
    hit: (amount: number, _dx: number, _dz: number, _k: number, slow: number) => {
      log.push({ id: `f${i}`, amount, slow })
      return false
    },
  }))
}

function juiceWith(combos: ComboId[]) {
  const healed: number[] = []
  const j = new Juice({ vfx, lowPower: false, number: () => {}, heal: (n) => healed.push(n) })
  j.combos = new Set(combos)
  return { j, healed }
}

function run(j: Juice, world: JuiceWorld, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) j.update(1 / 60, world)
}

describe('부품 조합이 보이는 효과를 바꾼다', () => {
  it('통통 솜사탕: 별이 몹에 맞으면 작은 구름이 핀다', () => {
    const log: { id: string; amount: number; slow: number }[] = []
    const b = bodies(3, log)
    const { j } = juiceWith(['fluffstar'])
    j.star(new Vector3(0, 1.1, 0), new Vector3(1, 0, 0), 20)
    run(j, { ...open, bodies: () => b }, 0.3)
    expect(j.live.clouds).toBe(1)
    expect(j.comboHits).toBeGreaterThan(0)
    const plain = juiceWith([]).j
    plain.star(new Vector3(0, 1.1, 0), new Vector3(1, 0, 0), 20)
    run(plain, { ...open, bodies: () => b }, 0.3)
    expect(plain.live.clouds).toBe(0)
  })

  it('꿰뚫는 별똥: 별이 더 많이 튀고 더 아프다', () => {
    const count = (combos: ComboId[]) => {
      const log: { id: string; amount: number; slow: number }[] = []
      const b = bodies(9, log)
      const { j } = juiceWith(combos)
      j.star(new Vector3(0, 1.1, 0), new Vector3(1, 0, 0), 20)
      run(j, { ...open, bodies: () => b }, 2)
      return { hits: log.length, top: Math.max(...log.map((l) => l.amount)) }
    }
    const plain = count([])
    const pierce = count(['piercestar'])
    expect(pierce.hits).toBeGreaterThan(plain.hits)
    expect(pierce.top).toBeGreaterThan(plain.top)
  })

  it('서리 구름은 몹을 훨씬 오래 느리게 하고, 달콤 구름은 피해의 일부만큼 회복한다', () => {
    const log: { id: string; amount: number; slow: number }[] = []
    const b = bodies(1, log)
    const { j, healed } = juiceWith(['frostcloud', 'sweetcloud'])
    j.cloud(new Vector3(b[0].x, 1, b[0].z), 40)
    run(j, { ...open, bodies: () => b }, JUICE.cloudLife)
    expect(log.length).toBeGreaterThan(2)
    expect(Math.min(...log.map((l) => l.slow))).toBeGreaterThan(0.5)
    expect(healed.length).toBe(log.length)
    expect(healed.reduce((a, n) => a + n, 0)).toBeLessThan(log.reduce((a, l) => a + l.amount, 0) * 0.5)
  })
})

describe('예전 저장 옮기기', () => {
  function oldSave(): { save: SaveData; g: ItemInstance; spare: ItemInstance } {
    const save = rich()
    // 예전 저장: 선물 플래그도, 시작 총 부품도 없었다.
    delete save.flags[PARTS_GIFT_FLAG]
    const g = gun(save, 'gun_water', 'rare', 8)
    g.affixes = [
      { id: 'power', name: '힘찬', stat: 'damage', value: 0.08 },
      { id: 'ricochet', name: '통통 튀는', stat: 'starShot', value: 0.09 },
      { id: 'fluff', name: '몽실몽실', stat: 'cloud', value: 0.07 },
    ]
    const spare = makeItem('gun_dart', 'common', mulberry32(2), 6)
    spare.affixes = [{ id: 'pierce', name: '꿰뚫는', stat: 'pierce', value: 1 }]
    townOf(save).stash.push(spare)
    return { save, g, spare }
  }

  it('도탄·뭉게·관통 옵션은 같은 등급의 특수 부품이 되어 총에 끼워지고(칸이 없으면 가방), 다른 옵션은 그대로다', () => {
    const { save, g, spare } = oldSave()
    const r = migrateParts(save)
    expect(r.converted).toBe(3)
    expect(g.affixes.map((a) => a.id)).toEqual(['power'])
    expect(gunMods(g).map((m) => m.defId).sort()).toEqual([TRICK_PART.cloud, TRICK_PART.star].sort())
    expect(gunMods(g).every((m) => m.rarity === 'rare' && m.itemLevel === 8)).toBe(true)
    expect(gunMods(spare).map((m) => m.defId)).toEqual([TRICK_PART.pierce])
    expect(spare.affixes).toEqual([])
    // 효과는 그대로 남는다.
    expect(computeStats(save).starShot).toBeGreaterThan(0)
    expect(computeStats(save).cloud).toBeGreaterThan(0)
  })

  it('칸이 모자라면 가방으로, 전설은 고유 옵션을 그대로 지킨다', () => {
    const save = rich()
    const g = gun(save, 'gun_water', 'common', 3)
    g.affixes = [
      { id: 'ricochet', name: '통통 튀는', stat: 'starShot', value: 0.09 },
      { id: 'fluff', name: '몽실몽실', stat: 'cloud', value: 0.07 },
    ]
    const leg = makeLegend('leg_starrain', 10)
    addItem(save, leg)
    const before = JSON.stringify(leg.affixes)
    migrateParts(save)
    expect(gunMods(g).length).toBe(1)
    expect(bagItems(save).some((i) => i.defId === TRICK_PART.cloud)).toBe(true)
    expect(JSON.stringify(leg.affixes)).toBe(before)
  })

  it('한 번만 도탄·뭉게 부품 선물을 주고, 두 번 돌려도 같은 결과다', () => {
    const { save } = oldSave()
    const a = migrateSave(save)
    expect(a.parts.gifted).toBe(2)
    expect(save.flags[PARTS_GIFT_FLAG]).toBe(true)
    const n = save.items.length
    const b = migrateSave(save)
    expect(b.parts).toEqual({ converted: 0, gifted: 0 })
    expect(save.items.length).toBe(n)
  })

  it('갓 시작한 저장(1레벨, 시작 총만)은 선물 없이 플래그만 선다', () => {
    const save = freshSave()
    delete save.flags[PARTS_GIFT_FLAG]
    const r = migrateParts(save)
    expect(r.gifted).toBe(0)
    expect(save.flags[PARTS_GIFT_FLAG]).toBe(true)
  })
})

describe('밸런스: 특수 부품과 조합이 초당 피해를 터뜨리지 않는다', () => {
  it('부품 없는 총은 효과 피해 0, 꽉 채운 조합도 예전 최대치를 크게 넘지 않는다', () => {
    expect(juiceShare(0, 0, 0.2)).toBe(0)
    // 예전 최대: 모든 총이 기본 별·구름 + 옵션 상한(조합 없음).
    const oldMax = juiceShare(STAT_CAPS.starShot, STAT_CAPS.cloud, 0.45, [], 3)
    const all: ComboId[] = ['fluffstar', 'piercestar', 'sparkstar']
    const newMax = juiceShare(STAT_CAPS.starShot, STAT_CAPS.cloud, 0.45, all, 3)
    expect(newMax).toBeLessThan(oldMax * 1.3)
    // 흔한 구성(보통 도탄 + 뭉게, iLv 10): 예전 '옵션 하나'짜리 총과 비슷한 맛.
    const part = makeMod(TRICK_PART.star, 'common', 10).affixes[0].value
    const typical = juiceShare(part, part, 0.2, ['fluffstar'])
    const oldTypical = juiceShare(0.09, 0.0001, 0.2)
    expect(typical).toBeLessThan(oldTypical * 1.6)
    expect(typical).toBeGreaterThan(0)
  })
})
