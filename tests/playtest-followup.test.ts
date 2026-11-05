import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { GUIDE, GUIDE_DUST, GUIDE_PLUS1_GOLD, guideEvent, guideStep } from '../src/sim/chapters'
import { canPay, upgradeCost } from '../src/sim/workshop'
import { engageFor } from '../src/data/guns'
import { EARLY_SHOT, RANGED, SHOT_STYLES, hordeHp } from '../src/world/dungeon/horde'
import { floorPlan } from '../src/sim/delve'
import { EXPLORE } from '../src/world/dungeon/layout'
import { FOE_HIT_BAND } from '../src/world/dungeon/run'
import { DIFFICULTY } from '../src/combat/difficulty'
import { rng } from '../src/world/dungeon/maze'

describe('플레이테스트: 첫 강화', () => {
  it('공방 단계가 꿈가루 두 줌과 +1에 필요한 골드를 쥐여 준다', () => {
    const save = freshSave()
    save.gold = 0
    const rngn = rng(4)
    for (let n = 0; n < 20 && guideStep(save)?.id !== 'workshop'; n += 1) {
      const step = guideStep(save)!
      guideEvent(save, { type: step.id, amount: step.goal }, rngn)
    }
    expect(guideStep(save)?.id).toBe('workshop')
    expect(guideStep(save)?.gift).toBe('dust')
    expect(save.materials.dream_dust).toBeGreaterThanOrEqual(GUIDE_DUST)
    expect(save.gold).toBeGreaterThanOrEqual(GUIDE_PLUS1_GOLD)
    const gun = save.items.find((i) => i.uid === save.equipment.weapon)!
    const cost = upgradeCost(gun)!
    expect(cost).toEqual({ gold: 28, mats: { dream_dust: 1 } })
    expect(canPay(save, cost)).toBe(true)
  })
})

describe('플레이테스트: 깊이 1 위협', () => {
  it('깊이 1 탐색 사격은 물총 스위트스팟(14m) 너머까지 나가고, 한 발은 체력의 한 자리다', () => {
    const sweet = engageFor('water').sweet
    expect(sweet).toBe(14)
    expect(RANGED.maxShot).toBeLessThan(sweet)
    expect(EARLY_SHOT.max).toBeGreaterThan(sweet)
    expect(EARLY_SHOT.far).toBeGreaterThanOrEqual(sweet)
    const hp = hordeHp('slime', floorPlan(1, 1).scale.hp * EXPLORE.hp)
    const dps = 137
    const ttk = hp / dps
    const flight = sweet / (SHOT_STYLES.bubble.speed * EARLY_SHOT.speed)
    const arrive = SHOT_STYLES.bubble.aim + flight
    // The shot is still in the air when an unupgraded slime dies, and lands if she stays on the pack.
    expect(ttk).toBeGreaterThan(1.5)
    expect(ttk).toBeLessThan(arrive)
    expect(arrive).toBeLessThan(3)
    const maxHp = DIFFICULTY.hero.maxHp
    const chip = FOE_HIT_BAND[0] * maxHp
    expect(chip).toBeGreaterThan(maxHp * 0.08)
    expect(chip).toBeLessThan(maxHp * 0.2)
  })
})

describe('플레이테스트: 가이드가 슬라임 셋을 말한다', () => {
  it('사격은 짧은 연사고, 처치 단계 제목에 3마리가 있다', () => {
    const shoot = GUIDE.find((g) => g.id === 'shoot')!
    const kill = GUIDE.find((g) => g.id === 'kill')!
    expect(shoot.goal).toBeLessThanOrEqual(8)
    expect(shoot.keys).toContain('슬라임 3')
    expect(kill.title).toContain('3')
    expect(kill.keys).toContain('3')
  })
})
