import type { StatKey } from '../sim/types'

export interface AffixSpec {
  id: string
  /** Name prefix ("반짝이는 별빛 물총"). */
  name: string
  stat: StatKey
  /** Roll range at item level 1 (fractions for % stats). */
  min: number
  max: number
  weaponOnly?: boolean
  /** Not on guns (hp, armour, move). */
  gearOnly?: boolean
  /** Whole numbers, and not scaled by item level (pierce). */
  flat?: boolean
  /** Only one element per item. */
  element?: boolean
}

/** 3D affixes (values at item level 1; item level and rarity scale them up). */
export const AFFIXES: AffixSpec[] = [
  { id: 'power', name: '힘찬', stat: 'damage', min: 0.04, max: 0.1 },
  { id: 'swift', name: '재빠른', stat: 'fireRate', min: 0.04, max: 0.1 },
  { id: 'keen', name: '날카로운', stat: 'critChance', min: 0.02, max: 0.05 },
  { id: 'fierce', name: '맹렬한', stat: 'critDamage', min: 0.12, max: 0.35 },
  { id: 'sip', name: '쪽쪽', stat: 'lifesteal', min: 0.01, max: 0.025 },
  { id: 'pierce', name: '꿰뚫는', stat: 'pierce', min: 1, max: 1, weaponOnly: true, flat: true },
  { id: 'light', name: '가벼운', stat: 'moveSpeed', min: 0.03, max: 0.07, gearOnly: true },
  { id: 'vital', name: '튼튼한', stat: 'hp', min: 10, max: 28, gearOnly: true },
  { id: 'guard', name: '단단한', stat: 'armor', min: 0.02, max: 0.05, gearOnly: true },
  { id: 'lucky', name: '행운의', stat: 'luck', min: 4, max: 12 },
  { id: 'sparkle', name: '반짝이는', stat: 'sparkle', min: 0.08, max: 0.16, weaponOnly: true, element: true },
  { id: 'ice', name: '서늘한', stat: 'ice', min: 0.1, max: 0.2, weaponOnly: true, element: true },
  { id: 'candy', name: '끈적한', stat: 'candy', min: 0.1, max: 0.2, weaponOnly: true, element: true },
]

/** Affixes per rarity: 보통 0, 매직 1, 희귀 2, 영웅 3, 전설 4. */
export const AFFIX_COUNT: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
}

/** Stats shown as percentages. */
export const PERCENT_STATS: StatKey[] = ['critChance', 'critDamage', 'attackSpeed', 'damage', 'fireRate', 'lifesteal', 'moveSpeed', 'armor', 'sparkle', 'ice', 'candy']
