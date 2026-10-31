import { describe, expect, it } from 'vitest'
import { MATERIAL_HELP, MATERIAL_KO } from '../src/data/items'
import { TREE } from '../src/data/tree'
import { SKILL_ICON_IDS, skillSvg } from '../src/ui/skillicons'
import { HELP_KEYS } from '../src/ui/help'
import { LIVE_CAP } from '../src/world/dungeon/waves'

const HANJA = /[\u4e00-\u9fff]/

describe('잔손질: 스킬 아이콘과 글자', () => {
  it('스킬 15개 모두 그림 아이콘이 있다', () => {
    expect(TREE.length).toBe(15)
    for (const s of TREE) {
      expect(SKILL_ICON_IDS).toContain(s.id)
      expect(skillSvg(s.id)).toMatch(/^<svg/)
    }
  })

  it('스킬 이름·글자에 한자가 없다', () => {
    for (const s of TREE) {
      expect(s.glyph).not.toMatch(HANJA)
      expect(s.name).not.toMatch(HANJA)
      expect(skillSvg(s.id)).not.toMatch(HANJA)
    }
  })
})

describe('잔손질: 도움말과 재료 설명', () => {
  it('도움말에 H·M·T와 가방·스킬 키가 모두 있다', () => {
    const keys = HELP_KEYS.map(([k]) => k).join(' ')
    for (const k of ['H', 'M', 'T', 'I', 'K', 'Q', 'G', 'Space', 'WASD', 'Esc']) expect(keys).toContain(k)
  })

  it('재료마다 어디서 나오고 어디에 쓰는지 설명이 있다', () => {
    for (const id of Object.keys(MATERIAL_KO)) {
      expect(MATERIAL_HELP[id]).toBeTruthy()
      expect(MATERIAL_HELP[id]).toMatch(/써|필요/)
    }
  })
})

describe('잔손질: 성능', () => {
  it('보스 층 동시 생존 괴물 상한은 70', () => {
    expect(LIVE_CAP).toBe(70)
  })
})
