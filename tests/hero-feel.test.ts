import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { wrapAngle } from '../src/3d/feel'
import {
  GAIT, KNOCK, MOVE, gaitBlend, gaitRate, knockDecay, knockDistance, legYaw, turnToward,
} from '../src/3d/motion'
import { createView, pose, wishFrom } from '../src/3d/tps'

/** The shared shoulder camera at view yaw `yaw`, standing behind her at the origin. */
function shoulderCamera(yaw: number): PerspectiveCamera {
  const p = pose(createView(yaw, 0.1), null, 0, 0, 0, 1 / 60)
  const camera = new PerspectiveCamera(68, 16 / 9, 0.1, 100)
  camera.position.set(p.x, p.y, p.z)
  camera.lookAt(p.x + p.fx, p.y + p.fy, p.z + p.fz)
  camera.updateMatrixWorld()
  return camera
}

describe('시점을 돌려도 방향키는 화면 기준 (숄더 카메라)', () => {
  const yaws = [0, 0.62, Math.PI / 2, 2.2, Math.PI, -2, -0.9]
  const keys: [string, number, number, number, number][] = [
    ['W', 0, 1, 0, 1], ['S', 0, -1, 0, -1], ['A', -1, 0, -1, 0], ['D', 1, 0, 1, 0],
  ]
  for (const yaw of yaws) {
    for (const [name, ax, ay, sx, sy] of keys) {
      it(`yaw ${yaw.toFixed(2)}: ${name}`, () => {
        const wish = wishFrom(ax, ay, yaw)
        expect(Math.hypot(wish.x, wish.z)).toBeCloseTo(1, 5)
        const camera = shoulderCamera(yaw)
        const forward = camera.getWorldDirection(new Vector3()).setY(0).normalize()
        const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
        const along = wish.x * forward.x + wish.z * forward.z
        const side = wish.x * right.x + wish.z * right.z
        if (sx !== 0) {
          expect(Math.sign(side)).toBe(sx)
          expect(Math.abs(along)).toBeLessThan(0.05)
        } else {
          expect(Math.sign(along)).toBe(sy)
          expect(Math.abs(side)).toBeLessThan(0.05)
        }
      })
    }
  }
})

describe('넉백은 프레임에 상관없이 부드럽게 줄어든다', () => {
  function simulate(fps: number, seconds: number): { travelled: number; firstStep: number; speed: number } {
    const dt = 1 / fps
    let v = KNOCK.speed
    let x = 0
    let firstStep = -1
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      // Same order as Hero.update: decay, then integrate.
      v *= knockDecay(dt)
      x += v * dt
      if (firstStep < 0) firstStep = v * dt
    }
    return { travelled: x, firstStep, speed: v }
  }

  it('30fps 와 144fps 의 남은 속도가 같다', () => {
    expect(knockDecay(1 / 30) ** 30).toBeCloseTo(knockDecay(1 / 144) ** 144, 10)
    expect(simulate(30, 0.5).speed).toBeCloseTo(simulate(144, 0.5).speed, 6)
  })

  it('총 이동거리는 거의 같고 짧다 (순간이동 아님)', () => {
    const a = simulate(30, 2).travelled
    const b = simulate(144, 2).travelled
    expect(Math.abs(a - b)).toBeLessThan(0.12)
    expect(b).toBeGreaterThan(0.5)
    expect(b).toBeLessThan(0.9)
    expect(knockDistance()).toBeCloseTo(KNOCK.speed / KNOCK.decay)
  })

  it('한 프레임에 밀리는 거리는 작다', () => {
    expect(simulate(60, 1).firstStep).toBeLessThan(0.12)
    expect(simulate(30, 1).firstStep).toBeLessThan(0.2)
  })

  it('약 0.4초 뒤에는 거의 멈춘다', () => {
    expect(simulate(60, 0.45).speed).toBeLessThan(KNOCK.speed * 0.05)
  })
})

describe('걸음 블렌드', () => {
  it('정지/걷기/달리기 가중치는 합이 1', () => {
    for (const s of [0, 0.3, 1, 2, 3.15, 4, 5.1, 9]) {
      const w = gaitBlend(s)
      expect(w.idle + w.walk + w.run).toBeCloseTo(1, 6)
      for (const v of [w.idle, w.walk, w.run]) expect(v).toBeGreaterThanOrEqual(0)
    }
    expect(gaitBlend(0).idle).toBe(1)
    expect(gaitBlend(MOVE.run).run).toBeGreaterThan(0.9)
  })

  it('보폭 속도는 속도에 따라 늘고, 뒷걸음이면 거꾸로', () => {
    expect(gaitRate(GAIT.walk.speed)).toBeCloseTo(1 / GAIT.walk.cycle, 2)
    expect(gaitRate(MOVE.run)).toBeGreaterThan(gaitRate(MOVE.walk))
    expect(gaitRate(-MOVE.walk)).toBeCloseTo(-gaitRate(MOVE.walk), 6)
    expect(gaitRate(0)).toBe(0)
  })
})

describe('회전', () => {
  it('180도 반대로 돌 때 한 프레임에 휙 돌지 않는다', () => {
    const next = turnToward(0, Math.PI, 1 / 30, MOVE.turnMove, MOVE.turnMoveMax)
    expect(Math.abs(next)).toBeLessThanOrEqual(MOVE.turnMoveMax / 30 + 1e-9)
  })

  it('결국 목표 방향에 도달한다', () => {
    let a = 0
    for (let i = 0; i < 120; i++) a = turnToward(a, 2.5, 1 / 60, MOVE.turnMove, MOVE.turnMoveMax)
    expect(wrapAngle(a - 2.5)).toBeCloseTo(0, 3)
  })

  it('조준 뒤로 걸으면 다리는 조준 방향 (뒷걸음)', () => {
    expect(legYaw(Math.PI, 0)).toBeCloseTo(0, 6)
    const side = legYaw(Math.PI / 2, 0)
    expect(side).toBeCloseTo(MOVE.legOffsetMax, 6)
  })
})
