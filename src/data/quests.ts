import type { Rarity } from '../sim/types'

export interface ObjectiveDef {
  id: string
  type: 'kill' | 'collect' | 'talk' | 'enter'
  target: string
  count: number
  label: string
}

export interface QuestRewards {
  gold?: number
  xp?: number
  potions?: number
  byeolhaPoints?: number
  mochiPoints?: number
  items?: { defId: string; rarity: Rarity }[]
  consume?: Record<string, number>
}

export interface QuestDef {
  id: string
  title: string
  summary: string
  side?: boolean
  autoTurnIn?: boolean
  requires?: string
  objectives: ObjectiveDef[]
  rewards: QuestRewards
}

export const QUESTS: Record<string, QuestDef> = {
  q_awaken: {
    id: 'q_awaken',
    title: '별빛 아래의 고양이',
    summary: '꿈에서 눈을 뜨고, 모찌와 함께 꿈의 마을로 향한다.',
    autoTurnIn: true,
    objectives: [
      { id: 'talk', type: 'talk', target: 'mochi', count: 1, label: '모찌와 대화' },
      { id: 'slime', type: 'kill', target: 'tutorial', count: 1, label: '일그러진 솜사탕 슬라임 처치' },
      { id: 'village', type: 'enter', target: 'village', count: 1, label: '꿈의 마을 도착' },
    ],
    rewards: { gold: 40, xp: 40, potions: 1 },
  },
  q_dust: {
    id: 'q_dust',
    title: '반짝이는 꿈가루',
    summary: '몽환의 숲에서 괴물을 잠재우고 꿈가루를 모은다.',
    requires: 'q_awaken',
    objectives: [
      { id: 'wild', type: 'kill', target: 'wild', count: 8, label: '숲의 괴물 처치' },
      { id: 'dust', type: 'collect', target: 'dream_dust', count: 5, label: '꿈가루 모으기' },
    ],
    rewards: { gold: 130, xp: 100, items: [{ defId: 'hat_beret', rarity: 'rare' }] },
  },
  q_bloom: {
    id: 'q_bloom',
    title: '꽃망울의 악몽',
    summary: '별빛 제단의 나이트메어 블룸을 잠재운다.',
    requires: 'q_dust',
    objectives: [{ id: 'boss', type: 'kill', target: 'bloom', count: 1, label: '나이트메어 블룸 처치' }],
    rewards: {
      gold: 280,
      xp: 200,
      byeolhaPoints: 1,
      items: [{ defId: 'acc_charm', rarity: 'epic' }],
    },
  },
  q_parts: {
    id: 'q_parts',
    title: '장난감 공방의 부탁',
    summary: '정예 괴물에게서 장난감 부품을 모아 키키에게 전한다.',
    side: true,
    requires: 'q_awaken',
    objectives: [{ id: 'parts', type: 'collect', target: 'toy_part', count: 3, label: '장난감 부품' }],
    rewards: {
      gold: 80,
      xp: 70,
      items: [{ defId: 'gun_dart', rarity: 'rare' }],
      consume: { toy_part: 3 },
    },
  },
}

export const QUEST_ORDER = ['q_awaken', 'q_dust', 'q_bloom', 'q_parts']
