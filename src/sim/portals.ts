/**
 * 별문 길: 이야기(챕터 장소)와 무한 탐험(꿈 하수도 깊이)을 한 목록에 섞지 않는다.
 * 돌아가기 포털은 섬이든 몽실이든, 그 층에서 귀환·쓰러짐으로 나왔을 때 그 자리로 이어 준다.
 */
import { chapter2Open, chapter3Open } from './chapters'
import { portalChoices } from './delve'
import { STORY, dreamOf, openAreas } from './dreamstory'
import { PLACE, lockedLabel, placeLabel } from './places'
import type { SaveData } from './types'

export type GateWhere = 'village' | 'wild' | 'mongsil'

export interface PortalRow {
  text: string
  go?: string
  locked?: boolean
  /** story = 챕터 장소, delve = 무한 탐험, return = 그 자리, nav = 메뉴 이동 */
  lane: 'story' | 'delve' | 'return' | 'nav'
}

export interface StoryGateInput {
  where: GateWhere
  save: SaveData
  /** Chapter-1 zone rows already filtered by the story (meadow, forest…). */
  zones: { label: string; go: string }[]
  /** Parked-floor label, or '' when nothing is waiting. */
  kept: string
}

/**
 * A recall or a fall keeps the floor (Hellgate-style parked return).
 * Clearing the floor, beating its boss, or standing in town does not.
 */
export function shouldParkFloor(why: 'recall' | 'down' | 'clear', flags: { town: boolean; bossBeaten: boolean; justUnlocked: boolean }): boolean {
  if (flags.town || flags.bossBeaten || flags.justUnlocked) return false
  return why === 'recall' || why === 'down'
}

const DELVE_ENTRY: PortalRow = { text: '무한 탐험 · 꿈 하수도', go: 'delve-menu', lane: 'delve' }

/** Story 별문. The tower is one row that opens its own menu — not a depth mixed into this list. */
export function storyGateRows(input: StoryGateInput): PortalRow[] {
  const rows: PortalRow[] = []
  if (input.kept && input.where !== 'wild') rows.push({ text: `돌아가기 포털 · ${input.kept}`, go: 'return', lane: 'return' })
  for (const z of input.zones) rows.push({ text: z.label, go: z.go, lane: 'story' })
  if (input.where === 'wild') return rows
  if (input.where === 'mongsil') {
    rows.push({ text: placeLabel('village', '섬으로'), go: 'island', lane: 'story' })
    rows.push({ text: placeLabel('field', PLACE.field.note), go: 'field', lane: 'story' })
    const areas = openAreas(input.save)
    for (const a of ['loft', 'tower', 'moon'] as const) {
      if (areas.includes(a)) rows.push({ text: placeLabel(a, PLACE[a].note), go: `area:${a}`, lane: 'story' })
      else {
        const n = STORY.findIndex((q) => q.where === a) + 1
        rows.push({ text: lockedLabel(a, `꿈의 비밀 ${n} 필요`), locked: true, lane: 'story' })
      }
    }
    if (chapter3Open(input.save)) rows.push({ text: '🔒 3장 · 꿈 바깥의 목소리 · 다음 챕터 준비 중', locked: true, lane: 'story' })
    rows.push(DELVE_ENTRY)
    return rows
  }
  if (!chapter2Open(input.save)) rows.push({ text: lockedLabel('maze'), locked: true, lane: 'story' })
  else if (dreamOf(input.save).maze.passed) rows.push({ text: placeLabel('mongsil', PLACE.mongsil.note), go: 'mongsil', lane: 'story' })
  else rows.push({ text: placeLabel('maze', PLACE.maze.note), go: 'area:maze', lane: 'story' })
  rows.push(DELVE_ENTRY)
  return rows
}

/** Second menu: depths of the infinite tower, then back to the story 별문. */
export function delveGateRows(save: SaveData): PortalRow[] {
  const rows: PortalRow[] = portalChoices(save).map((c) => ({ text: c.label, go: `sewer:${c.depth}:${c.floor}`, lane: 'delve' as const }))
  rows.push({ text: '← 이야기 길', go: 'story-menu', lane: 'nav' })
  return rows
}
