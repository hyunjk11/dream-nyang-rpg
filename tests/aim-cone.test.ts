import { describe, expect, it } from 'vitest'
import { AIM_CONES, RETICLE, aimFor, bloomed, reticlePx, shotCone, splitDamage } from '../src/combat/aim'
import { spreadFan } from '../src/combat/gunfeel'
import { DUAL_ENGAGE, GUN_PROFILES, engageFor, falloffAt, gunDps, gunStatLine, rangeLabel } from '../src/data/guns'
import type { HoldType } from '../src/actors/holds'
import type { WeaponKind } from '../src/sim/types'

/** Narrow → wide. Each resting cone starts past the previous hold's full bloom. */
const ORDER: HoldType[] = ['sniper', 'rifle', 'pistol', 'dual', 'shotgun']

describe('총마다 조준 원뿔', () => {
  it('저격 < 소총 < 권총 < 쌍권총 < 샷건 (쉼 때 각이 앞 총의 최대보다 넓다)', () => {
    for (let i = 1; i < ORDER.length; i += 1) {
      const prev = AIM_CONES[ORDER[i - 1]]
      const next = AIM_CONES[ORDER[i]]
      expect(next.yawMin, next.hold).toBeGreaterThan(prev.yawMax)
      expect(next.yawMax).toBeGreaterThan(next.yawMin)
    }
  })

  it('쌍권총은 가로로 납작한 부채꼴이고, 저격·샷건은 둥글다', () => {
    const dual = AIM_CONES.dual
    expect(dual.fan).toBe(3)
    expect(dual.yawMin).toBeGreaterThan(dual.pitchMax)
    expect(AIM_CONES.sniper.fan).toBe(1)
    expect(AIM_CONES.sniper.yawMax).toBeLessThan(0.005)
    expect(AIM_CONES.shotgun.yawMin).toBeCloseTo(AIM_CONES.shotgun.pitchMin)
    expect(AIM_CONES.pistol.fan).toBe(1)
    expect(AIM_CONES.rifle.fan).toBe(1)
  })

  it('잡는 법이 원뿔을 고른다: 물총 하나 = 보통, 쌍권총 = 퍼짐, 저격 = 한 점', () => {
    expect(aimFor('water', false).hold).toBe('pistol')
    expect(aimFor('water', true).hold).toBe('dual')
    expect(aimFor('dart').hold).toBe('sniper')
    expect(aimFor('star').hold).toBe('rifle')
    expect(aimFor('bubble').hold).toBe('shotgun')
    for (const kind of Object.keys(GUN_PROFILES) as WeaponKind[]) {
      const cone = aimFor(kind, false)
      expect(GUN_PROFILES[kind].spreadMin).toBeCloseTo(cone.yawMin)
      expect(GUN_PROFILES[kind].spreadMax).toBeCloseTo(cone.yawMax)
    }
  })

  it('부채꼴로 나눈 피해의 합은 한 발과 같다 (한 몸에 다 맞으면 초당 피해가 그대로)', () => {
    for (const total of [1, 2, 8, 9, 17, 130]) {
      const parts = splitDamage(total, AIM_CONES.dual.fan)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(Math.max(1, total))
      expect(parts.every((n) => n >= 1)).toBe(true)
      if (total >= AIM_CONES.dual.fan) {
        expect(parts).toHaveLength(AIM_CONES.dual.fan)
        expect(Math.max(...parts)).toBeLessThan(total)
      }
    }
    // 1 피해는 올리면 세 발이 되므로 한 줄기로 남긴다.
    expect(splitDamage(1, 3)).toEqual([1])
    expect(gunDps(GUN_PROFILES.water)).toBeCloseTo(GUN_PROFILES.water.damage / GUN_PROFILES.water.gap)
  })

  it('조준선 픽셀은 원뿔을 따른다: 저격은 점, 쌍권총은 가로로 길다', () => {
    const fov = 68
    const h = 900
    const px = (hold: HoldType) => reticlePx(shotCone(hold, 0).yaw, fov, h)
    expect(px('sniper')).toBe(RETICLE.min)
    expect(px('rifle')).toBeGreaterThan(px('sniper'))
    expect(px('pistol')).toBeGreaterThan(px('rifle') * 1.5)
    expect(px('dual')).toBeGreaterThan(px('pistol') * 1.5)
    expect(px('shotgun')).toBeGreaterThan(px('dual'))
    const dual = shotCone('dual', 0)
    expect(reticlePx(dual.yaw, fov, h)).toBeGreaterThan(reticlePx(dual.pitch, fov, h) * 2)
    // 연사하면 원뿔이 벌어진다.
    expect(shotCone('pistol', 1).yaw).toBeCloseTo(AIM_CONES.pistol.yawMax)
    expect(bloomed(0.02, 0.08, 0.5)).toBeCloseTo(0.02 + 0.06 * 0.25)
  })

  it('타원 퍼짐은 단위 벡터이고 가로·세로 반각 안에 있다', () => {
    const yaw = 0.09
    const pitch = 0.03
    const dir = { x: 0, y: 0, z: 1 }
    for (let i = 0; i < 24; i += 1) {
      for (let j = 0; j < 16; j += 1) {
        const s = spreadFan(dir.x, dir.y, dir.z, yaw, pitch, i / 24, j / 16)
        expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6)
        const hx = (s.x / s.z) / Math.tan(yaw)
        const vy = (s.y / s.z) / Math.tan(pitch)
        expect(hx * hx + vy * vy).toBeLessThanOrEqual(1.0001)
      }
    }
    const side = spreadFan(0, 0, 1, yaw, pitch, 1, 0)
    const up = spreadFan(0, 0, 1, yaw, pitch, 1, 0.25)
    expect(Math.atan(Math.abs(side.x / side.z))).toBeCloseTo(yaw, 5)
    expect(Math.atan(Math.abs(up.y / up.z))).toBeCloseTo(pitch, 5)
    // 같은 씨앗이면 쌍권총의 가로 어긋남이 저격보다 훨씬 크다.
    const wide = spreadFan(0, 0, 1, AIM_CONES.dual.yawMin, AIM_CONES.dual.pitchMin, 1, 0)
    const pin = spreadFan(0, 0, 1, AIM_CONES.sniper.yawMax, AIM_CONES.sniper.pitchMax, 1, 0)
    expect(Math.abs(wide.x)).toBeGreaterThan(Math.abs(pin.x) * 10)
  })

  it('툴팁 탄퍼짐 말이 원뿔과 맞다', () => {
    expect(gunStatLine(GUN_PROFILES.dart)).toContain('한 점')
    expect(gunStatLine(GUN_PROFILES.star)).toContain('좁음')
    expect(gunStatLine(GUN_PROFILES.water)).toContain('탄퍼짐 보통')
    expect(gunStatLine(GUN_PROFILES.bubble)).toContain('넓음')
    expect(gunStatLine(GUN_PROFILES.bubble)).toContain('×9알')
  })

  it('사거리는 쌍권총·샷건이 가깝고 저격이 멀다 (같은 숫자를 사격과 사냥이 읽는다)', () => {
    const dual = engageFor('water', true)
    const pistol = engageFor('water', false)
    const shotgun = engageFor('bubble')
    const rifle = engageFor('star')
    const sniper = engageFor('dart')
    expect(dual).toEqual(DUAL_ENGAGE)
    expect(pistol.sweet).toBeGreaterThan(shotgun.sweet)
    expect(shotgun.sweet).toBeGreaterThan(dual.sweet)
    expect(rifle.sweet).toBeGreaterThan(pistol.sweet)
    expect(sniper.sweet).toBeGreaterThan(rifle.sweet)
    // 쌍권총이 끊긴 거리에서도 저격은 아직 풀 피해.
    expect(dual.far).toBeLessThan(sniper.sweet)
    expect(falloffAt({ engage: dual }, 4)).toBe(1)
    expect(falloffAt({ engage: dual }, dual.far)).toBe(dual.min)
    expect(falloffAt({ engage: dual }, dual.far + 8)).toBe(dual.min)
    expect(falloffAt({ engage: sniper }, 20)).toBe(1)
    expect(falloffAt({ engage: sniper }, sniper.sweet)).toBe(1)
    expect(rangeLabel(dual)).toBe('가까움')
    expect(rangeLabel(sniper)).toBe('아주 김')
    expect(gunStatLine(GUN_PROFILES.water, GUN_PROFILES.water.damage, 1, true)).toContain('탄퍼짐 넓음')
    expect(gunStatLine(GUN_PROFILES.water, GUN_PROFILES.water.damage, 1, true)).toContain('가까움')
    expect(gunStatLine(GUN_PROFILES.dart)).toContain('아주 김')
    expect(gunStatLine(GUN_PROFILES.dart)).toContain(`${sniper.sweet}~${sniper.far}m`)
  })
})
