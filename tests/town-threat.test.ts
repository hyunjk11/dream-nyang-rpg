import { describe, expect, it } from 'vitest'
import { Group, Vector3 } from 'three'
import { Hero } from '../src/actors/hero'
import { Combat, townHit } from '../src/combat/combat'
import { DIFFICULTY } from '../src/combat/difficulty'
import { fieldPlan } from '../src/sim/delve'
import { runFoeScale } from '../src/world/dungeon/run'
import { PORTAL_ARRIVAL, zone3d, type ZoneId } from '../src/world/town/zones3d'

/** Real Combat.update → Hero.hurt for 10 s. Attack phase is pinned so the percent is stable. */
function stand(id: ZoneId, at: { x: number; z: number }, drift = 0) {
  const combat = new Combat(new Group())
  combat.setRoster(zone3d(id).foes)
  for (const f of combat.foes) {
    f.spawn = 1
    f.attack = 0.2
    f.phase = 0
  }
  const hero = new Hero()
  hero.maxHp = 150
  hero.hp = 150
  const pos = new Vector3()
  const dt = 1 / 60
  for (let t = 0; t < 10; t += dt) {
    const ang = t * 1.4
    pos.set(at.x + (drift ? Math.sin(ang) * drift : 0), 0, at.z + (drift ? Math.cos(ang) * drift : 0))
    combat.update(dt, pos, 0.7, (amount, from) => {
      hero.hurt(amount, from)
    })
    hero.iframes = Math.max(0, hero.iframes - dt)
    hero.sinceHit += dt
    if (hero.alive && hero.sinceHit > hero.regenDelay && hero.hp < hero.maxHp) {
      hero.hp = Math.min(hero.maxHp, hero.hp + DIFFICULTY.hero.regenRate * dt)
    }
  }
  return 1 - hero.hp / 150
}

describe('챕터 1 섬의 적 공격 (마을 스케일)', () => {
  it('야생 한 대는 미로 슬라임(13) 근처이고, 초원 튜토리얼은 더 약하고, 제단 꽃잎은 그 사이', () => {
    expect(townHit('slime')).toBe(11)
    expect(townHit('bug')).toBe(15)
    expect(townHit('bat')).toBe(9)
    expect(townHit('rabbit')).toBe(12)
    expect(townHit('slime', true)).toBe(5)
    expect(townHit('bloom')).toBe(17)
    expect(townHit('bloom')).toBeGreaterThan(townHit('slime'))
    expect(townHit('bloom')).toBeLessThan(39)
    expect(DIFFICULTY.town.hp).toBe(3)
    expect(DIFFICULTY.town.skillHp).toBe(11)
  })

  it('몽환의 숲 입구에 10초 서 있으면 60–85%가 빠지고, 3 m 원을 돌면 15% 미만', () => {
    const still = stand('forest', PORTAL_ARRIVAL)
    const moving = stand('forest', PORTAL_ARRIVAL, 3.2)
    expect(still).toBeGreaterThanOrEqual(0.6)
    expect(still).toBeLessThan(0.85)
    expect(moving).toBeLessThan(0.15)
  })

  it('꿈의 초원 슬라임 앞에 10초 서 있어도 숲보다 훨씬 덜 아프다', () => {
    const foes = zone3d('meadow').foes
    const at = foes[0]
    const meadow = stand('meadow', at)
    expect(meadow).toBeGreaterThanOrEqual(0.12)
    expect(meadow).toBeLessThan(0.35)
    expect(meadow).toBeLessThan(stand('forest', PORTAL_ARRIVAL) * 0.5)
  })

  it('버섯 골짜기 한가운데와 제단 꽃 앞도 서 있으면 아프고, 들판은 이미 미로 곡선을 쓴다', () => {
    const vale = zone3d('vale').foes.filter((f) => f.kind !== 'bloom')
    const mid = {
      x: vale.reduce((a, f) => a + f.x, 0) / vale.length,
      z: vale.reduce((a, f) => a + f.z, 0) / vale.length,
    }
    expect(stand('vale', mid)).toBeGreaterThanOrEqual(0.55)
    const bloom = zone3d('altar').foes[0]
    const front = stand('altar', { x: bloom.x, z: bloom.z + 5.5 })
    expect(front).toBeGreaterThanOrEqual(0.2)
    expect(front).toBeLessThan(0.5)
    const field = fieldPlan(1, { kinds: ['slime'], fluff: false, named: false, boss: false })
    expect(field.objective).toBe('field')
    expect(runFoeScale(field, false, 150).hit?.[0]).toBeGreaterThan(10)
  })
})
