// Skill punch before/after fix/gun-identity (run: npx vite-node tools/sim-skills.ts).
// Per depth: share of max HP one cast takes off normals / elites / the boss, and time-to-kill
// (gun at REF_DPS typical, plus every learned skill fired on cooldown) for a normal pack, an elite
// knight and the boss. "전" is the old flat formula (base × damageMul × 2.9 × floor HP × tone 1/2/4).
import { hordeHp, type HordeKind } from '../src/world/dungeon/horde'
import { BOSS } from '../src/world/dungeon/boss'
import { EXPLORE } from '../src/world/dungeon/layout'
import { floorPlan, BOSS_FLOOR } from '../src/sim/delve'
import { SKILL_POWER, SKILL_REF_MUL, skillBite, type SkillKind } from '../src/combat/skills'
import { TREE_BY_ID } from '../src/data/tree'
import { REF_DPS } from './sim-ttk-ref'

const BOSS_UPTIME = 0.75
/** Opening order: bomb, then Mochi, then the overdrive wave, then the aura (s after the first shot). */
const AT: Record<string, number> = { bomb: 0, rush: 0.6, wave: 1.2, aura: 1.8 }

const OLD = { tone: { n: 1, elite: 2, boss: 4 }, bomb: 65, rush: 60, wave: 42, auraPulse: 9, cd: { bomb: 7, rush: 10, wave: 22, aura: 28 } }
const NEW_CD = { bomb: TREE_BY_ID.bubble_bomb.cooldown!(1), rush: TREE_BY_ID.mochi_rush.cooldown!(1), wave: TREE_BY_ID.overdrive.cooldown!(1), aura: TREE_BY_ID.candy_aura.cooldown!(1) }
type Tone = 'n' | 'elite' | 'boss'
const casts: Exclude<SkillKind, 'chain'>[] = ['bomb', 'rush', 'wave', 'aura']

function oldHit(kind: (typeof casts)[number], tone: Tone, scale: number, dm: number): number {
  const base = kind === 'aura' ? OLD.auraPulse * 12 : OLD[kind]
  return base * dm * SKILL_POWER * scale * OLD.tone[tone]
}
function newHit(kind: (typeof casts)[number], tone: Tone, maxHp: number): number {
  return skillBite({ tone, maxHp }, kind, 1, 1)
}
/** Seconds to drop `hp` with the gun at `dps` and the `use`d skills on cooldown (staggered opener; the aura burns over 6 s). */
function ttk(hp: number, dps: number, hit: (k: (typeof casts)[number]) => number, cd: Record<string, number>, use: (typeof casts)[number][], uptime = 1): number {
  let left = hp
  const next: Record<string, number> = { ...AT }
  let burn = 0
  let burnLeft = 0
  for (let t = 0; t < 900; t += 0.05) {
    for (const k of use)
      if (t >= next[k]) {
        if (k === 'aura') {
          burn = hit(k) / 6
          burnLeft = 6
        } else left -= hit(k)
        next[k] = t + cd[k]
      }
    if (burnLeft > 0) {
      left -= burn * 0.05
      burnLeft -= 0.05
    }
    if (left <= 0) return t
    left -= dps * uptime * 0.05
  }
  return 900
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const PACK: HordeKind[] = ['slime', 'bug', 'skeleton', 'knight', 'golem']
console.log('깊이 | 한 번에 깎는 비율 (전 → 후): 폭탄 골렘 · 폭탄 정예 기사 · 폭탄 보스 | TTK 초 (총만 / 전 / 후, 폭탄+돌진 쿨마다): 일반 5마리 무리 · 정예 기사 · 보스')
for (const d of [1, 2, 3]) {
  const plan = floorPlan(d, 2)
  const scale = plan.scale.hp * EXPLORE.hp
  const dm = SKILL_REF_MUL[d]
  const dps = REF_DPS[`d${d}f2`][0]
  const golem = hordeHp('golem', scale)
  const knight = hordeHp('knight', scale, true)
  const bp = floorPlan(d, BOSS_FLOOR)
  const bossHp = BOSS.hp * bp.scale.boss.hp
  const bdps = REF_DPS[`d${d}f${BOSS_FLOOR}`][0]
  const bossScale = bp.scale.hp
  // Pack: five different normals stood together; area skills hit all of them, rush the line.
  const packHp = PACK.map((k) => hordeHp(k, scale))
  const packTtk = (hitOf: (k: (typeof casts)[number], hp: number) => number, cd: Record<string, number>) => {
    const left = [...packHp]
    const next: Record<string, number> = { ...AT }
    for (let t = 0; t < 600; t += 0.05) {
      for (const k of ['bomb', 'rush'] as const)
        if (t >= next[k]) {
          for (let i = 0; i < left.length; i += 1) if (left[i] > 0 && (k !== 'rush' || i < 3)) left[i] -= hitOf(k, packHp[i])
          next[k] = t + cd[k]
        }
      const alive = left.findIndex((h) => h > 0)
      if (alive < 0) return t
      left[alive] -= dps * 0.05
    }
    return 600
  }
  const gunPack = packHp.reduce((a, b) => a + b, 0) / dps
  const oldPack = packTtk((k) => oldHit(k, 'n', scale, dm), OLD.cd)
  const newPack = packTtk((k, hp) => newHit(k, 'n', hp), NEW_CD)
  const gunElite = knight / dps
  const two = ['bomb', 'rush'] as (typeof casts)[number][]
  const oldElite = ttk(knight, dps, (k) => oldHit(k, 'elite', scale, dm), OLD.cd, two)
  const newElite = ttk(knight, dps, (k) => newHit(k, 'elite', knight), NEW_CD, two)
  const gunBoss = bossHp / (bdps * BOSS_UPTIME)
  const oldBoss = ttk(bossHp, bdps, (k) => oldHit(k, 'boss', bossScale, dm), OLD.cd, two, BOSS_UPTIME)
  const newBoss = ttk(bossHp, bdps, (k) => newHit(k, 'boss', bossHp), NEW_CD, two, BOSS_UPTIME)
  const oldBoss4 = ttk(bossHp, bdps, (k) => oldHit(k, 'boss', bossScale, dm), OLD.cd, casts, BOSS_UPTIME)
  const newBoss4 = ttk(bossHp, bdps, (k) => newHit(k, 'boss', bossHp), NEW_CD, casts, BOSS_UPTIME)
  console.log(
    `d${d} | 골렘 ${pct(oldHit('bomb', 'n', scale, dm) / golem)} → ${pct(newHit('bomb', 'n', golem) / golem)} · 정예 ${pct(oldHit('bomb', 'elite', scale, dm) / knight)} → ${pct(newHit('bomb', 'elite', knight) / knight)} · 보스 ${pct(oldHit('bomb', 'boss', bossScale, dm) / bossHp)} → ${pct(newHit('bomb', 'boss', bossHp) / bossHp)}` +
      ` | 무리 ${gunPack.toFixed(1)} / ${oldPack.toFixed(1)} / ${newPack.toFixed(1)} · 정예 ${gunElite.toFixed(1)} / ${oldElite.toFixed(1)} / ${newElite.toFixed(1)} · 보스 ${gunBoss.toFixed(1)} / ${oldBoss.toFixed(1)} / ${newBoss.toFixed(1)} (스킬 4개: ${oldBoss4.toFixed(1)} / ${newBoss4.toFixed(1)})`,
  )
}
