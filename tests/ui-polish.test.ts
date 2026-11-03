import { describe, expect, it } from 'vitest'
import { hintHtml } from '../src/ui/help'

const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const main = read('../src/main.ts')
const html = read('../index.html')

describe('UI 다듬기', () => {
  it('조작 힌트는 항목마다 키 칩 하나', () => {
    const out = hintHtml('WASD 이동 · I 가방 · M 지도 · T 귀환')
    expect(out.match(/class="hk"/g)).toHaveLength(4)
    expect(out).toContain('<kbd>WASD</kbd>이동')
    expect(out).toContain('<kbd>T</kbd>귀환')
  })
  it('키가 없는 항목도 칩으로, HTML은 이스케이프', () => {
    const out = hintHtml('<b>위험</b> 표시')
    expect(out).not.toContain('<b>')
    expect(out).toContain('&lt;b&gt;')
  })
  it('몽실 마을 힌트는 T 귀환 대신 E 별문', () => {
    expect(main).toMatch(/inMongsil\(\) \? \(stage\.touch \? '' : ' · M 지도 · E 별문'\)/)
  })
  it('가방에 도감 버튼이 있음', () => {
    expect(html).toContain('id="inv-codex"')
    expect(main).toMatch(/codex: \(\) => \{\s*townUI\.open\('codex'\)/)
  })
})
