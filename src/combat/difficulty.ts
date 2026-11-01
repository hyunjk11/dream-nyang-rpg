/**
 * Every difficulty knob in one place. The first playtest said "too hard" (the wave hordes), the
 * explore floors that replaced them then read "too easy", so these defaults (보통) sit between:
 * fuller packs that hit harder and swing sooner, slower regen, fewer heart candies, elites that
 * enrage and charge, and a steeper climb per floor and per depth. 쉬움/어려움 scale on top (DIFF_MODES).
 * Multipliers are on the raw tables (HORDE, FOE_SPECS, BOSS); 1 = the old value.
 */
export const DIFFICULTY = {
  hero: {
    /** Was 100. */
    maxHp: 150,
    /** Mercy seconds after a hit (was 0.45). She blinks the whole time. */
    iframes: 0.85,
    /** Health comes back after this long without a hit... */
    regenDelay: 3.8,
    /** ...at this many HP per second. */
    regenRate: 5.5,
  },
  /** Sewer horde (multipliers on HORDE). */
  horde: {
    hp: 0.78,
    damage: 0.62,
    speed: 0.92,
    /** Longer, easier-to-read melee wind-up (was 0.32 s) and a longer rest between swings (was 1.1 s). */
    windup: 0.44,
    cooldown: 1.45,
  },
  /**
   * Elite multipliers (were hp 4.5, damage 2), plus their extra tricks: below rageAt of their hp
   * they enrage (faster, harder hits), and every chargeEvery s they crouch for chargeWind s and
   * then charge at chargeSpeed× for chargeTime s when she is chargeMin..chargeMax m away.
   */
  elite: { hp: 3.5, damage: 1.6, rageAt: 0.5, rageSpeed: 1.3, rageDamage: 1.25, chargeMin: 3.5, chargeMax: 9, chargeWind: 0.55, chargeTime: 0.45, chargeSpeed: 3.2, chargeEvery: 6 },
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
    /** Live cap on foes on the boss floor (was 200, then 140: 100+ at once dropped frames on weak PCs). */
    liveCap: 70,
  },
  /** The sewer boss (multipliers on BOSS). */
  boss: { hp: 0.95, damage: 0.75, orbSpeed: 0.95, ringCount: 0.85 },
  /**
   * The delve: depth (act) → floors 1..3 + a boss floor. Depth 1, floor 1 is exactly the old
   * sewer (all multipliers 1, wave roster from wave 1); everything after creeps up gently.
   */
  delve: {
    /** Normal floors per depth before the boss floor. */
    floors: 3,
    /** Foe hp / damage growth per extra floor inside a depth (+6% / +4%). */
    hpPerFloor: 0.06,
    damagePerFloor: 0.04,
    /** ...and per extra depth (+27% / +14%). */
    hpPerDepth: 0.27,
    damagePerDepth: 0.14,
    /** Floors start this many waves further into the roster (floor 1 of depth 1 = wave 1). */
    wavesPerFloor: 1,
    wavesPerDepth: 2,
    /** Survive floor: waves to outlast (floor 1 of depth 1 stays short and sweet). */
    surviveWaves: 3,
    /** Nest floor: pipes to plug. */
    nests: 3,
    /** Nest pipe hp (×foe hp scale). Roughly five slimes of water. */
    nestHp: 110,
    /** Boss hp / damage growth per depth. */
    bossHpPerDepth: 0.45,
    bossDamagePerDepth: 0.2,
    /** Gold drop growth per depth. */
    goldPerDepth: 0.35,
    /** Fall down there: this share of the gold picked up this run is dropped (items are kept). */
    deathGoldLoss: 0.3,
  },
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

/** Selectable difficulty (title screen). 보통 is the default tuning above. */
export type DiffMode = 'easy' | 'normal' | 'hard'
export const DIFF_MODES: Record<DiffMode, { label: string; foeHp: number; foeDamage: number; regen: number; potion: number }> = {
  easy: { label: '쉬움', foeHp: 0.75, foeDamage: 0.6, regen: 1.6, potion: 1.6 },
  normal: { label: '보통', foeHp: 1, foeDamage: 1, regen: 1, potion: 1 },
  hard: { label: '어려움', foeHp: 1.3, foeDamage: 1.3, regen: 0.7, potion: 0.7 },
}
export const DIFF_KEY = 'dnr3d.difficulty'
let mode: DiffMode = 'normal'
try {
  const raw = globalThis.localStorage?.getItem(DIFF_KEY)
  if (raw === 'easy' || raw === 'normal' || raw === 'hard') mode = raw
} catch {
  // storage blocked: keep 보통
}

export function diffMode(): DiffMode {
  return mode
}

/** Multipliers for the current mode. */
export function diff(): (typeof DIFF_MODES)[DiffMode] {
  return DIFF_MODES[mode]
}

export function setDiffMode(m: DiffMode): DiffMode {
  mode = m
  try {
    globalThis.localStorage?.setItem(DIFF_KEY, m)
  } catch {
    // ignore
  }
  return mode
}
