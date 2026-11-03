/**
 * 총 개조 부품: 조준경 · 총열 · 탄창 · 속성 칩 · 특수 부품 (도탄 · 뭉게 · 관통 · 쪽쪽). They drop like gear (rarity + iLv), sit in the bag,
 * and slot into a gun at the gunsmith (섬: 키키 · 몽실: 볼트). One of each kind per gun.
 */
import type { Element, StatKey } from '../sim/types'

export type ModKind = 'scope' | 'barrel' | 'mag' | 'chip' | 'trick'

export const MOD_KINDS: ModKind[] = ['scope', 'barrel', 'mag', 'chip', 'trick']

export const MOD_KO: Record<ModKind, string> = { scope: '조준경', barrel: '총열', mag: '탄창', chip: '속성 칩', trick: '특수 부품' }

export interface ModSpec {
  kind: ModKind
  /** Stats at iLv 1, common (scaled like gun affixes by iLv and rarity). */
  stats: Partial<Record<StatKey, number>>
  element?: Element
  /** 특수 부품: the gun effect it adds (stars, clouds, pierce, sip). */
  trick?: TrickId
}

/**
 * 특수 부품 (fix/mod-parts): the gun effects that used to come built into every gun (a star every
 * 7th droplet, a cloud on 5% of hits) or as rolled options are parts now. A gun takes up to
 * MAX_TRICKS different ones, and some pairs (and a trick with a chip) make a 조합 (COMBOS).
 */
export type TrickId = 'star' | 'cloud' | 'pierce' | 'sip'
export const MAX_TRICKS = 2
export const TRICK_KO: Record<TrickId, string> = { star: '도탄', cloud: '뭉게뭉게', pierce: '관통', sip: '쪽쪽 흡혈' }
/** What each trick does, for the tooltip (numbers come from the part's options). */
export const TRICK_TEXT: Record<TrickId, string> = {
  star: '7발마다(+확률) 별이 튀어나가 몹 사이를 통통 튕긴다',
  cloud: '맞힌 자리에 솜사탕 구름이 피어 안의 몹을 계속 간지럽힌다 (치명타면 더 자주)',
  pierce: '물방울이 괴물을 더 꿰뚫는다',
  sip: '준 피해의 일부만큼 체력을 쪽쪽 회복한다',
}

export type ComboId = 'fluffstar' | 'piercestar' | 'frostcloud' | 'sweetcloud' | 'sparkstar'
export interface ComboSpec {
  id: ComboId
  name: string
  /** Two traits: tricks or a chip element. */
  needs: [TrickId | Element, TrickId | Element]
  text: string
}
export const COMBOS: ComboSpec[] = [
  { id: 'fluffstar', name: '통통 솜사탕', needs: ['star', 'cloud'], text: '튕기는 별이 몹에 맞을 때마다 작은 솜사탕 구름을 피운다' },
  { id: 'piercestar', name: '꿰뚫는 별똥', needs: ['star', 'pierce'], text: '별이 2번 더 튀고 15% 더 아프다' },
  { id: 'sparkstar', name: '별빛 폭죽', needs: ['star', 'sparkle'], text: '별이 튈 때 별빛 폭죽이 터져 주변을 함께 친다' },
  { id: 'frostcloud', name: '서리 구름', needs: ['cloud', 'ice'], text: '구름이 하늘색 서리 구름이 되어 안의 몹을 꽁꽁 느리게 한다' },
  { id: 'sweetcloud', name: '달콤 구름', needs: ['cloud', 'sip'], text: '구름이 간지럽힐 때마다 그 피해의 일부만큼 회복한다' },
]
/** Combo numbers (kept small: a combo is a flavour, not a DPS spike). */
export const COMBO = { fluffShare: 0.4, pierceBounces: 2, pierceShare: 1.15, sparkShare: 0.25, sparkRadius: 1.3, frostSlow: 0.9, sweetShare: 0.25 }

/** defId → mod spec. The defs themselves live in ITEMS (name, icon, price) with `mod` set. */
export const MOD_SPECS: Record<string, ModSpec> = {
  mod_scope: { kind: 'scope', stats: { critChance: 0.018, critDamage: 0.08 } },
  mod_barrel: { kind: 'barrel', stats: { damage: 0.045 } },
  mod_mag: { kind: 'mag', stats: { fireRate: 0.04 } },
  mod_chip_sparkle: { kind: 'chip', stats: { sparkle: 0.07 }, element: 'sparkle' },
  mod_chip_ice: { kind: 'chip', stats: { ice: 0.08 }, element: 'ice' },
  mod_chip_candy: { kind: 'chip', stats: { candy: 0.08 }, element: 'candy' },
  mod_trick_star: { kind: 'trick', stats: { starShot: 0.05 }, trick: 'star' },
  mod_trick_cloud: { kind: 'trick', stats: { cloud: 0.05 }, trick: 'cloud' },
  mod_trick_pierce: { kind: 'trick', stats: { pierce: 1 }, trick: 'pierce' },
  mod_trick_sip: { kind: 'trick', stats: { lifesteal: 0.01 }, trick: 'sip' },
}

/** 특수 부품 def per trick (old-save migration, gifts). */
export const TRICK_PART: Record<TrickId, string> = { star: 'mod_trick_star', cloud: 'mod_trick_cloud', pierce: 'mod_trick_pierce', sip: 'mod_trick_sip' }

export const MOD_IDS = Object.keys(MOD_SPECS)

/** Tint each chip gives the gun's tank and tracer. */
export const CHIP_TINT: Record<Element, number> = { sparkle: 0xffe27a, ice: 0x9fe6ff, candy: 0xff9fd6 }
