// Headless explore-floor simulation (run: npx vite-node tools/sim-floor.ts): real floorMaze + planLayout + Horde (aggro/leash) + ExploreDirector.
import { tileCentre, worldToTile, distances, Tile, walkable } from '../src/world/dungeon/maze'
import { Horde, type HordeFoe } from '../src/world/dungeon/horde'
import { EXPLORE, floorMaze, planLayout } from '../src/world/dungeon/layout'
import { ExploreDirector } from '../src/world/dungeon/explore'
import { floorPlan } from '../src/sim/delve'
import { DIFFICULTY } from '../src/combat/difficulty'
import { rng } from '../src/world/dungeon/maze'

type Behaviour = 'thorough' | 'rusher'
interface Opts { depth: number; floor: number; acc: number; duty: number; behaviour: Behaviour; salt: number; gunDmg?: number; maxHp?: number; seconds?: number }

export function simulate(o: Opts) {
  const base = floorPlan(o.depth, o.floor, o.salt)
  const plan = process.env.CELLS ? { ...base, cells: Number(process.env.CELLS) } : base
  const maze = floorMaze(plan)
  const layout = planLayout(maze, plan, rng(plan.seed ^ 0x5bd1e995))
  const horde = new Horde(maze)
  horde.scale = { hp: plan.scale.hp * EXPLORE.hp, damage: plan.scale.damage }
  const nestHp = Math.round(DIFFICULTY.delve.nestHp * plan.scale.hp)
  const ex = new ExploreDirector(maze, layout, horde, Math.random, nestHp)
  const maxHp = o.maxHp ?? DIFFICULTY.hero.maxHp
  const s0 = tileCentre(maze, maze.start.x, maze.start.y)
  const hero = { x: s0.x, z: s0.z, hp: maxHp, iframes: 0, since: 99 }
  const dt = 1 / 30
  let heat = 0, cd = 0, coolT = 0, locked = false, kills = 0, taken = 0
  let deathAt: number | null = null, doneAt: number | null = null
  let maxNear = 0, maxChase = 0, minHp = 1
  const firstHit = new Map<number, number>()
  const ttk: number[] = []
  const hitsOn = new Map<number, number>()
  const htk: number[] = []
  const htkElite: number[] = []
  const chestsLeft = layout.chests.map((c) => ({ ...c, open: false }))
  if (layout.secret) chestsLeft.push({ ...layout.secret.pocket, open: false })
  let shrineUsed = !layout.shrine
  let pause = 0
  let opened = 0
  const los = (ax: number, az: number, bx: number, bz: number) => {
    const d = Math.hypot(bx - ax, bz - az); const n = Math.ceil(d / 0.4)
    for (let i = 1; i < n; i += 1) { const t = worldToTile(maze, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n); if (!walkable(maze, t.x, t.y)) return false }
    return true
  }
  horde.onKill = (f) => {
    kills += 1
    ex.foeDown(f)
    const a = firstHit.get(f.id)
    if (f.kind === 'slime' && !f.elite && a !== undefined) ttk.push(tNow - a)
    const h = hitsOn.get(f.id)
    if (h !== undefined) (f.elite ? htkElite : htk).push(h)
  }
  const exitC = { x: layout.exit.x + Math.floor(layout.exit.w / 2), y: layout.exit.y + Math.floor(layout.exit.h / 2) }
  const inExit = (x: number, y: number) => x >= layout.exit.x && y >= layout.exit.y && x < layout.exit.x + layout.exit.w && y < layout.exit.y + layout.exit.h
  // What she has seen (minimap fog: 2-tile radius), for the thorough explorer.
  const seen = new Uint8Array(maze.w * maze.h)
  const known = (x: number, y: number) => seen[y * maze.w + x] === 1
  const near8: number[] = []
  let tNow = 0
  let explored = false
  const seconds = o.seconds ?? 600
  for (let step = 0; step * dt < seconds; step += 1) {
    const t = step * dt
    tNow = t
    const ht = worldToTile(maze, hero.x, hero.z)
    if (inExit(ht.x, ht.y) && doneAt === null && (o.behaviour === 'rusher' || explored)) doneAt = t
    if (doneAt !== null) break
    // Nest bursts.
    ex.update(dt, hero.x, hero.z, hero.hp > 0, (i, kind) => { const n = ex.nests[i]; return horde.spawn(kind, n.x, n.z, false) }, layout.packs[0]?.kinds ?? ['slime'])
    horde.update(dt, { x: hero.x, z: hero.z, alive: hero.hp > 0 }, (amount) => {
      if (hero.iframes > 0 || hero.hp <= 0) return
      const tk = Math.max(1, Math.round(amount)); hero.hp -= tk; taken += tk; hero.iframes = DIFFICULTY.hero.iframes; hero.since = 0
    })
    hero.iframes = Math.max(0, hero.iframes - dt); hero.since += dt
    if (hero.since > DIFFICULTY.hero.regenDelay) hero.hp = Math.min(maxHp, hero.hp + DIFFICULTY.hero.regenRate * dt)
    minHp = Math.min(minHp, Math.max(0, hero.hp) / maxHp)
    if (hero.hp <= 0) { deathAt = t; break }
    // Shooting: nearest visible foe within 18 m (awake first); else a nest in sight (thorough).
    let target: { f?: HordeFoe; nest?: number } | null = null
    let bd = 18
    for (const f of horde.foes) {
      if (!horde.hittable(f)) continue
      const d = Math.hypot(f.x - hero.x, f.z - hero.z) + (f.mode === 'chase' ? 0 : 6)
      if (d < bd && los(hero.x, hero.z, f.x, f.z)) { bd = d; target = { f } }
    }
    if (!target && o.behaviour === 'thorough') ex.nests.forEach((n, i) => { if (n.hp <= 0) return; const d = Math.hypot(n.x - hero.x, n.z - hero.z); if (d < 12 && los(hero.x, hero.z, n.x, n.z)) target = { nest: i } })
    cd -= dt
    if (heat > 0 && (coolT += dt) > 0.22) heat = Math.max(0, heat - (locked ? 0.9 : 0.55) * dt)
    if (locked && heat <= 0.35) locked = false
    const busy = (Math.sin(Math.floor(t / 0.5) * 12.9898) * 43758.5453 % 1 + 1) % 1 < o.duty
    if (target && !locked && busy) {
      while (cd <= 0) {
        cd += 0.066; heat += 0.011; coolT = 0
        if (heat >= 1) { locked = true; break }
        if (Math.random() > o.acc) continue
        const dmg = (o.gunDmg ?? 9) * (Math.random() < 0.12 ? 1.8 : 1)
        if (target.f) { if (!firstHit.has(target.f.id)) firstHit.set(target.f.id, t); hitsOn.set(target.f.id, (hitsOn.get(target.f.id) ?? 0) + 1); if (horde.damage(target.f, dmg)) break }
        else if (target.nest !== undefined) { const n = ex.nests[target.nest]; n.hp -= dmg; if (n.hp <= 0) { n.hp = 0; chestsLeft.push({ x: maze.nests[n.i].x, y: maze.nests[n.i].y, open: false }); break } }
      }
    } else cd = Math.max(cd, 0)
    // Goals.
    if (pause > 0) { pause -= dt; continue }
    const dd = distances(maze.tiles, maze.w, maze.h, ht.x, ht.y)
    const goals: { x: number; y: number; act?: () => void }[] = []
    for (let yy = -2; yy <= 2; yy += 1) for (let xx = -2; xx <= 2; xx += 1) { const X = ht.x + xx, Y = ht.y + yy; if (X >= 0 && Y >= 0 && X < maze.w && Y < maze.h) seen[Y * maze.w + X] = 1 }
    if (o.behaviour === 'thorough') {
      for (const c of chestsLeft) if (!c.open && known(c.x, c.y)) goals.push({ x: c.x, y: c.y, act: () => { c.open = true; opened += 1; pause = 0.8 } })
      for (const n of ex.nests) if (n.hp > 0) { const w = worldToTile(maze, n.x, n.z); if (known(w.x, w.y)) goals.push(w) }
      if (!shrineUsed && layout.shrine && known(layout.shrine.x, layout.shrine.y)) goals.push({ ...layout.shrine, act: () => { shrineUsed = true; pause = 0.5 } })
      if (ex.layout.secret && !ex.secretOpen && known(layout.secret!.wall.x, layout.secret!.wall.y)) { const w = layout.secret!.wall; goals.push({ x: w.x - layout.secret!.dx, y: w.y - layout.secret!.dy, act: () => { ex.hitSecret(999) } }) }
    }
    if (layout.needsKey && !ex.hasKey) { const k = ex.keyHolder; if (k) { const w = worldToTile(maze, k.x, k.z); goals.push(w) } }
    let goal: { x: number; y: number; act?: () => void }
    if (o.behaviour === 'thorough' && !goals.length) {
      // Nothing known to do: walk to the nearest unseen open tile (exit room last).
      let bestF = Infinity, fx = -1, fy = -1
      for (let i = 0; i < seen.length; i += 1) {
        if (seen[i] || maze.tiles[i] === Tile.Solid) continue
        const X = i % maze.w, Y = Math.floor(i / maze.w)
        if (inExit(X, Y)) continue
        const v = dd[i]
        if (v >= 0 && v < bestF) { bestF = v; fx = X; fy = Y }
      }
      if (fx >= 0) goals.push({ x: fx, y: fy })
      else explored = true
    }
    const reach = goals.filter((g) => dd[g.y * maze.w + g.x] >= 0)
    if (reach.length) { reach.sort((a, b) => dd[a.y * maze.w + a.x] - dd[b.y * maze.w + b.x]); goal = reach[0] }
    else if (layout.needsKey && !ex.doorsOpen) { ex.hasKey && ex.openDoors(); goal = exitC }
    else goal = exitC
    if (goal.x === ht.x && goal.y === ht.y) { goal.act?.(); if (!goal.act) { /* key elite tile: fight there */ } }
    // Doors: walk through them once she has the key (tiles open).
    let gtiles = maze.tiles
    if (layout.needsKey && !ex.doorsOpen) { gtiles = Uint8Array.from(maze.tiles); for (const d of layout.doors) gtiles[d.y * maze.w + d.x] = Tile.Corridor }
    const gd = distances(gtiles, maze.w, maze.h, goal.x, goal.y)
    let nx = ht.x, ny = ht.y, nb = gd[ht.y * maze.w + ht.x]
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = gd[(ht.y + ay) * maze.w + ht.x + ax]; if (v >= 0 && v < nb) { nb = v; nx = ht.x + ax; ny = ht.y + ay } }
    if (layout.doors.some((d) => d.x === nx && d.y === ny) && !ex.doorsOpen) { if (ex.hasKey) ex.openDoors(); else { nx = ht.x; ny = ht.y } }
    const c = tileCentre(maze, nx, ny); const dx = c.x - hero.x, dz = c.z - hero.z, l = Math.hypot(dx, dz)
    const sp = (target ? 2.6 : 4.6) * dt
    if (l > 0.05) { hero.x += (dx / l) * Math.min(sp, l); hero.z += (dz / l) * Math.min(sp, l) }
    let near = 0
    for (const f of horde.foes) if (f.dying <= 0 && f.mode === 'chase' && Math.hypot(f.x - hero.x, f.z - hero.z) < 8) near += 1
    near8.push(near)
    maxNear = Math.max(maxNear, near); maxChase = Math.max(maxChase, horde.chasing)
  }
  ttk.sort((a, b) => a - b)
  near8.sort((a, b) => a - b)
  const p95 = near8.length ? near8[Math.floor(near8.length * 0.95)] : 0
  const foes = layout.packs.reduce((a, p) => a + p.size, 0)
  htk.sort((a, b) => a - b)
  htkElite.sort((a, b) => a - b)
  return { htk: htk.length ? htk[Math.floor(htk.length / 2)] : null, htkElite: htkElite.length ? htkElite[Math.floor(htkElite.length / 2)] : null, endHp: hero.hp / maxHp, minHp, deathAt, doneAt, kills, foes, maxNear, p95, maxChase, taken, opened, ttk: ttk.length ? ttk[Math.floor(ttk.length / 2)] : null }
}

import { HORDE, ELITE } from '../src/world/dungeon/horde'
import { BOSS } from '../src/world/dungeon/boss'
import { DIFF_MODES } from '../src/combat/difficulty'
{
  // Hits to kill with the starter water gun (9 per droplet, no crits), 보통, explore floors.
  const g = 9
  const hp = (kind: keyof typeof HORDE, d: number, f: number, elite: boolean, mode: keyof typeof DIFF_MODES = 'normal') =>
    Math.round(HORDE[kind].hp * DIFFICULTY.horde.hp * DIFF_MODES[mode].foeHp * floorPlan(d, f).scale.hp * EXPLORE.hp * (elite ? ELITE.hp : 1))
  console.log('## 시작 물총(9) 처치 타수 — 보통, 탐험 층 (괄호: 쉬움/어려움)')
  for (const [d, f] of [[1, 1], [1, 3], [2, 1], [3, 1]]) {
    const row = (['slime', 'bat', 'bug', 'skeleton', 'knight', 'golem'] as const).map((k) => `${k} ${Math.ceil(hp(k, d, f, false) / g)} (${Math.ceil(hp(k, d, f, false, 'easy') / g)}/${Math.ceil(hp(k, d, f, false, 'hard') / g)})`)
    console.log(`d${d}f${f} 일반: ${row.join(' · ')} | 정예 슬라임 ${Math.ceil(hp('slime', d, f, true) / g)} · 정예 기사 ${Math.ceil(hp('knight', d, f, true) / g)}`)
  }
  for (const d of [1, 2, 3]) {
    const bhp = Math.round(BOSS.hp * floorPlan(d, 4).scale.boss.hp)
    // New player: 15 shots/s × 30% hit × 60% on the trigger ≈ 2.7 hits/s.
    console.log(`깊이 ${d} 보스: HP ${bhp}, 시작 물총 ${Math.ceil(bhp / g)}타, 새 플레이어 약 ${(bhp / g / 2.7).toFixed(0)}초`)
  }
}
const people = [
  { name: '새 플레이어', acc: 0.3, duty: 0.6 },
  { name: '숙련', acc: 0.55, duty: 0.85 },
]
const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const rows: [number, number, string, Behaviour, Partial<Opts>][] = []
for (const [d, f] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 3]]) for (const pp of people) for (const b of ['thorough'] as Behaviour[]) rows.push([d, f, pp.name, b, { acc: pp.acc, duty: pp.duty }])
for (const [d, f] of [[2, 1], [2, 3], [3, 1], [3, 3]]) rows.push([d, f, '새+깊이1 장비', 'thorough', { acc: 0.3, duty: 0.6, gunDmg: 14, maxHp: 190 }])
for (const [d, f] of [[2, 3], [3, 1], [3, 3]]) rows.push([d, f, '숙련+좋은 장비', 'thorough', { acc: 0.55, duty: 0.85, gunDmg: 20, maxHp: 240 }])
for (const [d, f] of [[1, 3]]) rows.push([d, f, '새 플레이어', 'rusher', { acc: 0.3, duty: 0.6 }])
const med = (v: number[]) => (v.length ? v[Math.floor(v.length / 2)] : NaN)
for (const [d, f, who, b, extra] of rows) {
  const res = seeds.map((salt) => simulate({ depth: d, floor: f, behaviour: b, salt, acc: 0.3, duty: 0.6, ...extra }))
  const deaths = res.filter((r) => r.deathAt !== null).length
  const done = res.filter((r) => r.doneAt !== null).map((r) => r.doneAt as number).sort((a, c) => a - c)
  const ttks = res.map((r) => r.ttk).filter((x): x is number => x !== null)
  const alive = res.filter((r) => r.deathAt === null)
  const endHp = med(alive.map((r) => r.endHp).sort((a, c) => a - c))
  const minHp = med(alive.map((r) => r.minHp).sort((a, c) => a - c))
  console.log(`d${d}f${f} ${who} ${b}: 사망 ${deaths}/${res.length}  끝HP ${Math.round(endHp * 100)}%  최저HP ${Math.round(minHp * 100)}%  완료시간 중앙 ${(med(done) / 60).toFixed(1)}분 (${done.length ? (done[0] / 60).toFixed(1) : '-'}–${done.length ? (done[done.length - 1] / 60).toFixed(1) : '-'})  처치 중앙 ${med(res.map((r) => r.kills).sort((a, c) => a - c))}/${med(res.map((r) => r.foes))}  8m내 최대 ${Math.max(...res.map((r) => r.maxNear))} (p95 ${Math.max(...res.map((r) => r.p95))})  추격 최대 ${Math.max(...res.map((r) => r.maxChase))}  슬라임 TTK ${med(ttks.sort((a, c) => a - c)).toFixed(2)}s  일반 처치 타수 ${med(res.map((r) => r.htk).filter((x): x is number => x !== null).sort((a, c) => a - c))}  정예 타수 ${med(res.map((r) => r.htkElite).filter((x): x is number => x !== null).sort((a, c) => a - c))}  상자 ${med(res.map((r) => r.opened).sort((a, c) => a - c))}`)
}
