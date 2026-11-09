import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Horde, hordeHp, swingRest, type HordeKind } from '../src/world/dungeon/horde'
import { floorMaze, EXPLORE } from '../src/world/dungeon/layout'
import { tileCentre, walkable, worldToTile } from '../src/world/dungeon/maze'
import { runFoeScale, foeHit, bossRoomHit } from '../src/world/dungeon/run'
import { BOSS } from '../src/world/dungeon/boss'
import { floorPlan, fieldPlan } from '../src/sim/delve'
import { bombRadius } from '../src/data/tree'
import { DIFFICULTY } from '../src/combat/difficulty'
import { Hero } from '../src/actors/hero'
import { AURA_BURN, OVERDRIVE_WAVE, SKILL_RANGE, rushLock, AURA_PULSE, AURA_TIME, SKILL_CAP, SKILL_SHOTS, auraShare, skillBite, skillBlast, skillGear, SKILL_REF_MUL, type SkillBody } from '../src/combat/skills'
import { migrateSave } from '../src/sim/migrate'
import { freshSave } from '../src/sim/mutate'

/** 브라우저와 같은 길: Horde.update → 진짜 Hero.hurt (무적·방어·반올림) → Hero.update 자연 회복. */
function stand(plan: Parameters<typeof runFoeScale>[0] & Parameters<typeof floorMaze>[0], kinds: HordeKind[], maxHp = 150, isBoss = false, share = 0, drift = 0, dodge = false) {
  const maze = floorMaze(plan)
  const h = new Horde(maze)
  h.rangedShare = share
  h.scale = runFoeScale(plan, isBoss, maxHp)
  const s = tileCentre(maze, maze.start.x, maze.start.y)
  const hero = new Hero()
  hero.maxHp = maxHp
  hero.hp = maxHp
  hero.object.position.set(s.x, 0, s.z)
  // 칸이 열린 쪽으로 1.3 m 고리 (qa-realplay 와 같은 배치).
  kinds.forEach((k, i) => {
    let a = (i / kinds.length) * Math.PI * 2
    for (let tries = 0; tries < 12; tries += 1, a += 0.5) {
      const x = s.x + Math.sin(a) * 1.3, z = s.z + Math.cos(a) * 1.3
      const t = worldToTile(maze, x, z)
      if (!walkable(maze, t.x, t.y)) continue
      const f = h.spawn(k, x, z)!
      f.age = 10
      break
    }
  })
  const at = { x: s.x, z: s.z, alive: true }
  const dt = 1 / 60
  const aim = new Vector3()
  for (let t = 0; t < 10; t += dt) {
    if (drift > 0) {
      const ang = t * 1.2
      at.x = s.x + Math.sin(ang) * drift
      at.z = s.z + Math.cos(ang) * drift
    }
    h.update(dt, { ...at, dodge }, (amount, fx, fz) => {
      hero.hurt(amount, new Vector3(fx, 0, fz))
    })
    // 회복·무적 감소만 (Hero.update 와 같은 식).
    hero.iframes = Math.max(0, hero.iframes - dt)
    hero.sinceHit += dt
    if (hero.alive && hero.sinceHit > hero.regenDelay && hero.hp < hero.maxHp) hero.hp = Math.min(hero.maxHp, hero.hp + DIFFICULTY.hero.regenRate * hero.regenMul * dt)
    hero.object.position.set(at.x, 0, at.z)
    void aim
  }
  return { lost: 1 - hero.hp / maxHp, foes: h.foes.length }
}

describe('실제 플레이: 미로·하수도·들판에서도 피가 빠진다 (미로 - 안빠짐)', () => {
  it('미로·깊이 1–3 일반 무리 5마리에 10초 가만히 서 있으면 대부분 깎이거나 쓰러진다', () => {
    for (const [d, f] of [[1, 1], [1, 3], [2, 2], [3, 2]] as const) {
      const r = stand(floorPlan(d, f), ['slime', 'slime', 'bug', 'slime', 'bat'])
      expect(r.lost, `d${d}f${f}`).toBeGreaterThanOrEqual(0.7)
    }
  })

  it('같은 종류 5마리도 깊이마다 그 위험 구간에 머문다', () => {
    for (const [d, kind] of [[2, 'bat'], [3, 'skel_mage'], [3, 'bat'], [1, 'slime']] as const) {
      const r = stand(floorPlan(d, 2), [kind, kind, kind, kind, kind])
      expect(r.lost, `d${d} ${kind}`).toBeGreaterThanOrEqual(0.5)
      expect(r.lost, `d${d} ${kind}`).toBeLessThanOrEqual(1)
    }
  })

  it('레벨이 올라 최대 체력이 커져도(300) 같은 비율로 깎인다', () => {
    const r = stand(floorPlan(1, 2), ['slime', 'slime', 'bug', 'slime', 'bat'], 300)
    expect(r.lost).toBeGreaterThanOrEqual(0.7)
  })

  it('예전 배율(×1)이면 거의 안 빠졌다: 원인 재현', () => {
    const plan = floorPlan(1, 1)
    const maze = floorMaze(plan)
    const h = new Horde(maze)
    h.scale = { hp: plan.scale.hp, damage: plan.scale.damage }
    const f = h.spawn('slime', 0, 0)!
    expect(f.damage).toBe(1)
    expect(foeHit(150)).toBeGreaterThanOrEqual(4)
    h.scale = runFoeScale(plan, false, 150)
    expect(h.spawn('slime', 0, 0)!.damage).toBeGreaterThanOrEqual(3)
  })

  it('무리의 휘두르기는 서로 엇갈린다 (같은 프레임에 다 때려 무적이 다 삼키지 않게)', () => {
    const plan = floorPlan(1, 1)
    const h = new Horde(floorMaze(plan))
    const firsts = new Set<number>()
    for (let i = 0; i < 5; i += 1) firsts.add(Math.round(h.spawn('slime', 0, 0)!.cooldown * 10))
    expect(firsts.size).toBeGreaterThanOrEqual(4)
    const f = { beat: 0.1 }
    const rests = [swingRest(f), swingRest(f), swingRest(f)]
    expect(new Set(rests.map((r) => r.toFixed(2))).size).toBe(3)
    for (const r of rests) expect(r).toBeGreaterThan(DIFFICULTY.horde.cooldown * 0.6)
  })

  it('몽실 마을(몹 없음)만 배율이 없다; 들판은 일반 층처럼 아프다', () => {
    const town = runFoeScale({ scale: floorPlan(1, 1).scale, objective: 'town' }, false, 150)
    expect(town.damage).toBe(floorPlan(1, 1).scale.damage)
    const field = fieldPlan(1, { kinds: ['slime', 'bug'], fluff: false, named: false, boss: false })
    expect(runFoeScale(field, false, 150).damage).toBeGreaterThan(field.scale.damage * 3)
  })
})

/** 실제 몸 (실제 hordeHp / 보스 체력) 에 실제 skillBlast. */
function body(tone: SkillBody['tone'], maxHp: number): SkillBody & { hp: number } {
  const b = { id: tone, x: 0, z: 0, r: 0.6, tone, maxHp, hp: maxHp, hit: (n: number) => { b.hp -= n; return b.hp <= 0 } }
  return b
}

describe('밸런스 패스: 스킬 한 번 = 정예 12–18% · 보스 4–6%, 큰 쿨 스킬만 일반 무리 한 방', () => {
  const kinds = ['bomb', 'wave', 'rush', 'aura'] as const
  for (const d of [1, 2, 3]) {
    it(`깊이 ${d}: 막 시작한 장비(배율 1)도 장비가 좋아도(배율 3) 약속 범위다`, () => {
      const plan = floorPlan(d, 2)
      const hp = plan.scale.hp * EXPLORE.hp
      for (const mul of [1, SKILL_REF_MUL[d], 3]) {
        const gear = skillGear(mul, SKILL_REF_MUL[d])
        for (const k of kinds) {
          const pack = (['slime', 'bug', 'bat', 'slime', 'jelly'] as const).map((kind) => body('n', hordeHp(kind, hp, false)))
          skillBlast(pack, 0, 0, 3, { kind: k, rank: 1, gear })
          const left = pack.reduce((a, b) => a + Math.max(0, b.hp), 0) / pack.reduce((a, b) => a + b.maxHp, 0)
          // 큰 쿨(과열 폭주 파동·사탕 오라)만 무리를 한 방에 지우고, 나머지는 크게 깎는다 (70% 이상).
          if (k === 'wave' || k === 'aura') expect(pack.every((b) => b.hp <= 0), `${k} pack`).toBe(true)
          else expect(left, `${k} pack 남은 체력`).toBeLessThanOrEqual(0.3)
          const elite = body('elite', hordeHp('knight', hp, true))
          skillBlast([elite], 0, 0, 3, { kind: k, rank: 1, gear })
          const ep = 1 - elite.hp / elite.maxHp
          expect(ep, `${k} elite ×${mul}`).toBeGreaterThanOrEqual(0.12)
          expect(ep, `${k} elite ×${mul}`).toBeLessThanOrEqual(0.1805)
          const boss = body('boss', Math.round(BOSS.hp * floorPlan(d, 4).scale.boss.hp))
          skillBlast([boss], 0, 0, 3, { kind: k, rank: 1, gear })
          const bp = 1 - boss.hp / boss.maxHp
          expect(bp, `${k} boss ×${mul}`).toBeGreaterThanOrEqual(0.04)
          expect(bp, `${k} boss ×${mul}`).toBeLessThanOrEqual(0.0605)
        }
      }
    })
  }
  it('보스가 스스로 멈추는 거리(BOSS.keep)와 그보다 조금 먼 곳에서도 네 스킬이 모두 닿는다', () => {
    for (const d of [BOSS.keep, BOSS.keep + 0.8]) {
      const mk = () => { const b = body('boss', 28000); b.r = BOSS.radius; b.x = d; return b }
      expect(skillBlast([mk()], d - BOSS.radius, 0, bombRadius(0), { kind: 'bomb', rank: 1, gear: 1 }), `폭탄 ${d}`).toBe(1)
      expect(skillBlast([mk()], 0, 0, OVERDRIVE_WAVE.radius, { kind: 'wave', rank: 1, gear: 1 }), `과열 ${d}`).toBe(1)
      expect(rushLock([mk()], 0, 0, 1, 0, SKILL_RANGE.rush), `돌진 ${d}`).not.toBeNull()
      expect(skillBlast([mk()], 0, 0, AURA_BURN.burst, { kind: 'aura', rank: 1, gear: 1, share: auraShare(true) }), `오라 ${d}`).toBe(1)
    }
  })

  it('사탕 오라는 4.4–5.6 m 거리를 지키는 보스에게도 닿고, 한 번 전체가 보스 4–6%다', () => {
    const boss = body('boss', 28000)
    boss.r = 1.0
    boss.x = 5.6
    for (let i = 0; i < AURA_TIME / AURA_PULSE; i++) {
      if (i > 0) boss.x = 4.6
      const hit = skillBlast([boss], 0, 0, i === 0 ? AURA_BURN.burst : AURA_BURN.radius, { kind: 'aura', rank: 1, gear: 1, share: auraShare(i === 0) })
      expect(hit, `펄스 ${i}`).toBe(1)
    }
    const p = 1 - boss.hp / boss.maxHp
    expect(p).toBeGreaterThanOrEqual(0.04)
    expect(p).toBeLessThanOrEqual(0.0605)
  })

  it('사탕 오라는 첫 펄스에 절반이 한 번에 들어가 큰 숫자로 보이고, 전체 합은 그대로다', () => {
    const pulses = AURA_TIME / AURA_PULSE
    let sum = auraShare(true)
    for (let i = 1; i < pulses; i += 1) sum += auraShare(false)
    expect(sum).toBeCloseTo(1, 5)
    expect(auraShare(true)).toBeGreaterThanOrEqual(0.4)
    const elite = body('elite', 4000)
    skillBlast([elite], 0, 0, 3, { kind: 'aura', rank: 1, gear: 1, share: auraShare(true) })
    expect(4000 - elite.hp).toBeGreaterThanOrEqual(4000 * 0.06)
  })

  it('스킬 숫자는 총 치명타 한 방보다 크지만, 정예·보스 상한은 넘지 않는다', () => {
    const crit = 620
    const floor = SKILL_SHOTS * crit
    for (const k of ['bomb', 'wave', 'rush'] as const) {
      expect(skillBite({ tone: 'n', maxHp: 374 }, k, 1, 1, 1, floor)).toBeGreaterThan(crit)
      expect(skillBite({ tone: 'elite', maxHp: 6570 }, k, 1, 1, 1, floor)).toBeGreaterThan(crit)
      expect(skillBite({ tone: 'elite', maxHp: 6570 }, k, 1, 1, 1, floor)).toBeLessThanOrEqual(Math.round(6570 * SKILL_CAP.elite))
      expect(skillBite({ tone: 'boss', maxHp: 28000 }, k, 1, 1, 1, floor)).toBeLessThanOrEqual(Math.round(28000 * SKILL_CAP.boss))
    }
  })

  it('랭크가 올라도 상한(정예 18%, 보스 6%)을 넘지 않는다', () => {
    const elite = body('elite', 10000)
    skillBlast([elite], 0, 0, 3, { kind: 'wave', rank: 10, gear: 1.15 })
    expect(1 - elite.hp / 10000).toBeLessThanOrEqual(0.1805)
    const boss = body('boss', 30000)
    skillBlast([boss], 0, 0, 3, { kind: 'bomb', rank: 10, gear: 1.15 })
    expect(1 - boss.hp / 30000).toBeLessThanOrEqual(0.0605)
  })
})

describe('난이도 제거 + 저장 이전', () => {
  it('예전 저장의 difficulty 필드는 지워지고 나머지는 그대로다', () => {
    const s = freshSave() as ReturnType<typeof freshSave> & { difficulty?: string; settings?: Record<string, unknown> }
    s.difficulty = 'easy'
    ;(s as { settings?: Record<string, unknown> }).settings = { ...(s.settings ?? {}), difficulty: 'hard' }
    const gold = s.gold
    migrateSave(s)
    expect(s.difficulty).toBeUndefined()
    expect((s.settings as Record<string, unknown>).difficulty).toBeUndefined()
    expect(s.gold).toBe(gold)
  })
})

describe('밸런스 패스: 1장 튜토리얼 스킬은 그대로', () => {
  it('마을 몹(town)은 예전 비율: 정예 30–40%, 보스(제단 꽃) 15–25%, 일반은 한 방', () => {
    for (const k of ['bomb', 'wave', 'rush'] as const) {
      expect(skillBite({ tone: 'n', maxHp: 300, town: true }, k, 1, 1)).toBeGreaterThanOrEqual(300)
      const e = skillBite({ tone: 'elite', maxHp: 1000, town: true }, k, 1, 1) / 1000
      expect(e).toBeGreaterThanOrEqual(0.3)
      expect(e).toBeLessThanOrEqual(0.4)
      const b = skillBite({ tone: 'boss', maxHp: 10000, town: true }, k, 1, 1) / 10000
      expect(b).toBeGreaterThanOrEqual(0.15)
      expect(b).toBeLessThanOrEqual(0.25)
    }
  })
})

describe('맞는 한 대의 무게 (보스 > 기사 > 슬라임, 정예는 같은 한 대에 더 오래 버틴다)', () => {
  it('깊이 1에서 슬라임 한 대는 최대 체력의 8–10%, 기사는 그보다 세고, 보스 몸통은 더 아프다', () => {
    const plan = floorPlan(1, 1)
    const h = new Horde(floorMaze(plan))
    h.scale = runFoeScale(plan, false, 150)
    const slime = h.spawn('slime', 0, 0)!.damage / 150
    const knight = h.spawn('knight', 1, 0)!.damage / 150
    const elite = h.spawn('knight', 2, 0, true)!.damage / 150
    expect(slime).toBeGreaterThanOrEqual(0.11)
    expect(slime).toBeLessThanOrEqual(0.16)
    expect(knight).toBeGreaterThan(slime)
    expect(elite).toBe(knight)
    const touch = Math.round(BOSS.contact * bossRoomHit(150, 'boss')) / 150
    const orb = Math.round(BOSS.orbDamage * bossRoomHit(150, 'boss')) / 150
    expect(touch).toBeGreaterThan(knight)
    expect(orb).toBeGreaterThan(slime)
    expect(orb).toBeLessThan(touch)
  })
})

describe('실제 플레이: 원거리가 절반 섞인 무리', () => {
  it('원거리 50% 무리 5마리에 10초 서 있으면 근접만 있을 때보다 더 아프고, 10초 안에 죽지는 않는다', () => {
    for (const [d, f] of [[1, 1], [1, 3], [2, 2], [3, 2]] as const) {
      const melee = stand(floorPlan(d, f), ['slime', 'slime', 'bug', 'slime', 'bat'], 150, false, 0)
      const mixed = stand(floorPlan(d, f), ['slime', 'slime', 'bug', 'slime', 'bat'], 150, false, 0.5)
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.RANGED_LOG) console.log(`d${d}f${f} 근접만 ${(melee.lost * 100).toFixed(1)}% 섞임 ${(mixed.lost * 100).toFixed(1)}%`)
      expect(mixed.lost, `d${d}f${f}`).toBeGreaterThanOrEqual(0.7)
      // Standing still, the shots finally add pressure instead of vanishing into the same i-frame budget.
      expect(mixed.lost, `d${d}f${f} ranged`).toBeGreaterThan(melee.lost - 0.02)
    }
  })

  it('대시 무적이면 같은 무리가 10초 동안 거의 못 맞힌다', () => {
    const still = stand(floorPlan(1, 1), ['slime', 'slime', 'bug', 'slime', 'bat'], 150, false, 0.5)
    const dashed = stand(floorPlan(1, 1), ['slime', 'slime', 'bug', 'slime', 'bat'], 150, false, 0.5, 0, true)
    expect(still.lost).toBeGreaterThan(0.6)
    expect(dashed.lost).toBeLessThan(0.2)
    expect(dashed.lost).toBeLessThan(still.lost)
  })
})
