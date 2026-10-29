export type SkillOwner = 'byeolha' | 'mochi'
export type SkillType = 'active' | 'passive'

export interface SkillDef {
  id: string
  owner: SkillOwner
  kind: SkillType
  name: string
  description: string
  cooldown: number
  requires: string[]
  hotkey?: string
}

export const SKILLS: Record<string, SkillDef> = {
  spray: {
    id: 'spray',
    owner: 'byeolha',
    kind: 'active',
    name: '물보라 난사',
    description: '전방으로 물줄기를 흩뿌린다. 여러 마리에게 약하게 맞는다.',
    cooldown: 5,
    requires: [],
    hotkey: '1',
  },
  shield: {
    id: 'shield',
    owner: 'byeolha',
    kind: 'active',
    name: '비누 방벽',
    description: '잠시 피해를 흡수하는 비눗방울 막을 두른다.',
    cooldown: 11,
    requires: ['spray'],
    hotkey: '2',
  },
  focus: {
    id: 'focus',
    owner: 'byeolha',
    kind: 'active',
    name: '집중 사격',
    description: '다음 6발이 반드시 치명타가 된다.',
    cooldown: 8,
    requires: ['spray'],
    hotkey: '3',
  },
  sense: {
    id: 'sense',
    owner: 'byeolha',
    kind: 'passive',
    name: '꿈의 감각',
    description: '치명타 확률이 5% 증가한다.',
    cooldown: 0,
    requires: ['focus'],
  },
  taunt: {
    id: 'taunt',
    owner: 'mochi',
    kind: 'active',
    name: '냥냥 도발',
    description: '주변의 작은 괴물이 잠시 모찌만 쫓는다. 보스는 고집이 세서 넘어오지 않는다.',
    cooldown: 11,
    requires: [],
    hotkey: '4',
  },
  heal: {
    id: 'heal',
    owner: 'mochi',
    kind: 'active',
    name: '골골 치유',
    description: '골골송으로 별하의 체력을 회복한다.',
    cooldown: 13,
    requires: ['taunt'],
    hotkey: 'Z',
  },
  pounce: {
    id: 'pounce',
    owner: 'mochi',
    kind: 'active',
    name: '냥냥 펀치',
    description: '가장 가까운 괴물에게 달려들어 세게 찍는다.',
    cooldown: 6,
    requires: ['taunt'],
    hotkey: 'X',
  },
  lucky: {
    id: 'lucky',
    owner: 'mochi',
    kind: 'passive',
    name: '행운의 방울',
    description: '행운이 12 증가한다. 더 좋은 꿈이 떨어진다.',
    cooldown: 0,
    requires: ['pounce'],
  },
}

export const HOTBAR = ['spray', 'shield', 'focus', 'taunt', 'heal', 'pounce']
