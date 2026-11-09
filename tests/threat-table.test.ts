import { describe, expect, it } from 'vitest'
import { shotAim } from '../src/world/dungeon/horde'

describe('탄 조준', () => {
  it('서 있으면 발밑을 조준하고, 대시처럼 빠른 속도는 리드가 잘린다', () => {
    const still = shotAim(0, 0, { x: 10, z: 0, vx: 0, vz: 0 }, 16)
    expect(still.x).toBeCloseTo(10)
    const walk = shotAim(0, 0, { x: 10, z: 0, vx: 0, vz: 3 }, 16)
    expect(walk.z).toBeGreaterThan(0)
    expect(walk.z).toBeLessThan(1.8)
    const dash = shotAim(0, 0, { x: 10, z: 0, vx: 0, vz: 12 }, 16)
    expect(Math.abs(dash.z)).toBeLessThanOrEqual(1.8)
  })
})
