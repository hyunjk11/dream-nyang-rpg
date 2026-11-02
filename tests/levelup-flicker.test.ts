import { describe, expect, it } from 'vitest'
import { BANNER_MS, LEVELUP_MS } from '../src/ui/screens'

const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/ui/style.css')
const main = read('../src/main.ts')

const animMs = (sel: string, name: string) => {
  const m = new RegExp(`${sel}\\.show \\{[^}]*animation: ${name} ([\\d.]+)s[^}]*forwards`).exec(css)
  expect(m).not.toBeNull()
  return Number(m![1]) * 1000
}

describe('레벨업 깜박임', () => {
  it('밀려난(squeezed) 조각은 display:none이 아니라 숨김+흐름 밖이라, 다시 잴 때 등장 애니메이션이 처음부터 재생되지 않는다', () => {
    const rule = /\.squeezed \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('visibility: hidden')
    expect(rule).toContain('position: absolute')
    expect(rule).not.toContain('display: none')
  })

  it('레벨업 카드와 구역 배너는 애니메이션이 끝나면 show가 빠진다', () => {
    const lvl = animMs('#levelup', 'lvl-pop')
    const ban = animMs('#zone-banner', 'banner')
    expect(LEVELUP_MS).toBeGreaterThanOrEqual(lvl)
    expect(LEVELUP_MS).toBeLessThan(lvl + 500)
    expect(BANNER_MS).toBeGreaterThanOrEqual(ban)
    expect(main).toContain('playOnce(levelEl, LEVELUP_MS)')
  })

  it('레벨업 카드에는 무한 반복 애니메이션이 없다', () => {
    const rules = css.match(/#levelup[^{]*\{[^}]*\}/g) ?? []
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) expect(r).not.toContain('infinite')
  })
})
