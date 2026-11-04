/**
 * 장소 이름표 (fix/balance-quests-portals): every place the portals reach, in story order, with one
 * label scheme "n장 · 이름" used by the portal menus, the arrival banners, the quest route chips and
 * the map. No imports, so floorsnap / areas / waypoint can all use it.
 */
export type PlaceId = 'meadow' | 'village' | 'forest' | 'vale' | 'altar' | 'sewer' | 'maze' | 'mongsil' | 'field' | 'loft' | 'tower' | 'moon'

export interface PlaceDef {
  id: PlaceId
  chapter: 1 | 2
  name: string
  /** One short note for the portal menu. */
  note: string
}

/** Story order: 1장 (섬) then 2장 (꿈 미로 → 몽실 마을 → 들판 → 다락 → 시계탑 → 둥지). */
export const PLACES: readonly PlaceDef[] = [
  { id: 'meadow', chapter: 1, name: '꿈의 초원', note: '처음 깨어난 곳' },
  { id: 'village', chapter: 1, name: '꿈의 마을', note: '섬의 첫 마을' },
  { id: 'forest', chapter: 1, name: '몽환의 숲', note: '루나의 꿈가루 부탁' },
  { id: 'vale', chapter: 1, name: '버섯 골짜기', note: '키키의 부품' },
  { id: 'altar', chapter: 1, name: '별빛 제단', note: '악몽 꽃' },
  { id: 'sewer', chapter: 1, name: '꿈 하수도', note: '깊이별 던전 · 의뢰' },
  { id: 'maze', chapter: 2, name: '꿈 미로', note: '모찌와 함께' },
  { id: 'mongsil', chapter: 2, name: '몽실 마을', note: '몽이의 꿈의 비밀' },
  { id: 'field', chapter: 2, name: '몽실 들판', note: '게시판 의뢰 · 등불 불씨' },
  { id: 'loft', chapter: 2, name: '구름 다락', note: '꿈의 비밀 2' },
  { id: 'tower', chapter: 2, name: '멈춘 시계탑', note: '꿈의 비밀 3' },
  { id: 'moon', chapter: 2, name: '달빛 둥지', note: '꿈의 비밀 4 · 보스' },
]

export const PLACE: Record<PlaceId, PlaceDef> = Object.fromEntries(PLACES.map((p) => [p.id, p])) as Record<PlaceId, PlaceDef>

export function isPlace(v: unknown): v is PlaceId {
  return typeof v === 'string' && v in PLACE
}

/** "2장 · 구름 다락" (with an optional tail: "2장 · 구름 다락 · 1/2층"). */
export function placeLabel(id: PlaceId, tail = ''): string {
  const p = PLACE[id]
  return `${p.chapter}장 · ${p.name}${tail ? ` · ${tail}` : ''}`
}

/** A portal row for a place she cannot reach yet: "🔒 2장 · 꿈 미로 · 2장 필요". */
export function lockedLabel(id: PlaceId, need = `${PLACE[id].chapter}장 필요`): string {
  return `🔒 ${placeLabel(id)} · ${need}`
}

/** Story rank (menu sort key). */
export function placeRank(id: PlaceId): number {
  return PLACES.findIndex((p) => p.id === id)
}
