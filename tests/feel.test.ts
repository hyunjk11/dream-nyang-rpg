import { describe, expect, it } from 'vitest'
import { HAND_LIFT, cameraFocus, gripPoint, gunInFront, muzzlePoint } from '../src/game/rig'

describe('조준과 카메라', () => {
  it('총은 발보다 위에 있고 총구는 조준 방향으로 나간다', () => {
    const feet = { x: 400, y: 500 }
    for (const aim of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -2]) {
      const grip = gripPoint(feet.x, feet.y, aim)
      expect(grip.y).toBeLessThan(feet.y - HAND_LIFT + 20)
      expect(grip.y).toBeLessThan(feet.y - 40)
      for (const key of ['gun_water', 'gun_bubble', 'gun_dart']) {
        const tip = muzzlePoint(feet.x, feet.y, aim, key)
        const along = (tip.x - grip.x) * Math.cos(aim) + (tip.y - grip.y) * Math.sin(aim)
        expect(along).toBeGreaterThan(24)
      }
    }
  })

  it('위를 보면 총이 몸 뒤로 가고, 카메라는 별하 몸통을 본다', () => {
    expect(gunInFront(-Math.PI / 2)).toBe(false)
    expect(gunInFront(Math.PI / 2)).toBe(true)
    expect(gunInFront(0)).toBe(true)
    const focus = cameraFocus(400, 500, 0, 168)
    const mochi = { x: 400 - 72, y: 500 }
    const torso = { x: 400, y: 500 - 168 * 0.42 }
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    expect(dist(focus, torso)).toBeLessThan(dist(focus, mochi))
    expect(focus.y).toBeLessThan(480)
    expect(focus.x).toBeGreaterThan(400)
  })
})
