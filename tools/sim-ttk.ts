// Headless time-to-kill table (run: npx vite-node tools/sim-ttk.ts): real hp formulas × in-game DPS of real kits.
// The DPS numbers are sustained single-target fire with every proc (star, candy, crits), measured in the
// browser by /workspace/fix3/ttk.cjs MODE=dps on kits from tools/ttk-kit.ts (2026-11-02, after the crit caps).
import { HORDE, hordeHp, type HordeKind } from '../src/world/dungeon/horde'
import { BOSS } from '../src/world/dungeon/boss'
import { EXPLORE } from '../src/world/dungeon/layout'
import { floorPlan, fieldPlan, BOSS_FLOOR } from '../src/sim/delve'
import { DIFFICULTY } from '../src/combat/difficulty'
import { FOE_SPECS } from '../src/combat/foes'

/** Typical / geared sustained DPS a player has on each floor (interpolated between the measured kits). */
export const REF_DPS: Record<string, [number, number]> = {
  d1f1: [137, 250], d1f2: [300, 400], d1f3: [450, 510], d1f4: [494, 600],
  d2f1: [550, 800], d2f2: [600, 1000], d2f3: [660, 1280], d2f4: [700, 1400],
  d3f1: [900, 1500], d3f2: [1300, 1700], d3f3: [1737, 1860], d3f4: [1800, 2000],
}
/** Share of a boss fight she can actually spend shooting (dodging rings, adds). */
export const BOSS_UPTIME = 0.75

const kinds: HordeKind[] = ['slime', 'bat', 'skeleton', 'knight', 'golem']
const s = (hp: number, dps: number) => (hp / dps).toFixed(1)
export function table(): string[] {
  const out: string[] = []
  out.push('층 | 기준 DPS(보통/좋은 장비) | ' + kinds.map((k) => `${k} 초`).join(' | ') + ' | 정예 슬라임 | 정예 기사 | 보스')
  for (let d = 1; d <= 3; d += 1)
    for (let f = 1; f <= BOSS_FLOOR; f += 1) {
      const plan = floorPlan(d, f)
      const [typ, gear] = REF_DPS[`d${d}f${f}`]
      const mul = plan.objective === 'boss' ? 1 : EXPLORE.hp
      const hp = (k: HordeKind, e = false) => hordeHp(k, plan.scale.hp * mul, e, 1)
      const cells = kinds.map((k) => `${s(hp(k), typ)}/${s(hp(k), gear)} (${hp(k)})`)
      const boss = plan.objective === 'boss' ? `${s(BOSS.hp * plan.scale.boss.hp, typ * BOSS_UPTIME)}/${s(BOSS.hp * plan.scale.boss.hp, gear * BOSS_UPTIME)} (${Math.round(BOSS.hp * plan.scale.boss.hp)})` : '-'
      out.push(`d${d}f${f} | ${typ}/${gear} | ${cells.join(' | ')} | ${s(hp('slime', true), typ)}/${s(hp('slime', true), gear)} | ${s(hp('knight', true), typ)}/${s(hp('knight', true), gear)} | ${boss}`)
    }
  const field = fieldPlan(1, { kills: 0, boss: true } as never)
  const fdps = REF_DPS.d1f2
  out.push(`들판 | ${fdps.join('/')} | 슬라임 ${s(hordeHp('slime', field.scale.hp * EXPLORE.hp, false, 1), fdps[0])}s · 악몽 꽃 ${s(BOSS.hp * field.scale.boss.hp, fdps[0] * BOSS_UPTIME)}/${s(BOSS.hp * field.scale.boss.hp, fdps[1] * BOSS_UPTIME)}s (${Math.round(BOSS.hp * field.scale.boss.hp)})`)
  const town = (k: keyof typeof FOE_SPECS) => FOE_SPECS[k].hp * DIFFICULTY.town.hp * (k === 'bloom' ? DIFFICULTY.town.bossHp : 1)
  out.push(`마을(시작 물총 137) | ` + (['slime', 'bat', 'bug', 'rabbit'] as const).map((k) => `${k} ${s(town(k), 137)}s`).join(' · ') + ` · bloom ${s(town('bloom'), 137 * BOSS_UPTIME)}s (${town('bloom')})`)
  return out
}
void HORDE
for (const l of table()) console.log(l)
