import { describe, expect, it } from 'vitest'
import { AIM_PITCH_MIN, HOLD_POSES, MASTER_DEFAULT, UPPER_TWIST_LIMIT, aimPitchDeg, upperTwist } from '../src/3d/feel'
import { ISLAND_RADIUS, WALK_RADIUS, islandBudget, islandPaths, pathEdgeDistance, rimRadius, scatterSpots } from '../src/3d/island'

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

describe('음량', () => {
  it('기본 음량은 낮다', () => {
    expect(MASTER_DEFAULT).toBeLessThanOrEqual(0.35)
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
