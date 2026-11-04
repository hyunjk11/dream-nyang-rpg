/** 챕터 2 지역 (꿈 미로, 구름 다락, 멈춘 시계탑, 달빛 둥지): ids, names and labels. Only imports places (no deps). */
import { placeLabel } from './places'

export type AreaId = 'maze' | 'loft' | 'tower' | 'moon'

export interface AreaDef {
  id: AreaId
  name: string
  /** Explore floors, then (moon only) the boss floor. */
  floors: number
  /** Difficulty: the sewer depth and floor whose numbers each area floor borrows (0 = its boss floor). */
  depth: number
  scaleFloors: readonly number[]
  /** Dungeon look (world/dungeon/theme ThemeId). */
  theme: string
  /** Where a recall / fall / finish sends her. */
  home: 'island' | 'mongsil'
  /** The last floor is a boss floor. */
  boss?: { name: string; hp: number }
  blurb: string
}

export const AREAS: Record<AreaId, AreaDef> = {
  maze: { id: 'maze', name: '꿈 미로', floors: 4, depth: 1, scaleFloors: [1, 2, 3, 3], theme: 'maze', home: 'island', blurb: '섬 마을 아래로 이어진 길 · 모찌가 길을 알아' },
  loft: { id: 'loft', name: '구름 다락', floors: 2, depth: 2, scaleFloors: [1, 2], theme: 'cloud', home: 'mongsil', blurb: '속삭임이 새어 나오는 구름 위 다락' },
  tower: { id: 'tower', name: '멈춘 시계탑', floors: 2, depth: 2, scaleFloors: [2, 3], theme: 'clock', home: 'mongsil', blurb: '3시 33분에 멈춘 시계탑' },
  moon: { id: 'moon', name: '달빛 둥지', floors: 1, depth: 2, scaleFloors: [0], theme: 'moon', home: 'mongsil', boss: { name: '꿈먹는 밤나방', hp: 1.15 }, blurb: '잊힌 꿈을 먹는 나방의 둥지' },
}

export const AREA_IDS = Object.keys(AREAS) as AreaId[]

export function isArea(v: unknown): v is AreaId {
  return typeof v === 'string' && v in AREAS
}

/** "2장 · 꿈 미로 · 2/4층" (or "2장 · 달빛 둥지 · 보스층"). */
export function areaLabel(area: AreaId, floor: number): string {
  const a = AREAS[area]
  if (a.boss && floor >= a.floors) return placeLabel(area, '보스층')
  return placeLabel(area, `${floor}/${a.floors}층`)
}

