/**
 * 보조 손 · 쌍권총: one-handed guns (the water pistol) can go in the main hand alone (one-hand hold)
 * or one in each hand. With two, each hand fires its own gun (own +N, options, element, parts) and
 * the shots alternate; the pair fires DUAL_PACE× as many shots as one gun (two equal guns ≈ 1.7× DPS).
 * Two-handed guns (shotgun, rifle, sniper) take both hands, so the off hand is empty with one.
 * Skills scale off the main hand (computeStats is the main hand's view; the off gun is not in it).
 */
import type { GunProfile } from '../data/guns'
import { ITEMS } from '../data/items'
import { bagItems, equipItem, findItem, ONE_HANDED_GUNS, oneHanded } from './inventory'
import { computeStats, equippedItems, type ComputedStats } from './stats'
import { BAG_CAP, type ItemInstance, type SaveData, type WeaponKind } from './types'


/** Gun bases held in one hand. */
export const ONE_HANDED = ONE_HANDED_GUNS
/** Shots of a two-gun pair vs one gun (each shot uses its own hand's gun). */
export const DUAL_PACE = 1.7

export function gunKindOf(item: ItemInstance | undefined): WeaponKind | undefined {
  return item ? ITEMS[item.defId]?.gun : undefined
}

export const isOneHanded = oneHanded

export function mainGun(save: SaveData): ItemInstance | undefined {
  return findItem(save, save.equipment.weapon)
}

/** The off-hand gun if the pair is legal (both one-handed), else undefined. */
export function offGun(save: SaveData): ItemInstance | undefined {
  const off = findItem(save, save.equipment.offhand)
  if (!off || off.uid === save.equipment.weapon || !isOneHanded(off) || !isOneHanded(mainGun(save))) return undefined
  return off
}

/** Drop an off-hand that no longer fits (old saves, a two-handed main gun). */
export function fixHands(save: SaveData): void {
  if (save.equipment.offhand && !offGun(save)) delete save.equipment.offhand
}

export interface HandResult {
  ok: boolean
  reason?: string
}

/** '보조 손에 차기': a one-handed gun into the off hand (clear message for a two-handed one). */
export function equipOffhand(save: SaveData, uid: string): HandResult {
  const r = equipItem(save, uid, 'offhand')
  return { ok: r.ok, reason: r.reason }
}

export function unequipOffhand(save: SaveData): HandResult {
  if (!save.equipment.offhand) return { ok: false, reason: '보조 손이 비어 있어.' }
  if (bagItems(save).length >= BAG_CAP) return { ok: false, reason: '가방이 가득 찼어.' }
  delete save.equipment.offhand
  return { ok: true }
}

/** Main-hand stats (= computeStats) and, with a pair, the off hand's own view: same body and gear, its own gun. */
export function handStats(save: SaveData): { main: ComputedStats; off: ComputedStats | null } {
  const main = computeStats(save)
  const off = offGun(save)
  if (!off) return { main, off: null }
  const rest = equippedItems(save).filter((i) => i.uid !== save.equipment.weapon)
  return { main, off: computeStats(save, [off, ...rest]) }
}

/** Seconds between shots of one gun on its own (bursts averaged). */
export function shotInterval(p: GunProfile, rate: number): number {
  const r = Math.max(0.25, rate)
  return p.burst > 0 ? (p.burst * p.gap + p.burstRest) / p.burst / r : p.gap / r
}

/** Average damage of one trigger pull from this hand (pellets, crits; no procs or pierce). */
export function shotValue(s: ComputedStats): number {
  return s.shotDamage * Math.max(1, s.gun.pellets) * (1 + s.critChance * (s.critMul - 1))
}

export interface HandDps {
  main: number
  off: number
  total: number
  /** Total vs the main gun alone (1 without a pair). */
  vsOne: number
}

/** Sustained DPS per hand and in total (no heat or overdrive). */
export function handDps(save: SaveData): HandDps {
  const { main, off } = handStats(save)
  const im = shotInterval(main.gun, main.fireRate)
  const solo = shotValue(main) / im
  if (!off) return { main: solo, off: 0, total: solo, vsOne: 1 }
  const cycle = (im + shotInterval(off.gun, off.fireRate)) / DUAL_PACE
  const m = shotValue(main) / cycle
  const o = shotValue(off) / cycle
  return { main: m, off: o, total: m + o, vsOne: (m + o) / solo }
}

/** Cadence for the shared trigger: a pair fires DUAL_PACE× the harmonic mean of the two guns' rates. */
export function pairRate(main: ComputedStats, off: ComputedStats | null): number {
  if (!off) return main.fireRate
  const im = shotInterval(main.gun, main.fireRate)
  const io = shotInterval(off.gun, off.fireRate)
  return main.fireRate * (2 * DUAL_PACE * im) / (im + io)
}

