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
  /** Hotbar label when the full name does not fit a 50–58 px button (≤ 5 chars incl. space). */
  short?: string
  /** What rank r does (r ≥ 1). */
  text: (r: number) => string
  /** Active skills: hotkey and cooldown (s) at rank r. */
  key?: '1' | '2' | '3' | '4'
  cooldown?: (r: number) => number
}

/** Name for the hotbar button. */
export const hotbarName = (s: TreeSkill): string => s.short ?? s.name

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
  { id: 'polish', branch: 'gun', tier: 0, kind: 'passive', max: 5, name: '물총 손질', glyph: '손', text: (r) => `모든 피해 +${pct(0.05 * r)}` },
  { id: 'rhythm', branch: 'gun', tier: 1, kind: 'passive', max: 3, name: '두두두 리듬', glyph: '리', text: (r) => `연사 속도 +${pct(0.05 * r)}` },
  {
    id: 'overdrive', branch: 'gun', tier: 2, kind: 'active', max: 3, name: '과열 폭주', glyph: '폭', key: '2',
    text: (r) => `열기 폭발로 주변 일반 괴물을 한 방에 날려 버리고 ${biteText('wave', r)}! 그리고 ${5 + r}초 동안 연사 +60%, 치명타 +10%, 과열 없음`,
    cooldown: (r) => 24 - r * 2,
  },
  { id: 'star_eye', branch: 'gun', tier: 3, kind: 'passive', max: 3, name: '별빛 조준', glyph: '별', text: (r) => `치명타 확률 +${pct(0.03 * r)}, 치명타 피해 +${pct(0.1 * r)}` },
  { id: 'dream_pierce', branch: 'gun', tier: 4, kind: 'passive', max: 1, name: '꿈 관통', glyph: '관', text: () => '물방울이 괴물 하나를 더 꿰뚫는다' },
  // 비눗방울 폭탄
  {
    id: 'bubble_bomb', branch: 'bubble', tier: 0, kind: 'active', max: 5, name: '거품 폭탄', glyph: '거', key: '1',
    text: (r) => `조준한 곳에 큰 비눗방울을 던져 펑! 일반 괴물 무리를 크게 깎고 ${biteText('bomb', r)}`,
    cooldown: () => 16,
  },
  { id: 'big_bubble', branch: 'bubble', tier: 1, kind: 'passive', max: 3, name: '왕방울', glyph: '왕', text: (r) => `거품 폭탄 범위 +${pct(0.15 * r)}` },
  { id: 'sticky_soap', branch: 'bubble', tier: 2, kind: 'passive', max: 3, name: '끈적 비누', glyph: '끈', text: (r) => `폭탄 맞은 괴물이 2초 느려지고, 폭탄 대기 -${(0.6 * r).toFixed(1)}초` },
  { id: 'pop_chain', branch: 'bubble', tier: 3, kind: 'passive', max: 3, name: '톡톡 연쇄', glyph: '연', text: (r) => `처치할 때 ${pct(0.08 * r)} 확률로 작은 방울이 터진다` },
  { id: 'sparkle_heart', branch: 'bubble', tier: 4, kind: 'passive', max: 1, name: '반짝 마음', glyph: '빛', text: () => '모든 물방울에 반짝 속성 +12%' },
  // 모찌와 함께
  { id: 'fluffy', branch: 'mochi', tier: 0, kind: 'passive', max: 5, name: '폭신 털', glyph: '털', text: (r) => `최대 체력 +${pct(0.06 * r)}` },
  {
    id: 'mochi_rush', branch: 'mochi', tier: 1, kind: 'active', max: 3, name: '모찌 돌진', glyph: '냥', key: '3',
    text: (r) => `모찌가 조준한 쪽으로 쌩! 지나간 길의 일반 괴물은 날아가고 ${biteText('rush', r)}`,
    cooldown: () => 18,
  },
  { id: 'purr', branch: 'mochi', tier: 2, kind: 'passive', max: 3, name: '골골 회복', glyph: '골', text: (r) => `자연 회복 +${pct(0.3 * r)}, 더 빨리 시작` },
  {
    id: 'candy_aura', branch: 'mochi', tier: 3, kind: 'active', max: 3, name: '하트 사탕 오라', short: '사탕 오라', glyph: '사', key: '4',
    text: (r) => `6초 동안 매초 최대 체력 ${pct(auraHeal(r))} 회복, 받는 피해 -20%, 곁의 괴물은 사탕에 녹아(${biteText('aura', r)})`,
    cooldown: () => 28,
  },
  { id: 'lucky_bell', branch: 'mochi', tier: 4, kind: 'passive', max: 2, name: '행운 방울', glyph: '복', text: (r) => `행운 +${10 * r} (좋은 장비가 더 자주)` },
]

export const TREE_BY_ID: Record<string, TreeSkill> = Object.fromEntries(TREE.map((s) => [s.id, s]))
export const ACTIVES: ActiveId[] = ['bubble_bomb', 'overdrive', 'mochi_rush', 'candy_aura']

/** Bubble bomb base damage at rank r (before the damage multiplier). */
export type SkillKind = 'bomb' | 'wave' | 'rush' | 'aura' | 'chain'
/** (fix/gun-identity, see combat/skills.ts skillBite) */
/**
 * Balance pass (user: "스킬이 너무 셈 · 최대 체력 % 한 방"): a cast now takes 12–18% off an elite and
 * 4–6% off the boss; only the big-cooldown 과열 폭주 wave (and the 28 s aura, over its pulses) wipes a
 * normal pack, the 16 s bomb and 18 s rush leave it at ~25–30%. Skills land ~25–35% of a boss fight.
 */
export const SKILL_BITE: Record<SkillKind, { n: number; elite: number; boss: number; rank: number }> = {
  bomb: { n: 0.75, elite: 0.14, boss: 0.04, rank: 0.005 },
  wave: { n: 1.05, elite: 0.16, boss: 0.05, rank: 0.005 },
  rush: { n: 0.7, elite: 0.14, boss: 0.04, rank: 0.005 },
  aura: { n: 1.6, elite: 0.15, boss: 0.045, rank: 0.005 },
  chain: { n: 0.3, elite: 0.02, boss: 0.006, rank: 0 },
}
/** 1장 튜토리얼 (town foes): the pre-balance-pass numbers, untouched. */
export const SKILL_BITE_TOWN: Record<SkillKind, { n: number; elite: number; boss: number; rank: number }> = {
  bomb: { n: 1.05, elite: 0.33, boss: 0.18, rank: 0.015 },
  wave: { n: 1.05, elite: 0.32, boss: 0.17, rank: 0.03 },
  rush: { n: 1.05, elite: 0.34, boss: 0.18, rank: 0.03 },
  aura: { n: 3, elite: 0.32, boss: 0.16, rank: 0.03 },
  chain: { n: 0.6, elite: 0.05, boss: 0.015, rank: 0 },
}

/** "정예 33%·보스 18%" for a skill at rank r (tooltips). */
export function biteText(kind: SkillKind, r: number): string {
  const t = SKILL_BITE[kind]
  const up = t.rank * Math.max(0, r - 1)
  return `정예 ${pct(t.elite + up)}·보스 ${pct(t.boss + up)}`
}
export function bombDamage(r: number): number {
  return 45 + 20 * Math.max(1, r)
}
export function bombRadius(bigRank: number): number {
  return 3.4 * (1 + 0.15 * bigRank)
}
export function rushDamage(r: number): number {
  return 40 + 20 * Math.max(1, r)
}
export function auraHeal(r: number): number {
  return 0.05 + 0.015 * Math.max(1, r)
}
