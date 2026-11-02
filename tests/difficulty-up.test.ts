import { afterEach, describe, expect, it } from 'vitest'
import { DIFF_MODES, DIFFICULTY, diff, diffMode, setDiffMode } from '../src/combat/difficulty'
import { generateMaze, tileCentre, walkable, worldToTile } from '../src/world/dungeon/maze'
import { Horde } from '../src/world/dungeon/horde'
import { floorScale } from '../src/sim/delve'
import { EXPLORE } from '../src/world/dungeon/layout'

const maze = generateMaze(20261101)
const start = tileCentre(maze, maze.start.x, maze.start.y)

/** A point `metres` from the start along a straight, fully open line (null if none). */
function openLine(metres: number): { x: number; z: number } | null {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let open = true
    for (let m = 0; m <= metres; m += 0.25) {
      const t = worldToTile(maze, start.x + dx * m, start.z + dz * m)
      if (!walkable(maze, t.x, t.y)) open = false
    }
    if (open) return { x: start.x + dx * metres, z: start.z + dz * metres }
  }
  return null
}

afterEach(() => {
  setDiffMode('normal')
})

describe('난이도 상향 (보통 기본)', () => {
  it('보통은 몬스터가 단단하고 빠르며, 싸움이 길어진 만큼 한 대는 약하고 드물다', () => {
    expect(DIFFICULTY.horde.hp).toBeGreaterThan(0.72)
    // 몬스터가 약 8배 단단해진 대신(2026-11) 한 대 피해와 공격 빈도를 낮췄다: 위협은 남긴다.
    expect(DIFFICULTY.horde.damage).toBeGreaterThanOrEqual(0.15)
    expect(DIFFICULTY.horde.speed).toBeGreaterThan(0.86)
    expect(DIFFICULTY.horde.windup).toBeLessThan(0.48)
    expect(DIFFICULTY.horde.cooldown).toBeLessThan(2.5)
    expect(DIFFICULTY.hero.regenRate).toBeLessThanOrEqual(7)
    expect(DIFFICULTY.hero.regenDelay).toBeGreaterThanOrEqual(3)
    expect(DIFFICULTY.elite.hp).toBeGreaterThan(3.2)
    expect(DIFFICULTY.boss.hp).toBeGreaterThan(0.7)
  })

  it('층과 깊이가 오를수록 체력·공격력 배율이 이전보다 가파르게 오른다', () => {
    const d1 = floorScale(1, 1)
    const d3 = floorScale(3, 3)
    expect(d3.hp - d1.hp).toBeGreaterThan(2 * 0.2 + 2 * 0.04)
    expect(d3.damage).toBeGreaterThan(d1.damage)
  })

  it('몹이 단단해진 만큼 무리는 적고 작다 (팩 5–8, 2–4마리, 추격 최대 3)', () => {
    expect(EXPLORE.packs[0]).toBeGreaterThanOrEqual(5)
    expect(EXPLORE.packs[1]).toBeLessThanOrEqual(10)
    expect(EXPLORE.packSize[1]).toBeLessThanOrEqual(4)
    expect(EXPLORE.chaseCap).toBeGreaterThanOrEqual(3)
  })

  it('쉬움/보통/어려움: 기본은 보통, 바꾸면 저장되고 새로 나오는 몬스터 체력에 반영된다', () => {
    expect(diffMode()).toBe('normal')
    expect(Object.values(DIFF_MODES).map((m) => m.label)).toEqual(['쉬움', '보통', '어려움'])
    const h = new Horde(maze)
    const normal = h.spawn('slime', start.x, start.z)!.maxHp
    setDiffMode('hard')
    expect(globalThis.localStorage?.getItem('dnr3d.difficulty') ?? 'hard').toBe('hard')
    const hard = h.spawn('slime', start.x, start.z)!.maxHp
    setDiffMode('easy')
    const easy = h.spawn('slime', start.x, start.z)!.maxHp
    expect(hard).toBeGreaterThan(normal)
    expect(easy).toBeLessThan(normal)
    expect(diff().regen).toBeGreaterThan(1)
  })
})

describe('정예의 추가 기술', () => {
  it('체력이 절반 아래로 떨어지면 한 번 격노한다 (더 빠르고 더 아프게)', () => {
    const h = new Horde(maze)
    const raged: number[] = []
    h.onRage = (f) => raged.push(f.id)
    const f = h.spawn('slime', start.x, start.z, true)!
    const speed = f.speed
    const dmg = f.damage
    h.damage(f, f.maxHp * 0.3)
    expect(f.rage).toBe(false)
    h.damage(f, f.maxHp * 0.3)
    expect(f.rage).toBe(true)
    expect(f.speed).toBeCloseTo(speed * DIFFICULTY.elite.rageSpeed)
    expect(f.damage).toBeGreaterThanOrEqual(dmg)
    h.damage(f, 1)
    expect(raged).toEqual([f.id])
  })

  it('몇 미터 떨어진 곳에서 웅크렸다가(예고) 돌진해 한 번 때린다', () => {
    const found = openLine(5)
    expect(found).not.toBeNull()
    const line = found!
    const h = new Horde(maze)
    const f = h.spawn('slime', line.x, line.z, true)!
    f.age = 1
    f.chargeCd = 0
    const target = { x: start.x, z: start.z, alive: true }
    let hits = 0
    let crouched = false
    for (let i = 0; i < 90 && hits === 0; i += 1) {
      h.update(1 / 30, target, () => (hits += 1))
      if (f.chargeWind > 0) crouched = true
    }
    expect(crouched).toBe(true)
    expect(hits).toBe(1)
  })
})
