import { describe, expect, it } from 'vitest'
import { makeItem } from '../src/sim/loot'
import { equipItem } from '../src/sim/inventory'
import { equipOffhand } from '../src/sim/hands'
import { freshSave } from '../src/sim/mutate'
import { HAND_KO, partTarget, wornGun } from '../src/sim/mods'
import { mulberry32 } from '../src/sim/rng'
import type { SaveData } from '../src/sim/types'

const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

function pair(): { save: SaveData; main: string; off: string } {
  const save = freshSave()
  save.gold = 500
  const off = makeItem('gun_water', 'rare', mulberry32(2), 4)
  off.affixes = []
  save.items.push(off)
  expect(equipOffhand(save, off.uid).ok).toBe(true)
  return { save, main: save.equipment.weapon!, off: off.uid }
}

describe('부품을 끼울 총 고르기', () => {
  it('주 손과 보조 손을 각각 가리킨다', () => {
    const { save, main, off } = pair()
    expect(wornGun(save, 'weapon')?.uid).toBe(main)
    expect(wornGun(save, 'offhand')?.uid).toBe(off)
    expect(partTarget(save, 'offhand', true).gun?.uid).toBe(off)
    expect(partTarget(save, 'weapon', true).gun?.uid).toBe(main)
    expect(HAND_KO.offhand).toBe('보조 손')
  })

  it('보조 손이 비면 이유를 말하고, 엄격 모드에선 주 손으로 슬쩍 바꾸지 않는다', () => {
    const save = freshSave()
    const strict = partTarget(save, 'offhand', true)
    expect(strict.gun).toBeNull()
    expect(strict.note).toMatch(/보조 손/)
    const loose = partTarget(save, 'offhand', false)
    expect(loose.gun?.uid).toBe(save.equipment.weapon)
    expect(loose.note).toMatch(/주 손/)
  })

  it('양손 총은 보조 손 대상이 아니다', () => {
    const save = freshSave()
    const sniper = makeItem('gun_dart', 'rare', mulberry32(3), 6)
    save.items.push(sniper)
    expect(equipItem(save, sniper.uid).ok).toBe(true)
    expect(wornGun(save, 'offhand')).toBeNull()
    const strict = partTarget(save, 'offhand', true)
    expect(strict.gun).toBeNull()
    expect(strict.note).toMatch(/양손/)
  })

  it('가방과 공방 UI에 주 손 · 보조 손 큰 버튼이 있다', () => {
    const inv = read('../src/ui/inventory.ts')
    const town = read('../src/ui/town.ts')
    const css = read('../src/ui/style.css')
    expect(inv).toContain("id = `inv-hand-${hand}`")
    expect(inv).toContain('part-target')
    expect(town).toContain("id = `work-hand-${hand}`")
    expect(town).toContain('work-mod-which')
    expect(css).toMatch(/\.hand-pick \{[^}]*min-height: 56px/)
    expect(css).toMatch(/body\.touch \.hand-pick \{[^}]*min-height: 68px/)
    expect(css).toMatch(/body\.touch \.town-mods \.mod-part \{[^}]*min-height: 64px/)
  })
})
