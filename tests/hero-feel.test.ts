import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CAMERA_PITCH_DEG, CAMERA_YAW, cameraOffset, cameraRelativeWish, wrapAngle } from '../src/3d/feel'
import {
  GAIT, KNOCK, MOVE, ORBIT, createOrbit, gaitBlend, gaitRate, knockDecay, knockDistance, legYaw, orbitDrag, orbitStep, turnToward,
} from '../src/3d/motion'

function screenOf(x: number, z: number, yaw: number, pitch = CAMERA_PITCH_DEG): { x: number; y: number } {
  const offset = cameraOffset(yaw, pitch)
  const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 100)
  camera.position.set(offset.x, offset.y, offset.z)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const p = new Vector3(x, 0, z).project(camera)
  return { x: p.x, y: p.y }
}

describe('시점을 돌려도 방향키는 화면 기준', () => {
  const yaws = [0, CAMERA_YAW, Math.PI / 2, 2.2, Math.PI, -2, -0.9]
  const keys: [string, number, number, number, number][] = [
    ['W', 0, 1, 0, 1], ['S', 0, -1, 0, -1], ['A', -1, 0, -1, 0], ['D', 1, 0, 1, 0],
  ]
  for (const yaw of yaws) {
    for (const [name, ax, ay, sx, sy] of keys) {
      it(`yaw ${yaw.toFixed(2)}: ${name}`, () => {
        const wish = cameraRelativeWish(ax, ay, yaw)
        expect(Math.hypot(wish.x, wish.z)).toBeCloseTo(1, 5)
        const s = screenOf(wish.x, wish.z, yaw)
        if (sx !== 0) {
          expect(Math.sign(s.x)).toBe(sx)
          expect(Math.abs(s.y)).toBeLessThan(Math.abs(s.x) * 0.05)
        } else {
          expect(Math.sign(s.y)).toBe(sy)
          expect(Math.abs(s.x)).toBeLessThan(Math.abs(s.y) * 0.05)
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

describe('우클릭 시점 회전', () => {
  it('오른쪽으로 끌면 시야가 오른쪽으로 돈다', () => {
    const o = createOrbit(CAMERA_YAW, CAMERA_PITCH_DEG)
    const right = cameraRelativeWish(1, 0, o.yaw)
    const before = screenOf(right.x * 3, right.z * 3, o.yaw)
    orbitDrag(o, 80, 0)
    for (let i = 0; i < 60; i++) orbitStep(o, 1 / 60)
    const after = screenOf(right.x * 3, right.z * 3, o.yaw)
    // A point on the right drifts left on screen when the view turns right.
    expect(after.x).toBeLessThan(before.x)
    // ...and swings up toward the new forward.
    expect(after.y).toBeGreaterThan(before.y)
  })

  it('피치는 제한되고 부드럽게 따라간다 (점프 없음)', () => {
    const o = createOrbit(0, CAMERA_PITCH_DEG)
    orbitDrag(o, 0, 10000)
    expect(o.pitchTarget).toBe(ORBIT.pitchMax)
    orbitDrag(o, 0, -10000)
    expect(o.pitchTarget).toBe(ORBIT.pitchMin)
    orbitDrag(o, 300, 0)
    const total = Math.abs(o.yawTarget)
    orbitStep(o, 1 / 60)
    expect(Math.abs(o.yaw)).toBeLessThan(total * 0.25)
    for (let i = 0; i < 90; i++) orbitStep(o, 1 / 60)
    expect(o.yaw).toBeCloseTo(o.yawTarget, 3)
  })
})
