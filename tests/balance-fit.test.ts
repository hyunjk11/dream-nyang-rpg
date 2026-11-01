import { describe, expect, it } from 'vitest'
import { DIFFICULTY } from '../src/combat/difficulty'
import { BOSS_FLOOR, depthStep, floorScale, rosterShift } from '../src/sim/delve'
import { urgentFit } from '../src/ui/layout'
import { BANNER_MS } from '../src/ui/screens'

// Node's fs, loaded the same way as in guide-fold.test.ts (no @types/node in this project).
const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const html = read('../index.html')
const css = read('../src/ui/style.css')

describe('깊이 2 진입 완화', () => {
  it('깊이 2의 일반 층은 깊이 한 단계를 조금씩 나눠 받고, 보스층과 깊이 3부터는 그대로다', () => {
    const ease = DIFFICULTY.delve.entryEase
    expect(depthStep(1, 3)).toBe(0)
    expect(depthStep(2, 1)).toBe(ease[0])
    expect(depthStep(2, 2)).toBe(ease[1])
    expect(depthStep(2, 3)).toBe(ease[2])
    expect(depthStep(2, BOSS_FLOOR)).toBe(1)
    expect(depthStep(3, 1)).toBe(2)
    expect(ease[0]).toBeLessThan(ease[1])
    expect(ease[1]).toBeLessThan(ease[2])
    expect(ease[2]).toBeLessThanOrEqual(1)
  })

  it('깊이 2의 3층은 몬스터 종류를 한 단계 늦게 꺼내고, 보스층과 다른 깊이는 그대로다', () => {
    expect(rosterShift(2, 3)).toBe(DIFFICULTY.delve.entryRoster[2])
    expect(rosterShift(2, 3)).toBeLessThan(0)
    expect(rosterShift(2, BOSS_FLOOR)).toBe(0)
    expect(rosterShift(1, 3)).toBe(0)
    expect(rosterShift(3, 3)).toBe(0)
  })

  it('몬스터 체력은 층마다 끊김 없이 오르고, 깊이 2 첫 층의 오름폭이 예전보다 작다', () => {
    let prev = floorScale(1, 1).hp
    for (const [d, f] of [[1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1]]) {
      const hp = floorScale(d, f).hp
      expect(hp).toBeGreaterThan(prev)
      prev = hp
    }
    const old = DIFFICULTY.delve.hpPerDepth
    expect(floorScale(2, 1).hp - floorScale(1, 3).hp).toBeLessThan(old / 2)
  })

  it('보통·어려움의 깊이 3과 보스는 예전 배율 그대로라 계속 도전적이다', () => {
    const k = DIFFICULTY.delve
    expect(floorScale(3, 1).hp).toBeCloseTo(1 + 2 * k.hpPerDepth)
    expect(floorScale(2, BOSS_FLOOR).boss.hp).toBeCloseTo(1 + k.bossHpPerDepth)
    expect(floorScale(2, 1).firstWave).toBe(1 + k.wavesPerDepth)
    expect(floorScale(2, 1).gold).toBeCloseTo(1 + k.goldPerDepth)
  })
})

describe('설정 창 묶음', () => {
  const settings = html.slice(html.indexOf('<div id="settings"'), html.indexOf('<div id="crosshair"'))

  it('전투 · 화면 · 소리 · 조작 네 묶음에 모든 버튼과 슬라이더가 들어 있다', () => {
    const legends = [...settings.matchAll(/<legend>([^<]+)<\/legend>/g)].map((m) => m[1])
    expect(legends).toEqual(['전투', '화면', '소리', '조작'])
    for (const id of ['auto-aim', 'auto-candy', 'auto-sell', 'fps-toggle', 'auto-quality', 'mute', 'vol', 'bgm', 'sens', 'alt-mode', 'guide-skip']) expect(settings).toContain(`id="${id}"`)
  })

  it('작은 화면에서는 두 칸 격자로 접고 터치 버튼은 44px을 지킨다', () => {
    expect(css).toMatch(/body\.compact \.set-group \{[^}]*grid-template-columns: 1fr 1fr/)
    expect(css).toMatch(/body\.touch[^{]*#settings button[^{]*\{[^}]*min-height: 44px/)
  })
})

describe('토스트와 조준선', () => {
  const node = (id: string, cls = '', inTc = true) => ({ id, classList: { contains: (c: string) => cls.split(' ').includes(c) }, inTc })
  const tc = { contains: (n: { inTc?: boolean }) => !!n.inTc } as unknown as Node
  const rec = (type: string, target: object, extra: Partial<{ addedNodes: unknown[]; oldValue: string | null }> = {}) =>
    ({ type, target, addedNodes: extra.addedNodes ?? [], oldValue: extra.oldValue ?? null }) as unknown as Parameters<typeof urgentFit>[0]

  it('위 가운데에 토스트가 새로 붙으면 바로 다시 맞춘다', () => {
    expect(urgentFit(rec('childList', node('toasts'), { addedNodes: [{}] }), tc)).toBe(true)
    expect(urgentFit(rec('childList', node('toasts'), { addedNodes: [] }), tc)).toBe(false)
    expect(urgentFit(rec('childList', node('loot', '', false), { addedNodes: [{}] }), tc)).toBe(false)
  })

  it('숨어 있던 배너가 나타나 토스트를 밀어 내릴 때도 바로 맞추고, 글자만 바뀌면 미룬다', () => {
    expect(urgentFit(rec('attributes', node('zone-banner'), { oldValue: 'hidden' }), tc)).toBe(true)
    expect(urgentFit(rec('attributes', node('zone-banner', 'hidden'), { oldValue: '' }), tc)).toBe(false)
    expect(urgentFit(rec('attributes', node('contract-hud', 'open', false)), tc)).toBe(true)
    expect(urgentFit(rec('characterData', node('wave')), tc)).toBe(false)
  })
})

describe('구역 배너가 끝나면 자리를 비운다', () => {
  it('배너는 애니메이션 길이만큼만 보이고 그 뒤 show가 빠져 토스트 자리를 막지 않는다', () => {
    const m = /#zone-banner\.show \{[^}]*animation: banner ([\d.]+)s/.exec(css)
    expect(m).not.toBeNull()
    const anim = Number(m![1]) * 1000
    expect(BANNER_MS).toBeGreaterThanOrEqual(anim)
    expect(BANNER_MS).toBeLessThan(anim + 500)
  })
})
