import { describe, expect, it } from 'vitest'
import { groupLoot } from '../src/ui/summary'

describe('탐험 결과 전리품 묶기', () => {
  it('같은 재료와 사탕은 개수를 합치고 장비를 먼저 보여 준다', () => {
    const out = groupLoot([
      { name: '꿈가루 ×2', rarity: 'material' },
      { name: '하트 사탕', rarity: 'potion' },
      { name: '꿈가루 ×1', rarity: 'material' },
      { name: '하트 사탕', rarity: 'potion' },
      { name: '별빛 물총', rarity: 'common' },
    ] as never)
    expect(out.map((l) => l.name)).toEqual(['별빛 물총', '하트 사탕 ×2', '꿈가루 ×3'])
  })
})
