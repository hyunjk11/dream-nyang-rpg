import { describe, expect, it } from 'vitest'
import { GUN_PROFILES, falloffAt, gunDpsCrit, gunRate, gunStatLine } from '../src/data/guns'
import { fireFeel, gunVoice } from '../src/combat/shooter'
import { numberPunch } from '../src/ui/hudfx'
import { itemLines, makeItem } from '../src/sim/loot'

const { water, bubble, star, dart } = GUN_PROFILES

describe('총마다 개성이 뚜렷하다 (fix/gun-identity)', () => {
  it('연사 물총은 빠르고 가볍게, 저격총은 느리고 아주 세다', () => {
    expect(gunRate(water)).toBeGreaterThanOrEqual(17)
    expect(gunRate(dart)).toBeLessThan(1)
    expect(dart.damage).toBeGreaterThan(water.damage * 9)
    expect(dart.critMul).toBeGreaterThan(water.critMul)
    expect(dart.pierce).toBeGreaterThan(star.pierce)
  })

  it('샷건은 근거리에 퍼지고, 멀수록 약해지며 괴물을 크게 밀쳐 낸다', () => {
    expect(bubble.pellets).toBeGreaterThanOrEqual(8)
    expect(bubble.spreadMin).toBeGreaterThan(water.spreadMax)
    expect(falloffAt(bubble, 3)).toBe(1)
    expect(falloffAt(bubble, 11)).toBeLessThan(0.8)
    expect(falloffAt(bubble, 30)).toBe(bubble.falloff!.min)
    expect(falloffAt(water, 30)).toBe(1)
    expect(bubble.knock * bubble.pellets).toBeGreaterThan(water.knock * 10)
  })

  it('반동·화면 흔들림·히트스톱은 저격 > 샷건 > 점사 > 연사', () => {
    const order = [dart, bubble, star, water]
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].kickUp, order[i].kind).toBeGreaterThan(order[i].kickUp)
      expect(order[i - 1].fireShake).toBeGreaterThan(order[i].fireShake)
      expect(fireFeel(order[i - 1]).shakeCap).toBeGreaterThan(fireFeel(order[i]).shakeCap)
    }
    expect(dart.stop).toBeGreaterThanOrEqual(0.05)
    expect(water.stop).toBe(0)
  })

  it('소리도 총마다 다르다: 저격은 낮고 큰 탕!, 연사는 높고 가벼운 두두두', () => {
    const crack = gunVoice('crack', 0, 1, 0.5)
    const spray = gunVoice('spray', 0, 1, 0.5)
    expect(crack[0][1]).toBeGreaterThan(spray[0][1])
    expect(crack[0][2]).toBeLessThan(spray[0][2])
    expect(new Set(['spray', 'boom', 'burst', 'crack'].map((v) => JSON.stringify(gunVoice(v as never, 0, 1, 0.5)))).size).toBe(4)
  })

  it('저격 숫자는 크게 튀고 탄 궤적도 굵고 오래 남는다', () => {
    expect(dart.bigNumbers).toBe(true)
    expect(numberPunch('snipe')).toBeGreaterThan(numberPunch('crit'))
    expect(dart.tracerW).toBeGreaterThan(water.tracerW * 3)
    expect(dart.tracerLife).toBeGreaterThan(water.tracerLife * 3)
  })

  it('티어 안에서 DPS는 비슷한 띠에 있다 (저격·점사는 치명·관통으로 실측이 오른다)', () => {
    const base = gunDpsCrit(water)
    for (const p of [bubble]) {
      expect(gunDpsCrit(p) / base).toBeGreaterThan(0.75)
      expect(gunDpsCrit(p) / base).toBeLessThan(1.2)
    }
    // 저격 한 발은 연사 한 발의 10배 넘게 세다 (한 방 폭발력).
    expect(dart.damage * dart.critMul).toBeGreaterThan(water.damage * water.critMul * 10)
  })

  it('툴팁에 총 성격과 초당 발수·한 발 피해·탄퍼짐·반동 줄이 나온다', () => {
    expect(gunStatLine(dart)).toContain('초당 0.8발')
    expect(gunStatLine(bubble)).toContain('×9알')
    expect(gunStatLine(water)).toContain('초당 18발')
    const lines = itemLines(makeItem('gun_dart', 'rare', () => 0.5, 5))
    expect(lines.some((l) => l.includes('저격 다트총') && l.includes('탕!'))).toBe(true)
    expect(lines.some((l) => l.startsWith('초당'))).toBe(true)
  })
})
