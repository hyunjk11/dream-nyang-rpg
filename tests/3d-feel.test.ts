import { describe, expect, it } from 'vitest'
import { AIM_LEAD, CAMERA_PITCH_DEG, MASTER_DEFAULT, cameraOffset, cameraRelativeWish, focusPoint, sliceTimes } from '../src/3d/feel'

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
  })

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
