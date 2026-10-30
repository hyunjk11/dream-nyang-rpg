import { describe, expect, it } from 'vitest'
import { GUN, Gun, hitNormal, hitStopFor, rollDamage, spreadDir } from '../src/3d/dungeon/gunfeel'
import { VoicePool, synth } from '../src/3d/dungeon/gunsound'
import { TILE, generateMaze, tileCentre, Tile } from '../src/3d/dungeon/maze'

describe('두두두 연사 손맛', () => {
  it('방아쇠를 1초 당기면 초당 약 15발이 나가고 프레임이 느려도 연사 속도가 유지된다', () => {
    for (const dt of [1 / 60, 1 / 20]) {
      const g = new Gun()
      let shots = 0
      for (let t = 0; t < 1 - 1e-9; t += dt) shots += g.update(dt, true)
      expect(shots).toBeGreaterThanOrEqual(14)
      expect(shots).toBeLessThanOrEqual(16)
    }
  })

  it('연사할수록 조준선이 벌어지고 손을 떼면 다시 모인다', () => {
    const g = new Gun()
    const rest = g.spread
    for (let i = 0; i < 30; i += 1) g.update(1 / 60, true)
    expect(g.spread).toBeGreaterThan(rest * 3)
    expect(g.gapPx).toBeGreaterThan(GUN.gapPx + 5)
    for (let i = 0; i < 60; i += 1) g.update(1 / 60, false)
    expect(g.spread).toBeCloseTo(rest, 5)
  })

  it('계속 쏘면 약 6초 뒤 과열되어 잠시 쉬고, 식으면 다시 쏜다', () => {
    const g = new Gun()
    let t = 0
    while (!g.overheated && t < 20) {
      g.update(1 / 60, true)
      t += 1 / 60
    }
    expect(t).toBeGreaterThan(4.5)
    expect(t).toBeLessThan(8)
    expect(g.update(1 / 60, true)).toBe(0)
    let vent = 0
    while (g.overheated) {
      g.update(1 / 60, true)
      vent += 1 / 60
    }
    expect(vent).toBeGreaterThan(0.5)
    expect(vent).toBeLessThan(1.5)
    expect(g.update(0.1, true)).toBeGreaterThan(0)
  })

  it('퍼짐 방향은 단위 벡터이고 원뿔 각도 안에 있다', () => {
    const d = { x: 0.6, y: -0.2, z: 0.77 }
    const l = Math.hypot(d.x, d.y, d.z)
    for (let i = 0; i < 200; i += 1) {
      const s = spreadDir(d.x / l, d.y / l, d.z / l, 0.03, Math.random(), Math.random())
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6)
      const cos = (s.x * d.x + s.y * d.y + s.z * d.z) / l
      expect(Math.acos(Math.min(1, cos))).toBeLessThanOrEqual(0.0301)
    }
  })

  it('치명타는 가끔 크게 들어가고, 정예·보스만 히트스톱이 걸린다', () => {
    expect(rollDamage(0.05)).toEqual({ amount: Math.round(GUN.damage * GUN.critMul), crit: true })
    expect(rollDamage(0.5)).toEqual({ amount: GUN.damage, crit: false })
    expect(hitStopFor({})).toBe(0)
    expect(hitStopFor({ kill: true })).toBe(0)
    expect(hitStopFor({ elite: true })).toBeGreaterThan(0)
    expect(hitStopFor({ elite: true, kill: true })).toBeGreaterThan(hitStopFor({ elite: true }))
    expect(hitStopFor({ boss: true, kill: true })).toBeGreaterThan(0.1)
  })

  it('물 자국은 맞은 면의 법선을 따라 붙는다 (바닥·천장·벽)', () => {
    const m = generateMaze(20261030)
    const s = tileCentre(m, m.start.x, m.start.y)
    expect(hitNormal(m, s.x, 0, s.z, 0.3, 0.9)).toEqual({ x: 0, y: 1, z: 0 })
    expect(hitNormal(m, s.x, 4.2, s.z, 0.3, 0.9).y).toBe(-1)
    // Walk east from the start until the first solid tile; the face points back west.
    let x = m.start.x
    while (m.tiles[m.start.y * m.w + x + 1] !== Tile.Solid) x += 1
    const wallX = (x + 1 - m.w / 2) * TILE
    const n = hitNormal(m, wallX, 1.2, s.z, 1, 0)
    expect(n).toEqual({ x: -1, y: 0, z: 0 })
  })

  it('합성 총소리는 클리핑 없이 짧고, 변형마다 조금씩 다르다', () => {
    for (const cue of ['shot', 'tail', 'tick', 'crit', 'pop', 'thunk', 'hiss'] as const) {
      const a = synth(cue, 44100, 0)
      let peak = 0
      for (const v of a) peak = Math.max(peak, Math.abs(v))
      expect(peak).toBeLessThanOrEqual(0.8 + 1e-6)
      expect(peak).toBeGreaterThan(0.5)
      expect(Math.abs(a[a.length - 1])).toBeLessThan(0.01)
    }
    expect(synth('shot', 44100, 0).length).toBeLessThan(44100 * 0.1)
    const a = synth('shot', 44100, 0)
    const b = synth('shot', 44100, 2)
    let diff = 0
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diff += Math.abs(a[i] - b[i])
    expect(diff).toBeGreaterThan(1)
  })

  it('보이스 풀은 동시 재생 수를 넘기면 가장 오래된 소리부터 줄인다', () => {
    const pool = new VoicePool<number>(3)
    expect(pool.add(1, 0, 1)).toEqual([])
    expect(pool.add(2, 0.05, 1)).toEqual([])
    expect(pool.add(3, 0.1, 1)).toEqual([])
    expect(pool.add(4, 0.15, 1)).toEqual([1])
    expect(pool.size).toBe(3)
    // Finished voices leave on their own.
    expect(pool.add(5, 2, 3)).toEqual([])
    expect(pool.size).toBe(1)
  })
})
