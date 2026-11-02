// Shared by tools/sim-ttk.ts and tools/sim-floor.ts.
// Sustained single-target DPS with every proc, measured in the browser by /workspace/fix3/ttk.cjs MODE=dps
// on kits from tools/ttk-kit.ts (2026-11-02, after the crit caps); floors between kits are interpolated.
/** Typical / geared sustained DPS a player has on each floor (interpolated between the measured kits). */
export const REF_DPS: Record<string, [number, number]> = {
  d1f1: [137, 250], d1f2: [300, 400], d1f3: [450, 510], d1f4: [494, 600],
  d2f1: [550, 800], d2f2: [600, 1000], d2f3: [660, 1280], d2f4: [700, 1400],
  d3f1: [900, 1500], d3f2: [1300, 1700], d3f3: [1737, 1860], d3f4: [1800, 2000],
}
/** Share of a boss fight she can actually spend shooting (dodging rings, adds). */
