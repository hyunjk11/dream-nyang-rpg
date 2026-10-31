/**
 * Every difficulty knob in one place. The first playtest said "too hard", so the defaults below
 * are a clearly gentler game: more health that comes back, longer mercy after a hit, foes that
 * hit softer, die sooner and wind up longer, and sewer waves that start small and ramp up.
 * Multipliers are on the raw tables (HORDE, FOE_SPECS, BOSS); 1 = the old value.
 */
export const DIFFICULTY = {
  hero: {
    /** Was 100. */
    maxHp: 150,
    /** Mercy seconds after a hit (was 0.45). She blinks the whole time. */
    iframes: 0.95,
    /** Health comes back after this long without a hit... */
    regenDelay: 3.2,
    /** ...at this many HP per second. */
    regenRate: 7,
  },
  /** Sewer horde (multipliers on HORDE). */
  horde: {
    hp: 0.72,
    damage: 0.55,
    speed: 0.86,
    /** Longer, easier-to-read melee wind-up (was 0.32 s) and a longer rest between swings (was 1.1 s). */
    windup: 0.48,
    cooldown: 1.6,
  },
  /** Elite multipliers (were hp 4.5, damage 2). */
  elite: { hp: 3.2, damage: 1.5 },
  /** Sewer waves: size = base + step·(n-1) + curve·(n-1)², times the early ease. */
  waves: {
    base: 8,
    step: 6,
    curve: 1.2,
    max: 110,
    /** First waves are smaller still: wave 1 ×0.6, wave 2 ×0.75, wave 3 ×0.9. */
    ease: [0.6, 0.75, 0.9] as readonly number[],
    /** Foes per second out of the pipes (was 9), +rampPerWave per wave (was 0.12). */
    pour: 4.5,
    rampPerWave: 0.1,
    /** Elites appear from this wave (was 2). */
    firstElite: 3,
    /** Breather between waves (s, was 4). */
    rest: 6,
    /** Live cap on foes (was 200). */
    liveCap: 140,
  },
  /** The sewer boss (multipliers on BOSS). */
  boss: { hp: 0.7, damage: 0.55, orbSpeed: 0.85, ringCount: 0.72 },
  /** Island town foes (multipliers on FOE_SPECS). */
  town: { hp: 0.8, damage: 0.6, speed: 0.9, windup: 1.3 },
} as const

/** Sewer wave size for wave n (1-based). */
export function waveSize(n: number): number {
  const w = DIFFICULTY.waves
  const k = n - 1
  const ease = w.ease[k] ?? 1
  return Math.max(4, Math.min(w.max, Math.round((w.base + w.step * k + w.curve * k * k) * ease)))
}
