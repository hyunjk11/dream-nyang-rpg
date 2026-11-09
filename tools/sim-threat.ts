/**
 * Headless fight: the player shoots (hitscan DPS) while foes use the real Horde / town Combat.
 * Run: npx vitest run tools/sim-threat.ts
 * Prints HP lost, time-to-kill and deaths for a single foe and a pack, +0 and +3.
 */
import { Group, Vector3 } from 'three'
import { Hero } from '../src/actors/hero'
import { Combat } from '../src/combat/combat'
import { DIFFICULTY } from '../src/combat/difficulty'
import { upgradeMul } from '../src/sim/loot'
import { floorPlan, fieldPlan } from '../src/sim/delve'
import { EXPLORE } from '../src/world/dungeon/layout'
import { FIELD } from '../src/world/dungeon/field'
import { generateMaze, Tile, tileCentre, type Maze } from '../src/world/dungeon/maze'
import { EARLY_SHOT, Horde, type HordeKind } from '../src/world/dungeon/horde'
import { runFoeScale } from '../src/world/dungeon/run'
import type { FloorPlan } from '../src/sim/delve'
import type { FoeKind } from '../src/combat/foes'

const BASE_DPS = 137
const DT = 1 / 60

function arena(): Maze {
  const m = generateMaze(20261109)
  const floor = m.tiles[m.start.y * m.w + m.start.x]
  for (let y = 0; y < m.h; y += 1) {
    for (let x = 0; x < m.w; x += 1) {
      const edge = x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1
      m.tiles[y * m.w + x] = edge ? Tile.Solid : floor
    }
  }
  return m
}

export interface FightRow {
  area: string
  gear: '+0' | '+3'
  who: string
  lost: number
  ttk: number
  dead: boolean
  hits: number
  hp: number
}

function tickHero(hero: Hero, dt: number): void {
  hero.iframes = Math.max(0, hero.iframes - dt)
  hero.sinceHit += dt
  if (hero.alive && hero.sinceHit > hero.regenDelay && hero.hp < hero.maxHp) {
    hero.hp = Math.min(hero.maxHp, hero.hp + DIFFICULTY.hero.regenRate * hero.regenMul * dt)
  }
}

/** Strafe around a point the way auto-hunt holds a sweet spot (no dash). */
function strafe(t: number, ox: number, oz: number, radius = 1.6, rate = 1.5): { x: number; z: number; vx: number; vz: number } {
  const a = t * rate
  const x = ox + Math.sin(a) * radius
  const z = oz + Math.cos(a) * radius
  const vx = Math.cos(a) * radius * rate
  const vz = -Math.sin(a) * radius * rate
  return { x, z, vx, vz }
}

function hordeFight(label: string, plan: FloorPlan, hpMul: number, kinds: HordeKind[], plus: 0 | 3, dist: number, ranged?: boolean): FightRow {
  const maze = arena()
  const h = new Horde(maze)
  h.rangedShare = ranged === undefined ? 0.5 : ranged ? 1 : 0
  h.scale = runFoeScale(plan, false, 150)
  h.scale.hp *= hpMul
  if (plan.depth === 1 && plan.objective === 'exit' && !plan.area) {
    h.shotFar = EARLY_SHOT.far
    h.shotMax = EARLY_SHOT.max
    h.shotSpeed = EARLY_SHOT.speed
  }
  const c = tileCentre(maze, Math.floor(maze.w / 2), Math.floor(maze.h / 2))
  const hero = new Hero()
  hero.maxHp = 150
  hero.hp = 150
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2
    const f = h.spawn(k, c.x + Math.sin(a) * (kinds.length === 1 ? 0 : 1.4), c.z + Math.cos(a) * (kinds.length === 1 ? 0 : 1.4))!
    f.age = 10
    f.cooldown = 0.2 + (i * 0.17) % 0.4
    f.mode = 'chase'
  })
  const dps = BASE_DPS * upgradeMul(plus)
  let hits = 0
  let ttk = 8
  const startN = h.foes.length
  for (let t = 0; t < 12; t += DT) {
    const s = strafe(t, c.x, c.z + dist)
    const alive = h.foes.filter((f) => f.dying <= 0)
    if (!alive.length) {
      ttk = t
      break
    }
    let best = alive[0]
    let bd = Infinity
    for (const f of alive) {
      const d = Math.hypot(f.x - s.x, f.z - s.z)
      if (d < bd) {
        bd = d
        best = f
      }
    }
    h.damage(best, dps * DT)
    h.update(DT, { x: s.x, z: s.z, alive: hero.hp > 0, dodge: false, vx: s.vx, vz: s.vz }, (amount, fx, fz) => {
      if (hero.hurt(amount, new Vector3(fx, 0, fz))) hits += 1
    })
    tickHero(hero, DT)
    if (hero.hp <= 0) {
      ttk = t
      break
    }
    void startN
  }
  const lost = hero.hp <= 0 ? 150 : 150 - hero.hp
  const style = kinds.length === 1 ? (ranged ? '원거리' : '근접') : '무리'
  return { area: label, gear: plus ? '+3' : '+0', who: `${style}${kinds.length === 1 ? '' : kinds.length}`, lost: Math.round(lost), ttk: Math.round(ttk * 10) / 10, dead: hero.hp <= 0, hits, hp: Math.max(0, Math.round(hero.hp)) }
}

function townFight(label: string, kind: FoeKind, n: number, plus: 0 | 3, tutorial = false, dist = 6): FightRow {
  const combat = new Combat(new Group())
  const roster = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return { kind, x: Math.sin(a) * (n === 1 ? 0 : 1.3), z: Math.cos(a) * (n === 1 ? 0 : 1.3), tags: tutorial ? ['tutorial'] : ['wild'] }
  })
  combat.setRoster(roster)
  for (const f of combat.foes) {
    f.spawn = 1
    f.attack = 0.15
  }
  const hero = new Hero()
  hero.maxHp = 150
  hero.hp = 150
  const dps = BASE_DPS * upgradeMul(plus)
  const pos = new Vector3()
  let hits = 0
  let ttk = 8
  for (let t = 0; t < 12; t += DT) {
    const s = strafe(t, 0, dist, 1.1, 1.6)
    pos.set(s.x, 0, s.z)
    const alive = combat.foes.filter((f) => f.alive)
    if (!alive.length) {
      ttk = t
      break
    }
    let best = alive[0]
    let bd = Infinity
    for (const f of alive) {
      const d = Math.hypot(f.object.position.x - s.x, f.object.position.z - s.z)
      if (d < bd) {
        bd = d
        best = f
      }
    }
    best.hp -= dps * DT
    if (best.hp <= 0) {
      best.alive = false
      best.dying = 0.001
    }
    combat.update(DT, pos, 0.7, (amount, from) => {
      if (hero.hurt(amount, from)) hits += 1
    })
    tickHero(hero, DT)
    if (hero.hp <= 0) {
      ttk = t
      break
    }
  }
  const lost = hero.hp <= 0 ? 150 : 150 - hero.hp
  return { area: label, gear: plus ? '+3' : '+0', who: n === 1 ? `단일 ${kind}` : `무리 ${n} ${kind}`, lost: Math.round(lost), ttk: Math.round(ttk * 10) / 10, dead: hero.hp <= 0, hits, hp: Math.max(0, Math.round(hero.hp)) }
}

export function threatTable(): FightRow[] {
  const rows: FightRow[] = []
  const pluses = [0, 3] as const
  for (const plus of pluses) {
    rows.push(townFight('가이드 초원', 'slime', 1, plus, true, 4.5))
    rows.push(townFight('몽환의 숲', 'bug', 1, plus, false, 6))
    rows.push(townFight('몽환의 숲', 'bug', 3, plus, false, 5))
    rows.push(townFight('버섯 골짜기', 'rabbit', 1, plus, false, 6))
    rows.push(townFight('버섯 골짜기', 'rabbit', 3, plus, false, 5))
    rows.push(townFight('별빛 제단', 'bloom', 1, plus, false, 6.5))
    const field = fieldPlan(1, { kinds: ['slime'], fluff: false, named: false, boss: false })
    rows.push(hordeFight('들판', field, FIELD.hp, ['slime'], plus, 11, false))
    rows.push(hordeFight('들판', field, FIELD.hp, ['slime'], plus, 11, true))
    rows.push(hordeFight('들판', field, FIELD.hp, ['slime', 'bat', 'bug', 'rabbit'], plus, 11))
    for (const depth of [1, 2, 3] as const) {
      const plan = floorPlan(depth, depth === 1 ? 2 : 3)
      const name = depth === 1 ? '하수도 깊이1' : `무한탑 깊이${depth}`
      rows.push(hordeFight(name, plan, EXPLORE.hp, ['slime'], plus, 12, false))
      rows.push(hordeFight(name, plan, EXPLORE.hp, ['slime'], plus, 12, true))
      rows.push(hordeFight(name, plan, EXPLORE.hp, ['slime', 'bat', 'bug', 'skeleton'], plus, 11))
    }
  }
  return rows
}

