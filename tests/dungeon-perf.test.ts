import { describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three'
import { BUDGET, FREEZE_SCALE, GAP, HitStop, MAX_STOP } from '../src/core/hitstop'
import { SwapPool } from '../src/core/pool'
import { DETAIL, HIGH_FPS, LOW_FPS, Quality, UP_AFTER, WINDOW, freshQuality, qualityStep } from '../src/core/quality'
import { RING_CAP, Vfx } from '../src/core/vfx'
import { TtlCache } from '../src/ui/layout'
import { hitStopFor } from '../src/combat/gunfeel'

const FRAME = 1 / 60

/** Plays `seconds` of 60 FPS frames and returns game seconds that passed. */
function play(stop: HitStop, seconds: number, everyFrame?: (i: number) => void): number {
  let game = 0
  const n = Math.round(seconds / FRAME)
  for (let i = 0; i < n; i += 1) {
    everyFrame?.(i)
    game += FRAME * stop.step(FRAME)
  }
  return game
}

describe('히트스톱 시간 복구', () => {
  it('멈춤이 끝나면 시간 배율이 반드시 1로 돌아온다', () => {
    const stop = new HitStop()
    expect(stop.request(0.05)).toBe(true)
    expect(stop.step(FRAME)).toBeCloseTo(FREEZE_SCALE, 5)
    play(stop, 0.2)
    expect(stop.active).toBe(false)
    expect(stop.step(FRAME)).toBe(1)
  })

  it('멈춤은 겹쳐도 쌓이지 않고 최대 길이를 넘지 않는다', () => {
    const stop = new HitStop()
    stop.request(0.16)
    stop.request(0.16)
    stop.request(5)
    expect(stop.left).toBeLessThanOrEqual(MAX_STOP)
  })

  it('프레임 중간에 끝나는 멈춤은 그 부분만 느리게 한다', () => {
    const stop = new HitStop()
    stop.request(0.01)
    const scale = stop.step(0.02)
    expect(scale).toBeCloseTo((0.01 * FREEZE_SCALE + 0.01) / 0.02, 5)
    expect(stop.step(0.02)).toBe(1)
  })

  it('치명타 난사(매 프레임 요청)에도 게임 시간이 90% 이상 흐른다', () => {
    const stop = new HitStop()
    const regularCrit = hitStopFor({ crit: true })
    const regularKill = hitStopFor({ kill: true })
    const game = play(stop, 60, (i) => stop.request(i % 3 === 0 ? regularKill : regularCrit))
    expect(game / 60).toBeGreaterThan(0.9)
  })

  it('예전 방식(최대값 갱신)이라면 같은 난사에서 시간이 크게 느려졌다', () => {
    // The bug: every hit re-armed max(stop, s), so frames ran at 0.08× nearly back to back.
    let left = 0
    let game = 0
    for (let i = 0; i < 3600; i += 1) {
      left = Math.max(left, i % 3 === 0 ? 0.022 : 0.012)
      let dt = FRAME
      if (left > 0) {
        left -= FRAME
        dt *= 0.08
      }
      game += dt
    }
    expect(game / 60).toBeLessThan(0.5)
  })

  it('작은 멈춤은 직전 멈춤 뒤 간격 안에서는 무시되지만 큰 멈춤(엘리트/보스 처치)은 항상 걸린다', () => {
    const stop = new HitStop()
    stop.request(0.02)
    play(stop, 0.05)
    expect(stop.active).toBe(false)
    expect(stop.request(0.02)).toBe(false)
    expect(stop.request(hitStopFor({ boss: true, kill: true }))).toBe(true)
    play(stop, 0.3)
    // The heavy freeze also filled the budget; it drains within a couple of seconds.
    play(stop, 2)
    expect(stop.request(0.02)).toBe(true)
  })

  it('예산이 다 차면 작은 멈춤은 쉬었다가 다시 허용된다', () => {
    const stop = new HitStop()
    let served = 0
    for (let k = 0; k < 20; k += 1) {
      stop.request(0.04)
      play(stop, GAP + 0.06)
      served = stop.served
    }
    // Over ~7 s, the leaky budget caps freezes to a small share of real time.
    expect(served).toBeLessThan(7 * 0.08 + BUDGET + 0.05)
    stop.clear()
    expect(stop.request(0.02)).toBe(true)
  })
})

describe('파티클·링 풀', () => {
  it('SwapPool은 가득 차도 새 객체를 만들지 않고 재사용한다', () => {
    let made = 0
    const pool = new SwapPool(4, () => ({ id: made++, alive: true }))
    const seen = new Set<object>()
    for (let i = 0; i < 10; i += 1) seen.add(pool.spawn())
    expect(made).toBe(4)
    expect(seen.size).toBe(4)
    expect(pool.count).toBe(4)
    expect(pool.recycled).toBe(6)
  })

  it('죽은 항목은 뒤로 빠지고 산 항목만 앞에 남는다', () => {
    const pool = new SwapPool(6, () => ({ v: 0 }))
    for (let i = 0; i < 6; i += 1) pool.spawn().v = i
    pool.sweep((p) => p.v % 2 === 0)
    expect(pool.count).toBe(3)
    expect(pool.items.slice(0, pool.count).map((p) => p.v).sort()).toEqual([0, 2, 4])
    expect(pool.items.length).toBe(6)
  })

  it('Vfx는 오래 쏴도 파티클 상한을 넘지 않고 링 메시를 다시 쓴다', () => {
    const scene = new Scene()
    const vfx = new Vfx(scene, true)
    const at = new Vector3(0, 1, 0)
    for (let i = 0; i < 2000; i += 1) {
      vfx.hit(at, 0xff88aa, i % 5 === 0)
      if (i % 3 === 0) vfx.poof(at, 0x88ccff)
      vfx.update(FRAME)
    }
    const s = vfx.stats
    expect(s.particles).toBeLessThanOrEqual(s.cap)
    expect(s.rings).toBeLessThanOrEqual(RING_CAP)
    const spam = () => {
      for (let i = 0; i < 400; i += 1) {
        vfx.poof(at, 0x88ccff)
        vfx.poof(at, 0x88ccff)
        vfx.update(FRAME)
      }
    }
    spam()
    const meshesAfter = scene.children.length
    // 2 point clouds + at most RING_CAP pooled rings, and more spam adds nothing.
    expect(meshesAfter).toBeLessThanOrEqual(2 + RING_CAP)
    spam()
    expect(scene.children.length).toBe(meshesAfter)
    for (let i = 0; i < 120; i += 1) vfx.update(FRAME)
    expect(vfx.live).toBe(0)
    expect(vfx.stats.rings).toBe(0)
  })

  it('끝난 예고 원판은 풀로 돌아가 다른 적이 다시 쓴다', () => {
    const scene = new Scene()
    const vfx = new Vfx(scene, true)
    for (let i = 0; i < 50; i += 1) {
      const foe = {}
      vfx.telegraph(foe, 0, 0, 2, 0.5)
      vfx.endTelegraph(foe)
    }
    expect(vfx.stats.telegraphs).toBe(0)
    const discs = scene.children.filter((c) => c.renderOrder === 3)
    expect(discs.length).toBe(1)
  })

  it('품질 밀도가 낮으면 파티클 수가 줄지만 0이 되지는 않는다', () => {
    const vfx = new Vfx(new Scene(), false)
    vfx.density = 0.45
    vfx.burst(new Vector3(), 0xffffff, { count: 20 })
    expect(vfx.live).toBe(9)
    vfx.burst(new Vector3(), 0xffffff, { count: 1 })
    expect(vfx.live).toBe(10)
  })
})

describe('자동 품질', () => {
  const feed = (s: ReturnType<typeof freshQuality>, fps: number, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / fps) s = qualityStep(s, 1 / fps)
    return s
  }

  it('FPS가 떨어지면 단계가 내려가고 회복하면 천천히 올라온다', () => {
    let s = freshQuality()
    s = feed(s, LOW_FPS - 10, WINDOW * 2 + 0.1)
    expect(s.level).toBe(2)
    s = feed(s, HIGH_FPS + 4, WINDOW * (UP_AFTER - 1))
    expect(s.level).toBe(2)
    s = feed(s, HIGH_FPS + 4, WINDOW * 2)
    expect(s.level).toBe(1)
  })

  it('가장 낮은 단계 아래로는 내려가지 않고, 중간 FPS에서는 그대로 둔다', () => {
    let s = feed(freshQuality(), 10, WINDOW * 10)
    expect(s.level).toBe(DETAIL.length - 1)
    const before = s.level
    s = feed(s, (LOW_FPS + HIGH_FPS) / 2, WINDOW * 10)
    expect(s.level).toBe(before)
  })

  it('긴 멈춤(탭 전환)은 측정에서 빠진다', () => {
    const s = qualityStep(freshQuality(), 3)
    expect(s.frames).toBe(0)
  })

  it('끄면 즉시 최고 품질로 돌아간다', () => {
    const applied: number[] = []
    const q = new Quality((l) => applied.push(l))
    for (let i = 0; i < 200; i += 1) q.frame(1 / 15)
    expect(q.level).toBeGreaterThan(0)
    q.setEnabled(false)
    expect(q.level).toBe(0)
    expect(applied.at(-1)).toBe(0)
    q.frame(1 / 5)
    expect(q.level).toBe(0)
  })

  it('단계가 내려갈수록 해상도·파티클이 줄어든다', () => {
    for (let i = 1; i < DETAIL.length; i += 1) {
      expect(DETAIL[i].pr).toBeLessThan(DETAIL[i - 1].pr)
      expect(DETAIL[i].particles).toBeLessThan(DETAIL[i - 1].particles)
      expect(DETAIL[i].shadowEvery).toBeGreaterThanOrEqual(DETAIL[i - 1].shadowEvery)
    }
  })
})

describe('HUD 레이아웃 측정 캐시', () => {
  it('TTL 안에서는 다시 측정하지 않고, 지나거나 비우면 다시 측정한다', () => {
    const cache = new TtlCache<number>(250)
    let n = 0
    const make = () => ++n
    expect(cache.get(0, make)).toBe(1)
    expect(cache.get(100, make)).toBe(1)
    expect(cache.get(249, make)).toBe(1)
    expect(cache.get(250, make)).toBe(2)
    cache.clear()
    expect(cache.get(251, make)).toBe(3)
    expect(cache.misses).toBe(3)
  })
})

describe('들판 버섯 삼각형 예산', () => {
  it('버섯 자리는 상한까지만 고르게 남긴다', async () => {
    const { thinSpots, MUSHROOM_CAP } = await import('../src/world/dungeon/dream')
    const spots = Array.from({ length: 1746 }, (_, i) => i)
    const kept = thinSpots(spots, MUSHROOM_CAP)
    expect(kept.length).toBe(MUSHROOM_CAP)
    expect(new Set(kept).size).toBe(MUSHROOM_CAP)
    // Spread over the whole floor, not just the first rooms.
    expect(kept.at(-1)).toBeGreaterThan(1700)
    expect(thinSpots([1, 2, 3], MUSHROOM_CAP)).toEqual([1, 2, 3])
  })
})
