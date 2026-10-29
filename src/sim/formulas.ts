export interface DamageInput {
  atk: number
  weaponDamage: number
  multiplier: number
  targetDef: number
  critChance: number
  critMultiplier: number
  forceCrit?: boolean
  rng?: () => number
}

export function calcDamage(input: DamageInput): { amount: number; crit: boolean } {
  const rng = input.rng ?? Math.random
  const raw = (input.weaponDamage + input.atk * 0.65) * input.multiplier
  const def = Math.max(0, input.targetDef)
  const mitigated = raw * (100 / (100 + def * 2))
  const crit = Boolean(input.forceCrit) || rng() < input.critChance
  const amount = Math.max(1, Math.round(mitigated * (crit ? input.critMultiplier : 1)))
  return { amount, crit }
}

export function xpToNext(level: number): number {
  return Math.floor(30 + 18 * level + 4 * level * level)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
