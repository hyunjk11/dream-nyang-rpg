import { describe, expect, it } from 'vitest'
import { FOE_HOMES } from '../src/3d/combat'
import { WALK_RADIUS, pathEdgeDistance } from '../src/3d/island'
import { PLACES, PLACE_MODELS, insidePlace, nearestTalk, pushOutOfPlaces } from '../src/3d/places'
import { talkStep } from '../src/3d/talk'

const shipped = Object.keys(import.meta.glob('../public/models/3d/*_mobile.glb', { query: '?url' })).map((p) => p.split('/').pop())

describe('섬 랜드마크', () => {
  it('걸을 수 있는 섬 안, 길 밖에 서 있다', () => {
    for (const p of PLACES) {
      expect(Math.hypot(p.x, p.z) + p.solid).toBeLessThan(WALK_RADIUS)
      expect(pathEdgeDistance({ x: p.x, z: p.z }), p.kind).toBeGreaterThan(Math.max(p.solid, 0.2))
    }
  })

  it('적 자리와 시작 광장을 비워 둔다', () => {
    for (const p of PLACES) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(p.solid + 2)
      for (const [x, z] of FOE_HOMES) expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThan(p.solid + 1.5)
    }
  })

  it('Meshy 랜드마크마다 배포용 _mobile.glb 가 있다', () => {
    for (const kind of PLACE_MODELS) {
      const file = kind === 'kiki' ? 'npc_kiki_mobile.glb' : `place_${kind}_mobile.glb`
      expect(shipped).toContain(file)
    }
  })

  it('단단한 건물 안으로는 못 들어가고 빈 땅은 그대로다', () => {
    const house = PLACES.find((p) => p.kind === 'house')!
    const out = pushOutOfPlaces(house.x + 0.2, house.z, 0.3)
    expect(Math.hypot(out.x - house.x, out.z - house.z)).toBeCloseTo(house.solid + 0.3, 5)
    expect(pushOutOfPlaces(0, 0, 0.3)).toEqual({ x: 0, z: 0 })
    expect(insidePlace(house.x, house.z)).toBe(true)
    expect(insidePlace(0, 0)).toBe(false)
  })

  it('가까이 있을 때만 대화를 건다', () => {
    const kiki = PLACES.find((p) => p.kind === 'kiki')!
    expect(nearestTalk(kiki.x + 1.2, kiki.z)?.talk).toBe('kiki_offer')
    expect(nearestTalk(0, 0)).toBeNull()
  })

  it('대사를 한 줄씩 넘기고 끝나면 행동을 돌려준다', () => {
    expect(talkStep('kiki_offer', 0).line?.speaker).toBe('키키')
    expect(talkStep('well_rest', 1)).toEqual({ line: null, actions: [{ type: 'heal-full' }] })
    expect(talkStep('nope', 0).line).toBeNull()
  })
})
