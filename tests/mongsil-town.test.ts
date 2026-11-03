import { describe, expect, it } from 'vitest'
import { TOWN_SIZE, TOWN_SPOTS, townMaze } from '../src/world/dungeon/town'
import { Tile, tileCentre } from '../src/world/dungeon/maze'

describe('몽실 마을 압축', () => {
  it('마을은 11칸 이하로 작다', () => {
    expect(TOWN_SIZE).toBeLessThanOrEqual(11)
  })

  it('NPC·별문 사이 가장 먼 거리도 22m 이하다(이전 35.5m)', () => {
    const maze = townMaze(7)
    const at = TOWN_SPOTS.map((s) => tileCentre(maze, s.tile.x, s.tile.y))
    let far = 0
    for (const a of at) for (const b of at) far = Math.max(far, Math.hypot(a.x - b.x, a.z - b.z))
    expect(far).toBeLessThanOrEqual(22)
  })

  it('NPC와 별문 자리는 모두 걸을 수 있는 칸이다', () => {
    const maze = townMaze(3)
    for (const s of TOWN_SPOTS) expect(maze.tiles[s.tile.y * maze.w + s.tile.x]).not.toBe(Tile.Solid)
  })

  it('별문은 광장 북쪽, 몽이 바로 위에 있다', () => {
    const gate = TOWN_SPOTS.find((s) => s.id === 'gate')!
    const mongi = TOWN_SPOTS.find((s) => s.id === 'mongi')!
    expect(gate.tile.x).toBe(mongi.tile.x)
    expect(gate.tile.y).toBeLessThan(mongi.tile.y)
  })
})
