import type { StatKey } from '../sim/types'

export interface AffixSpec {
  id: string
  name: string
  stat: StatKey
  min: number
  max: number
  weaponOnly?: boolean
}

export const AFFIXES: AffixSpec[] = [
  { id: 'power', name: '힘센', stat: 'atk', min: 2, max: 6 },
  { id: 'vital', name: '생기찬', stat: 'hp', min: 12, max: 36 },
  { id: 'guard', name: '단단한', stat: 'def', min: 2, max: 7 },
  { id: 'keen', name: '날카로운', stat: 'critChance', min: 0.02, max: 0.055 },
  { id: 'fierce', name: '맹렬한', stat: 'critDamage', min: 0.12, max: 0.4 },
  { id: 'swift', name: '재빠른', stat: 'attackSpeed', min: 0.05, max: 0.14 },
  { id: 'light', name: '가벼운', stat: 'moveSpeed', min: 8, max: 22 },
  { id: 'lucky', name: '행운의', stat: 'luck', min: 4, max: 14 },
  { id: 'heavy', name: '묵직한', stat: 'weaponDamage', min: 2, max: 8, weaponOnly: true },
]

export const AFFIX_COUNT: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
}
