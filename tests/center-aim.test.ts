import { describe, expect, it } from 'vitest'
import { TPS, createView, overlapsHer, pose, rightOf } from '../src/core/tps'

describe('가운데 조준 카메라', () => {
  it('카메라는 그녀 바로 뒤 위에 있어 화면 가로 가운데에 그녀가 선다', () => {
    for (const yaw of [0, 0.9, -2.2]) {
      const v = createView(yaw, 0.12)
      const c = pose(v, null, 2, 0, -1, 1 / 60)
      const r = rightOf(yaw)
      // 카메라에서 그녀까지의 옆 방향 거리 = 0 (어깨 오프셋 없음).
      expect((2 - c.x) * r.x + (-1 - c.z) * r.z).toBeCloseTo(0, 5)
      expect(c.y).toBeGreaterThan(TPS.height + 0.3)
    }
  })

  it('기본 시선에서는 조준선이 그녀 머리 위로 지나가 가리지 않는다', () => {
    const v = createView(0, 0.12)
    const c = pose(v, null, 0, 0, 0, 1 / 60)
    expect(overlapsHer(c.x, c.y, c.z, c.fx, c.fy, c.fz, 0, 0, 0)).toBe(0)
    // 좁은 통로처럼 붐이 짧아져도 마찬가지.
    const n = createView(0, 0.12)
    n.reach = 0.72
    n.boom = 0.72
    const d = pose(n, null, 0, 0, 0, 1 / 60)
    expect(overlapsHer(d.x, d.y, d.z, d.fx, d.fy, d.fz, 0, 0, 0)).toBe(0)
  })

  it('낮은 천장에 눌려 카메라가 그녀 높이로 내려오면 반투명 처리 값이 올라간다', () => {
    // 그녀 뒤 3 m, 가슴 높이에서 정면을 보면 조준선이 몸을 지난다.
    expect(overlapsHer(0, 1.2, -3, 0, 0, 1, 0, 0, 0)).toBeGreaterThan(0.5)
    // 그녀 뒤가 아니라 앞을 보는 방향이면 0.
    expect(overlapsHer(0, 1.2, 3, 0, 0, 1, 0, 0, 0)).toBe(0)
  })

  it('뒤 벽에 막히면 카메라가 앞으로 당겨지고, 천장에 막히면 덜 올라간다', () => {
    const v = createView(0, 0.12)
    // 뒤쪽 1 m에 벽, 위쪽 0.4 m에 천장.
    const ray = (_ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => {
      const len = Math.hypot(dx, dy, dz)
      const uy = dy / len
      const uz = dz / len
      let best = max
      if (uz < -1e-6) best = Math.min(best, (-1 - oz) / uz)
      if (uy > 1e-6) best = Math.min(best, (TPS.height + 0.4 - oy) / uy)
      return best
    }
    const c = pose(v, ray, 0, 0, 0, 1)
    expect(c.z).toBeGreaterThan(-1)
    expect(c.y).toBeLessThan(TPS.height + 0.4)
  })
})
