export type Behavior = 'hop' | 'kiter' | 'dasher' | 'swoop' | 'boss'

export interface EnemyDef {
  id: string
  name: string
  behavior: Behavior
  hp: number
  atk: number
  def: number
  speed: number
  xp: number
  radius: number
  contact: number
  knock: number
  gold: [number, number]
  gear: number
  weapon: number
  dust: number
  part: number
  potion: number
  projectile?: { speed: number; life: number; damage: number; kind: string }
}

export const ENEMIES: Record<string, EnemyDef> = {
  slime: {
    id: 'slime',
    name: '솜사탕 슬라임',
    behavior: 'hop',
    hp: 78,
    atk: 10,
    def: 2,
    speed: 70,
    xp: 16,
    radius: 30,
    contact: 9,
    knock: 1,
    gold: [3, 7],
    gear: 0.07,
    weapon: 0.09,
    dust: 0.55,
    part: 0.06,
    potion: 0.05,
  },
  bug: {
    id: 'bug',
    name: '포자 꿈벌레',
    behavior: 'kiter',
    hp: 60,
    atk: 11,
    def: 1,
    speed: 74,
    xp: 18,
    radius: 28,
    contact: 8,
    knock: 1,
    gold: [4, 8],
    gear: 0.08,
    weapon: 0.11,
    dust: 0.6,
    part: 0.1,
    potion: 0.05,
    projectile: { speed: 230, life: 1.55, damage: 11, kind: 'spore' },
  },
  rabbit: {
    id: 'rabbit',
    name: '그림자 토끼',
    behavior: 'dasher',
    hp: 72,
    atk: 14,
    def: 3,
    speed: 125,
    xp: 20,
    radius: 26,
    contact: 13,
    knock: 0.85,
    gold: [4, 9],
    gear: 0.08,
    weapon: 0.1,
    dust: 0.34,
    part: 0.32,
    potion: 0.05,
  },
  bat: {
    id: 'bat',
    name: '수정 박쥐',
    behavior: 'swoop',
    hp: 54,
    atk: 12,
    def: 1,
    speed: 145,
    xp: 20,
    radius: 24,
    contact: 11,
    knock: 1.1,
    gold: [4, 8],
    gear: 0.08,
    weapon: 0.1,
    dust: 0.3,
    part: 0.2,
    potion: 0.06,
  },
  bloom: {
    id: 'bloom',
    name: '나이트메어 블룸',
    behavior: 'boss',
    hp: 1700,
    atk: 18,
    def: 8,
    speed: 58,
    xp: 240,
    radius: 58,
    contact: 16,
    knock: 0.12,
    gold: [70, 110],
    gear: 1,
    weapon: 1,
    dust: 1,
    part: 1,
    potion: 1,
  },
}

export interface EliteMod {
  id: string
  name: string
  hp?: number
  def?: number
  speed?: number
  knock?: number
  lifesteal?: number
  explode?: boolean
  color: number
}

export const ELITES: Record<string, EliteMod> = {
  tough: { id: 'tough', name: '질긴', hp: 1.35, def: 10, knock: 0.55, color: 0x9fd0ff },
  swift: { id: 'swift', name: '재빠른', speed: 1.4, color: 0xc8ffb0 },
  volatile: { id: 'volatile', name: '불안정한', explode: true, color: 0xff9ed2 },
  vampiric: { id: 'vampiric', name: '흡혈의', lifesteal: 0.55, color: 0xff8b9a },
}
