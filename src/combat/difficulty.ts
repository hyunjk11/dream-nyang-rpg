/**
 * Every difficulty knob in one place. The first playtest said "too hard" (the wave hordes), the
 * explore floors that replaced them then read "too easy", so these defaults sit between:
 * fuller packs that hit harder and swing sooner, slower regen, fewer heart candies, elites that
 * enrage and charge, and a steeper climb per floor and per depth.
 * Multipliers are on the raw tables (HORDE, FOE_SPECS, BOSS); 1 = the old value.
 */
export const DIFFICULTY = {
  hero: {
    /** Was 100. */
    maxHp: 150,
    /** Mercy seconds after a hit (was 0.45). She blinks the whole time. */
    iframes: 0.85,
    /** Health comes back after this long without a hit... */
    regenDelay: 3,
    /** ...at this many HP per second. */
    regenRate: 7,
  },
  /** Sewer horde (multipliers on HORDE). */
  horde: {
    /**
     * Was 0.78, then 1.3 ("still melting"): measured with real kits and every proc (fix3/ttk.cjs), a slime
     * died in 0.1-0.4 s. Now a regular foe takes about 2-3 s of sustained fire from a typical player at
     * its depth (starter water gun on depth 1 floor 1: ~3 s), a knight ~5 s.
     */
    hp: 8.6,
    /** Was 0.62: tougher foes hit a little softer, so a fight lasts longer without being deadlier. */
    /** Was 0.36: fights last ~8× longer, so each swing lands softer and less often (cooldown 1.45 → 2.1 s). 0.18 → 0.15 to smooth depth 3. */
    damage: 0.15,
    speed: 0.92,
    /** Wind-up stays readable (0.44 s) so a step or a dash still leaves the swing. The rest between swings was 2.1 s: a pack on top of her only landed ~7 hits in 10 s. 1.55 s keeps the telegraph and closes that long breath. */
    windup: 0.44,
    cooldown: 1.55,
  },
  /**
   * Elite multipliers (were hp 4.5, damage 2). hp is ×6.5 a slime-sized foe; bigger kinds get only
   * (kind hp / slime hp)^hpKindPow of their size on top, so every elite is a ~15-25 s fight. Plus their extra tricks: below rageAt of their hp
   * they enrage (faster, harder hits), and every chargeEvery s they crouch for chargeWind s and
   * then charge at chargeSpeed× for chargeTime s when she is chargeMin..chargeMax m away.
   */
  elite: { hp: 6.5, hpKindPow: 0.25, damage: 1, rageAt: 0.5, rageSpeed: 1.3, rageDamage: 1.1, chargeMin: 3.5, chargeMax: 9, chargeWind: 0.55, chargeTime: 0.45, chargeSpeed: 3.2, chargeEvery: 6 },
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
  /** hp was 2 (a ~10 s boss): now ~60-90 s of fire from a typical player at that depth. */
  boss: { hp: 15, damage: 0.55, orbSpeed: 0.95, ringCount: 0.85 },
  /**
   * The delve: depth (act) → floors 1..3 + a boss floor. Depth 1, floor 1 is exactly the old
   * sewer (all multipliers 1, wave roster from wave 1); everything after creeps up gently.
   */
  delve: {
    /** Normal floors per depth before the boss floor. */
    floors: 3,
    /** Foe hp / damage growth per extra floor inside a depth (hp +50%: gear and levels grow fast; damage +4%). */
    hpPerFloor: 0.08,
    damagePerFloor: 0.04,
    /** ...and per extra depth: hp ×2.35 each depth (geometric, like the gear), damage +8% (was 14%: depth 3 was a wall in the sim). */
    hpDepthGrowth: 1.45,
    damagePerDepth: 0.08,
    /** Floors start this many waves further into the roster (floor 1 of depth 1 = wave 1). */
    wavesPerFloor: 1,
    wavesPerDepth: 2,
    /**
     * Depth 2 comes in gently: floors 1, 2, 3 of depth 2 carry only this share of the depth step
     * (foe hp/damage, extra packs, the second elite affix); the boss floor and
     * every deeper depth carry all of it. The headless sim (tools/sim-floor.ts) showed new players
     * hitting a wall there (0 → 8 deaths in 10 from floor 1 to floor 3 with depth-1 gear).
     */
    entryEase: [0.5, 0.7, 0.75] as readonly number[],
    /** Foe hp share of the depth step on depth 2's normal floors (2.35^share), falling as the floor bonus grows so depth-1 gear still gets through (sim, new player + depth-1 gear: d2f3 16→6/20). */
    entryHpEase: [0.82, 0.7, 0.6] as readonly number[],
    /** ...and their explore packs draw from the roster this many tiers back (floor 3 met wave-6 kinds). */
    entryRoster: [0, 0, -1] as readonly number[],
    /** Survive floor: waves to outlast (floor 1 of depth 1 stays short and sweet). */
    surviveWaves: 3,
    /** Nest floor: pipes to plug. */
    nests: 3,
    /** Nest pipe hp (×foe hp scale). Roughly five slimes of water. */
    nestHp: 2000,
    /** Boss hp growth per depth (×1.75 each, geometric) and damage growth (+20%). */
    bossHpGrowth: 1.3,
    bossDamagePerDepth: 0.2,
    /** Gold drop growth per depth. */
    goldPerDepth: 0.35,
    /** Fall down there: this share of the gold picked up this run is dropped (items are kept). */
    deathGoldLoss: 0.3,
  },
  /** Island town foes (multipliers on FOE_SPECS). */
  /**
   * 챕터 1 튜토리얼 지역 (몽환의 숲 · 버섯 골짜기 · 별빛 제단). hp 11 made a slime a 2.7 s chew and an
   * elite ~10 s: far too much for the guide. Now, with the starter gun (137 DPS): normals 0.55-0.9 s,
   * elites (×elite) 4.6-5.4 s, the altar's bloom (×bossHp) ~25 s. skillHp keeps the skills' town
   * numbers where they were. The sewer, its boss floors and the 꿈 미로 use DIFFICULTY.horde, not this.
   */
  town: { hp: 3, elite: 6.8, bossHp: 4.9, skillHp: 11, damage: 0.32, speed: 0.9, windup: 1.3 },
} as const

/** Sewer wave size for wave n (1-based). */
export function waveSize(n: number): number {
  const w = DIFFICULTY.waves
  const k = n - 1
  const ease = w.ease[k] ?? 1
  return Math.max(4, Math.min(w.max, Math.round((w.base + w.step * k + w.curve * k * k) * ease)))
}

/**
 * There is no difficulty setting any more (fix/real-play): one tuned baseline for everyone. The old
 * title-card pick (쉬움/보통/어려움) lived in localStorage under this key; it is dropped on load.
 */
export const OLD_DIFF_KEY = 'dnr3d.difficulty'
export function dropOldDifficulty(store: { removeItem(k: string): void } | null | undefined = globalThis.localStorage): void {
  try {
    store?.removeItem(OLD_DIFF_KEY)
  } catch {
    // storage blocked: nothing to drop
  }
}
