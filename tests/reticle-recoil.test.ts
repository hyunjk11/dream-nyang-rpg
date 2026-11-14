import { describe, expect, it } from 'vitest'
import { AIM_CONES, aimSpreadScale, reticlePx } from '../src/combat/aim'
import { GUN_PROFILES } from '../src/data/guns'
import { HOLD_STYLES } from '../src/actors/holds'
import { KICK_CAP, createView, kick, recover } from '../src/core/tps'
import { feelDecay, fireFeel, recoilSide } from '../src/combat/shooter'
import { SWAP_DELAY, coolRuntime, type GunRuntime } from '../src/combat/gunfeel'

describe('괄호 조준 [  ]', () => {
  it('탄퍼짐이 괄호 간격이 되고, 움직이거나 반동 중에는 벌어졌다가 멈추면 돌아온다', () => {
    const h = 844
    const fov = 68
    const sniper = reticlePx(AIM_CONES.sniper.yawMin, fov, h)
    const dual = reticlePx(AIM_CONES.dual.yawMin, fov, h)
    const shotgun = reticlePx(AIM_CONES.shotgun.yawMin, fov, h)
    expect(dual).toBeGreaterThan(sniper * 4)
    expect(shotgun).toBeGreaterThan(dual)
    const steady = aimSpreadScale(false, 0)
    const moving = aimSpreadScale(true, 0)
    const kicked = aimSpreadScale(false, 0.1)
    expect(steady).toBe(1)
    expect(moving).toBeGreaterThan(1)
    expect(kicked).toBeGreaterThan(moving)
    expect(sniper * kicked).toBeLessThan(dual * steady)
  })
})

describe('총마다 반동', () => {
  it('저격은 한 방이 크고 오래 남고, 연사는 가볍고 바로 돌아온다. 반동은 0으로 붙는다', () => {
    const order = ['crack', 'boom', 'burst', 'spray'] as const
    for (let i = 1; i < order.length; i += 1) {
      expect(feelDecay(order[i - 1]).recoil).toBeLessThan(feelDecay(order[i]).recoil)
      expect(feelDecay(order[i - 1]).shake).toBeLessThan(feelDecay(order[i]).shake)
    }
    expect(feelDecay('crack').recoil).toBeLessThan(8)
    expect(feelDecay('spray').recoil).toBeGreaterThan(12)
    expect(fireFeel({ voice: 'crack' }).shakeCap).toBeGreaterThan(fireFeel({ voice: 'spray' }).shakeCap)
    const view = createView()
    kick(view, GUN_PROFILES.dart.kickUp, 0.01)
    expect(view.kickPitch).toBeGreaterThan(0.08)
    expect(view.kickPitch).toBeLessThanOrEqual(KICK_CAP.pitch)
    for (let i = 0; i < 180; i += 1) recover(view, 1 / 60, feelDecay('crack').recoil)
    expect(view.kickPitch).toBe(0)
    expect(view.kickYaw).toBe(0)
    // A spray cannot stack the kick without bound.
    const spray = createView()
    for (let i = 0; i < 80; i += 1) {
      kick(spray, GUN_PROFILES.water.kickUp, GUN_PROFILES.water.kickSide)
      recover(spray, GUN_PROFILES.water.gap, feelDecay('spray').recoil)
    }
    expect(spray.kickPitch).toBeLessThan(0.02)
    expect(Math.abs(spray.kickYaw)).toBeLessThanOrEqual(KICK_CAP.yaw)
  })

  it('쌍권총 좌우 반동은 서로 상쇄되고, 저격 자세는 가장 느리게 돌아온다', () => {
    const pace = 1 / 1.7
    const left = recoilSide(true, 'left', 0.004, pace, 0.9)
    const right = recoilSide(true, 'right', 0.004, pace, 0.1)
    expect(left).toBeLessThan(0)
    expect(right).toBeGreaterThan(0)
    expect(left + right).toBeCloseTo(0)
    expect(Math.abs(left)).toBeLessThan(0.004)
    expect(HOLD_STYLES.sniper.settle).toBeLessThan(HOLD_STYLES.shotgun.settle)
    expect(HOLD_STYLES.dual.settle).toBeGreaterThan(HOLD_STYLES.pistol.settle)
  })
})

describe('무기 교체 쿨다운', () => {
  it('넣어 둔 총의 열과 쿨다운은 식고, 교체 직후엔 잠시 못 쏜다', () => {
    const holster: GunRuntime = { cooldown: 0.5, bloom: 0.8, heat: 1, overheated: true, burstLeft: 2 }
    coolRuntime(holster, 0.4)
    expect(holster.cooldown).toBeCloseTo(0.1)
    expect(holster.bloom).toBeLessThan(0.8)
    expect(holster.heat).toBeLessThan(1)
    expect(SWAP_DELAY).toBeGreaterThan(0.15)
    expect(SWAP_DELAY).toBeLessThan(0.45)
  })
})
