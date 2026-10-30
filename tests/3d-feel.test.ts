import { describe, expect, it } from 'vitest'
import { AIM_LEAD, AIM_PITCH_MIN, CAMERA_DISTANCE, CAMERA_DISTANCE_MAX, CAMERA_DISTANCE_MIN, CAMERA_PITCH_DEG, HOLD_POSES, MASTER_DEFAULT, UPPER_TWIST_LIMIT, aimPitchDeg, cameraOffset, cameraRelativeWish, characterScreenFraction, clampCameraDistance, focusPoint, sliceTimes, upperTwist } from '../src/3d/feel'
import { ISLAND_RADIUS, WALK_RADIUS, islandBudget, islandPaths, pathEdgeDistance, rimRadius, scatterSpots } from '../src/3d/island'

describe('3D 카메라와 음량', () => {
  it('쿼터뷰는 위에서 내려다보고 별하 앞을 조금 본다', () => {
    const offset = cameraOffset()
    expect(CAMERA_PITCH_DEG).toBeGreaterThan(40)
    expect(CAMERA_PITCH_DEG).toBeLessThan(60)
    expect(offset.y).toBeGreaterThan(Math.hypot(offset.x, offset.z) * 0.8)
    const focus = focusPoint(0, 0, 0, 2, 0, AIM_LEAD)
    const cat = { x: -1.4, z: 0.2 }
    const toFocus = Math.hypot(focus.x, focus.z)
    const focusToCat = Math.hypot(focus.x - cat.x, focus.z - cat.z)
    expect(focus.x).toBeGreaterThan(0.4)
    expect(toFocus).toBeLessThan(focusToCat)
    // Byeolha's silhouette fills about 1/5 to 1/4 of the screen height at the default distance.
    const fraction = characterScreenFraction(CAMERA_DISTANCE)
    expect(fraction).toBeGreaterThanOrEqual(0.2)
    expect(fraction).toBeLessThanOrEqual(0.26)
    // Zoom stays in a readable band both ways.
    expect(characterScreenFraction(CAMERA_DISTANCE_MIN)).toBeLessThan(0.33)
    expect(characterScreenFraction(CAMERA_DISTANCE_MAX)).toBeGreaterThan(0.19)
    expect(clampCameraDistance(1)).toBe(CAMERA_DISTANCE_MIN)
    expect(clampCameraDistance(20)).toBe(CAMERA_DISTANCE_MAX)
  })

  it('조준을 가까이 하면 카메라가 거의 움직이지 않는다', () => {
    const near = focusPoint(0, 0, 0, 0.5, 0)
    const far = focusPoint(0, 0, 0, 8, 0)
    expect(near.x).toBeLessThan(0.2)
    expect(far.x).toBeCloseTo(AIM_LEAD)
  })
})

describe('별하 총 잡기', () => {
  it('모든 클립에서 손이 가슴 앞에 있고 총구가 바닥을 향하지 않는다', () => {
    for (const [state, pose] of Object.entries(HOLD_POSES)) {
      expect(pose.reach.fwd, state).toBeGreaterThan(0.2)
      expect(pose.reach.fwd, state).toBeLessThan(0.5)
      expect(Math.abs(pose.reach.right), state).toBeLessThan(0.16)
      expect(pose.reach.up, state).toBeGreaterThan(-0.15)
      expect(pose.pitch, state).toBeGreaterThan(-10)
    }
    expect(HOLD_POSES.shoot.reach.fwd).toBeGreaterThan(HOLD_POSES.idle.reach.fwd)
    // Aiming at her own feet still keeps the barrel nearly level.
    expect(aimPitchDeg(-1, 0.1, -8)).toBeGreaterThanOrEqual(AIM_PITCH_MIN)
    expect(aimPitchDeg(0, 4, 0)).toBeCloseTo(0)
  })

  it('윗몸 비틀기는 등 뒤로 넘어가지 않는다', () => {
    expect(Math.abs(upperTwist(Math.PI, 0, 1))).toBeLessThanOrEqual(UPPER_TWIST_LIMIT)
    expect(upperTwist(0.4, 0, 0.5)).toBeCloseTo(0.2)
  })
})

describe('3D 입력과 음량', () => {
  it('W는 카메라가 보는 쪽으로 걷는다', () => {
    const wish = cameraRelativeWish(0, 1)
    const back = cameraOffset()
    const dot = wish.x * -back.x + wish.z * -back.z
    expect(dot).toBeGreaterThan(0.9)
  })

  it('기본 음량은 낮고 클립 구간만 남긴다', () => {
    expect(MASTER_DEFAULT).toBeLessThanOrEqual(0.35)
    const sliced = sliceTimes([0, 0.5, 1.2, 2], [0, 1, 2, 3], 1, 0.5, 1.2)
    expect(sliced.times).toEqual([0, 0.7])
    expect(sliced.values).toEqual([1, 2])
  })
})

describe('꿈섬 바닥', () => {
  it('저전력 경로는 장식 수와 텍스처를 줄인다', () => {
    const low = islandBudget(true)
    const high = islandBudget(false)
    for (const key of Object.keys(low) as (keyof typeof low)[]) expect(low[key], key).toBeLessThanOrEqual(high[key])
    expect(low.texture).toBeLessThan(high.texture)
  })

  it('풀과 꽃은 길을 비우고 섬 안에 놓인다', () => {
    const paths = islandPaths()
    const spots = scatterSpots({ count: 200, minR: 0.6, maxR: ISLAND_RADIUS - 0.5, clearPath: 0.1, clearCenter: 0, scale: [1, 1], clumps: 8, seed: 3 }, paths)
    expect(spots.length).toBe(200)
    for (const spot of spots) {
      expect(pathEdgeDistance(spot, paths)).toBeGreaterThanOrEqual(0.1)
      expect(Math.hypot(spot.x, spot.z)).toBeLessThan(ISLAND_RADIUS)
    }
    for (let a = 0; a < Math.PI * 2; a += 0.1) expect(rimRadius(a)).toBeGreaterThan(WALK_RADIUS + 0.5)
  })
})
