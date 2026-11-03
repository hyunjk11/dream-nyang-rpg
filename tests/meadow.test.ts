import { describe, expect, it } from 'vitest'
import { FIELD, FieldDirector, fieldMaze } from '../src/world/dungeon/field'
import { Horde } from '../src/world/dungeon/horde'
import { Tile, distances, rng, tileCentre, walkable, worldToTile } from '../src/world/dungeon/maze'
import { collideCircle, rayHit } from '../src/world/dungeon/walls'
import { grassTiles, treeSpots } from '../src/world/dungeon/meadow'

describe('몽실 들판 강·나무 (2026-11)', () => {
  for (const seed of [1, 7, 42, 12345, 99999]) {
    it(`강이 있고 다리 둘·징검다리 하나로 건널 수 있으며, 갇힌 빈 칸이 없다 (seed ${seed})`, () => {
      const m = fieldMaze(seed)
      const water = [...m.tiles].filter((t) => t === Tile.Water).length
      expect(water).toBeGreaterThan(40)
      const kinds = (m.river?.crossings ?? []).map((c) => c.kind)
      expect(kinds.filter((k) => k === 'bridge').length).toBe(2)
      expect(kinds).toContain('stones')
      const d = distances(m.tiles, m.w, m.h, m.start.x, m.start.y)
      for (let i = 0; i < m.tiles.length; i += 1) {
        const t = m.tiles[i]
        if (t !== Tile.Solid && t !== Tile.Water) expect(d[i]).toBeGreaterThanOrEqual(0)
      }
      // 보스 링까지 길이 있다.
      expect(d[(m.bossRoom.y + 3) * m.w + m.bossRoom.x + 3]).toBeGreaterThan(0)
    })
  }

  it('강물은 걸어서 못 들어가지만 총알·시야는 넘어간다', () => {
    const m = fieldMaze(5)
    const i = m.tiles.indexOf(Tile.Water)
    const tx = i % m.w
    const ty = Math.floor(i / m.w)
    expect(walkable(m, tx, ty)).toBe(false)
    const c = tileCentre(m, tx, ty)
    // 물 칸 한가운데로 걸어 들어가도 밀려 나온다.
    const out = collideCircle(m, c.x, c.z, 0.4)
    const t = worldToTile(m, out.x, out.z)
    expect(m.tiles[t.y * m.w + t.x]).not.toBe(Tile.Water)
    // 강 서쪽에서 동쪽으로 쏜 총알은 물 위를 지난다.
    let wx = tx
    while (m.tiles[ty * m.w + wx - 1] !== Tile.Chamber) wx -= 1
    const from = tileCentre(m, wx - 1, ty)
    expect(rayHit(m, from.x, 1.2, from.z, 1, 0, 0, TILE_SPAN)).toBeGreaterThan(TILE_SPAN * 0.9)
  })

  it('들판 몹은 강물 위에 생기지 않고, 다리 너머로 쫓아온다', () => {
    const m = fieldMaze(42)
    const h = new Horde(m)
    const fd = new FieldDirector(m, h, rng(3), { kinds: ['slime'], named: null, mobile: false })
    const s = tileCentre(m, m.start.x, m.start.y)
    fd.update(1, s.x, s.z, true)
    for (const f of h.foes) {
      const t = worldToTile(m, f.x, f.z)
      expect(m.tiles[t.y * m.w + t.x]).not.toBe(Tile.Water)
      expect(m.tiles[t.y * m.w + t.x]).not.toBe(Tile.Solid)
    }
    // 강 건너(동쪽) 몹이 그녀를 쫓으면 강을 건너온다.
    const east = h.foes.filter((f) => f.x > 12)
    expect(east.length).toBeGreaterThan(0)
    for (const f of east) f.mode = 'chase'
    h.aggro = null
    const hero = { x: s.x, z: s.z, alive: true }
    for (let k = 0; k < 60 * 40; k += 1) h.update(1 / 60, hero, () => {})
    const crossed = east.filter((f) => f.x < 0).length
    expect(crossed).toBeGreaterThan(east.length * 0.6)
    expect(FIELD.alive[0]).toBeGreaterThan(30)
  })

  it('나무는 막힌 칸(숲)과 가장자리에만 서고, 꽃·덤불·바위는 풀밭 칸에만 깔린다', () => {
    const m = fieldMaze(7)
    for (const t of treeSpots(m, false)) {
      const k = worldToTile(m, t.x, t.z)
      const inside = k.x >= 0 && k.y >= 0 && k.x < m.w && k.y < m.h
      if (inside) expect([Tile.Solid, Tile.Chamber]).toContain(m.tiles[k.y * m.w + k.x])
    }
    for (const i of grassTiles(m)) expect(m.tiles[i]).toBe(Tile.Chamber)
  })
})

const TILE_SPAN = 3.4 * 4
