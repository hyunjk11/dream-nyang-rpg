/**
 * How Byeolha holds each toy gun (2026-11, "저격총같은건 양손으로", "물총은 쌍권총도 가능"):
 * - dual: a water pistol in each hand, shots alternate left/right (두두두), each hand kicks on its own.
 * - rifle / shotgun / sniper: one gun in front, main hand on the grip, off hand on the foregrip,
 *   barrel along the camera; recoil shoves the whole pose (both hands ride the gun).
 * Pure numbers, no Three.js, so the choices are tested.
 */
import type { WeaponKind } from '../sim/types'

export type HoldType = 'dual' | 'rifle' | 'shotgun' | 'sniper'

export interface HoldStyle {
  type: HoldType
  /** Korean label for tooltips and the QA report. */
  label: string
  /** Off hand on the foregrip (no second gun). */
  twoHanded: boolean
  /** A second gun in the left hand; shots alternate hands. */
  dual: boolean
  /**
   * Main-hand target offset (m, tuned for a 0.5 m arm like HOLD_POSES), added on top of the
   * walk/shoot pose. `right` replaces the pose's own sideways reach when `centre` is set.
   */
  reach: { fwd: number; right: number; up: number }
  /** Pull the hand toward her centre line (two-handed guns sit in front of her, not off to the side). */
  centre: boolean
  /** Where the off hand grabs, as a share of the grip→muzzle length (two-handed). */
  fore: number
  /** Per-shot pose recoil: shove back (m), muzzle climb (deg), how fast it settles (1/s). */
  kickBack: number
  kickUp: number
  settle: number
  /** Extra barrel pitch bias (deg) when raised: the sniper sights a touch higher. */
  pitch: number
}

export const HOLD_STYLES: Record<HoldType, HoldStyle> = {
  // 쌍권총: both arms out, guns a hand-width apart, light quick kicks that alternate.
  dual: { type: 'dual', label: '쌍권총 (한 손씩)', twoHanded: false, dual: true, reach: { fwd: 0.02, right: 0.17, up: 0.03 }, centre: true, fore: 0, kickBack: 0.05, kickUp: 10, settle: 14, pitch: 0 },
  // 3점사 소총: tucked in at the chest, off hand on the barrel, small tight kicks.
  rifle: { type: 'rifle', label: '양손 소총 (가슴 앞)', twoHanded: true, dual: false, reach: { fwd: -0.02, right: 0.035, up: 0.05 }, centre: true, fore: 0.62, kickBack: 0.045, kickUp: 5, settle: 12, pitch: 1 },
  // 비눗방울 산탄총: held low at the hip, big shove and muzzle climb (펑!).
  shotgun: { type: 'shotgun', label: '양손 산탄총 (허리춤)', twoHanded: true, dual: false, reach: { fwd: -0.04, right: 0.05, up: -0.03 }, centre: true, fore: 0.56, kickBack: 0.1, kickUp: 16, settle: 7, pitch: 2 },
  // 저격총: shouldered high near the eye line, long reach for the foregrip, a heavy slow kick (탕!).
  sniper: { type: 'sniper', label: '양손 저격총 (어깨 견착)', twoHanded: true, dual: false, reach: { fwd: -0.07, right: 0.02, up: 0.11 }, centre: true, fore: 0.7, kickBack: 0.13, kickUp: 11, settle: 5, pitch: 2 },
}

/** Which hold each gun base uses. */
export const HOLD_OF: Record<WeaponKind, HoldType> = {
  water: 'dual',
  star: 'rifle',
  bubble: 'shotgun',
  dart: 'sniper',
}

export function holdFor(kind: WeaponKind): HoldStyle {
  return HOLD_STYLES[HOLD_OF[kind] ?? 'dual']
}

/** Which hand fires shot number n (1-based, Gun.shots): dual guns alternate, starting right. */
export function firingHand(style: Pick<HoldStyle, 'dual'>, n: number): 'right' | 'left' {
  return style.dual && n % 2 === 0 ? 'left' : 'right'
}

/** Recoil envelope 0..1 after a kick: snaps to 1, eases back at `settle` per second. */
export function settleKick(t: number, dt: number, settle: number): number {
  return Math.max(0, t - dt * settle)
}
