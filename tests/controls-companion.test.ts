import { describe, expect, it } from 'vitest'
import { CAT, catSlot, createCat, stepCat } from '../src/sim/companion'
import { createView, pose } from '../src/3d/tps'

// Where the shoulder camera sits relative to her (view yaw 0.62), as main.ts hands it to Mochi.
const lens = pose(createView(0.62, 0.1), null, 0, 0, 0, 1 / 60)
const cam = { x: lens.x, z: lens.z }

function run(cat = createCat(), seconds: number, hero: (t: number) => { x: number; z: number; vx: number; vz: number }) {
  const dt = 1 / 60
  let maxSpeed = 0
  let maxJump = 0
  for (let i = 0; i < seconds * 60; i++) {
    const h = hero(i * dt)
    const px = cat.x
    const pz = cat.z
    stepCat(cat, dt, h.x, h.z, h.vx, h.vz, cam.x, cam.z, 9)
    maxSpeed = Math.max(maxSpeed, Math.hypot(cat.vx, cat.vz))
    maxJump = Math.max(maxJump, Math.hypot(cat.x - px, cat.z - pz))
  }
  return { cat, maxSpeed, maxJump }
}

describe('모찌 따라가기', () => {
  it('별하가 서 있으면 모찌도 멈춘다', () => {
    const { cat } = run(createCat(2, 2), 6, () => ({ x: 0, z: 0, vx: 0, vz: 0 }))
    expect(cat.moving).toBe(false)
    expect(Math.hypot(cat.vx, cat.vz)).toBeLessThan(0.01)
  })

  it('걸을 때 속도 제한 안에서 순간이동 없이 따라온다', () => {
    const { cat, maxSpeed, maxJump } = run(createCat(), 5, (t) => ({ x: 3.15 * t * 0.4, z: 0, vx: 1.26, vz: 0 }))
    expect(maxSpeed).toBeLessThanOrEqual(CAT.runSpeed + 1e-6)
    expect(maxJump).toBeLessThan(0.15)
    const slot = catSlot(5 * 1.26, 0, 1, 0, cam.x, cam.z)
    expect(Math.hypot(cat.x - slot.x, cat.z - slot.z)).toBeLessThan(1)
  })

  it('조준만 돌릴 때 자리는 바뀌지 않는다 (조준과 무관한 자리)', () => {
    // catSlot takes no aim at all; a still hero keeps the same slot.
    const a = catSlot(0, 0, 0, 1, cam.x, cam.z)
    const b = catSlot(0, 0, 0, 1, cam.x, cam.z)
    expect(a).toEqual(b)
  })

  it('카메라 쪽으로 많이 나오지 않고, 화면에서 별하에게 가려지지 않는다', () => {
    const cl = Math.hypot(cam.x, cam.z)
    const cx = cam.x / cl
    const cz = cam.z / cl
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const slot = catSlot(0, 0, Math.sin(a), Math.cos(a), cam.x, cam.z)
      expect(slot.x * cx + slot.z * cz).toBeLessThanOrEqual(CAT.cameraSide * Math.hypot(CAT.behind, CAT.side) + 1e-6)
      const lateral = slot.x * -cz + slot.z * cx
      expect(Math.abs(lateral)).toBeGreaterThanOrEqual(CAT.screenGap - 1e-6)
    }
  })

  it('너무 멀어지면 바로 옆으로 붙는다', () => {
    const cat = createCat(0, 0)
    stepCat(cat, 1 / 60, 30, 0, 0, 0, cam.x, cam.z, 40)
    expect(Math.hypot(cat.x - 30, cat.z)).toBeLessThan(CAT.snap)
  })
})
