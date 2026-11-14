/**
 * How Byeolha holds each toy gun (2026-11, "저격총같은건 양손으로", "물총은 쌍권총도 가능"):
 * - pistol: one water pistol in the right hand (한 손), the left arm free.
 * - dual: a water pistol in each hand (보조 손에 두 번째 총), shots alternate left/right, each hand kicks on its own.
 * - rifle / shotgun / sniper: one gun in front, main hand on the grip, off hand on the foregrip,
 *   barrel along the camera; recoil shoves the whole pose (both hands ride the gun).
 * Pure numbers, no Three.js, so the choices are tested.
 */
import type { WeaponKind } from '../sim/types'

export type HoldType = 'pistol' | 'dual' | 'rifle' | 'shotgun' | 'sniper'

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
  // 한 손 권총: one gun out in the right hand, a touch off-centre, quick light kicks.
  pistol: { type: 'pistol', label: '한 손 권총', twoHanded: false, dual: false, reach: { fwd: 0.02, right: 0.12, up: 0.03 }, centre: true, fore: 0, kickBack: 0.042, kickUp: 8, settle: 16, pitch: 0 },
  // 쌍권총: both arms out, guns a hand-width apart. Each hand's kick is lighter and returns before that hand fires again.
  dual: { type: 'dual', label: '쌍권총 (한 손씩)', twoHanded: false, dual: true, reach: { fwd: 0.02, right: 0.17, up: 0.03 }, centre: true, fore: 0, kickBack: 0.032, kickUp: 6, settle: 22, pitch: 0 },
  // 3점사 소총: tucked in at the chest, off hand on the barrel. A short climb across the burst, then it settles in the rest.
  rifle: { type: 'rifle', label: '양손 소총 (가슴 앞)', twoHanded: true, dual: false, reach: { fwd: -0.02, right: 0.035, up: 0.05 }, centre: true, fore: 0.62, kickBack: 0.05, kickUp: 8, settle: 9, pitch: 1 },
  // 비눗방울 산탄총: held low at the hip, one big shove and muzzle climb (펑!), mostly straight up.
  shotgun: { type: 'shotgun', label: '양손 산탄총 (허리춤)', twoHanded: true, dual: false, reach: { fwd: -0.04, right: 0.05, up: -0.03 }, centre: true, fore: 0.56, kickBack: 0.12, kickUp: 18, settle: 5.2, pitch: 2 },
  // 저격총: shouldered high, one heavy slow kick (탕!) that is gone before the next shot.
  sniper: { type: 'sniper', label: '양손 저격총 (어깨 견착)', twoHanded: true, dual: false, reach: { fwd: -0.07, right: 0.02, up: 0.11 }, centre: true, fore: 0.7, kickBack: 0.16, kickUp: 15, settle: 2.8, pitch: 2 },
}

/** Which hold each gun base uses. */
export const HOLD_OF: Record<WeaponKind, HoldType> = {
  water: 'pistol',
  star: 'rifle',
  bubble: 'shotgun',
  dart: 'sniper',
}

/** The hold for this gun base; `paired` = a second one-handed gun in the off hand (쌍권총). */
export function holdFor(kind: WeaponKind, paired = false): HoldStyle {
  const t = HOLD_OF[kind] ?? 'pistol'
  return HOLD_STYLES[t === 'pistol' && paired ? 'dual' : t]
}

/** Which hand fires shot number n (1-based, Gun.shots): dual guns alternate, starting right. */
export function firingHand(style: Pick<HoldStyle, 'dual'>, n: number): 'right' | 'left' {
  return style.dual && n % 2 === 0 ? 'left' : 'right'
}

/** Recoil envelope 0..1 after a kick: snaps to 1, eases back at `settle` per second. */
export function settleKick(t: number, dt: number, settle: number): number {
  return Math.max(0, t - dt * settle)
}
