import { describe, expect, it } from 'vitest'
import { Horde, hordeHp, type HordeKind } from '../src/world/dungeon/horde'
import { BOSS } from '../src/world/dungeon/boss'
import { bossMaze, BOSS_ARENA } from '../src/world/dungeon/rooms'
import { floorMaze, EXPLORE } from '../src/world/dungeon/layout'
import { Tile, distances, tileCentre } from '../src/world/dungeon/maze'
import { BOSS_LIVE, BOSS_ADDS, BOSS_GUARD, bossRoomHit } from '../src/world/dungeon/run'
import { floorPlan } from '../src/sim/delve'
import { DIFFICULTY } from '../src/combat/difficulty'
import { SKILL_POWER, SKILL_TONE, skillAmount, skillBlast, type SkillBody } from '../src/combat/skills'
import { bombDamage, rushDamage } from '../src/data/tree'
import { REF_DPS } from '../tools/sim-ttk-ref'

describe('보스층은 웨이브가 아니라 보스 방', () => {
  it('보스층 미로는 시작 방 → 통로 → 보스 아레나 한 칸짜리 방 구조다', () => {
    for (const d of [1, 2, 3]) {
      const plan = floorPlan(d, 4)
      expect(plan.objective).toBe('boss')
      const m = floorMaze(plan)
      expect(m.h % 2).toBe(1)
      expect(m.w).toBe(BOSS_ARENA.size + 4)
      const boss = [...m.tiles].filter((t) => t === Tile.Boss).length
      expect(boss).toBeGreaterThan(BOSS_ARENA.size * BOSS_ARENA.size - 8)
      // 시작 칸에서 보스 아레나까지 걸어서 닿는다.
      const dist = distances(m.tiles, m.w, m.h, m.start.x, m.start.y)
      let reach = 0
      for (let i = 0; i < m.tiles.length; i += 1) if (m.tiles[i] === Tile.Boss && dist[i] >= 0) reach += 1
      expect(reach).toBe(boss)
    }
    expect(bossMaze(7).w).toBe(bossMaze(8).w)
  })

  it('동시에 서 있는 졸개는 최대 8마리, 부르는 수도 작다', () => {
    expect(BOSS_LIVE).toBeLessThanOrEqual(8)
    expect(BOSS_ADDS + BOSS_GUARD).toBeLessThanOrEqual(BOSS_LIVE)
  })
})

/** 몹 6마리에게 둘러싸인 채 가만히 맞는 10초 (무적 시간과 자연 회복 포함). */
function surrounded(hit: number, maxHp: number, kinds: HordeKind[] = ['slime', 'bug', 'jelly', 'slime', 'bug', 'knight']) {
  const m = bossMaze(3)
  const plan = floorPlan(1, 4)
  const h = new Horde(m)
  h.scale = { hp: plan.scale.hp, damage: plan.scale.damage * hit }
  // 보스 아레나 한가운데.
  let sx = 0, sy = 0, n = 0
  for (let i = 0; i < m.tiles.length; i += 1) {
    if (m.tiles[i] !== Tile.Boss) continue
    sx += i % m.w
    sy += Math.floor(i / m.w)
    n += 1
  }
  const c = tileCentre(m, Math.round(sx / n), Math.round(sy / n) + 1)
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2
    const f = h.spawn(k, c.x + Math.sin(a) * 1.1, c.z + Math.cos(a) * 1.1)!
    f.age = 10
  })
  const hero = { x: c.x, z: c.z, alive: true }
  let hp = maxHp
  let iframes = 0
  let since = 9
  const dt = 1 / 30
  for (let t = 0; t < 10; t += dt) {
    iframes = Math.max(0, iframes - dt)
    since += dt
    h.update(dt, hero, (amount) => {
      if (iframes > 0) return
      hp -= amount
      iframes = DIFFICULTY.hero.iframes
      since = 0
    })
    if (since > DIFFICULTY.hero.regenDelay) hp = Math.min(maxHp, hp + DIFFICULTY.hero.regenRate * dt)
    hero.x = c.x
    hero.z = c.z
  }
  return { hp, lost: 1 - hp / maxHp }
}

describe('보스층에서 내 피도 빠진다 (내 피도 안빠져)', () => {
  it('예전 공식이면 몹 6마리에 둘러싸여도 10초에 피가 거의 안 빠졌다', () => {
    const old = surrounded(1, 150)
    expect(old.lost).toBeLessThan(0.1)
  })

  it('이제 Lv1(150)도 Lv30(302)도 10초 포위에 확실히 깎이지만 바로 죽지는 않는다', () => {
    for (const maxHp of [150, 302]) {
      const r = surrounded(bossRoomHit(maxHp, 'adds'), maxHp)
      expect(r.lost, `maxHp ${maxHp}`).toBeGreaterThan(0.15)
      expect(r.lost, `maxHp ${maxHp}`).toBeLessThan(0.5)
    }
  })

  it('보스층 몹·보스 피해 배율은 최대 체력을 따라 커진다', () => {
    expect(bossRoomHit(150, 'adds')).toBeGreaterThan(1)
    expect(bossRoomHit(300, 'adds')).toBeCloseTo(bossRoomHit(150, 'adds') * 2)
    expect(Math.round(BOSS.contact * bossRoomHit(150, 'boss'))).toBeGreaterThanOrEqual(12)
  })
})

describe('스킬이 새 체력 곡선을 따라간다 (스킬도 너무 약해)', () => {
  const floors: [number, number, boolean][] = [[1, 1, true], [1, 4, false], [2, 2, true], [2, 4, false], [3, 1, true], [3, 4, false]]
  it('랭크1 거품 폭탄 하나가 일반 몹 체력의 절반 이상을 깎는다 (깊이 1~3)', () => {
    for (const [d, f, explore] of floors) {
      const scale = floorPlan(d, f).scale.hp * (explore ? EXPLORE.hp : 1)
      const power = SKILL_POWER * scale
      const normal = hordeHp('bug', scale)
      const bomb = skillAmount(bombDamage(1), 1, power, 'n')
      expect(bomb / normal, `d${d}f${f}`).toBeGreaterThan(0.5)
      expect(bomb / normal, `d${d}f${f}`).toBeLessThan(1)
      expect(skillAmount(rushDamage(1), 1, power, 'n') / normal).toBeGreaterThan(0.45)
      // 정예는 눈에 띄게 (≥15%) 깎인다.
      expect(skillAmount(bombDamage(1), 1, power, 'elite') / hordeHp('knight', scale, true), `d${d}f${f} 정예`).toBeGreaterThan(0.15)
    }
  })

  it('보스에게는 폭탄 하나가 몇 % 단위로 박힌다', () => {
    for (const d of [1, 2, 3]) {
      const p = floorPlan(d, 4)
      const boss = Math.round(BOSS.hp * p.scale.boss.hp)
      expect(skillAmount(bombDamage(1), 1, SKILL_POWER * p.scale.hp, 'boss') / boss, `d${d}`).toBeGreaterThan(0.04)
    }
  })

  it('스킬 범위 피해는 정예·보스에 더 세게, 무리 전체에 들어간다', () => {
    const got: Record<string, number> = {}
    const body = (id: string, tone: SkillBody['tone'], x: number): SkillBody => ({ id, x, z: 0, r: 0.4, tone, hit: (a) => ((got[id] = a), false) })
    const n = skillBlast([body('a', 'n', 0), body('b', 'n', 1), body('e', 'elite', -1), body('B', 'boss', 0.5), body('far', 'n', 9)], 0, 0, 2.4, 65, 3)
    expect(n).toBe(4)
    expect(got.a).toBe(195)
    expect(got.e).toBe(195 * SKILL_TONE.elite)
    expect(got.B).toBe(195 * SKILL_TONE.boss)
    expect(got.far).toBeUndefined()
  })

  it('TTK: 일반 몹 5마리 무리를 총만 쓸 때보다 폭탄+돌진을 섞으면 훨씬 빨리 정리한다', () => {
    for (const [d, f] of [[1, 2], [2, 2], [3, 1]] as const) {
      const scale = floorPlan(d, f).scale.hp * EXPLORE.hp
      const power = SKILL_POWER * scale
      const dps = REF_DPS[`d${d}f${f}`][0]
      const pack = 5 * hordeHp('bug', scale)
      const gun = pack / dps
      // 폭탄은 5마리 모두, 돌진은 2마리를 친다.
      const skills = 5 * skillAmount(bombDamage(1), 1, power, 'n') + 2 * skillAmount(rushDamage(1), 1, power, 'n')
      const mixed = Math.max(0, pack - skills) / dps
      expect(mixed, `d${d}f${f}`).toBeLessThan(gun * 0.45)
    }
  })
})
