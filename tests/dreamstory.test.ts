import { describe, expect, it } from 'vitest'
import { freshSave } from '../src/sim/mutate'
import { chaptersOf, claimQuest, skipGuide, CHAPTER2 } from '../src/sim/chapters'
import { BOSS_FLOOR, Delve, floorScale } from '../src/sim/delve'
import { floorStateLabel } from '../src/sim/floorsnap'
import {
  AREAS,
  AREA_IDS,
  MAZE_CHAIN,
  STORY,
  areaLabel,
  areaPlan,
  dreamOf,
  mazeCleared,
  mazeEvent,
  mazeHud,
  mazeQuest,
  openAreas,
  passMaze,
  storyEvent,
  storyHud,
  storyTalk,
  townPlan,
  wantsSparks,
  enterMaze,
} from '../src/sim/dreamstory'
import { summaryLines } from '../src/ui/summary'
import { TOWN_SPOTS, townMaze } from '../src/world/dungeon/town'
import { floorMaze } from '../src/world/dungeon/layout'
import { Tile, rng } from '../src/world/dungeon/maze'
import { THEMES, themeOf } from '../src/world/dungeon/theme'
import type { SaveData } from '../src/sim/types'

const seeded = (n = 5) => rng(n)

/** Do 모찌's whole maze chain. */
function walkMaze(save: SaveData): number {
  let gold = 0
  for (const q of MAZE_CHAIN) {
    const g0 = save.gold
    for (let i = 0; i < q.goal; i += 1) mazeEvent(save, q.kind)
    gold += save.gold - g0
  }
  return gold
}

/** Do whatever the current story step wants. */
function playStep(save: SaveData): void {
  const d = dreamOf(save)
  const q = STORY[d.story.step]!
  if (q.kind === 'spark') storyEvent(save, { type: 'spark', amount: q.goal })
  else if (q.kind === 'area') storyEvent(save, { type: 'area', area: q.where as 'loft' })
  else storyEvent(save, { type: 'boss', area: q.where as 'moon' })
}


/** A save that really is in chapter 2: the guide is done and she has walked into the 꿈 미로. */
function ch2Save() {
  const save = freshSave()
  skipGuide(save)
  enterMaze(save)
  return save
}

describe('챕터 2 지역 (꿈 미로 · 구름 다락 · 시계탑 · 달빛 둥지)', () => {
  it('지역 층 계획은 지역 이름표·테마·층 수를 따른다', () => {
    for (const id of AREA_IDS) {
      const a = AREAS[id]
      for (let f = 1; f <= a.floors; f += 1) {
        const plan = areaPlan(id, f, 3)
        expect(plan.area).toBe(id)
        expect(plan.areaFloor).toBe(f)
        expect(plan.theme).toBe(a.theme)
        expect(plan.label).toBe(areaLabel(id, f))
        expect(plan.key).toBe(false)
        expect(themeOf(plan).id).toBe(a.theme)
      }
    }
    expect(areaPlan('maze', 2).label).toBe('2장 · 꿈 미로 · 2/4층')
    expect(areaPlan('moon', 1).objective).toBe('boss')
    expect(areaPlan('maze', 4).objective).toBe('exit')
  })

  it('달빛 둥지 보스는 같은 깊이 보스층보다 체력이 15% 높다', () => {
    const moon = areaPlan('moon', 1)
    const plain = floorScale(AREAS.moon.depth, BOSS_FLOOR)
    expect(moon.scale.boss.hp).toBeCloseTo(plain.boss.hp * 1.15, 5)
  })

  it('지역 여행은 마지막 층에서 areaLast가 되고 하수도 체크포인트를 건드리지 않는다', () => {
    const save = freshSave()
    const trip = Delve.area(save, 'maze')
    expect(trip.plan.label).toBe('2장 · 꿈 미로 · 1/4층')
    for (let f = 1; f < AREAS.maze.floors; f += 1) {
      expect(trip.areaLast).toBe(false)
      trip.nextFloor(save)
    }
    expect(trip.floor).toBe(4)
    expect(trip.areaLast).toBe(true)
    const sum = trip.finish(save, 'clear', 0)
    expect(sum.label).toBe('2장 · 꿈 미로 · 4/4층')
    expect(summaryLines(sum).sub).toContain('꿈 미로')
    expect(save.delve?.checkpoint ?? null).toBeNull()
  })

  it('지역 이름표는 보관된 층 라벨에도 쓰인다', () => {
    const trip = Delve.area(freshSave(), 'loft')
    const state = { depth: 2, floor: 1, salt: trip.salt, area: 'loft', areaFloor: 2 } as unknown as Parameters<typeof floorStateLabel>[0]
    expect(floorStateLabel(state)).toContain('구름 다락')
  })

  it('테마마다 안개 색이 다르다 (챕터 2 테마 포함)', () => {
    for (const id of ['maze', 'cloud', 'clock', 'moon', 'market'] as const) expect(THEMES[id]).toBeTruthy()
  })
})

describe('몽실 마을', () => {
  it('마을은 담으로 둘러싸인 광장이고 NPC 자리는 모두 걸을 수 있는 곳이다', () => {
    const m = townMaze(9)
    for (let x = 0; x < m.w; x += 1) {
      expect(m.tiles[x]).toBe(Tile.Solid)
      expect(m.tiles[(m.h - 1) * m.w + x]).toBe(Tile.Solid)
    }
    for (const s of TOWN_SPOTS) expect(m.tiles[s.tile.y * m.w + s.tile.x]).not.toBe(Tile.Solid)
    expect(new Set(TOWN_SPOTS.map((s) => s.id))).toEqual(new Set(['mongi', 'somsom', 'toto', 'bolt', 'board', 'gate']))
  })

  it('마을 계획은 floorMaze가 광장을 만든다', () => {
    const plan = townPlan(2)
    expect(plan.objective).toBe('town')
    expect(plan.label).toBe('몽실 마을')
    const m = floorMaze(plan)
    expect(m.w).toBe(townMaze(plan.seed).w)
  })

  it('마을 여행(Delve.town)은 보스층도 지역도 아니다', () => {
    const t = Delve.town(freshSave())
    expect(t.town).toBe(true)
    expect(t.onBoss).toBe(false)
    expect(t.plan.objective).toBe('town')
  })
})

describe('모찌의 미로 퀘스트', () => {
  it('넷을 차례로 끝내면 미로가 열리고 보상이 쌓인다', () => {
    const save = ch2Save()
    expect(mazeQuest(save)?.id).toBe('m_kill')
    expect(mazeCleared(save)).toBe(false)
    const gold = walkMaze(save)
    expect(gold).toBe(MAZE_CHAIN.reduce((n, q) => n + q.reward.gold, 0))
    expect(mazeCleared(save)).toBe(true)
    expect(mazeHud(save)?.title).toBe('미로 밖으로')
  })

  it('다른 종류 이벤트는 지금 퀘스트를 진행시키지 않는다', () => {
    const save = ch2Save()
    expect(mazeEvent(save, 'frag').result).toBeNull()
    expect(dreamOf(save).maze.step).toBe(0)
    for (let i = 0; i < 11; i += 1) mazeEvent(save, 'kill')
    expect(dreamOf(save).maze.step).toBe(0)
    const o = mazeEvent(save, 'kill')
    expect(o.next?.id).toBe('m_frag')
    expect(o.say?.who).toBe('모찌')
  })

  it('미로를 나오면 집이 몽실 마을이 되고 이야기 HUD가 뜬다', () => {
    const save = ch2Save()
    walkMaze(save)
    passMaze(save)
    const d = dreamOf(save)
    expect(d.maze.passed).toBe(true)
    expect(d.home).toBe('mongsil')
    expect(mazeHud(save)).toBeNull()
    expect(storyHud(save)?.prog).toBe('몽이에게 말 걸기')
  })
})

describe('꿈의 비밀 (몽이의 이야기)', () => {
  it('제안 → 진행 → 보고를 네 번 하면 챕터 2가 클리어되고 챕터 3이 열린다', () => {
    const save = ch2Save()
    walkMaze(save)
    passMaze(save)
    let cleared = 0
    const reveals: string[] = []
    for (let i = 0; i < STORY.length; i += 1) {
      expect(storyTalk(save, seeded(i)).took).toBe(true)
      playStep(save)
      expect(storyHud(save)?.done).toBe(true)
      const t = storyTalk(save, seeded(i + 9))
      reveals.push(...t.lines.map((l) => l.text))
      cleared ||= t.out.cleared
    }
    expect(cleared).toBe(2)
    const c = chaptersOf(save)
    expect(c.cleared).toContain(2)
    expect(c.current).toBeGreaterThanOrEqual(3)
    expect(dreamOf(save).story.done).toBe(true)
    expect(reveals.join(' ')).toContain('별하')
    expect(storyHud(save)).toBeNull()
  })

  it('별문은 이야기가 닿은 지역만 연다', () => {
    const save = ch2Save()
    expect(openAreas(save)).toEqual([])
    passMaze(save)
    expect(openAreas(save)).toEqual([])
    storyTalk(save, seeded())
    expect(wantsSparks(save)).toBe(true)
    playStep(save)
    storyTalk(save, seeded())
    expect(openAreas(save)).toEqual([])
    storyTalk(save, seeded())
    expect(openAreas(save)).toEqual(['loft'])
  })

  it('엉뚱한 지역 이벤트는 이야기를 진행시키지 않는다', () => {
    const save = ch2Save()
    passMaze(save)
    storyTalk(save, seeded())
    storyEvent(save, { type: 'area', area: 'tower' })
    storyEvent(save, { type: 'boss', area: 'moon' })
    expect(dreamOf(save).story.state).toBe('active')
    expect(dreamOf(save).story.count).toBe(0)
  })
})

describe('예전 세이브 이어 하기', () => {
  it('들판 퀘스트를 해 본 세이브는 미로를 지난 것으로 치고 예전 챕터 2 클리어는 다시 연다', () => {
    const save = ch2Save()
    const c = chaptersOf(save)
    c.guide.done = true
    if (!c.cleared.includes(1)) c.cleared.push(1)
    c.current = 2
    // An old save took a field quest before the 꿈 미로 existed.
    c.quests[CHAPTER2[0]!.id].status = 'active'
    c.cleared.push(2)
    c.card = 2
    delete save.dream
    const d = dreamOf(save)
    expect(d.maze.passed).toBe(true)
    expect(chaptersOf(save).cleared).not.toContain(2)
    expect(chaptersOf(save).card).toBe(0)
    expect(claimQuest(save, 'nope').ok).toBe(false)
  })

  it('처음 하는 세이브는 미로부터 시작한다', () => {
    const save = ch2Save()
    const d = dreamOf(save)
    expect(d.maze.passed).toBe(false)
    expect(d.home).toBe('island')
  })

  it('깨진 dream 블록은 안전한 값으로 고쳐진다', () => {
    const save = ch2Save()
    ;(save as unknown as { dream: unknown }).dream = { maze: { step: 99, count: -4, passed: 'yes' }, story: { step: -2, state: 'wat' }, home: 'mongsil', gates: ['moon', 'nope', 'moon'] }
    const d = dreamOf(save)
    expect(d.maze.step).toBe(MAZE_CHAIN.length)
    expect(d.maze.count).toBe(0)
    expect(d.story.step).toBe(0)
    expect(d.story.state).toBe('offer')
    expect(d.gates).toEqual(['moon'])
    expect(d.home).toBe('mongsil')
  })
})
