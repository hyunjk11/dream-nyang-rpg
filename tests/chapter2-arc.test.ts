import { describe, expect, it } from 'vitest'
import { HALO_SET, haloPair } from '../src/data/legends'
import { freshSave } from '../src/sim/mutate'
import { chapter3Open, chaptersOf, claimQuest, questEvent, skipGuide, takeQuest } from '../src/sim/chapters'
import {
  STORY,
  STORY_V,
  TOWER_WARDEN,
  areaPlan,
  dreamOf,
  enterMaze,
  gunWork,
  noteTinker,
  passMaze,
  storyEvent,
  storyQuest,
  storyTalk,
} from '../src/sim/dreamstory'
import { makeLegend } from '../src/sim/legends'
import { addItem } from '../src/sim/inventory'
import { computeStats } from '../src/sim/stats'
import { storyGateRows } from '../src/sim/portals'
import { floorMaze, planLayout } from '../src/world/dungeon/layout'
import { rng, tileCentre, generateMaze } from '../src/world/dungeon/maze'
import { Boss } from '../src/world/dungeon/boss'
import { Horde, hordeHp } from '../src/world/dungeon/horde'
import { runFoeScale } from '../src/world/dungeon/run'
import { makeItem } from '../src/sim/loot'
import { dpsOf } from '../src/ui/inventory'
import { FIELD } from '../src/world/dungeon/field'
import { floorPlan } from '../src/sim/delve'
import { DIFFICULTY } from '../src/combat/difficulty'
import type { SaveData } from '../src/sim/types'

function arrived(): SaveData {
  const save = freshSave()
  skipGuide(save)
  enterMaze(save)
  passMaze(save)
  return save
}

describe('챕터 2 이야기 사슬', () => {
  it('도착 뒤 메인 퀘스트는 여섯 이고 개조·파수꾼·나방·보스를 지난다', () => {
    expect(STORY.map((q) => q.id)).toEqual(['s1', 's2', 's_bolt', 's3', 's_silk', 's4'])
    expect(STORY.filter((q) => q.kind === 'tinker')).toHaveLength(1)
    expect(STORY.filter((q) => q.kind === 'hunt')).toHaveLength(1)
    expect(STORY.at(-1)?.kind).toBe('boss')
    expect(TOWER_WARDEN.name).toContain('파수꾼')
  })

  it('이미 +가 있는 총은 그 자리에서 끝나지 않고, 한 단계 더 올리거나 부품을 끼워야 한다', () => {
    const save = arrived()
    const gun = save.items.find((i) => i.uid === save.equipment.weapon)!
    gun.plus = 1
    for (let i = 0; i < 8 && storyQuest(save)?.id !== 's_bolt'; i += 1) {
      const d = dreamOf(save)
      const q = storyQuest(save)!
      if (d.story.state === 'offer' || d.story.state === 'ready') storyTalk(save, () => 0.8)
      else if (q.kind === 'spark') storyEvent(save, { type: 'spark', amount: q.goal })
      else if (q.kind === 'area') storyEvent(save, { type: 'area', area: 'loft' })
    }
    expect(storyQuest(save)?.id).toBe('s_bolt')
    expect(dreamOf(save).story.state).toBe('offer')
    storyTalk(save, () => 0.8)
    expect(dreamOf(save).story.state).toBe('active')
    expect(gunWork(save).plus).toBeGreaterThanOrEqual(1)
    expect(noteTinker(save)).toBeNull()
    gun.plus = gunWork(save).plus + 1
    expect(noteTinker(save)).toContain('몽이')
    expect(dreamOf(save).story.state).toBe('ready')
  })
})

describe('예전 세이브가 새 이야기 칸에 앉는다', () => {
  it('시계탑을 아직 시작 안 한 세이브는 볼트 개조부터 받는다', () => {
    const save = arrived()
    save.dream = { maze: { step: 4, count: 0, passed: true, entered: true }, story: { step: 2, state: 'offer', count: 0, done: false }, home: 'mongsil', gates: [] } as unknown as SaveData['dream']
    const d = dreamOf(save)
    expect(d.story.v).toBe(STORY_V)
    expect(storyQuest(save)?.id).toBe('s_bolt')
    expect(d.story.state).toBe('offer')
  })

  it('시계탑을 이미 진행 중인 세이브는 그 퀘스트에 남는다', () => {
    const save = arrived()
    save.dream = { maze: { step: 4, count: 0, passed: true, entered: true }, story: { step: 2, state: 'active', count: 0, done: false }, home: 'mongsil', gates: [] } as unknown as SaveData['dream']
    expect(storyQuest(save)?.id).toBe('s3')
    expect(dreamOf(save).story.state).toBe('active')
  })

  it('보스를 받기 직전이면 나방의 실을 먼저 한다', () => {
    const save = arrived()
    save.dream = { maze: { step: 4, count: 0, passed: true, entered: true }, story: { step: 3, state: 'offer', count: 0, done: false }, home: 'mongsil', gates: [] } as unknown as SaveData['dream']
    expect(storyQuest(save)?.id).toBe('s_silk')
  })

  it('이미 끝낸 이야기와 v2 진행은 다시 끼워 넣지 않는다', () => {
    const save = arrived()
    save.dream = { maze: { step: 4, count: 0, passed: true, entered: true }, story: { step: 4, state: 'ready', count: 1, done: true }, home: 'mongsil', gates: [] } as unknown as SaveData['dream']
    const done = dreamOf(save)
    expect(done.story.done).toBe(true)
    expect(storyQuest(save)).toBeNull()
    const mid = arrived()
    const tower = STORY.findIndex((q) => q.id === 's3')
    mid.dream = {
      maze: { step: 4, count: 0, passed: true, entered: true },
      story: { step: tower, state: 'active', count: 0, done: false, v: STORY_V, mark: { plus: 2, mods: 1 } },
      home: 'mongsil',
      gates: [],
    } as unknown as SaveData['dream']
    expect(storyQuest(mid)?.id).toBe('s3')
    expect(dreamOf(mid).story.mark).toEqual({ plus: 2, mods: 1 })
  })
})

describe('들판 반복 의뢰와 3장 문', () => {
  it('대청소는 보상 뒤에 다시 맡을 수 있고 횟수가 남는다', () => {
    const save = arrived()
    chaptersOf(save)
    // Open the sweep by claiming the ones before it would; mark it offered directly.
    const q = chaptersOf(save).quests.c2_sweep
    q.status = 'active'
    for (let i = 0; i < 25; i += 1) questEvent(save, { type: 'kill', kind: 'bug', elite: false })
    expect(q.status).toBe('done')
    expect(claimQuest(save, 'c2_sweep', () => 0.5).ok).toBe(true)
    expect(q.status).toBe('offered')
    expect(q.runs).toBe(1)
    expect(q.progress).toBe(0)
    expect(takeQuest(save, 'c2_sweep').ok).toBe(true)
  })

  it('2장을 끝내면 별문에 잠긴 3장 문이 붙는다', () => {
    const save = arrived()
    const c = chaptersOf(save)
    c.cleared.push(2)
    c.current = 3
    dreamOf(save).story.done = true
    expect(chapter3Open(save)).toBe(true)
    const rows = storyGateRows({ where: 'mongsil', save, zones: [], kept: '' })
    const teaser = rows.find((r) => r.text.includes('다음 챕터'))
    expect(teaser?.locked).toBe(true)
    expect(teaser?.text).toContain('3장')
    expect(rows.filter((r) => r.lane === 'delve')).toHaveLength(1)
    expect(rows.findIndex((r) => r.go === 'delve-menu')).toBeGreaterThan(rows.findIndex((r) => r.text.includes('다음 챕터')))
  })
})

describe('달무리 세트', () => {
  it('두 물총을 양손에 차면 피해와 흡혈이 붙고, 한 자루만이면 없다', () => {
    expect(haloPair('leg_lullaby', 'leg_halo')).toBe(true)
    const save = freshSave()
    const a = makeLegend('leg_lullaby', 8)
    const b = makeLegend('leg_halo', 8)
    addItem(save, a)
    addItem(save, b)
    save.equipment.weapon = a.uid
    const one = computeStats(save).lifesteal
    save.equipment.offhand = b.uid
    const both = computeStats(save)
    expect(both.lifesteal).toBeGreaterThan(one)
    expect(both.lifesteal - one).toBeCloseTo(HALO_SET.bonus.lifesteal, 5)
  })
})

describe('구역 얼굴과 밤나방 패턴', () => {
  it('다락과 시계탑 무리는 서로 다른 종류만 쓴다', () => {
    for (const id of ['loft', 'tower'] as const) {
      const plan = areaPlan(id, id === 'tower' ? 2 : 1, 4)
      const layout = planLayout(floorMaze(plan), plan, rng(9))
      const kinds = new Set(layout.packs.flatMap((p) => p.kinds))
      expect(kinds.size).toBeGreaterThan(0)
      for (const k of kinds) expect(plan.area && ['jelly', 'bat', 'wraith', 'cog', 'skeleton', 'knight', 'skel_mage'].includes(k)).toBe(true)
      if (id === 'loft') expect(kinds.has('cog')).toBe(false)
      if (id === 'tower') expect([...kinds].some((k) => k === 'cog' || k === 'skeleton' || k === 'knight')).toBe(true)
    }
  })

  it('1단계 고리는 플레이어 쪽에 빈칸이 있고, 2·3단계에서 페이즈가 바뀐다', () => {
    const maze = generateMaze(7)
    const boss = new Boss(maze, { hp: 1, damage: 1 }, 'moth')
    const hx = boss.x + Math.sin(0.4) * 8
    const hz = boss.z + Math.cos(0.4) * 8
    const events: string[] = []
    for (let i = 0; i < 30 * 6 && boss.orbs.length === 0; i += 1) events.push(...boss.update(1 / 30, hx, hz, true, () => {}))
    expect(events).toContain('wake')
    expect(events).toContain('ring')
    expect(boss.orbs.length).toBeGreaterThan(4)
    const aim = Math.atan2(hx - boss.x, hz - boss.z)
    const ang = (x: number, z: number) => Math.atan2(x - boss.x, z - boss.z)
    const gap = (a: number) => {
      let d = Math.abs(a - aim)
      if (d > Math.PI) d = Math.PI * 2 - d
      return d
    }
    // The safe wedge toward her is empty (phase-3 fan is not out yet).
    expect(boss.orbs.some((o) => gap(ang(o.x, o.z)) < 0.35)).toBe(false)
    boss.damage(boss.maxHp * 0.4)
    expect(boss.update(1 / 30, hx, hz, true, () => {})).toContain('phase2')
    boss.damage(boss.maxHp * 0.4)
    expect(boss.update(1 / 30, hx, hz, true, () => {})).toContain('phase3')
    const bloom = new Boss(maze)
    bloom.damage(bloom.maxHp * 0.5)
    expect(bloom.update(1 / 30, hx, hz, true, () => {}).some((e) => e.startsWith('phase'))).toBe(false)
  })
})

describe('챕터 2 전투가 1장보다 아프고, 스펀지는 아니다', () => {
  const DT = 1 / 60
  /** A chapter-2 kit: level 11, rare water gun, iLv 8, then +0 or +3. */
  function kitDps(plus: 0 | 3): number {
    const save = freshSave()
    save.level = 11
    const gun = makeItem('gun_water', 'rare', () => 0.4, 8)
    gun.plus = plus
    const old = save.equipment.weapon
    save.items = save.items.filter((i) => i.uid !== old)
    save.items.push(gun)
    save.equipment.weapon = gun.uid
    return dpsOf(computeStats(save))
  }

  function pocket() {
    const hero = { hp: 150, iframes: 0, since: 99, hits: 0 }
    return {
      hero,
      hurt(amount: number) {
        if (hero.hp <= 0 || hero.iframes > 0 || amount <= 0) return
        hero.hp = Math.max(0, hero.hp - amount)
        hero.iframes = DIFFICULTY.hero.iframes
        hero.since = 0
        hero.hits += 1
      },
      tick(dt: number) {
        hero.iframes = Math.max(0, hero.iframes - dt)
        hero.since += dt
        if (hero.hp > 0 && hero.since > DIFFICULTY.hero.regenDelay && hero.hp < 150) hero.hp = Math.min(150, hero.hp + DIFFICULTY.hero.regenRate * dt)
      },
    }
  }

  function strafe(t: number, ox: number, oz: number, radius = 2.2) {
    const a = t * 1.4
    return { x: ox + Math.sin(a) * radius, z: oz + Math.cos(a) * radius, vx: Math.cos(a) * radius * 1.4, vz: -Math.sin(a) * radius * 1.4 }
  }

  function pack(label: string, plan: Parameters<typeof runFoeScale>[0], kinds: ('cog' | 'bat' | 'jelly' | 'knight' | 'slime' | 'mothling' | 'wraith')[], plus: 0 | 3, hpMul = 1) {
    const maze = generateMaze(11)
    const h = new Horde(maze)
    h.rangedShare = 0.5
    h.scale = runFoeScale(plan, false, 150)
    h.scale.hp *= hpMul
    const c = tileCentre(maze, Math.floor(maze.w / 2), Math.floor(maze.h / 2))
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * Math.PI * 2
      const f = h.spawn(k, c.x + Math.sin(a) * 1.2, c.z + Math.cos(a) * 1.2, false)!
      f.age = 10
      f.mode = 'chase'
      f.cooldown = 0.15
    })
    const body = pocket()
    const dps = kitDps(plus)
    let ttk = 16
    for (let t = 0; t < 16; t += DT) {
      const s = strafe(t, c.x, c.z + 11, 1.6)
      const alive = h.foes.filter((f) => f.dying <= 0 && f.hp > 0)
      if (!alive.length) {
        ttk = t
        break
      }
      let best = alive[0]!
      let bd = Infinity
      for (const f of alive) {
        const d = Math.hypot(f.x - s.x, f.z - s.z)
        if (d < bd) {
          bd = d
          best = f
        }
      }
      h.damage(best, dps * DT)
      h.update(DT, { x: s.x, z: s.z, alive: body.hero.hp > 0, dodge: false, vx: s.vx, vz: s.vz }, (amount) => body.hurt(amount))
      body.tick(DT)
      if (body.hero.hp <= 0) {
        ttk = t
        break
      }
    }
    return { label, plus, ttk: Math.round(ttk * 10) / 10, lost: Math.round(150 - Math.max(0, body.hero.hp)), dead: body.hero.hp <= 0, hits: body.hero.hits, foe: Math.round(hordeHp(kinds[0]!, h.scale.hp)) }
  }

  function moth(plus: 0 | 3) {
    const plan = areaPlan('moon', 1)
    const maze = generateMaze(3)
    const boss = new Boss(maze, plan.scale.boss, 'moth')
    const body = pocket()
    const dps = kitDps(plus)
    let ttk = 120
    const c = { x: boss.x, z: boss.z + 7 }
    for (let t = 0; t < 120; t += DT) {
      if (!boss.alive) {
        ttk = t
        break
      }
      const s = strafe(t, c.x, c.z, 3.2)
      boss.damage(dps * DT)
      boss.update(DT, s.x, s.z, body.hero.hp > 0, (amount) => body.hurt(amount))
      body.tick(DT)
      if (body.hero.hp <= 0) {
        ttk = t
        break
      }
    }
    return { label: '달빛 둥지 보스', plus, ttk: Math.round(ttk * 10) / 10, lost: Math.round(150 - Math.max(0, body.hero.hp)), dead: body.hero.hp <= 0, hp: boss.maxHp }
  }

  it('+0과 +3에서 구역 팩은 죽지 않고, 보스는 한 판 안에 끝난다', () => {
    const rows = [
      pack('1장 하수도', floorPlan(1, 1), ['slime', 'slime', 'bat'], 0),
      pack('구름 다락', areaPlan('loft', 1), ['jelly', 'bat', 'wraith', 'jelly'], 0),
      pack('시계탑', areaPlan('tower', 2), ['cog', 'knight', 'cog', 'bat'], 0),
      pack('나방 들판', areaPlan('loft', 1), ['mothling', 'mothling', 'mothling'], 0, FIELD.hp),
      pack('구름 다락', areaPlan('loft', 1), ['jelly', 'bat', 'jelly', 'bat'], 3),
      pack('시계탑', areaPlan('tower', 2), ['cog', 'knight', 'cog', 'bat'], 3),
      moth(0),
      moth(3),
    ]
    console.log('chapter2-threat', JSON.stringify(rows))
    const ch1 = rows[0]!
    const tower0 = rows.find((r) => r.label === '시계탑' && r.plus === 0)!
    const tower3 = rows.find((r) => r.label === '시계탑' && r.plus === 3)!
    expect(ch1.dead).toBe(false)
    expect(tower0.dead).toBe(false)
    expect(tower3.dead).toBe(false)
    expect(tower0.lost).toBeGreaterThan(ch1.lost)
    expect(tower3.ttk).toBeLessThan(tower0.ttk)
    expect(tower0.ttk).toBeGreaterThan(1.2)
    expect(tower0.ttk).toBeLessThan(14)
    for (const b of rows.filter((r) => r.label.includes('보스'))) {
      expect(b.dead, `${b.label} +${b.plus}`).toBe(false)
      expect(b.ttk).toBeGreaterThan(18)
      expect(b.ttk).toBeLessThan(95)
      expect(b.lost).toBeGreaterThan(15)
    }
    const boss3 = rows.find((r) => r.label.includes('보스') && r.plus === 3)!
    const boss0 = rows.find((r) => r.label.includes('보스') && r.plus === 0)!
    expect(boss3.ttk).toBeLessThan(boss0.ttk)
  })
})
