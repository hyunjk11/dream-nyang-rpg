import { describe, expect, it } from 'vitest'
import { arenaOf, boxHit, nudgeIn, pocketHome, squeezeVictim, ZONE_OF, zoneFor } from '../src/ui/layout'
import { tipSpot } from '../src/ui/tooltip'

// CSS goes through Vite's CSS pipeline (empty in tests), so read the file itself.
const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const css = fs.readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8')
const html = Object.values(import.meta.glob('../index.html', { query: '?raw', import: 'default', eager: true }))[0] as string

describe('HUD 구역 배치', () => {
  it('지도와 퀘스트 목록은 같은 오른쪽 위 구역에 쌓여 서로 겹치지 않는다', () => {
    expect(ZONE_OF.minimap).toBe('tr')
    expect(ZONE_OF['contract-hud']).toBe('tr')
  })

  it('가이드·토스트·보스 바·층 배너는 모두 가운데 위 구역에 쌓인다', () => {
    for (const id of ['guide', 'toasts', 'bossbar', 'zone-banner', 'wave', 'levelup', 'note']) expect(ZONE_OF[id]).toBe('tc')
  })

  it('조이스틱과 전리품 알림은 왼쪽 아래, 스킬과 버튼은 오른쪽 아래', () => {
    expect(ZONE_OF.stick).toBe('bl')
    expect(ZONE_OF['loot-toasts']).toBe('bl')
    expect(ZONE_OF.hotbar).toBe('br')
    expect(ZONE_OF.actions).toBe('br')
  })

  it('id가 없거나 모르는 요소는 구역에 넣지 않는다', () => {
    expect(zoneFor({ id: 'minimap' } as Element)).toBe('tr')
    expect(zoneFor({ id: 'crosshair' } as Element)).toBeNull()
    expect(zoneFor({ id: '' } as Element)).toBeNull()
  })

  it('가방·사탕 주머니는 작은 화면에선 조이스틱 위, 큰 화면에선 오른쪽 아래', () => {
    expect(pocketHome(true)).toBe('bl')
    expect(pocketHome(false)).toBe('br')
  })

  it('화살표 영역은 위아래 HUD 사이에 들어가고 화면 안에 머문다', () => {
    const a = arenaOf({ w: 1280, h: 720 }, 200, 600)
    expect(a.cy - a.ry).toBeGreaterThanOrEqual(218 - 0.01)
    expect(a.cy + a.ry).toBeLessThanOrEqual(582 + 0.01)
    expect(a.cx - a.rx).toBeGreaterThan(0)
    expect(a.cx + a.rx).toBeLessThan(1280)
  })

  it('HUD가 화면을 거의 다 덮어도 화살표 영역은 최소 크기를 지킨다', () => {
    const a = arenaOf({ w: 360, h: 640 }, 500, 200)
    expect(a.ry).toBeGreaterThanOrEqual(30)
    expect(a.cy).toBeGreaterThan(0)
    expect(a.cy).toBeLessThan(640)
  })
})

describe('안전 영역과 작은 화면 규칙', () => {
  it('노치·홈 바 안전 영역을 HUD 여백에 반영한다', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) expect(css).toContain(`env(safe-area-inset-${side}`)
    expect(html).toContain('viewport-fit=cover')
  })

  it('작은 화면에선 퀘스트를 접는 칩으로 바꾸고 지도를 줄인다', () => {
    expect(css).toMatch(/#quest-chip/)
    expect(css).toMatch(/max-width:\s*600px/)
    expect(css).toMatch(/--map:\s*\d+px/)
  })

  it('카드와 창은 화면 높이를 넘지 않고 스크롤된다', () => {
    expect(css).toMatch(/\.chapter-box[^{]*\{[^}]*max-height/)
    expect(css).toMatch(/overflow(-y)?:\s*auto/)
  })
})

describe('툴팁 위치', () => {
  it('공간이 있으면 커서 오른쪽 아래에 뜬다', () => {
    expect(tipSpot(100, 100, 200, 80, 1280, 720)).toEqual({ left: 114, top: 114 })
  })

  it('오른쪽·아래 끝에선 커서 반대편으로 뒤집혀 화면 안에 남는다', () => {
    const t = tipSpot(1250, 700, 200, 80, 1280, 720)
    expect(t.left + 200).toBeLessThanOrEqual(1280 - 6)
    expect(t.top + 80).toBeLessThanOrEqual(720 - 6)
    expect(t.left).toBe(1250 - 14 - 200)
  })

  it('화면보다 큰 툴팁도 왼쪽 위 여백 6px 안쪽에 고정된다', () => {
    const t = tipSpot(10, 10, 500, 900, 360, 640)
    expect(t.left).toBe(6)
    expect(t.top).toBe(6)
  })
})

describe('작은 화면 맞춤', () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

  it('2px 넘게 겹칠 때만 겹침으로 본다', () => {
    expect(boxHit(box(0, 0, 10, 10), box(9, 9, 20, 20))).toBe(false)
    expect(boxHit(box(0, 0, 10, 10), box(5, 5, 20, 20))).toBe(true)
  })

  it('화살표가 HUD 위에 놓이면 가운데 쪽으로 당겨 비킨다', () => {
    const hud = [box(0, 600, 300, 720)]
    const s = nudgeIn(150, 640, 640, 360, 16, hud)
    expect(s.clear).toBe(true)
    expect(boxHit(box(s.x - 16, s.y - 16, s.x + 16, s.y + 16), hud[0], 0)).toBe(false)
    expect(Math.hypot(s.x - 640, s.y - 360)).toBeLessThan(Math.hypot(150 - 640, 640 - 360))
  })

  it('빈 자리면 화살표 위치를 그대로 둔다', () => {
    expect(nudgeIn(100, 100, 640, 360, 16, [])).toEqual({ x: 100, y: 100, clear: true })
  })

  it('자리가 모자라면 우선순위가 가장 낮은 겹친 조각(오래된 토스트)부터 숨긴다', () => {
    expect(squeezeVictim(['toast-old', 'toast-new', 'banner', 'loot'], new Set(['loot', 'toast-new']))).toBe('toast-new')
    expect(squeezeVictim(['a', 'b'], new Set())).toBeNull()
  })
})
