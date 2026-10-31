import { describe, expect, it } from 'vitest'
import { applyProcs, chill, ELEMENTS, freshElements, speedMul, tickElements } from '../src/combat/elements'
import { rushLock, type SkillBody } from '../src/combat/skills'

const body = (id: string, x: number, z: number): SkillBody => ({ id, x, z, r: 0.5, tone: 'n', hit: () => false })

describe('원소 효과 (마을·하수도 공통)', () => {
  it('서늘 속성은 적을 느리게 하고 시간이 지나면 풀린다', () => {
    const f = freshElements()
    applyProcs(f, { ice: true }, 10)
    expect(f.chill).toBe(ELEMENTS.chill)
    expect(speedMul(f)).toBe(ELEMENTS.slow)
    tickElements(f, ELEMENTS.chill + 0.1)
    expect(speedMul(f)).toBe(1)
  })

  it('끈적 속성은 맞힌 피해의 일부를 시간에 걸쳐 준다', () => {
    const f = freshElements()
    applyProcs(f, { candy: true }, 20)
    let dmg = 0
    for (let i = 0; i < 40; i += 1) dmg += tickElements(f, 0.1)
    expect(dmg).toBeCloseTo(20 * ELEMENTS.gooShare * ELEMENTS.goo, 3)
    expect(f.goo).toBe(0)
  })

  it('스킬 둔화는 더 긴 쪽만 남긴다', () => {
    const f = freshElements()
    chill(f, 2)
    chill(f, 0.5)
    expect(f.chill).toBe(2)
  })
})

describe('모찌 돌진 조준', () => {
  it('정면 원뿔 안에서 조준선에 가깝고 가까운 적을 고른다', () => {
    const ahead = rushLock([body('a', 0, 4), body('b', 3, 0.2), body('c', 0.3, 2.5)], 0, 0, 0, 1, 6)
    expect(ahead).toMatchObject({ x: 0, z: 4 })
    const near = rushLock([body('far', 0, 5), body('near', 0, 2)], 0, 0, 0, 1, 6)
    expect(near).toMatchObject({ x: 0, z: 2 })
  })

  it('원뿔 밖이나 사거리 밖의 적은 무시한다', () => {
    expect(rushLock([body('a', 4, 0), body('b', 0, -3), body('c', 0, 12)], 0, 0, 0, 1, 6)).toBeNull()
  })
})
