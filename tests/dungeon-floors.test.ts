import { describe, expect, it } from 'vitest'
import { BOSS, Boss } from '../src/world/dungeon/boss'
import { Horde, HORDE } from '../src/world/dungeon/horde'
import { Tile, generateMaze } from '../src/world/dungeon/maze'
import { Director, waveFor } from '../src/world/dungeon/waves'
import { floorPlan } from '../src/sim/delve'

/** Let a director run with foes dying quickly; returns it after `seconds`. */
function play(dir: Director, seconds: number): Director {
  let alive = 0
  for (let i = 0; i < seconds * 30; i += 1) {
    alive += dir.update(1 / 30, { nestDistance: [6, 8], alive, inBoss: false }).length
    alive = Math.max(0, alive - 2)
  }
  return dir
}

describe('층별 미로와 연출', () => {
  it('보스층은 작은 미로에 7×7 보스 방, 보통 층은 9×9 칸에 5×5 방', () => {
    const boss = floorPlan(1, 4)
    const m = generateMaze(boss.seed, boss.cells, boss.cells, boss.bossRoom)
    expect(m.w).toBe(13)
    expect(m.bossRoom.w).toBe(7)
    let tiles = 0
    for (const t of m.tiles) if (t === Tile.Boss) tiles += 1
    expect(tiles).toBe(49)
    const n = floorPlan(1, 1)
    expect(generateMaze(n.seed, n.cells, n.cells, n.bossRoom).bossRoom.w).toBe(5)
  })

  it('연출가는 끝난 웨이브 수를 세고, 목표를 이루면 조용해진다', () => {
    const dir = play(new Director(), 120)
    expect(dir.cleared).toBeGreaterThanOrEqual(2)
    dir.quiet = true
    const wave = dir.wave
    play(dir, 60)
    expect(dir.wave).toBeLessThanOrEqual(wave + 1)
    expect(dir.active).toBeNull()
  })

  it('깊은 층의 연출가는 더 뒤쪽 웨이브 구성으로 시작한다', () => {
    const plan = floorPlan(2, 3)
    const dir = new Director(plan.scale.firstWave)
    const w = dir.begin()
    expect(dir.wave).toBe(1)
    expect(w.total).toBe(waveFor(plan.scale.firstWave).total)
    expect(new Director().begin().total).toBe(waveFor(1).total)
  })

  it('무리와 보스는 층 배율만큼 단단해진다 (깊이 1은 그대로)', () => {
    const m = generateMaze(7)
    const a = new Horde(m)
    const b = new Horde(m)
    b.scale = { hp: 1.5, damage: 1.2 }
    const fa = a.spawn('slime', 0, 0)!
    const fb = b.spawn('slime', 0, 0)!
    expect(fb.hp).toBeGreaterThan(fa.hp)
    expect(fb.damage).toBeGreaterThanOrEqual(fa.damage)
    expect(fa.hp).toBe(Math.round(HORDE.slime.hp * 0.72))
    expect(new Boss(m).maxHp).toBe(BOSS.hp)
    const deep = new Boss(m, floorPlan(3, 4).scale.boss)
    expect(deep.maxHp).toBeGreaterThan(BOSS.hp)
    expect(deep.hp).toBe(deep.maxHp)
  })
})
