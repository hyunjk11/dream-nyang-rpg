import { describe, expect, it } from 'vitest'
import { EXPLORE, floorMaze, planLayout } from '../src/world/dungeon/layout'
import { Tile, distances, rng } from '../src/world/dungeon/maze'
import type { RoomMaze } from '../src/world/dungeon/rooms'

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const
const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 3)
const mazeOf = (seed: number) => floorMaze({ seed, cells: 11, bossRoom: 5, objective: 'exit' }) as RoomMaze
const open = (m: RoomMaze, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.tiles[y * m.w + x] !== Tile.Solid

describe('탐험 층 방 구조 (미로 단순화)', () => {
  it('모든 칸이 시작에서 이어지고, 출구까지 본길이 짧다 (30~48칸)', () => {
    for (const seed of seeds) {
      const m = mazeOf(seed)
      const d = distances(m.tiles, m.w, m.h, m.start.x, m.start.y)
      for (let i = 0; i < m.tiles.length; i += 1) if (m.tiles[i] !== Tile.Solid) expect(d[i]).toBeGreaterThanOrEqual(0)
      let ex = Infinity
      const r = m.bossRoom
      for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) ex = Math.min(ex, d[y * m.w + x])
      expect(ex).toBeGreaterThanOrEqual(EXPLORE.exitMin)
      expect(ex).toBeLessThanOrEqual(48)
    }
  })

  it('막다른 길은 몇 개뿐 (3~6), 곁방은 3~4개', () => {
    for (const seed of seeds) {
      const m = mazeOf(seed)
      let dead = 0
      for (let y = 1; y < m.h - 1; y += 1)
        for (let x = 1; x < m.w - 1; x += 1) {
          if (m.tiles[y * m.w + x] !== Tile.Corridor) continue
          if (DIRS.filter(([dx, dy]) => open(m, x + dx, y + dy)).length === 1) dead += 1
        }
      expect(dead).toBeGreaterThanOrEqual(3)
      expect(dead).toBeLessThanOrEqual(6)
      expect(m.side.length).toBeGreaterThanOrEqual(3)
      expect(m.side.length).toBeLessThanOrEqual(4)
    }
  })

  it('본길 복도는 두 칸 너비', () => {
    for (const seed of seeds.slice(0, 10)) {
      const m = mazeOf(seed)
      // Every slot-to-slot link on the main path crosses the wall line with two side-by-side tiles.
      for (let i = 1; i < m.path.length; i += 1) {
        const a = m.path[i - 1]
        const b = m.path[i]
        if (a.y === b.y) {
          const x = Math.max(a.x, b.x) * 6
          const rows = [-1, 0, 1, 2].map((o) => a.y * 6 + 3 + o).filter((y) => open(m, x, y))
          expect(rows.length).toBeGreaterThanOrEqual(2)
        } else {
          const y = Math.max(a.y, b.y) * 6
          const cols = [-1, 0, 1, 2].map((o) => a.x * 6 + 3 + o).filter((x) => open(m, x, y))
          expect(cols.length).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('곁방에는 보물상자나 정예가 있다', () => {
    for (const seed of seeds.slice(0, 20)) {
      const m = mazeOf(seed)
      const L = planLayout(m, { depth: 1, floor: 2 }, rng(seed ^ 0x55))
      const inR = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
      const rewarded = m.side.filter((r) => L.chests.some((c) => inR(r, c.x, c.y)) || L.packs.some((p) => p.elite && inR(r, p.x, p.y)))
      expect(rewarded.length).toBeGreaterThanOrEqual(2)
      expect(L.needsKey).toBe(true)
      expect(L.chests.length).toBeGreaterThanOrEqual(EXPLORE.chests[0])
    }
  })

  it('같은 씨앗이면 같은 지도', () => {
    expect(Array.from(mazeOf(42).tiles)).toEqual(Array.from(mazeOf(42).tiles))
  })
})
