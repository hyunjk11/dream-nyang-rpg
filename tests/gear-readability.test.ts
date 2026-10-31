import { describe, expect, it } from 'vitest'
import { GEAR_AFFIX } from '../src/data/affixes'
import { ITEMS, SHOP } from '../src/data/items'
import { addItem } from '../src/sim/inventory'
import { powerVsWorn } from '../src/sim/inventory'
import { itemName, itemNameParts, itemPower, makeItem, rollAffixes } from '../src/sim/loot'
import { freshSave, tryEquip } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { ICON_KEYS, iconSvg } from '../src/ui/icons'
import { itemShape } from '../src/world/dungeon/loot-view'
import { wearMesh } from '../src/actors/wear'
import type { ItemInstance } from '../src/sim/types'

const bases = Object.values(ITEMS)

describe('장비 구분: 아이콘과 이름', () => {
  it('17개 기본 장비마다 서로 다른 그림 아이콘이 있다', () => {
    expect(bases.length).toBe(17)
    const icons = new Set(bases.map((d) => d.icon))
    expect(icons.size).toBe(17)
    for (const d of bases) {
      expect(ICON_KEYS).toContain(d.icon)
      expect(iconSvg(d.icon)).toMatch(/^<svg/)
    }
  })

  it('접두어와 접미어가 이름에 붙고, 강화 수치는 맨 뒤에 온다', () => {
    const item: ItemInstance = { ...makeItem('gun_water', 'rare', mulberry32(3), 5), plus: 3 }
    const parts = itemNameParts(item)
    expect(parts.base).toBe('별빛 물총')
    expect(parts.prefix.length).toBeGreaterThan(0)
    expect(parts.suffix).toMatch(/의$/)
    expect(itemName(item)).toBe(`${parts.prefix} ${parts.suffix} 별빛 물총 +3`)
  })

  it('상점 이름은 아이템 표의 이름과 같다', () => {
    for (const entry of SHOP) {
      if (entry.kind !== 'item' || !entry.defId) continue
      expect(entry.name).toBe(ITEMS[entry.defId].name)
    }
  })
})

describe('장비 구분: 능력치 폭과 파워', () => {
  it('모자·옷·신발·장신구 기본치가 정해진 폭 안에 있다', () => {
    for (const d of bases) {
      const s = d.stats ?? {}
      if (d.slot === 'hat') {
        expect(s.hp).toBeGreaterThanOrEqual(20)
        expect(s.hp).toBeLessThanOrEqual(40)
        expect(s.armor).toBeGreaterThanOrEqual(0.03)
        expect(s.armor).toBeLessThanOrEqual(0.06)
      }
      if (d.slot === 'outfit') {
        expect(s.hp).toBeGreaterThanOrEqual(35)
        expect(s.hp).toBeLessThanOrEqual(70)
      }
      if (d.slot === 'shoes') {
        expect(s.moveSpeed).toBeGreaterThanOrEqual(0.06)
        expect(s.moveSpeed).toBeLessThanOrEqual(0.1)
      }
    }
  })

  it('방어구 옵션은 총보다 1.6배 크게 굴러간다', () => {
    expect(GEAR_AFFIX).toBe(1.6)
    const a = rollAffixes('hat', 'legendary', mulberry32(9), 1)
    const b = rollAffixes('weapon', 'legendary', mulberry32(9), 1)
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBe(a.length)
  })

  it('희귀도·레벨이 높을수록 파워가 커진다', () => {
    const lo = makeItem('hat_beret', 'common', mulberry32(1), 1)
    const hi = makeItem('hat_beret', 'epic', mulberry32(1), 10)
    expect(itemPower(hi)).toBeGreaterThan(itemPower(lo))
    expect(itemPower(makeItem('gun_dart', 'rare', mulberry32(2), 5))).toBeGreaterThan(0)
  })

  it('입은 장비와 비교해 ▲▼ 값을 주고, 입은 것은 비교하지 않는다', () => {
    const save = freshSave()
    const worn = makeItem('hat_pin', 'common', mulberry32(4), 1)
    const better = makeItem('hat_beret', 'epic', mulberry32(5), 8)
    addItem(save, worn, true)
    addItem(save, better, true)
    expect(tryEquip(save, worn.uid).ok).toBe(true)
    const delta = powerVsWorn(save, better, itemPower)
    expect(delta).not.toBeNull()
    expect(delta!).toBeGreaterThan(0)
    expect(powerVsWorn(save, worn, itemPower)).toBeNull()
  })
})

describe('장비 구분: 바닥과 별하 몸', () => {
  it('바닥에 떨어진 장비는 종류별 모양을 가진다', () => {
    expect(itemShape('gun_star')).toBe('gun')
    expect(itemShape('hat_beret')).toBe('hat')
    expect(itemShape('hat_pin')).toBe('pin')
    expect(itemShape('outfit_cape')).toBe('outfit')
    expect(itemShape('shoes_boots')).toBe('shoes')
    expect(itemShape('acc_ring')).toBe('band')
    expect(itemShape('collar_bell')).toBe('collar')
  })

  it('모자·옷·신발은 별하 몸에 붙는 메쉬가 있다', () => {
    for (const d of bases) {
      if (d.slot !== 'hat' && d.slot !== 'outfit' && d.slot !== 'shoes') continue
      const built = wearMesh(d.id, 'rare', 0.13)
      expect(built, d.id).not.toBeNull()
      expect(built!.anchor).toBe(d.slot === 'hat' ? 'head' : d.slot === 'outfit' ? 'neck' : 'feet')
      expect(built!.mesh.children.length).toBeGreaterThan(0)
    }
  })
})
