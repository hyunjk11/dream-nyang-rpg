import { describe, expect, it } from 'vitest'
import { generateMaze, tileCentre, Tile, TILE, type Maze } from '../src/world/dungeon/maze'
import { Horde, NEVER_RANGED, RANGED, SHOT_CAP, SHOT_STYLE, SHOT_STYLES, rangedPick, type HordeKind } from '../src/world/dungeon/horde'
import { rangedShareFor, RANGED_BOSS_SHARE } from '../src/world/dungeon/run'

/** 벽만 두른 빈 광장 (가운데 줄에 벽 / 물을 세울 수 있게). */
function arena(mid?: number): Maze {
  const m = generateMaze(20261105)
  const floor = m.tiles[m.start.y * m.w + m.start.x]
  for (let y = 0; y < m.h; y += 1)
    for (let x = 0; x < m.w; x += 1) {
      const edge = x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1
      m.tiles[y * m.w + x] = edge ? Tile.Solid : floor
    }
  if (mid !== undefined) {
    const cx = Math.floor(m.w / 2)
    for (let y = 1; y < m.h - 1; y += 1) m.tiles[y * m.w + cx] = mid
  }
  return m
}
const centre = (m: Maze) => tileCentre(m, Math.floor(m.w / 2), Math.floor(m.h / 2))

function duel(m: Maze, kind: HordeKind, dx: number, dodge = false, secs = 4) {
  const h = new Horde(m)
  h.rangedShare = 1
  const c = centre(m)
  const hero = { x: c.x + TILE * 1.5, z: c.z, alive: true, dodge }
  const f = h.spawn(kind, hero.x - dx, c.z)!
  f.age = 10
  f.damage = 20
  let dmg = 0
  let hits = 0
  for (let i = 0; i < secs * 60; i += 1)
    h.update(1 / 60, hero, (a) => {
      dmg += a
      hits += 1
    })
  return { h, f, dmg, hits, hero }
}

describe('원거리 몬스터', () => {
  it('일반·정예의 약 50% 가 원거리이고 무리 안에서 섞인다', () => {
    let ranged = 0
    for (let n = 1; n <= 200; n += 1) if (rangedPick(n, 0.5)) ranged += 1
    expect(ranged / 200).toBeGreaterThan(0.45)
    expect(ranged / 200).toBeLessThan(0.55)
    // 5 마리 무리마다 원거리·근접이 다 들어 있다.
    for (let s = 1; s < 150; s += 5) {
      const pack = [0, 1, 2, 3, 4].map((i) => rangedPick(s + i, 0.5))
      expect(pack.some(Boolean)).toBe(true)
      expect(pack.some((r) => !r)).toBe(true)
    }
    const m = arena()
    const h = new Horde(m)
    h.rangedShare = 0.5
    const c = centre(m)
    for (let i = 0; i < 40; i += 1) h.spawn('slime', c.x + (i % 6), c.z + Math.floor(i / 6))
    const r = h.foes.filter((f) => f.ranged).length
    expect(r).toBeGreaterThanOrEqual(18)
    expect(r).toBeLessThanOrEqual(22)
  })

  it('보스 층은 몇 마리만, 마을은 0, 우두머리(lord·lich)는 늘 근접', () => {
    expect(rangedShareFor({ objective: 'town' })).toBe(0)
    expect(rangedShareFor({ objective: 'boss' })).toBe(RANGED_BOSS_SHARE)
    expect(RANGED_BOSS_SHARE).toBeLessThan(RANGED.share)
    expect(rangedShareFor({ objective: 'exit' } as never)).toBe(RANGED.share)
    const m = arena()
    const h = new Horde(m)
    h.rangedShare = 1
    const c = centre(m)
    for (const k of NEVER_RANGED) expect(h.spawn(k, c.x, c.z)!.ranged).toBe(false)
    expect(new Horde(arena()).spawn('slime', c.x, c.z)!.ranged).toBe(false)
  })

  it('원거리 몬스터마다 귀여운 탄 모양이 있고 예고 0.4–0.6 초, 느림~중간 속도', () => {
    expect(SHOT_STYLE.slime).toBe('bubble')
    expect(SHOT_STYLE.skeleton).toBe('moon')
    expect(new Set(Object.values(SHOT_STYLE))).toEqual(new Set(['bubble', 'star', 'spore', 'moon']))
    for (const s of Object.values(SHOT_STYLES)) {
      expect(s.aim).toBeGreaterThanOrEqual(0.4)
      expect(s.aim).toBeLessThanOrEqual(0.6)
      expect(s.speed).toBeGreaterThanOrEqual(12)
      expect(s.speed).toBeLessThanOrEqual(20)
    }
  })

  it('열린 곳에서는 9 m 거리에서 쏴서 맞히고, 한 발 피해는 근접보다 약하다', () => {
    const { dmg, hits, f, h } = duel(arena(), 'slime', 9)
    expect(h.fired).toBeGreaterThan(0)
    expect(hits).toBeGreaterThan(0)
    expect(dmg / hits).toBeLessThan(f.damage)
  })

  it('벽은 탄을 막고 (조준도 안 한다), 몽실 강물은 막지 않는다', () => {
    const wall = duel(arena(Tile.Solid), 'slime', 9)
    expect(wall.hits).toBe(0)
    const water = duel(arena(Tile.Water), 'slime', 9)
    expect(water.hits).toBeGreaterThan(0)
  })

  it('대시 무적 중에는 탄이 그녀를 통과한다 (피하기)', () => {
    const r = duel(arena(), 'slime', 9, true)
    expect(r.h.fired).toBeGreaterThan(0)
    expect(r.hits).toBe(0)
    expect(r.h.dodged).toBeGreaterThan(0)
  })

  it('가까이 붙으면 뒤로 물러나고 7–11 m 를 지킨다', () => {
    const r = duel(arena(), 'slime', 3, false, 3)
    expect(Math.hypot(r.f.x - r.hero.x, r.f.z - r.hero.z)).toBeGreaterThan(4.5)
    const far = duel(arena(), 'slime', 16, false, 5)
    expect(Math.hypot(far.f.x - far.hero.x, far.f.z - far.hero.z)).toBeLessThan(RANGED.far + 0.5)
  })

  it(`동시에 조준하는 원거리 몬스터는 최대 ${SHOT_CAP} 마리`, () => {
    const m = arena()
    const h = new Horde(m)
    h.rangedShare = 1
    const c = centre(m)
    const hero = { x: c.x, z: c.z, alive: true, dodge: true }
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2
      h.spawn('slime', c.x + Math.sin(a) * 9, c.z + Math.cos(a) * 9)!.age = 10
    }
    let peak = 0
    for (let i = 0; i < 300; i += 1) {
      h.update(1 / 60, hero, () => {})
      peak = Math.max(peak, h.foes.filter((f) => f.aim > 0).length)
    }
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(SHOT_CAP)
  })
})
