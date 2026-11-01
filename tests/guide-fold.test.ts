import { describe, expect, it } from 'vitest'
import { chipText, foldHide, foldPoke, foldStep, foldToggle, foldView, freshFold, FULL_MS, MANUAL_MS, PROGRESS_MS } from '../src/ui/guidefold'
import { aimZone, boxHit, clearOfAim, ZONE_OF } from '../src/ui/layout'
import { HELP_KEYS } from '../src/ui/help'

const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const HEAD = '가이드 13/13 · 깊이 1 악몽 꽃 쓰러뜨리기'

describe('가이드 카드 접기', () => {
  it('새 단계가 시작되면 4~5초 동안 펼쳐졌다가 작은 칩으로 접힌다', () => {
    const s = foldStep(freshFold(), 1000, HEAD, '', false)
    expect(FULL_MS).toBeGreaterThanOrEqual(4000)
    expect(FULL_MS).toBeLessThanOrEqual(5000)
    expect(foldView(s, 1000)).toBe('full')
    expect(foldView(s, 1000 + FULL_MS - 1)).toBe('full')
    expect(foldView(foldStep(s, 1000 + FULL_MS, HEAD, '', false), 1000 + FULL_MS)).toBe('chip')
  })

  it('같은 단계가 계속되면 다시 펼쳐지지 않는다 (계속 떠 있지 않음)', () => {
    let s = foldStep(freshFold(), 0, HEAD, '', false)
    for (let t = 0; t < 60_000; t += 500) s = foldStep(s, t, HEAD, '', false)
    expect(foldView(s, 60_000)).toBe('chip')
  })

  it('진행도가 바뀌면 잠깐만 다시 펼쳐진다', () => {
    let s = foldStep(freshFold(), 0, '가이드 4/13 · 처치', '0/3', false)
    s = foldStep(s, 10_000, '가이드 4/13 · 처치', '1/3', false)
    expect(foldView(s, 10_000)).toBe('full')
    expect(foldView(s, 10_000 + PROGRESS_MS)).toBe('chip')
  })

  it('전투 중에는 새 단계도 진행도도 카드를 펼치지 않고, 전투가 끝나면 펼친다', () => {
    let s = foldStep(freshFold(), 0, HEAD, '', true)
    expect(foldView(s, 0)).toBe('chip')
    s = foldStep(s, 500, HEAD, '1/3', true)
    expect(foldView(s, 500)).toBe('chip')
    s = foldStep(s, 3000, HEAD, '1/3', false)
    expect(foldView(s, 3000)).toBe('full')
    expect(foldView(s, 3000 + FULL_MS)).toBe('chip')
  })

  it('펼쳐진 카드도 전투가 시작되면 바로 접힌다', () => {
    let s = foldStep(freshFold(), 0, HEAD, '', false)
    s = foldStep(s, 1000, HEAD, '', true)
    expect(foldView(s, 1000)).toBe('chip')
  })

  it('J/칩으로 직접 펼치면 전투 중에도 잠깐 보이고, 다시 누르면 접힌다', () => {
    let s = foldStep(freshFold(), 0, HEAD, '', false)
    s = foldStep(s, 10_000, HEAD, '', true)
    s = foldToggle(s, 10_000)
    s = foldStep(s, 10_100, HEAD, '', true)
    expect(foldView(s, 10_100)).toBe('full')
    expect(foldView(s, 10_000 + MANUAL_MS)).toBe('chip')
    s = foldToggle(s, 11_000)
    expect(foldView(s, 11_000)).toBe('chip')
  })

  it('X로 숨기면 다음 단계까지 안 나오고, 다음 단계에서 다시 펼쳐진다', () => {
    let s = foldHide(foldStep(freshFold(), 0, HEAD, '', false))
    expect(foldView(s, 100)).toBe('off')
    s = foldStep(s, 200, HEAD, '1/3', false)
    s = foldPoke(s, 300, false)
    expect(foldView(s, 300)).toBe('off')
    s = foldStep(s, 5000, '가이드 1/13 · 다음', '', false)
    expect(foldView(s, 5000)).toBe('full')
  })

  it('숨긴 뒤에도 J로 다시 볼 수 있다', () => {
    const s = foldToggle(foldHide(foldStep(freshFold(), 0, HEAD, '', false)), 1000)
    expect(foldView(s, 1000)).toBe('full')
  })

  it('별하·모찌 대사는 전투가 아닐 때만 카드를 잠깐 펼친다', () => {
    const s = foldStep(freshFold(), 0, HEAD, '', false)
    expect(foldView(foldPoke(s, 20_000, false), 20_000)).toBe('full')
    expect(foldView(foldPoke(s, 20_000, true), 20_000)).toBe('chip')
  })

  it('칩 글자는 짧게 줄이고 진행도를 붙인다', () => {
    expect(chipText(HEAD, '').length).toBeLessThanOrEqual(26)
    expect(chipText('가이드 4/13 · 처치', '1/3')).toBe('가이드 4/13 · 처치 1/3')
  })
})

describe('조준점 보호 구역', () => {
  const sizes: [number, number][] = [[1920, 1080], [1280, 720], [1024, 768], [844, 390], [768, 1024], [390, 844], [360, 640]]

  it('화면 가운데(조준점)를 감싸고 화면 안에 들어간다', () => {
    for (const [w, h] of sizes) {
      const z = aimZone(w, h)
      expect(z.left).toBeLessThan(w / 2 - 40)
      expect(z.right).toBeGreaterThan(w / 2 + 40)
      expect(z.top).toBeLessThan(h / 2 - 30)
      expect(z.bottom).toBeGreaterThan(h / 2 + 30)
      expect(z.left).toBeGreaterThan(0)
      expect(z.top).toBeGreaterThan(0)
    }
  })

  it('사용자 화면 크기에서 위쪽 가이드 카드 자리(상단 160px)와 겹치지 않는다', () => {
    const card = { left: 400, right: 880, top: 60, bottom: 160 }
    expect(boxHit(card, aimZone(1280, 720), 0)).toBe(false)
  })

  it('가장자리 화살표 타원은 조준 구역을 완전히 감싼다', () => {
    for (const [w, h] of sizes) {
      const z = aimZone(w, h)
      const a = clearOfAim({ cx: w / 2, cy: h / 2, rx: 60, ry: 40 }, z)
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * Math.PI * 2
        const p = { x: a.cx + Math.sin(t) * a.rx, y: a.cy - Math.cos(t) * a.ry }
        const me = { left: p.x - 20, right: p.x + 20, top: p.y - 20, bottom: p.y + 20 }
        expect(boxHit(me, z, 0)).toBe(false)
      }
    }
  })
})

describe('가이드 칩 배치와 키', () => {
  it('접힌 가이드 칩은 왼쪽 위 구역(체력/추적 아래)에 놓인다', () => {
    expect(ZONE_OF['guide-chip']).toBe('tl')
  })

  it('J는 가이드 전용이고 다른 조작에 쓰이지 않는다', () => {
    for (const f of ['../src/core/input.ts', '../src/main.ts', '../src/ui/help.ts', '../src/ui/inventory.ts', '../src/ui/town.ts']) {
      expect(read(f)).not.toMatch(/KeyJ/)
    }
    expect(read('../src/ui/chapters.ts')).toMatch(/KeyJ/)
    expect(HELP_KEYS.some(([k]) => k === 'J')).toBe(true)
  })

  it('가이드 카드에 숨기기(X) 버튼이 있고 클릭할 수 있다', () => {
    const css = read('../src/ui/style.css')
    expect(css).toMatch(/#guide \.guide-x \{[^}]*pointer-events: auto/)
    expect(css).toMatch(/#guide-chip \{[^}]*pointer-events: auto/)
    expect(css).toMatch(/#guide\.hidden, #guide\.cramped \{ display: none !important; \}/)
  })
})
