/**
 * 고정 전설 (fixed legendaries): seven named guns with set options, a look of their own and one
 * place each that drops them. They always roll 전설, sit on a gun base, and take mods like any gun.
 */
import type { AreaId } from '../sim/areas'
import type { StatKey, WeaponKind } from '../sim/types'

export type LegendSource =
  | { kind: 'boss'; depth: number }
  | { kind: 'areaBoss'; area: AreaId }
  | { kind: 'areaChest'; area: AreaId }
  | { kind: 'mazeElite' }

export interface LegendDef {
  id: string
  name: string
  gun: WeaponKind
  /** Option values at iLv 1 (scaled by iLv × the 전설 rarity power like any affix). pierce is flat. */
  stats: Partial<Record<StatKey, number>>
  /** One-line signature for the card and the 도감. */
  signature: string
  /** Where it drops (first match wins); the 도감 shows this as a hint before it is found. */
  sources: LegendSource[]
  where: string
  look: { body: number; tank: number; barrel: number; tracer: number; barrelLen: number; size: number }
}

export const LEGENDS: LegendDef[] = [
  {
    id: 'leg_starrain', name: '별비 개틀링', gun: 'water',
    stats: { fireRate: 0.18, starShot: 0.12, damage: 0.05 },
    signature: '쏟아지는 물줄기 사이로 별비가 튄다 · 연사 대폭 상승',
    sources: [{ kind: 'boss', depth: 1 }], where: '깊이 1 보스 · 악몽 꽃',
    look: { body: 0xfff0a8, tank: 0xffd35a, barrel: 0xffe9a0, tracer: 0xfff3b0, barrelLen: 1.35, size: 1.08 },
  },
  {
    id: 'leg_cotton', name: '솜사탕 교란기', gun: 'bubble',
    stats: { cloud: 0.16, candy: 0.2, lifesteal: 0.014, damage: 0.05 },
    signature: '맞은 자리마다 끈적한 솜사탕 구름 · 몰려오는 무리를 붙잡는다',
    sources: [{ kind: 'boss', depth: 2 }], where: '깊이 2 보스',
    look: { body: 0xffc6e5, tank: 0xffffff, barrel: 0xff9fd6, tracer: 0xffd6ee, barrelLen: 0.85, size: 1.2 },
  },
  {
    id: 'leg_dunbar', name: '꿈결 던바', gun: 'star',
    stats: { damage: 0.13, critDamage: 0.28, sparkle: 0.13 },
    signature: '세 발 점사가 꿈결처럼 겹친다 · 치명타가 터지면 별빛이 번진다',
    sources: [{ kind: 'boss', depth: 3 }], where: '깊이 3 보스',
    look: { body: 0x8f7bff, tank: 0xffe08a, barrel: 0xc9b8ff, tracer: 0xffeeb0, barrelLen: 1.6, size: 1.08 },
  },
  {
    id: 'leg_mochi', name: '모찌 발바닥 물총', gun: 'water',
    stats: { mochi: 0.45, luck: 16, damage: 0.05, fireRate: 0.06 },
    signature: '모찌가 신나서 돌진이 훨씬 세진다 · 젤리 발바닥 도장이 찍힌 물총',
    sources: [{ kind: 'mazeElite' }, { kind: 'areaChest', area: 'loft' }], where: '꿈 미로 모찌 퀘스트 정예 · 구름 다락 상자',
    look: { body: 0xffb36b, tank: 0xfff1d6, barrel: 0xff8fa3, tracer: 0xffe2c4, barrelLen: 1, size: 1.05 },
  },
  {
    id: 'leg_whisper', name: '속삭이는 방울총', gun: 'bubble',
    stats: { fireRate: 0.11, sparkle: 0.11, cloud: 0.08, damage: 0.05 },
    signature: '퐁퐁 터질 때마다 누군가 이름을 부르는 소리 · 반짝 구름',
    sources: [{ kind: 'areaChest', area: 'loft' }], where: '구름 다락 보물 상자',
    look: { body: 0xd8f6ff, tank: 0xbfe9ff, barrel: 0x9fe6ff, tracer: 0xe9f7ff, barrelLen: 0.8, size: 1.15 },
  },
  {
    id: 'leg_pierce', name: '별꿰기 저격총', gun: 'dart',
    stats: { pierce: 2, critChance: 0.05, critDamage: 0.2, damage: 0.06 },
    signature: '한 줄로 선 괴물을 별처럼 꿰뚫는다 · 관통 +2',
    sources: [{ kind: 'areaChest', area: 'tower' }], where: '멈춘 시계탑 보물 상자',
    look: { body: 0x5b6fd6, tank: 0xffe066, barrel: 0xbfe9ff, tracer: 0xfff6c4, barrelLen: 2.15, size: 1.1 },
  },
  {
    id: 'leg_moth', name: '밤나방 달빛총', gun: 'star',
    stats: { ice: 0.22, lifesteal: 0.022, damage: 0.09 },
    signature: '달빛 가루가 서리처럼 내려앉는다 · 맞힐수록 조금씩 회복',
    sources: [{ kind: 'areaBoss', area: 'moon' }], where: '달빛 둥지 · 꿈먹는 밤나방',
    look: { body: 0x3d3566, tank: 0xbfe9ff, barrel: 0x9fd8ff, tracer: 0xd6f0ff, barrelLen: 1.5, size: 1.08 },
  },
]

export const LEGEND_BY_ID: Record<string, LegendDef> = Object.fromEntries(LEGENDS.map((l) => [l.id, l]))
