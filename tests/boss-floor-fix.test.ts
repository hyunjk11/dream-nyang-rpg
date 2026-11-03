import { describe, expect, it } from 'vitest'
import { Horde, hordeHp, type HordeKind } from '../src/world/dungeon/horde'
import { BOSS } from '../src/world/dungeon/boss'
import { bossMaze, BOSS_ARENA } from '../src/world/dungeon/rooms'
import { floorMaze, EXPLORE } from '../src/world/dungeon/layout'
import { Tile, distances, tileCentre } from '../src/world/dungeon/maze'
import { BOSS_LIVE, BOSS_ADDS, BOSS_GUARD, bossRoomHit } from '../src/world/dungeon/run'
import { floorPlan } from '../src/sim/delve'
import { DIFFICULTY } from '../src/combat/difficulty'
import { SKILL_BITE, SKILL_POWER, SKILL_REF_MUL, skillBite, skillBlast, skillGear, type SkillBody } from '../src/combat/skills'
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

describe('스킬이 새 체력 곡선을 따라간다 (fix/gun-identity: 스킬은 큰 한 방)', () => {
  const kinds: HordeKind[] = ['slime', 'bug', 'skeleton', 'knight', 'golem']
  it('랭크1 거품 폭탄·폭주 파동·모찌 돌진 한 번이면 일반 몹은 어떤 종류든 쓰러진다 (무리 정리)', () => {
    for (const d of [1, 2, 3])
      for (const k of kinds) {
        const hp = hordeHp(k, floorPlan(d, 2).scale.hp * EXPLORE.hp)
        for (const kind of ['bomb', 'wave', 'rush'] as const) expect(skillBite({ tone: 'n', maxHp: hp }, kind, 1, 1), `d${d} ${k} ${kind}`).toBeGreaterThanOrEqual(hp)
      }
  })

  it('같은 수준 장비면 정예는 한 번에 30~40%, 보스는 15~25%가 깎인다', () => {
    for (const kind of ['bomb', 'wave', 'rush', 'aura'] as const)
      for (const r of [1, 3]) {
        const e = skillBite({ tone: 'elite', maxHp: 1000 }, kind, r, 1) / 1000
        const b = skillBite({ tone: 'boss', maxHp: 10000 }, kind, r, 1) / 10000
        expect(e, `${kind} r${r} 정예`).toBeGreaterThanOrEqual(0.3)
        expect(e, `${kind} r${r} 정예`).toBeLessThanOrEqual(0.4)
        expect(b, `${kind} r${r} 보스`).toBeGreaterThanOrEqual(0.15)
        expect(b, `${kind} r${r} 보스`).toBeLessThanOrEqual(0.25)
      }
    // 폭탄 r5도 정예 40%, 보스 25% 안쪽.
    expect(skillBite({ tone: 'elite', maxHp: 1000 }, 'bomb', 5, 1)).toBeLessThanOrEqual(400)
    expect(skillBite({ tone: 'boss', maxHp: 1000 }, 'bomb', 5, 1)).toBeLessThanOrEqual(250)
  })

  it('장비가 좋으면 조금 더, 나쁘면 조금 덜 (0.8~1.2배로 묶임)', () => {
    expect(skillGear(SKILL_REF_MUL[2], SKILL_REF_MUL[2])).toBe(1)
    expect(skillGear(10, SKILL_REF_MUL[1])).toBe(1.2)
    expect(skillGear(0.5, SKILL_REF_MUL[3])).toBe(0.8)
  })

  it('스킬 범위 피해는 범위 안 무리 전체에 들어가고, 정예·보스는 최대 체력 비율로 깎인다', () => {
    const got: Record<string, number> = {}
    const body = (id: string, tone: SkillBody['tone'], x: number, maxHp: number): SkillBody => ({ id, x, z: 0, r: 0.4, tone, maxHp, hit: (a) => ((got[id] = a), false) })
    const n = skillBlast([body('a', 'n', 0, 300), body('b', 'n', 1, 900), body('e', 'elite', -1, 2000), body('B', 'boss', 0.5, 20000), body('far', 'n', 9, 300)], 0, 0, 2.4, { kind: 'bomb', rank: 1, gear: 1 })
    expect(n).toBe(4)
    expect(got.a).toBeGreaterThanOrEqual(300)
    expect(got.b).toBeGreaterThanOrEqual(900)
    expect(got.e).toBe(Math.round(2000 * SKILL_BITE.bomb.elite))
    expect(got.B).toBe(Math.round(20000 * SKILL_BITE.bomb.boss))
    expect(got.far).toBeUndefined()
  })

  it('TTK: 정예 기사·보스를 총만 쓸 때보다 스킬을 섞으면 훨씬 빨리 잡는다', () => {
    for (const d of [1, 2, 3]) {
      const dps = REF_DPS[`d${d}f2`][0]
      const elite = hordeHp('knight', floorPlan(d, 2).scale.hp * EXPLORE.hp, true)
      const gun = elite / dps
      // 폭탄 + 돌진 한 번씩.
      const mixed = (elite - skillBite({ tone: 'elite', maxHp: elite }, 'bomb', 1, 1) - skillBite({ tone: 'elite', maxHp: elite }, 'rush', 1, 1)) / dps
      expect(mixed, `d${d}`).toBeLessThan(gun * 0.4)
      void SKILL_POWER
      void BOSS
    }
  })
})
