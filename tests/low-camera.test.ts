import { describe, expect, it } from 'vitest'
import {
  AIM_REACH_MAX, CAMERA_GROUND_CLEARANCE, CAMERA_MIN_PULL, CAMERA_PITCH_MAX, CAMERA_PITCH_MIN, LOW_VIEW_FROM,
  boomLength, cameraColliders, cameraRig, clampPitch, groundAim, lowViewAmount, wheelStep,
} from '../src/3d/camera'
import { CAMERA_DISTANCE, CAMERA_DISTANCE_MAX, CAMERA_DISTANCE_MIN, CAMERA_FOV, CAMERA_PITCH_DEG, cameraOffset, cameraRelativeWish } from '../src/3d/feel'
import { ORBIT, createOrbit, orbitDrag, orbitStep } from '../src/3d/motion'
import { PLACES } from '../src/3d/places'

const rad = (d: number) => (d * Math.PI) / 180

/** A ray from the camera through a screen row (ndc y), on the camera's vertical centre line. */
function screenRay(yaw: number, pitchDeg: number, zoom: number, ndcY: number) {
  const rig = cameraRig(pitchDeg, zoom)
  const off = cameraOffset(yaw, pitchDeg, rig.distance)
  const o = { x: off.x, y: rig.lookY + off.y, z: off.z }
  // Straight down the view, then tilted up by the row's angle.
  const down = rad(pitchDeg) - Math.atan(ndcY * Math.tan(rad(CAMERA_FOV / 2)))
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  return { o, d: { x: fx * Math.cos(down), y: -Math.sin(down), z: fz * Math.cos(down) } }
}

describe('낮은 시점 피치 제한', () => {
  it('우클릭 드래그로 12°까지 내리고 62°까지 올린다', () => {
    expect(ORBIT.pitchMin).toBe(CAMERA_PITCH_MIN)
    expect(ORBIT.pitchMax).toBe(CAMERA_PITCH_MAX)
    expect(CAMERA_PITCH_MIN).toBeGreaterThanOrEqual(10)
    expect(CAMERA_PITCH_MIN).toBeLessThanOrEqual(15)
    const o = createOrbit(0, CAMERA_PITCH_DEG)
    orbitDrag(o, 0, -100000)
    expect(o.pitchTarget).toBe(CAMERA_PITCH_MIN)
    orbitDrag(o, 0, 100000)
    expect(o.pitchTarget).toBe(CAMERA_PITCH_MAX)
    expect(clampPitch(-30)).toBe(CAMERA_PITCH_MIN)
    expect(clampPitch(90)).toBe(CAMERA_PITCH_MAX)
  })

  it('기본 각도(50°)는 그대로이고 기본 구도도 바뀌지 않는다', () => {
    expect(CAMERA_PITCH_DEG).toBe(50)
    expect(lowViewAmount(CAMERA_PITCH_DEG)).toBe(0)
    expect(cameraRig(CAMERA_PITCH_DEG, CAMERA_DISTANCE)).toEqual({ distance: CAMERA_DISTANCE, lookY: 1.05 })
  })

  it('내려갈수록 카메라는 가까워지고 바라보는 점은 올라간다 (끊김 없이)', () => {
    let prev = cameraRig(LOW_VIEW_FROM, CAMERA_DISTANCE)
    for (let p = LOW_VIEW_FROM - 1; p >= CAMERA_PITCH_MIN; p -= 1) {
      const rig = cameraRig(p, CAMERA_DISTANCE)
      expect(rig.distance).toBeLessThanOrEqual(prev.distance)
      expect(rig.lookY).toBeGreaterThanOrEqual(prev.lookY)
      expect(prev.distance - rig.distance).toBeLessThan(0.25)
      prev = rig
    }
    const low = cameraRig(CAMERA_PITCH_MIN, CAMERA_DISTANCE)
    expect(low.distance).toBeLessThan(4.2)
    // The lens stays well above the grass at the lowest angle, even fully zoomed in.
    const near = cameraRig(CAMERA_PITCH_MIN, CAMERA_DISTANCE_MIN)
    expect(near.lookY + Math.sin(rad(CAMERA_PITCH_MIN)) * near.distance).toBeGreaterThan(1.8)
  })

  it('피치가 바뀌어도 서서히 따라간다', () => {
    const o = createOrbit(0, CAMERA_PITCH_DEG)
    orbitDrag(o, 0, -10000)
    orbitStep(o, 1 / 60)
    expect(CAMERA_PITCH_DEG - o.pitch).toBeLessThan((CAMERA_PITCH_DEG - CAMERA_PITCH_MIN) * 0.25)
    for (let i = 0; i < 90; i++) orbitStep(o, 1 / 60)
    expect(o.pitch).toBeCloseTo(CAMERA_PITCH_MIN, 2)
  })

  it('낮은 시점에서도 이동은 카메라 기준이다 (W = 화면 안쪽)', () => {
    for (const yaw of [0, 0.62, 2, -2.5]) {
      const w = cameraRelativeWish(0, 1, yaw)
      const back = cameraOffset(yaw, CAMERA_PITCH_MIN, 1)
      // Forward is away from the camera on the ground, whatever the pitch.
      expect(w.x * back.x + w.z * back.z).toBeLessThan(0)
      expect(Math.hypot(w.x, w.z)).toBeCloseTo(1, 5)
    }
  })
})

describe('휠 줌과 피치 연동', () => {
  it('최대로 당긴 뒤 더 당기면 시점이 내려가고, 밀면 기본 각도로 돌아온 뒤 멀어진다', () => {
    let s = { zoom: CAMERA_DISTANCE, pitch: CAMERA_PITCH_DEG }
    for (let i = 0; i < 40; i++) s = wheelStep(s, -1)
    expect(s.zoom).toBe(CAMERA_DISTANCE_MIN)
    expect(s.pitch).toBe(CAMERA_PITCH_MIN)
    s = wheelStep(s, 1)
    expect(s.zoom).toBe(CAMERA_DISTANCE_MIN)
    expect(s.pitch).toBeGreaterThan(CAMERA_PITCH_MIN)
    for (let i = 0; i < 40; i++) s = wheelStep(s, 1)
    expect(s.pitch).toBe(CAMERA_PITCH_DEG)
    expect(s.zoom).toBe(CAMERA_DISTANCE_MAX)
  })

  it('우클릭으로 올린 높은 각도는 휠이 건드리지 않는다', () => {
    const s = wheelStep({ zoom: CAMERA_DISTANCE, pitch: 60 }, 1)
    expect(s.pitch).toBe(60)
    expect(s.zoom).toBeGreaterThan(CAMERA_DISTANCE)
  })
})

describe('카메라 충돌 (당겨오기)', () => {
  const colliders = cameraColliders(PLACES)

  it('집 뒤로 카메라가 들어가면 벽 앞까지 당겨진다', () => {
    const house = PLACES.find((p) => p.kind === 'house')!
    // She stands south of the house; the camera behind her (north) would be inside it.
    const f = { x: house.x, y: 1.45, z: house.z + 4 }
    const c = { x: house.x, y: 2.3, z: house.z - 0.5 }
    const full = Math.hypot(c.x - f.x, c.y - f.y, c.z - f.z)
    const len = boomLength(f.x, f.y, f.z, c.x, c.y, c.z, colliders)
    expect(len).toBeLessThan(full)
    // Ends outside the house footprint (plus pad), between her and the wall.
    const t = len / full
    const z = f.z + (c.z - f.z) * t
    expect(z - house.z).toBeGreaterThan(1.85)
  })

  it('아무것도 없으면 그대로, 별문 안을 걸을 때는 무시한다', () => {
    expect(boomLength(0, 1.4, 0, 0, 2.3, 3.6, colliders)).toBeCloseTo(Math.hypot(0.9, 3.6), 5)
    const portal = PLACES.find((p) => p.kind === 'portal')!
    const len = boomLength(portal.x, 1.2, portal.z, portal.x + 0.4, 2, portal.z + 3, colliders)
    expect(len).toBeGreaterThan(CAMERA_MIN_PULL)
  })

  it('지면 아래로는 내려가지 않고, 너무 가까이 붙지도 않는다', () => {
    const len = boomLength(0, 1.2, 0, 0, -1, 4, [])
    const full = Math.hypot(2.2, 4)
    const y = 1.2 + (-1 - 1.2) * (len / full)
    expect(y).toBeGreaterThanOrEqual(CAMERA_GROUND_CLEARANCE - 1e-6)
    const wall = [{ x: 0, z: 1, r: 0.5, y0: 0, y1: 5 }]
    expect(boomLength(0, 1.4, 0, 0, 2, 4, wall)).toBe(CAMERA_MIN_PULL)
  })
})

describe('낮은 시점 조준', () => {
  it('지평선 근처를 가리켜도 조준점은 유한하고 사거리 안이다', () => {
    for (const ndcY of [-0.6, 0, 0.3, 0.5, 0.56, 0.6, 0.9, 1]) {
      const { o, d } = screenRay(0.62, CAMERA_PITCH_MIN, CAMERA_DISTANCE, ndcY)
      const a = groundAim(o.x, o.y, o.z, d.x, d.y, d.z, 0, 0)
      expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true)
      expect(Math.hypot(a.x, a.z)).toBeLessThanOrEqual(AIM_REACH_MAX + 1e-6)
    }
  })

  it('조준 방향은 커서가 가리키는 쪽 (카메라 앞쪽)을 유지한다', () => {
    const yaw = 0.62
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    for (const ndcY of [0.2, 0.55, 0.95]) {
      const { o, d } = screenRay(yaw, CAMERA_PITCH_MIN, CAMERA_DISTANCE, ndcY)
      const a = groundAim(o.x, o.y, o.z, d.x, d.y, d.z, 0, 0)
      const len = Math.hypot(a.x, a.z)
      expect((a.x * fx + a.z * fz) / len).toBeGreaterThan(0.99)
    }
  })

  it('가까운 바닥은 그대로 맞히고, 기본 시점 조준은 바뀌지 않는다', () => {
    const { o, d } = screenRay(0.62, CAMERA_PITCH_DEG, CAMERA_DISTANCE, -0.2)
    const a = groundAim(o.x, o.y, o.z, d.x, d.y, d.z, 0, 0)
    expect(a.clamped).toBe(false)
    const t = (0.05 - o.y) / d.y
    expect(a.x).toBeCloseTo(o.x + d.x * t, 6)
    expect(a.z).toBeCloseTo(o.z + d.z * t, 6)
  })
})
