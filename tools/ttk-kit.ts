// Realistic gear kits for time-to-kill checks (run: npx vite-node tools/ttk-kit.ts > kits.json).
// A kit = the level a player usually has at that depth, the best of a few drops per slot at the
// depth's rarity cap and item level, and skill points spent down the gun branch first.
import { makeItem, maxRarityFor, itemPower } from '../src/sim/loot'
import { itemLevelFor } from '../src/sim/delve'
import { learn } from '../src/sim/skilltree'
import { computeStats } from '../src/sim/stats'
import { rng } from '../src/world/dungeon/maze'
import type { EquipSlot, ItemInstance, SaveData } from '../src/sim/types'

export const KIT_LEVEL: Record<number, number> = { 1: 8, 2: 13, 3: 18 }
/** typical: a level lower, one rarity below the cap, best of 2 drops. geared: the cap, best of 6. */
export type Tier = 'typical' | 'geared'
const ORDER = ['polish', 'polish', 'polish', 'polish', 'polish', 'rhythm', 'rhythm', 'rhythm', 'overdrive', 'star_eye', 'star_eye', 'star_eye', 'dream_pierce', 'fluffy', 'fluffy', 'fluffy', 'fluffy', 'fluffy']
const SLOTS: [EquipSlot, string[]][] = [
  ['hat', ['hat_beret', 'hat_pin', 'hat_mushroom']],
  ['outfit', ['outfit_hoodie', 'outfit_knit', 'outfit_cape']],
  ['shoes', ['shoes_boots', 'shoes_sneakers']],
  ['accessory', ['acc_ring', 'acc_charm', 'acc_bell']],
  ['accessory2', ['acc_ring', 'acc_charm', 'acc_bell']],
]

export function kit(depth: number, gun: string, tier: Tier = 'geared', seed = 1) {
  const r = rng(seed * 7919 + depth * 31)
  const RAR = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
  const top = maxRarityFor(depth)
  const cap = tier === 'geared' ? top : RAR[Math.max(1, RAR.indexOf(top) - 1)]
  const tries = tier === 'geared' ? 6 : 2
  const il = itemLevelFor(depth, 3)
  const best = (ids: string[], n = tries) => {
    let pick: ItemInstance | null = null
    for (let i = 0; i < n; i++) {
      const it = makeItem(ids[Math.floor(r() * ids.length)], cap, r, il)
      if (!pick || itemPower(it) > itemPower(pick)) pick = it
    }
    return pick!
  }
  const items: ItemInstance[] = [best([gun])]
  const equipment: Partial<Record<EquipSlot, string>> = { weapon: items[0].uid }
  for (const [slot, ids] of SLOTS) { const it = best(ids); items.push(it); equipment[slot] = it.uid }
  const level = (KIT_LEVEL[depth] ?? 8) - (tier === 'typical' ? 2 : 0)
  const save = { level, byeolhaPoints: level, items, equipment } as unknown as SaveData
  for (const id of ORDER) learn(save, id)
  const s = computeStats(save)
  return { depth, gun, tier, level, items, equipment, build: save.build, summary: { shot: s.shotDamage, crit: s.critChance, critMul: s.critMul, fireRate: s.fireRate, star: s.starShot, cloud: s.cloud, sparkle: s.sparkle, candy: s.candy, ice: s.ice, pierce: s.pierce, maxHp: s.maxHp } }
}

const kits = [
  kit(1, 'gun_water', 'typical'), kit(1, 'gun_water'), kit(1, 'gun_star'),
  kit(2, 'gun_water', 'typical'), kit(2, 'gun_water'), kit(2, 'gun_star'), kit(2, 'gun_bubble'),
  kit(3, 'gun_water', 'typical'), kit(3, 'gun_water'),
]
console.log(JSON.stringify(kits))
