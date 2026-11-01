import { describe, expect, it } from 'vitest'
import { InstancedMesh } from 'three'
import { generateMaze } from '../src/world/dungeon/maze'
import { PROP_CAP, THEMES, themeFor, themeProps } from '../src/world/dungeon/theme'
import { deathShape } from '../src/combat/foes'
import { numberPunch } from '../src/ui/hudfx'
import { bigHitShake, TRACER_LIFE } from '../src/combat/shooter'
import { labelScale } from '../src/world/dungeon/loot-view'
import { notesAt, TRACKS, trackFor } from '../src/audio/music'

describe('던전 테마', () => {
  it('깊이마다 꿈 하수도 → 캔디 동굴 → 별빛 서재 순으로 돌아간다', () => {
    expect(themeFor(1).id).toBe('sewer')
    expect(themeFor(2).id).toBe('candy')
    expect(themeFor(3).id).toBe('library')
    expect(themeFor(4).id).toBe('sewer')
    expect(new Set(Object.values(THEMES).map((t) => t.fog)).size).toBe(3)
  })

  it('테마 소품은 인스턴스 메시 몇 개로만 그려지고 개수 상한을 넘지 않는다', () => {
    const maze = generateMaze(7)
    for (const t of Object.values(THEMES)) {
      const g = themeProps(maze, t)
      const meshes = g.children.filter((c) => c instanceof InstancedMesh) as InstancedMesh[]
      expect(meshes.length).toBeLessThanOrEqual(2)
      // 벽면은 PROP_CAP 개까지, 벽면마다 소품 최대 3개.
      for (const m of meshes) expect(m.count).toBeLessThanOrEqual(PROP_CAP * 3)
      if (t.id !== 'sewer') expect(meshes.reduce((n, m) => n + m.count, 0)).toBeGreaterThan(0)
    }
  })
})

describe('몬스터 처치 연출', () => {
  it('납작 → 펑 → 반짝이며 사라지는 순서를 지킨다', () => {
    expect(deathShape(0.2).tall).toBeLessThan(1)
    expect(deathShape(0.2).wide).toBeGreaterThan(1)
    expect(deathShape(0.48).tall).toBeGreaterThan(1)
    expect(deathShape(1).tall).toBeLessThan(0.05)
  })
})

describe('타격감', () => {
  it('치명타 숫자가 일반 숫자보다 세게 튀어나온다', () => {
    expect(numberPunch('crit')).toBeGreaterThan(numberPunch('elite'))
    expect(numberPunch('elite')).toBeGreaterThan(numberPunch('n'))
  })

  it('화면 흔들림은 큰 타격에만, 그리고 작게 걸린다', () => {
    expect(bigHitShake({ crit: false, kill: false, elite: false, boss: false })).toBe(0)
    expect(bigHitShake({ crit: true, kill: false, elite: false, boss: false })).toBeGreaterThan(0)
    const most = bigHitShake({ crit: true, kill: true, elite: true, boss: false })
    expect(most).toBeGreaterThan(bigHitShake({ crit: true, kill: false, elite: false, boss: false }))
    expect(most).toBeLessThanOrEqual(0.1)
    expect(TRACER_LIFE).toBeGreaterThan(0.05)
  })

  it('바닥 아이템 이름표는 가까이 가면 작아지고 멀면 원래 크기다', () => {
    expect(labelScale(0.5)).toBeCloseTo(0.45)
    expect(labelScale(4)).toBeGreaterThan(labelScale(1.5))
    expect(labelScale(20)).toBe(1)
  })
})

describe('배경음악', () => {
  it('마을은 녹음된 곡, 던전은 테마별 곡, 보스는 보스 곡을 고른다', () => {
    expect(trackFor('town', 1)).toBeNull()
    expect(trackFor('dungeon', 1)?.id).toBe('sewer')
    expect(trackFor('dungeon', 2)?.id).toBe('candy')
    expect(trackFor('dungeon', 3)?.id).toBe('library')
    expect(trackFor('boss', 2)?.id).toBe('boss')
  })

  it('마디 첫 박에는 화음이 깔리고 보스 곡에만 킥이 들어간다', () => {
    const first = notesAt(TRACKS.sewer, 0)
    expect(first.filter((n) => n.voice === 'pad')).toHaveLength(3)
    expect(first.some((n) => n.voice === 'kick')).toBe(false)
    expect(notesAt(TRACKS.boss, 0).some((n) => n.voice === 'kick')).toBe(true)
    // 같은 루프는 같은 선율로 반복된다.
    const loop = TRACKS.candy.bars.length * 8
    expect(notesAt(TRACKS.candy, 3)).toEqual(notesAt(TRACKS.candy, 3 + loop))
  })
})
