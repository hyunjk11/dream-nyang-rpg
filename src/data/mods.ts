/**
 * 총 개조 부품: 조준경 · 총열 · 탄창 · 속성 칩. They drop like gear (rarity + iLv), sit in the bag,
 * and slot into a gun at the gunsmith (섬: 키키 · 몽실: 볼트). One of each kind per gun.
 */
import type { Element, StatKey } from '../sim/types'

export type ModKind = 'scope' | 'barrel' | 'mag' | 'chip'

export const MOD_KINDS: ModKind[] = ['scope', 'barrel', 'mag', 'chip']

export const MOD_KO: Record<ModKind, string> = { scope: '조준경', barrel: '총열', mag: '탄창', chip: '속성 칩' }

export interface ModSpec {
  kind: ModKind
  /** Stats at iLv 1, common (scaled like gun affixes by iLv and rarity). */
  stats: Partial<Record<StatKey, number>>
  element?: Element
}

/** defId → mod spec. The defs themselves live in ITEMS (name, icon, price) with `mod` set. */
export const MOD_SPECS: Record<string, ModSpec> = {
  mod_scope: { kind: 'scope', stats: { critChance: 0.018, critDamage: 0.08 } },
  mod_barrel: { kind: 'barrel', stats: { damage: 0.045 } },
  mod_mag: { kind: 'mag', stats: { fireRate: 0.04 } },
  mod_chip_sparkle: { kind: 'chip', stats: { sparkle: 0.07 }, element: 'sparkle' },
  mod_chip_ice: { kind: 'chip', stats: { ice: 0.08 }, element: 'ice' },
  mod_chip_candy: { kind: 'chip', stats: { candy: 0.08 }, element: 'candy' },
}

export const MOD_IDS = Object.keys(MOD_SPECS)

/** Tint each chip gives the gun's tank and tracer. */
export const CHIP_TINT: Record<Element, number> = { sparkle: 0xffe27a, ice: 0x9fe6ff, candy: 0xff9fd6 }
