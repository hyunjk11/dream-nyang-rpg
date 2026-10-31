/**
 * Byeolha's skill tree: three small branches, five skills each (passives plus four actives on
 * 1–4). A skill on tier t needs level TIER_LEVEL[t] and t×2 points already in its branch.
 */
export type Branch = 'gun' | 'bubble' | 'mochi'
export type ActiveId = 'bubble_bomb' | 'overdrive' | 'mochi_rush' | 'candy_aura'

export interface TreeSkill {
  id: string
  branch: Branch
  tier: number
  kind: 'active' | 'passive'
  max: number
  name: string
  /** Little glyph on the button (plain text, no emoji fonts needed). */
  glyph: string
  /** What rank r does (r ≥ 1). */
  text: (r: number) => string
  /** Active skills: hotkey and cooldown (s) at rank r. */
  key?: '1' | '2' | '3' | '4'
  cooldown?: (r: number) => number
}

export const BRANCH_KO: Record<Branch, { name: string; blurb: string; color: string }> = {
  gun: { name: '물총 장인', blurb: '쏘고 또 쏘는 손맛', color: '#7fb8ff' },
  bubble: { name: '비눗방울 폭탄', blurb: '퐁퐁 터지는 범위 공격', color: '#ff9fd2' },
  mochi: { name: '모찌와 함께', blurb: '모찌 돌진과 달콤한 회복', color: '#ffd36b' },
}

export const TIER_LEVEL = [1, 3, 6, 10, 15]
export const LEVEL_CAP = 30

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

export const TREE: TreeSkill[] = [
  // 물총 장인
  { id: 'polish', branch: 'gun', tier: 0, kind: 'passive', max: 5, name: '물총 손질', glyph: '力', text: (r) => `모든 피해 +${pct(0.05 * r)}` },
  { id: 'rhythm', branch: 'gun', tier: 1, kind: 'passive', max: 3, name: '두두두 리듬', glyph: '速', text: (r) => `연사 속도 +${pct(0.05 * r)}` },
  {
    id: 'overdrive', branch: 'gun', tier: 2, kind: 'active', max: 3, name: '과열 폭주', glyph: '爆', key: '2',
    text: (r) => `${5 + r}초 동안 연사 +60%, 치명타 +10%, 과열 없음`,
    cooldown: (r) => 24 - r * 2,
  },
  { id: 'star_eye', branch: 'gun', tier: 3, kind: 'passive', max: 3, name: '별빛 조준', glyph: '星', text: (r) => `치명타 확률 +${pct(0.03 * r)}, 치명타 피해 +${pct(0.1 * r)}` },
  { id: 'dream_pierce', branch: 'gun', tier: 4, kind: 'passive', max: 1, name: '꿈 관통', glyph: '貫', text: () => '물방울이 괴물 하나를 더 꿰뚫는다' },
  // 비눗방울 폭탄
  {
    id: 'bubble_bomb', branch: 'bubble', tier: 0, kind: 'active', max: 5, name: '거품 폭탄', glyph: '泡', key: '1',
    text: (r) => `조준한 곳에 큰 비눗방울을 던져 펑! 범위 피해 ${bombDamage(r)}`,
    cooldown: () => 7,
  },
  { id: 'big_bubble', branch: 'bubble', tier: 1, kind: 'passive', max: 3, name: '왕방울', glyph: '大', text: (r) => `거품 폭탄 범위 +${pct(0.15 * r)}` },
  { id: 'sticky_soap', branch: 'bubble', tier: 2, kind: 'passive', max: 3, name: '끈적 비누', glyph: '粘', text: (r) => `폭탄 맞은 괴물이 2초 느려지고, 폭탄 대기 -${(0.6 * r).toFixed(1)}초` },
  { id: 'pop_chain', branch: 'bubble', tier: 3, kind: 'passive', max: 3, name: '톡톡 연쇄', glyph: '連', text: (r) => `처치할 때 ${pct(0.08 * r)} 확률로 작은 방울이 터진다` },
  { id: 'sparkle_heart', branch: 'bubble', tier: 4, kind: 'passive', max: 1, name: '반짝 마음', glyph: '光', text: () => '모든 물방울에 반짝 속성 +12%' },
  // 모찌와 함께
  { id: 'fluffy', branch: 'mochi', tier: 0, kind: 'passive', max: 5, name: '폭신 털', glyph: '毛', text: (r) => `최대 체력 +${pct(0.06 * r)}` },
  {
    id: 'mochi_rush', branch: 'mochi', tier: 1, kind: 'active', max: 3, name: '모찌 돌진', glyph: '猫', key: '3',
    text: (r) => `모찌가 조준한 쪽으로 쌩! 지나간 길의 괴물에게 ${rushDamage(r)} 피해`,
    cooldown: () => 10,
  },
  { id: 'purr', branch: 'mochi', tier: 2, kind: 'passive', max: 3, name: '골골 회복', glyph: '癒', text: (r) => `자연 회복 +${pct(0.3 * r)}, 더 빨리 시작` },
  {
    id: 'candy_aura', branch: 'mochi', tier: 3, kind: 'active', max: 3, name: '하트 사탕 오라', glyph: '飴', key: '4',
    text: (r) => `6초 동안 매초 최대 체력 ${pct(auraHeal(r))} 회복, 받는 피해 -20%`,
    cooldown: () => 28,
  },
  { id: 'lucky_bell', branch: 'mochi', tier: 4, kind: 'passive', max: 2, name: '행운 방울', glyph: '福', text: (r) => `행운 +${10 * r} (좋은 장비가 더 자주)` },
]

export const TREE_BY_ID: Record<string, TreeSkill> = Object.fromEntries(TREE.map((s) => [s.id, s]))
export const ACTIVES: ActiveId[] = ['bubble_bomb', 'overdrive', 'mochi_rush', 'candy_aura']

/** Bubble bomb base damage at rank r (before the damage multiplier). */
export function bombDamage(r: number): number {
  return 45 + 20 * Math.max(1, r)
}
export function bombRadius(bigRank: number): number {
  return 2.4 * (1 + 0.15 * bigRank)
}
export function rushDamage(r: number): number {
  return 40 + 20 * Math.max(1, r)
}
export function auraHeal(r: number): number {
  return 0.05 + 0.015 * Math.max(1, r)
}
