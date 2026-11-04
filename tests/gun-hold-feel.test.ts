import { describe, expect, it } from 'vitest'
import { HOLD_OF, HOLD_STYLES, firingHand, holdFor, settleKick } from '../src/actors/holds'
import { HitStop, MAX_SLOW } from '../src/core/hitstop'
import { GUN_PROFILES } from '../src/data/guns'
import { MUZZLE_LIGHT, casingLook } from '../src/combat/gunfx'
import { gunVoice, killSlowmo } from '../src/combat/shooter'
import { STUN_SPEED, staggerFor } from '../src/world/dungeon/horde'
import { QOL_DEFAULTS, loadQol } from '../src/sim/qol'
import { hitStopFor } from '../src/combat/gunfeel'
import { HDR_SAFE } from '../src/core/safeframe'

describe('총 잡는 법', () => {
  it('저격총·소총·산탄총은 양손으로, 물총은 쌍권총으로 잡는다', () => {
    expect(HOLD_OF.water).toBe('pistol')
    expect(holdFor('dart').twoHanded).toBe(true)
    expect(holdFor('star').twoHanded).toBe(true)
    expect(holdFor('bubble').twoHanded).toBe(true)
    expect(holdFor('water').dual).toBe(false)
    expect(holdFor('water', true).dual).toBe(true)
    expect(holdFor('water').twoHanded).toBe(false)
  })

  it('양손 총은 보조손이 총열 앞쪽(포어그립)을 잡는다', () => {
    for (const t of ['rifle', 'shotgun', 'sniper'] as const) {
      expect(HOLD_STYLES[t].fore).toBeGreaterThan(0.4)
      expect(HOLD_STYLES[t].fore).toBeLessThan(0.9)
    }
  })

  it('저격총은 반동이 가장 크고 가장 천천히 돌아온다', () => {
    const s = HOLD_STYLES.sniper
    for (const t of ['dual', 'rifle'] as const) {
      expect(s.kickBack).toBeGreaterThan(HOLD_STYLES[t].kickBack)
      expect(s.settle).toBeLessThan(HOLD_STYLES[t].settle)
    }
  })

  it('쌍권총은 양손을 번갈아 쏘고, 양손 총은 늘 오른손 총구에서 나간다', () => {
    const dual = [0, 1, 2, 3].map((n) => firingHand(HOLD_STYLES.dual, n))
    expect(dual).toEqual(['left', 'right', 'left', 'right'])
    expect([0, 1, 2].map((n) => firingHand(HOLD_STYLES.sniper, n))).toEqual(['right', 'right', 'right'])
  })

  it('반동은 매 프레임 줄어들다 0에서 멈춘다', () => {
    expect(settleKick(1, 0.05, 10)).toBeCloseTo(0.5)
    expect(settleKick(0.1, 1, 10)).toBe(0)
  })
})

describe('총마다 다른 손맛', () => {
  it('총마다 탄피 모양·총구 빛·경직이 다르다', () => {
    const kinds = Object.values(GUN_PROFILES).map((p) => p.casing)
    expect(new Set(kinds).size).toBe(4)
    expect(GUN_PROFILES.dart.stagger).toBeGreaterThan(GUN_PROFILES.bubble.stagger)
    expect(GUN_PROFILES.water.stagger).toBe(0)
    expect(GUN_PROFILES.dart.punch).toBeGreaterThan(GUN_PROFILES.water.punch * 5)
  })

  it('저격총은 메아리(탕…탕…)가, 물총은 무거운 바디 없이 가벼운 소리가 난다', () => {
    const crack = gunVoice('crack', 0, 1, 0.5).map((c) => c[0])
    expect(crack).toContain('echo')
    expect(crack).toContain('boom')
    const water = gunVoice(GUN_PROFILES.water.voice, 0, 1, 0.5).map((c) => c[0])
    expect(water).not.toContain('boom')
    expect(water).not.toContain('echo')
  })

  it('물방울 탄피는 작고 튀지 않으며, 저격 탄피가 가장 크다', () => {
    expect(casingLook('drop').drop).toBe(true)
    expect(casingLook('drop').confetti).toBe(false)
    expect(casingLook('long').scale).toBeGreaterThan(casingLook('shell').scale)
  })

  it('총구 빛은 짧고 프레임 가드 안전 범위 아래로 묶여 있다', () => {
    expect(MUZZLE_LIGHT.max).toBeLessThan(HDR_SAFE)
    expect(MUZZLE_LIGHT.life).toBeLessThanOrEqual(0.08)
    for (const p of Object.values(GUN_PROFILES)) expect(p.light).toBeLessThanOrEqual(1)
  })

  it('치명타·처치 히트스톱은 30~80ms 사이다', () => {
    for (const h of [{ crit: true }, { kill: true }, { elite: true, kill: true }, { elite: true, crit: true }, { boss: true, crit: true }]) {
      const s = hitStopFor(h)
      expect(s).toBeGreaterThanOrEqual(0.03)
      expect(s).toBeLessThanOrEqual(0.08)
    }
    expect(hitStopFor({})).toBe(0)
  })
})

describe('경직과 슬로모션', () => {
  it('엘리트는 경직을 40%만 받고, 경직은 0.5초를 넘지 않는다', () => {
    expect(staggerFor(0.38, false)).toBeCloseTo(0.38)
    expect(staggerFor(0.38, true)).toBeCloseTo(0.152)
    expect(staggerFor(5, false)).toBe(0.5)
    expect(STUN_SPEED).toBeLessThan(0.3)
  })

  it('엘리트·보스 처치에만 슬로모션이 걸린다', () => {
    expect(killSlowmo('n')).toBeNull()
    expect(killSlowmo('elite')?.scale).toBeLessThan(1)
    expect(killSlowmo('boss')!.seconds).toBeGreaterThan(killSlowmo('elite')!.seconds)
  })

  it('슬로모션은 느려졌다가 끝나면 시간 배율이 1로 돌아온다', () => {
    const h = new HitStop()
    h.slow(0.4, 0.3)
    expect(h.step(1 / 60)).toBeCloseTo(0.3)
    let last = 0
    for (let i = 0; i < 60; i += 1) last = h.step(1 / 60)
    expect(last).toBe(1)
  })

  it('슬로모션은 겹쳐도 최대 길이를 넘지 않고, clear로 즉시 풀린다', () => {
    const h = new HitStop()
    h.slow(5, 0.3)
    expect(h.slowLeft).toBe(MAX_SLOW)
    h.clear()
    expect(h.step(1 / 60)).toBe(1)
  })

  it('히트스톱 도중 들어온 작은 멈춤은 흡수되어 멈춤이 끝없이 이어지지 않는다', () => {
    const h = new HitStop()
    h.request(0.045)
    let frames = 0
    while (h.active && frames < 100) {
      h.request(0.03)
      h.step(1 / 60)
      frames += 1
    }
    expect(frames).toBeLessThanOrEqual(3)
  })
})

describe('화면 흔들림 설정', () => {
  it('기본은 켬이고, 저장된 끔 설정을 불러온다', () => {
    expect(QOL_DEFAULTS.shake).toBe(true)
    expect(loadQol(JSON.stringify({ shake: false })).shake).toBe(false)
    expect(loadQol(JSON.stringify({ shake: 'x' })).shake).toBe(true)
  })
})
