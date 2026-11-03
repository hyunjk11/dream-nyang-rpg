import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import {
  ACTIVE_CAP,
  CHAPTER2,
  GUIDE,
  NAMED,
  activeQuests,
  chapter2Open,
  chaptersOf,
  claimQuest,
  fieldNeeds,
  guideEvent,
  guideHud,
  guideStep,
  isVeteran,
  questEvent,
  questHud,
  skipGuide,
  takeQuest,
} from '../src/sim/chapters'
import { Delve, delveOf, floorIntro, objectiveText } from '../src/sim/delve'
import { FIELD, FieldDirector, fieldMaze } from '../src/world/dungeon/field'
import { floorMaze } from '../src/world/dungeon/layout'
import { Horde } from '../src/world/dungeon/horde'
import { Tile, rng, tileCentre } from '../src/world/dungeon/maze'
import { summaryLines } from '../src/ui/summary'
import type { SaveData } from '../src/sim/types'

const seeded = (n = 7) => rng(n)

/** Walk the whole guide with the events each step waits for. */
function finishGuide(save: SaveData): number {
  let cleared = 0
  for (let k = 0; k < 200 && guideStep(save); k += 1) {
    const step = guideStep(save)!
    const o = guideEvent(save, { type: step.id, amount: step.goal, depth: 1 }, seeded(k))
    cleared ||= o.cleared
  }
  return cleared
}

/** Finish every chapter 2 quest in order (take → events → claim). */
function playChapter2(save: SaveData): { cleared: number; gold: number } {
  let cleared = 0
  const gold0 = save.gold
  for (const d of CHAPTER2) {
    expect(takeQuest(save, d.id).ok, d.id).toBe(true)
    for (let i = 0; i < d.goal; i += 1) {
      if (d.kind === 'kill') questEvent(save, { type: 'kill', kind: d.target === 'any' ? 'bug' : (d.target as 'slime'), elite: false })
      else if (d.kind === 'collect') questEvent(save, { type: 'collect' })
      else if (d.kind === 'named') questEvent(save, { type: 'named' })
      else questEvent(save, { type: 'boss' })
    }
    const r = claimQuest(save, d.id, seeded(3))
    expect(r.ok, d.id).toBe(true)
    cleared ||= r.cleared
  }
  return { cleared, gold: save.gold - gold0 }
}

describe('챕터 1 가이드 챕터', () => {
  it('새 저장은 가이드 1단계(걷기)에서 시작하고 건너뛰기 제안이 없다', () => {
    const save = freshSave()
    const c = chaptersOf(save)
    expect(c.current).toBe(1)
    expect(c.offerSkip).toBe(false)
    expect(guideStep(save)?.id).toBe('move')
    expect(guideHud(save, false)?.head).toContain(`1/${GUIDE.length}`)
  })

  it('가이드는 이동·사격·대시·처치·스킬·장비·사탕·마을·하수도·귀환·보스 순서다', () => {
    expect(GUIDE.map((g) => g.id)).toEqual(['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss'])
    for (const g of GUIDE) {
      expect(g.say.text.length, g.id).toBeGreaterThan(4)
      expect(['별하', '모찌']).toContain(g.say.who)
      expect(g.touch.length).toBeGreaterThan(2)
    }
  })

  it('지금 단계가 아닌 행동은 세지 않는다', () => {
    const save = freshSave()
    expect(guideEvent(save, { type: 'kill' }).advanced).toBe(-1)
    expect(guideEvent(save, { type: 'boss', depth: 1 }).cleared).toBe(0)
    expect(guideStep(save)?.id).toBe('move')
  })

  it('걸음 수를 다 채우면 다음 단계로 넘어가고 대사가 나온다', () => {
    const save = freshSave()
    expect(guideEvent(save, { type: 'move', amount: 3 }).advanced).toBe(-1)
    const o = guideEvent(save, { type: 'move', amount: 2 })
    expect(o.advanced).toBe(1)
    expect(o.say?.text).toBeTruthy()
    expect(guideStep(save)?.id).toBe('shoot')
  })

  it('장비 단계는 장비를, 사탕 단계는 하트 사탕을 선물한다', () => {
    const save = freshSave()
    save.potions = 0
    const bag = save.items.length
    let gear = false
    let candy = false
    for (let k = 0; k < 20 && guideStep(save)?.id !== 'shop'; k += 1) {
      const step = guideStep(save)!
      const o = guideEvent(save, { type: step.id, amount: step.goal }, seeded(k))
      if (o.gift === 'gear') gear = true
      if (o.gift === 'candy') candy = true
    }
    expect(gear).toBe(true)
    expect(candy).toBe(true)
    expect(save.items.length).toBe(bag + 1)
    expect(save.potions).toBeGreaterThanOrEqual(1)
  })

  it('깊이 2 보스는 가이드 보스로 치지 않는다', () => {
    const save = freshSave()
    const c = chaptersOf(save)
    c.guide.step = GUIDE.length - 1
    expect(guideEvent(save, { type: 'boss', depth: 2 }).cleared).toBe(0)
    expect(guideEvent(save, { type: 'boss', depth: 1 }).cleared).toBe(1)
  })

  it('가이드를 끝내면 챕터 1 클리어 카드가 뜨고 챕터 2가 열린다', () => {
    const save = freshSave()
    expect(chapter2Open(save)).toBe(false)
    expect(finishGuide(save)).toBe(1)
    const c = chaptersOf(save)
    expect(c.card).toBe(1)
    expect(c.cleared).toContain(1)
    expect(chapter2Open(save)).toBe(true)
    expect(guideHud(save, false)).toBeNull()
  })

  it('기존 플레이어는 건너뛰기를 제안받고, 건너뛰면 바로 챕터 2다', () => {
    const save = freshSave()
    delveOf(save).cleared = 1
    expect(isVeteran(save)).toBe(true)
    const c = chaptersOf(save)
    expect(c.offerSkip).toBe(true)
    skipGuide(save)
    expect(c.guide.skipped).toBe(true)
    expect(c.offerSkip).toBe(false)
    expect(chapter2Open(save)).toBe(true)
    expect(c.card).toBe(0)
  })
})

describe('챕터 저장', () => {
  it('JSON으로 저장했다 불러와도 진행이 그대로다 (새로고침)', () => {
    const save = freshSave()
    guideEvent(save, { type: 'move', amount: 8 })
    guideEvent(save, { type: 'shoot', amount: 10 })
    const back = JSON.parse(JSON.stringify(save)) as SaveData
    expect(guideStep(back)?.id).toBe('shoot')
    expect(chaptersOf(back).guide.count).toBe(10)
  })

  it('망가진 챕터 데이터는 안전하게 고쳐진다', () => {
    const save = freshSave()
    ;(save as unknown as { chapters: unknown }).chapters = { current: 99, guide: { step: -4, count: 'x' }, quests: { c2_slime: { status: 'wat', progress: 1e9 }, c2_bat: { status: 'active', progress: 1e9 } }, cleared: 'no' }
    const c = chaptersOf(save)
    expect(c.current).toBe(1) // 가이드를 안 끝낸 저장은 챕터 1로 돌아온다
    expect(c.guide.step).toBe(0)
    expect(c.guide.count).toBe(0)
    expect(c.cleared).toEqual([])
    expect(c.quests.c2_slime.status).toBe('offered')
    expect(c.quests.c2_bat.progress).toBe(8)
  })
})

describe('챕터 2 몽실 들판 퀘스트', () => {
  const open = () => {
    const save = freshSave()
    skipGuide(save)
    return save
  }

  it('퀘스트는 5~8개이고 마지막은 챕터 보스다', () => {
    expect(CHAPTER2.length).toBeGreaterThanOrEqual(5)
    expect(CHAPTER2.length).toBeLessThanOrEqual(8)
    expect(CHAPTER2[CHAPTER2.length - 1].kind).toBe('boss')
    expect(CHAPTER2.some((d) => d.kind === 'collect')).toBe(true)
    expect(CHAPTER2.some((d) => d.kind === 'named')).toBe(true)
  })

  it('가이드 전에는 퀘스트를 받을 수 없다', () => {
    expect(takeQuest(freshSave(), 'c2_slime').ok).toBe(false)
  })

  it(`한 번에 ${ACTIVE_CAP}개까지만 맡는다`, () => {
    const save = open()
    expect(takeQuest(save, 'c2_slime').ok).toBe(true)
    expect(takeQuest(save, 'c2_bat').ok).toBe(true)
    expect(activeQuests(save).length).toBe(2)
    expect(takeQuest(save, 'c2_fluff').ok).toBe(false)
  })

  it('처치는 맞는 종류만 센다', () => {
    const save = open()
    takeQuest(save, 'c2_slime')
    questEvent(save, { type: 'kill', kind: 'bat', elite: false })
    expect(chaptersOf(save).quests.c2_slime.progress).toBe(0)
    questEvent(save, { type: 'kill', kind: 'slime', elite: false })
    expect(chaptersOf(save).quests.c2_slime.progress).toBe(1)
    expect(questHud(save)[0].prog).toBe('1/10')
  })

  it('다 채우면 완료 알림, 게시판에서 보상(골드·경험치·장비)을 받고 다음 퀘스트가 열린다', () => {
    const save = open()
    takeQuest(save, 'c2_bat')
    let toasts: string[] = []
    for (let i = 0; i < 10; i += 1) toasts = toasts.concat(questEvent(save, { type: 'kill', kind: 'bat', elite: false }).toasts)
    expect(toasts.length).toBe(1)
    expect(chaptersOf(save).quests.c2_bat.status).toBe('done')
    const gold = save.gold
    const items = save.items.length
    const r = claimQuest(save, 'c2_bat', seeded())
    expect(r.ok).toBe(true)
    expect(save.gold).toBe(gold + 70)
    expect(save.items.length).toBe(items + 1)
    expect(r.gear).toBeTruthy()
    expect(chaptersOf(save).quests.c2_fluff.status).toBe('offered')
    expect(claimQuest(save, 'c2_bat').ok).toBe(false)
  })

  it('들판 필요(몹 종류·솜사탕·대장·보스)는 맡은 퀘스트를 따른다', () => {
    const save = open()
    expect(fieldNeeds(save).fluff).toBe(false)
    const c = chaptersOf(save)
    c.quests.c2_fluff.status = 'active'
    c.quests.c2_named.status = 'active'
    const n = fieldNeeds(save)
    expect(n.fluff).toBe(true)
    expect(n.named).toBe(true)
    expect(n.boss).toBe(false)
    expect(n.kinds).toContain('slime')
  })

  it('들판 퀘스트를 끝까지 해도 챕터 2는 몽이의 이야기로만 클리어된다', () => {
    const save = open()
    const r = playChapter2(save)
    expect(r.cleared).toBe(0)
    expect(r.gold).toBe(CHAPTER2.reduce((n, d) => n + d.reward.gold, 0))
    expect(chaptersOf(save).cleared).not.toContain(2)
    expect(save.level).toBeGreaterThan(1)
  })
})

describe('몽실 들판 필드', () => {
  it('넓게 트인 들판이다: 테두리는 막혀 있고 안쪽 대부분이 걸을 수 있다', () => {
    const m = fieldMaze(1234)
    expect(m.w).toBe(FIELD.size)
    let open = 0
    for (let i = 0; i < m.w * m.h; i += 1) if (m.tiles[i] !== Tile.Solid) open += 1
    expect(open / ((m.w - 2) * (m.h - 2))).toBeGreaterThan(0.8)
    for (let x = 0; x < m.w; x += 1) {
      expect(m.tiles[x]).toBe(Tile.Solid)
      expect(m.tiles[(m.h - 1) * m.w + x]).toBe(Tile.Solid)
    }
    expect(m.tiles[m.start.y * m.w + m.start.x]).toBe(Tile.Start)
    expect(m.tiles[(m.bossRoom.y + 3) * m.w + m.bossRoom.x + 3]).toBe(Tile.Boss)
  })

  it('출발점에서 보스 방까지 걸어갈 수 있다', () => {
    for (const seed of [1, 2, 3, 99, 4242]) {
      const m = fieldMaze(seed)
      const horde = new Horde(m)
      const b = m.bossRoom
      horde.flow.aim(m.start.x, m.start.y)
      expect(horde.flow.at(b.x + 3, b.y + 3), `seed ${seed}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('Delve.field는 들판 계획을 쓰고 하수도 체크포인트를 건드리지 않는다', () => {
    const save = freshSave()
    delveOf(save).checkpoint = { depth: 1, floor: 2 }
    const trip = Delve.field(save, { kinds: ['slime'], fluff: true, named: false, boss: false })
    expect(trip.plan.objective).toBe('field')
    expect(floorMaze(trip.plan).w).toBe(FIELD.size)
    expect(objectiveText(trip.plan, 0, false)).toContain('퀘스트')
    expect(floorIntro(trip.plan).title).toContain('몽실 들판')
    const sum = trip.finish(save, 'recall')
    expect(delveOf(save).checkpoint).toEqual({ depth: 1, floor: 2 })
    expect(sum.field).toBe(true)
    expect(summaryLines(sum).sub).toContain('몽실 들판')
  })

  it('무리를 계속 채운다: 처치해도 다시 몰려온다', () => {
    const m = fieldMaze(5)
    const horde = new Horde(m)
    const fd = new FieldDirector(m, horde, seeded(11), { kinds: ['slime', 'bat'], named: null, mobile: false })
    const s = tileCentre(m, m.start.x, m.start.y)
    for (let t = 0; t < 40; t += 1) fd.update(1, s.x, s.z, true)
    expect(horde.alive).toBeGreaterThanOrEqual(fd.target - FIELD.pack[1])
    expect(horde.alive).toBeLessThanOrEqual(fd.target)
    const before = fd.packs
    horde.clear()
    for (let t = 0; t < 20; t += 1) fd.update(1, s.x, s.z, true)
    expect(fd.packs).toBeGreaterThan(before)
    expect(horde.alive).toBeGreaterThan(0)
    // 새 무리는 잠든 채로 그녀에게서 떨어져 나타난다.
    for (const f of horde.foes) {
      expect(f.mode).toBe('idle')
      expect(Math.hypot(f.x - s.x, f.z - s.z)).toBeGreaterThan(FIELD.near - 3)
    }
  })

  it('도착하자마자 들판이 무리로 가득하다 (첫 틱에 한꺼번에)', () => {
    const m = fieldMaze(9)
    const horde = new Horde(m)
    const fd = new FieldDirector(m, horde, seeded(4), { kinds: ['slime', 'bug'], named: null, mobile: false })
    const s = tileCentre(m, m.start.x, m.start.y)
    fd.update(0.6, s.x, s.z, true)
    expect(horde.alive).toBeGreaterThanOrEqual(fd.target - FIELD.pack[1])
    expect(fd.packs).toBeGreaterThanOrEqual(3)
  })

  it('모바일은 동시에 적게 띄운다', () => {
    const m = fieldMaze(5)
    const fd = new FieldDirector(m, new Horde(m), seeded(1), { kinds: ['slime'], named: null, mobile: true })
    expect(fd.target).toBeLessThan(FIELD.alive[0])
  })

  it('대장 몽글이는 한 번만 나오고, 쓰러지면 이벤트가 온다', () => {
    const m = fieldMaze(8)
    const horde = new Horde(m)
    const fd = new FieldDirector(m, horde, seeded(2), { kinds: ['slime'], named: NAMED, mobile: false })
    const s = tileCentre(m, m.start.x, m.start.y)
    let spawns = 0
    for (let t = 0; t < 30; t += 1) spawns += fd.update(1, s.x, s.z, true).filter((e) => e.type === 'named-spawn').length
    expect(spawns).toBe(1)
    const boss = fd.named()!
    expect(boss.elite).toBe(true)
    const normal = horde.foes.find((f) => f.kind === 'slime' && !f.elite)
    if (normal) expect(boss.maxHp).toBeGreaterThan(normal.maxHp * 5)
    expect(fd.foeDown(boss)).toEqual([{ type: 'named-down' }])
    expect(fd.foeDown(boss)).toEqual([])
    for (let t = 0; t < 30; t += 1) expect(fd.update(1, s.x, s.z, true).some((e) => e.type === 'named-spawn')).toBe(false)
  })
})
