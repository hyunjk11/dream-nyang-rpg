// 밸런스 표: each gun (rare/legendary/unique) at the iLv + level a player has per area → TTK on a
// normal (slime, knight), a slime elite, an elite and the boss. Sustained DPS × crit, no skills, 100% hit.
// Run: npx vite-node tools/ttk-table.ts
import { BOSS } from '../src/world/dungeon/boss'
import { HORDE, hordeHp } from '../src/world/dungeon/horde'
import { areaPlan } from '../src/sim/dreamstory'
import { fieldPlan, floorPlan } from '../src/sim/delve'
import { freshSave } from '../src/sim/mutate'
import { makeItem } from '../src/sim/loot'
import { makeLegend } from '../src/sim/legends'
import { computeStats } from '../src/sim/stats'
import { dpsOf } from '../src/ui/inventory'
import { mulberry32 } from '../src/sim/rng'
import { EXPLORE } from '../src/world/dungeon/layout'
import type { ItemInstance } from '../src/sim/types'

const STAGES = [
  { name: '1장 미로 1층', plan: () => areaPlan('maze', 1), lv: 5, ilv: 3 },
  { name: '1장 미로 3층', plan: () => areaPlan('maze', 3), lv: 7, ilv: 4 },
  { name: '1장 하수도 보스', plan: () => floorPlan(1, 4), lv: 8, ilv: 5 },
  { name: '몽실 들판', plan: () => fieldPlan(1, { kills: 0 } as never), lv: 9, ilv: 6 },
  { name: '2장 구름 다락 1층', plan: () => areaPlan('loft', 1), lv: 10, ilv: 7 },
  { name: '2장 시계탑 2층', plan: () => areaPlan('tower', 2), lv: 12, ilv: 9 },
  { name: '2장 달빛 둥지 보스', plan: () => areaPlan('moon', 1), lv: 13, ilv: 10 },
]
const GUNS: [string, (ilv: number) => ItemInstance][] = [
  ['물총 희귀', (l) => makeItem('gun_water', 'rare', mulberry32(1), l)],
  ['별총 희귀', (l) => makeItem('gun_star', 'rare', mulberry32(1), l)],
  ['방울 희귀', (l) => makeItem('gun_bubble', 'rare', mulberry32(1), l)],
  ['저격 희귀', (l) => makeItem('gun_dart', 'rare', mulberry32(1), l)],
  ['물총 전설', (l) => makeItem('gun_water', 'legendary', mulberry32(1), l)],
  ['유니크 별비', (l) => makeLegend('leg_starrain', l)],
]
const bossBase = (BOSS as { hp: number }).hp
const rows: string[] = []
for (const st of STAGES) {
  const plan = st.plan()
  const s = plan.scale
  const hp = s.hp * (plan.objective === 'exit' ? EXPLORE.hp : 1) // explore floors: meatier packs (run.ts)
  const normal = hordeHp('slime', hp), knight = hordeHp('knight', hp), elite = hordeHp('slime', hp, true)
  const boss = Math.round(bossBase * s.boss.hp)
  for (const [gname, mk] of GUNS) {
    const save = freshSave()
    save.level = st.lv
    const g = mk(st.ilv)
    const old = save.equipment.weapon
    save.items = save.items.filter((i) => i.uid !== old)
    save.items.push(g)
    save.equipment.weapon = g.uid
    const dps = dpsOf(computeStats(save))
    rows.push([st.name, gname, Math.round(dps), normal, (normal / dps).toFixed(2), (knight / dps).toFixed(2), elite, (elite / dps).toFixed(1), boss, (boss / dps).toFixed(0)].join('\t'))
  }
}
console.log(['구역', '총', 'DPS', '일반hp', '일반s', '기사s', '엘리트hp', '엘리트s', '보스hp', '보스s'].join('\t'))
console.log(rows.join('\n'))
void HORDE
