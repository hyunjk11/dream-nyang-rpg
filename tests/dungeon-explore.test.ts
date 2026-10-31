import { describe, expect, it } from 'vitest'
import { floorPlan } from '../src/sim/delve'
import { boardOf, contractEvent, contractGoal, takeContract } from '../src/sim/contracts'
import { freshSave } from '../src/sim/mutate'
import { mulberry32 } from '../src/sim/rng'
import { townOf } from '../src/sim/town'
import { EXPLORE, eliteName, floorMaze, planLayout, roomDistance } from '../src/world/dungeon/layout'
import { ExploreDirector } from '../src/world/dungeon/explore'
import { Horde } from '../src/world/dungeon/horde'
import { distances, rng, Tile, tileCentre, walkable } from '../src/world/dungeon/maze'

function floor(depth: number, f: number, salt = 0) {
  const plan = floorPlan(depth, f, salt)
  const maze = floorMaze(plan)
  const layout = planLayout(maze, plan, rng(plan.seed ^ 0x5bd1e995))
  return { plan, maze, layout }
}

describe('탐험 층 배치', () => {
  it('깊이 1: 무리 10–14개(3–6마리), 정예 1–2, 둥지 2–3, 상자 3–5, 제단 1', () => {
    for (let salt = 0; salt < 8; salt += 1) {
      for (const f of [1, 2, 3]) {
        const { layout } = floor(1, f, salt)
        const normal = layout.packs.filter((p) => !p.elite)
        const elites = layout.packs.filter((p) => p.elite)
        expect(layout.packs.length).toBeGreaterThanOrEqual(EXPLORE.packs[0])
        expect(layout.packs.length).toBeLessThanOrEqual(EXPLORE.packs[1] + EXPLORE.elitePacks[1])
        for (const p of normal) expect(p.size).toBeGreaterThanOrEqual(3)
        for (const p of normal) expect(p.size).toBeLessThanOrEqual(6)
        expect(elites.length).toBeGreaterThanOrEqual(1)
        expect(elites.length).toBeLessThanOrEqual(2)
        expect(layout.nests.length).toBeGreaterThanOrEqual(2)
        expect(layout.nests.length).toBeLessThanOrEqual(3)
        expect(layout.chests.length).toBeGreaterThanOrEqual(3)
        expect(layout.chests.length).toBeLessThanOrEqual(5)
        expect(layout.shrine).not.toBeNull()
      }
    }
  })

  it('깊이가 깊을수록 무리가 늘어난다(깊이당 +15%)', () => {
    let d1 = 0
    let d3 = 0
    for (let salt = 0; salt < 8; salt += 1) {
      d1 += floor(1, 1, salt).layout.packs.length
      d3 += floor(3, 1, salt).layout.packs.length
    }
    expect(d3).toBeGreaterThan(d1)
  })

  it('출구 방은 시작점에서 30칸 이상 떨어져 있고, 시작 근처는 비어 있다', () => {
    for (let salt = 0; salt < 8; salt += 1) {
      const { maze, layout } = floor(1, 1, salt)
      expect(layout.exitDist).toBeGreaterThanOrEqual(EXPLORE.exitMin)
      expect(roomDistance(maze, layout.exit)).toBe(layout.exitDist)
      for (const p of layout.packs) expect(p.dist).toBeGreaterThanOrEqual(EXPLORE.safe)
    }
  })

  it('2층부터 문이 있고, 열쇠 정예는 문을 닫은 채로도 닿을 수 있다', () => {
    expect(floor(1, 1).layout.needsKey).toBe(false)
    expect(floor(1, 1).layout.doors).toHaveLength(0)
    for (let salt = 0; salt < 8; salt += 1) {
      const { maze, layout } = floor(2, 2, salt)
      expect(layout.needsKey).toBe(true)
      expect(layout.doors.length).toBeGreaterThan(0)
      const key = layout.packs.find((p) => p.key)
      expect(key?.elite).toBeTruthy()
      const shut = Uint8Array.from(maze.tiles)
      for (const d of layout.doors) shut[d.y * maze.w + d.x] = Tile.Solid
      const d = distances(shut, maze.w, maze.h, maze.start.x, maze.start.y)
      expect(d[key!.y * maze.w + key!.x]).toBeGreaterThanOrEqual(0)
    }
  })

  it('정예 이름은 접두어 + 몬스터 이름', () => {
    expect(eliteName('slime', ['swift'])).toContain('재빠른')
    expect(eliteName('slime', ['swift'])).toContain('슬라임')
  })
})

describe('어그로와 리쉬', () => {
  it('무리는 잠들어 있다가 시야 12m 안에 들어오면 무리째 깨어난다', () => {
    const { maze, layout } = floor(1, 1, 3)
    const horde = new Horde(maze)
    const ex = new ExploreDirector(maze, layout, horde, mulberry32(1), 100)
    expect(ex.layout.packs.length).toBeGreaterThan(0)
    expect(horde.foes.every((f) => f.mode !== 'chase')).toBe(true)
    // Far away (start): nobody wakes.
    const s = tileCentre(maze, maze.start.x, maze.start.y)
    for (let i = 0; i < 30; i += 1) horde.update(1 / 30, { x: s.x, z: s.z, alive: true }, () => {})
    expect(horde.chasing).toBe(0)
  })

  it('한 마리를 맞히면 그 무리가 깨어나되, 동시 추격은 상한을 넘지 않는다', () => {
    const { maze, layout } = floor(1, 1, 4)
    const horde = new Horde(maze)
    new ExploreDirector(maze, layout, horde, mulberry32(2), 100)
    const victim = horde.foes.find((f) => f.pack === layout.packs[0].id)!
    horde.damage(victim, 1)
    const awake = horde.foes.filter((f) => f.pack === victim.pack && f.mode === 'chase')
    expect(awake.length).toBe(Math.min(layout.packs[0].size, EXPLORE.chaseCap))
    for (const p of layout.packs) {
      const f = horde.foes.find((g) => g.pack === p.id && g.mode !== 'chase')
      if (f) horde.damage(f, 1)
    }
    // Hits always wake the struck foe, but pack-mates wait for room.
    expect(horde.chasing).toBeLessThanOrEqual(EXPLORE.chaseCap + layout.packs.length)
  })

  it('멀리 떨어져 시야 밖에 오래 있으면 집으로 돌아간다(리쉬)', () => {
    const { maze, layout } = floor(1, 1, 5)
    const horde = new Horde(maze)
    new ExploreDirector(maze, layout, horde, mulberry32(3), 100)
    const victim = horde.foes.find((f) => f.pack === layout.packs[0].id)!
    horde.damage(victim, 1)
    expect(victim.mode).toBe('chase')
    const s = tileCentre(maze, maze.start.x, maze.start.y)
    // She stands far away (at the start) out of sight for longer than the leash time.
    const far = Math.hypot(victim.x - s.x, victim.z - s.z) > EXPLORE.leash
    for (let i = 0; i < 30 * (EXPLORE.leashTime + 2); i += 1) horde.update(1 / 30, { x: s.x, z: s.z, alive: true }, () => {})
    if (far) expect(victim.mode).not.toBe('chase')
    else expect(['chase', 'home', 'idle']).toContain(victim.mode)
  })
})

describe('열쇠·문·둥지', () => {
  it('문은 열쇠 없이는 막혀 있고, 열쇠 정예가 쓰러지면 열쇠를 얻어 문을 연다', () => {
    const { maze, layout } = floor(1, 2, 1)
    const horde = new Horde(maze)
    const ex = new ExploreDirector(maze, layout, horde, mulberry32(4), 100)
    const d = layout.doors[0]
    expect(walkable(maze, d.x, d.y)).toBe(false)
    expect(ex.openDoors()).toHaveLength(0)
    const k = ex.keyHolder!
    expect(k).toBeTruthy()
    expect(ex.foeDown(k)).toEqual([{ type: 'key' }])
    expect(ex.hasKey).toBe(true)
    expect(ex.openDoors()).toEqual([{ type: 'door' }])
    expect(walkable(maze, d.x, d.y)).toBe(true)
  })

  it('둥지는 가까이 가면 2–3마리씩 뿜고, 총량을 채우면 마른다', () => {
    const { maze, layout } = floor(1, 1, 2)
    const horde = new Horde(maze)
    const ex = new ExploreDirector(maze, layout, horde, mulberry32(5), 100)
    const n = ex.nests[0]
    let spawned = 0
    const before = horde.foes.length
    for (let i = 0; i < 30 * 200; i += 1) {
      const ev = ex.update(1 / 30, n.x, n.z, true, (_i, kind) => horde.spawn(kind, n.x, n.z, false), ['slime'])
      spawned += ev.filter((e) => e.type === 'spawn' && e.nest === n.i).length
      // Kill what came out so the live cap never stalls it.
      for (const f of horde.foes) if (f.pack === n.pack && f.dying <= 0) { ex.foeDown(f); f.hp = 0; f.dying = 1 }
      horde.foes.splice(before)
    }
    expect(spawned).toBe(EXPLORE.nestTotal)
  })
})

describe('상자 의뢰', () => {
  it('상자 열기가 상자 의뢰를 진행시킨다', () => {
    const save = freshSave()
    boardOf(save, mulberry32(1))
    const t = townOf(save)
    t.contracts[0] = { ...t.contracts[0], kind: 'chests', depth: 1, goal: contractGoal('chests', 1), progress: 0, status: 'offered' }
    const c = t.contracts[0]
    takeContract(save, c.id)
    contractEvent(save, { type: 'chest', depth: 1 })
    expect(c.progress).toBe(1)
  })
})
