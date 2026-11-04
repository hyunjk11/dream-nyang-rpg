import { describe, expect, it } from 'vitest'
import { bigNumber, formatDamage, nearFade, NUM_CLAMP, NUMS, numberPop, numberScaleCap } from '../src/ui/hudfx'
import { RARITIES, RARITY_COLOR, RARITY_KO, UNIQUE_COLOR, UNIQUE_KO } from '../src/sim/types'
import { isUnique, itemColor, itemRarityKo } from '../src/sim/rarity'
import { ITEMS } from '../src/data/items'
import { LEGEND_TAG } from '../src/world/dungeon/loot-view'

// CSS / source text read straight from disk (Vite empties CSS in tests).
const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const readFileSync = (f: string, enc: string): string => fs.readFileSync(new URL(`../${f}`, import.meta.url), enc)
const css = readFileSync('src/ui/style.css', 'utf8')

describe('데미지 숫자: 화면 가득 차지 않게', () => {
  it('데미지 숫자 클래스가 스킬 트리 .skill 카드 규칙과 겹치지 않는다', () => {
    expect(css).not.toMatch(/\.dmg\.(skill|crit|snipe|word|elite|boss|star|candy)\b/)
    expect(css).toMatch(/\.dmg\.k-skill/)
    const src = readFileSync('src/ui/hudfx.ts', 'utf8')
    expect(src).toContain('`dmg k-${kind}`')
    expect(src).not.toMatch(/className = `dmg \$\{kind\}`/)
  })
  it('숫자는 짧은 한국식 표기로 줄어든다 (4.8천, 1.2만, 1.2억)', () => {
    expect(formatDamage(860)).toBe('860')
    expect(formatDamage(4760)).toBe('4.8천')
    expect(formatDamage(1000)).toBe('1천')
    expect(formatDamage(11781)).toBe('1.2만')
    expect(formatDamage(1_234_567)).toBe('123만')
    expect(formatDamage(123_456_789)).toBe('1.2억')
    expect(formatDamage(1234.567)).toBe('1.2천')
    for (const n of [0, 7, 999, 9999, 99_999, 5_000_000, 9e9]) expect(formatDamage(n).length).toBeLessThanOrEqual(5)
  })
  it('화면 기준 크기 제한: 높이 6%/9%, 너비 30%를 넘지 않는다', () => {
    for (const [vw, vh] of [[1280, 720], [360, 640]]) {
      const cap = numberScaleCap(1280, 66, vw, vh, true)
      expect(1280 * cap).toBeLessThanOrEqual(vw * NUM_CLAMP.w + 0.01)
      expect(66 * numberScaleCap(80, 66, vw, vh, false)).toBeLessThanOrEqual(vh * 0.06 + 0.01)
      expect(40 * numberScaleCap(80, 40, vw, vh, true)).toBeLessThanOrEqual(vh * 0.09 + 0.01)
    }
    expect(bigNumber('skill')).toBe(true)
    expect(bigNumber('n')).toBe(false)
  })
  it('팝 애니메이션 최고치는 1.3배로 묶인다', () => {
    for (const punch of [0.45, 1.35, 1.7]) for (const t of [0, 0.05, 0.1, 0.5]) expect(numberPop(t, punch)).toBeLessThanOrEqual(NUM_CLAMP.pop)
    expect(numberPop(0.5, 1.7)).toBe(1)
  })
  it('카메라에 너무 가까운 숫자는 숨기고, 조금 떨어지면 서서히 보인다', () => {
    expect(nearFade(0.5)).toBe(0)
    expect(nearFade(NUM_CLAMP.near)).toBe(0)
    expect(nearFade(1.6)).toBeGreaterThan(0)
    expect(nearFade(1.6)).toBeLessThan(1)
    expect(nearFade(5)).toBe(1)
  })
  it('동시에 뜨는 숫자 수는 16개로 제한된다', () => {
    expect(NUMS).toBeLessThanOrEqual(16)
  })
})

describe('희귀도 색: 보통 흰 · 매직 초록 · 희귀 파랑 · 영웅 보라 · 전설 노랑 · 유니크 주황', () => {
  it('희귀도 이름과 색 사다리', () => {
    expect(RARITIES.map((r) => RARITY_KO[r])).toEqual(['보통', '매직', '희귀', '영웅', '전설'])
    expect(RARITY_COLOR).toEqual({ common: '#f3ece4', uncommon: '#7ee08a', rare: '#6fb2ff', epic: '#c98bff', legendary: '#ffe066' })
    expect(UNIQUE_COLOR).toBe('#ff9a3c')
    expect(UNIQUE_KO).toBe('유니크')
    expect(LEGEND_TAG).toBe(UNIQUE_COLOR)
  })
  it('이름 있는 고정 전설은 유니크로 주황, 랜덤 전설은 전설로 노랑', () => {
    const legendId = Object.keys(ITEMS).find((id) => ITEMS[id].legend)!
    const plainId = Object.keys(ITEMS).find((id) => !ITEMS[id].legend && ITEMS[id].slot)!
    const uniq = { defId: legendId, rarity: 'legendary' as const }
    const rand = { defId: plainId, rarity: 'legendary' as const }
    expect(isUnique(uniq)).toBe(true)
    expect(itemColor(uniq)).toBe('#ff9a3c')
    expect(itemRarityKo(uniq)).toBe('유니크')
    expect(itemColor(rand)).toBe('#ffe066')
    expect(itemRarityKo(rand)).toBe('전설')
  })
  it('UI 문구에 "고정 전설"·"전설 도감"이 남지 않는다', () => {
    for (const f of ['src/main.ts', 'src/ui/town.ts', 'src/sim/loot.ts', 'src/sim/workshop.ts']) {
      const s = readFileSync(f, 'utf8').split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      expect(s, f).not.toMatch(/['`]★? ?고정 전설|전설 도감/)
    }
  })
})
