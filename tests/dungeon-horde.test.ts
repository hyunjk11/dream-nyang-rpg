import { describe, expect, it } from 'vitest'
import { generateMaze, tileCentre, walkable, worldToTile } from '../src/3d/dungeon/maze'
import { solidAt } from '../src/3d/dungeon/walls'
import { FlowField, HORDE_CAP, Horde } from '../src/3d/dungeon/horde'
import { DRAIN, Director, LIVE_CAP, waveFor } from '../src/3d/dungeon/waves'
import { BOSS, Boss } from '../src/3d/dungeon/boss'

const maze = generateMaze(20261030)
const start = tileCentre(maze, maze.start.x, maze.start.y)

describe('몬스터 무리 길찾기', () => {
  it('흐름장은 그녀의 타일에서 0, 이웃으로 갈수록 1씩 늘고 다음 칸은 항상 더 가깝다', () => {
    const flow = new FlowField(maze)
    expect(flow.aim(maze.start.x, maze.start.y)).toBe(true)
    expect(flow.aim(maze.start.x, maze.start.y)).toBe(false)
    expect(flow.at(maze.start.x, maze.start.y)).toBe(0)
    for (let y = 0; y < maze.h; y += 1)
      for (let x = 0; x < maze.w; x += 1) {
        if (!walkable(maze, x, y)) continue
        const d = flow.at(x, y)
        expect(d).toBeGreaterThanOrEqual(0)
        if (d > 0) expect(flow.at(flow.next(x, y).x, flow.next(x, y).y)).toBe(d - 1)
      }
  })

  it('둥지에서 나온 무리는 벽을 뚫지 않고 미궁을 따라 그녀에게 몰려온다', () => {
    const horde = new Horde(maze)
    const nest = maze.nests[0]
    const n = tileCentre(maze, nest.x, nest.y)
    for (let i = 0; i < 20; i += 1) horde.spawn('slime', n.x + (i % 3) * 0.1, n.z + Math.floor(i / 3) * 0.1)
    horde.flow.aim(maze.start.x, maze.start.y)
    const startD = horde.foes.reduce((a, f) => a + horde.flow.at(worldToTile(maze, f.x, f.z).x, worldToTile(maze, f.x, f.z).y), 0)
    for (let i = 0; i < 300; i += 1) horde.update(1 / 30, { x: start.x, z: start.z, alive: true }, () => {})
    const after = horde.foes.reduce((a, f) => a + horde.flow.at(worldToTile(maze, f.x, f.z).x, worldToTile(maze, f.x, f.z).y), 0)
    expect(after).toBeLessThan(startD * 0.5)
    for (const f of horde.foes) expect(solidAt(maze, f.x, f.z)).toBe(false)
  })

  it('서로 밀어내서 한 점에 겹쳐 쌓이지 않는다', () => {
    const horde = new Horde(maze)
    for (let i = 0; i < 30; i += 1) horde.spawn('bug', start.x + 0.01 * i, start.z + ((i * 7) % 5) * 0.01)
    for (let i = 0; i < 60; i += 1) horde.update(1 / 30, { x: start.x + 2, z: start.z, alive: true }, () => {})
    let close = 0
    for (let i = 0; i < horde.foes.length; i += 1)
      for (let j = i + 1; j < horde.foes.length; j += 1) {
        const a = horde.foes[i]
        const b = horde.foes[j]
        if (Math.hypot(a.x - b.x, a.z - b.z) < (a.radius + b.radius) * 0.5) close += 1
      }
    expect(close).toBeLessThan(6)
  })

  it('곁에 붙으면 예비 동작 뒤에 때리고, 쏘면 맞고 쓰러진다', () => {
    const horde = new Horde(maze)
    const foe = horde.spawn('slime', start.x + 0.9, start.z)
    expect(foe).not.toBeNull()
    let hits = 0
    for (let i = 0; i < 90; i += 1) horde.update(1 / 30, { x: start.x, z: start.z, alive: true }, () => (hits += 1))
    expect(hits).toBeGreaterThan(0)
    const f = horde.foes[0]
    const hit = horde.raycast(start.x - 3, 0.4, f.z, 1, 0, 0, 20)
    expect(hit?.foe).toBe(f)
    expect(horde.raycast(start.x - 3, 0.4, f.z, -1, 0, 0, 20)).toBeNull()
    while (!horde.damage(f, 10));
    expect(horde.kills).toBe(1)
    for (let i = 0; i < 20; i += 1) horde.update(1 / 30, { x: start.x, z: start.z, alive: true }, () => {})
    expect(horde.foes).toHaveLength(0)
  })

  it(`200마리를 한 프레임에 돌려도 CPU 시간이 짧다`, () => {
    const horde = new Horde(maze)
    let k = 0
    for (let pass = 0; pass < 3; pass += 1)
      for (let y = 0; y < maze.h && horde.foes.length < 200; y += 1)
        for (let x = 0; x < maze.w && horde.foes.length < 200; x += 1)
          if (walkable(maze, x, y)) {
            const c = tileCentre(maze, x, y)
            horde.spawn((['slime', 'bug', 'rabbit', 'bat'] as const)[k++ % 4], c.x + pass * 0.7 - 0.7, c.z, k % 17 === 0)
          }
    expect(horde.foes.length).toBe(200)
    expect(HORDE_CAP).toBeGreaterThanOrEqual(200)
    for (let i = 0; i < 20; i += 1) horde.update(1 / 60, { x: start.x, z: start.z, alive: true }, () => {})
    const t0 = performance.now()
    for (let i = 0; i < 60; i += 1) horde.update(1 / 60, { x: start.x, z: start.z, alive: true }, () => {})
    const per = (performance.now() - t0) / 60
    expect(per).toBeLessThan(4)
  })
})

describe('웨이브와 보스', () => {
  it('웨이브는 갈수록 커지고, 종류와 정예가 늘어난다', () => {
    const a = waveFor(1)
    const c = waveFor(4)
    expect(a.elites).toBe(0)
    expect(c.total).toBeGreaterThan(a.total)
    expect(c.kinds.length).toBeGreaterThan(a.kinds.length)
    expect(c.elites).toBeGreaterThan(0)
  })

  it('연출가는 가까운 둥지로 쏟아내고, 살아있는 수가 상한을 넘지 않으며, 보스 방에선 멈춘다', () => {
    const dir = new Director()
    let alive = 0
    let elites = 0
    const nests = [5, 9, 2, 14, 30]
    const used = new Set<number>()
    for (let i = 0; i < 30 * 60; i += 1) {
      const orders = dir.update(1 / 30, { nestDistance: nests, alive, inBoss: false })
      alive += orders.length
      for (const o of orders) {
        used.add(o.nest)
        if (o.elite) elites += 1
      }
      expect(alive).toBeLessThanOrEqual(LIVE_CAP)
      alive = Math.max(0, alive - 1)
    }
    expect(dir.wave).toBeGreaterThanOrEqual(3)
    expect(elites).toBeGreaterThan(0)
    expect(used.has(4)).toBe(false)
    expect(used.has(2)).toBe(false)
    expect(used.has(DRAIN)).toBe(true)
    expect(dir.update(1, { nestDistance: nests, alive: 0, inBoss: true })).toHaveLength(0)
  })

  it('보스는 방에 들어오면 깨어나 고리 탄을 쏘고, 체력 2/3·1/3에서 무리를 부르며, 쓰러진다', () => {
    const boss = new Boss(maze)
    const b = maze.bossRoom
    const far = tileCentre(maze, b.x + 2, b.y + 4)
    expect(boss.update(0.1, start.x, start.z, true, () => {})).toEqual([])
    expect(boss.damage(100)).toBe(false)
    expect(boss.hp).toBe(BOSS.hp)
    const events: string[] = []
    for (let i = 0; i < 30 * 6; i += 1) events.push(...boss.update(1 / 30, far.x, far.z, true, () => {}))
    expect(events).toContain('wake')
    expect(events).toContain('ring')
    boss.damage(BOSS.hp * 0.4)
    events.push(...boss.update(1 / 30, far.x, far.z, true, () => {}))
    boss.damage(BOSS.hp * 0.4)
    events.push(...boss.update(1 / 30, far.x, far.z, true, () => {}))
    expect(events.filter((e) => e === 'summon')).toHaveLength(2)
    expect(boss.raycast(boss.x - 5, BOSS.chest, boss.z, 1, 0, 0, 20)).toBeGreaterThan(0)
    expect(boss.damage(BOSS.hp)).toBe(true)
    expect(boss.alive).toBe(false)
  })
})
