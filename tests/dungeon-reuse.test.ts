import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { bakeSkinned, decimate, frameTimes } from '../src/3d/dungeon/bake'
import { CHAMPIONS, HORDE, type HordeKind } from '../src/3d/dungeon/horde'
import { HORDE_KINDS, KIND_ART, walkFrame } from '../src/3d/dungeon/horde-view'
import { LORD_TINTS, LUCKY, LUCKY_KINDS, luckyFrames } from '../src/3d/dungeon/lucky'
import { Director, waveFor } from '../src/3d/dungeon/waves'

const shipped = Object.keys(import.meta.glob('../public/models/3d/*_mobile.glb', { query: '?url' })).map((p) => p.split('/').pop())
const credits = Object.values(import.meta.glob('../CREDITS.md', { query: '?raw', import: 'default', eager: true }))[0] as string

describe('E단계 몬스터 재활용', () => {
  it('모든 무리 종류에 외형 출처·키·포즈가 정해져 있다', () => {
    expect(HORDE_KINDS.length).toBe(17)
    for (const k of HORDE_KINDS) {
      const a = KIND_ART[k]
      expect(a.height).toBeGreaterThan(0.5)
      // Elites (×1.45) still fit under the 4.2 m sewer ceiling.
      expect(a.height * 1.45 + (a.hover ?? 0)).toBeLessThan(4.2)
      expect(HORDE[k].chest).toBeLessThan(a.height + (a.hover ?? 0))
      if (a.source !== 'lucky') expect(a.file ?? 'meshy').toBeTruthy()
    }
  })

  it('재활용 GLB는 배포에 포함되는 _mobile 파일로 존재하고 크레딧에 적혀 있다', () => {
    for (const k of HORDE_KINDS) {
      const f = KIND_ART[k].file
      if (!f) continue
      expect(shipped).toContain(f)
      expect(credits).toContain(f.startsWith('kk_') ? 'kk_skel_' : f)
    }
    expect(credits).toContain('CC0')
    expect(credits).toContain('lucky-defense-3d')
  })

  it('럭키 디펜스 13종은 7종 몸체 + 군주 몸체 하나의 6가지 색 변형으로 들어온다', () => {
    expect(LUCKY_KINDS.length).toBe(8)
    expect(LORD_TINTS.length).toBe(6)
    expect(LUCKY_KINDS.length - 1 + LORD_TINTS.length).toBe(13)
    for (const k of LUCKY_KINDS) expect(LUCKY[k].source.length).toBeGreaterThan(0)
  })

  it('절차 몬스터는 걷기 4프레임으로 합쳐지고 정점 색을 가진다', () => {
    for (const k of LUCKY_KINDS) {
      const frames = luckyFrames(k)
      expect(frames.length).toBe(4)
      for (const g of frames) {
        expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count)
        expect(g.getAttribute('position').count).toBeLessThan(12000)
      }
    }
    // Legs move between frames.
    const w = luckyFrames('wolf')
    const a = w[0].getAttribute('position').array
    const b = w[1].getAttribute('position').array
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff = Math.max(diff, Math.abs(a[i] - b[i]))
    expect(diff).toBeGreaterThan(0.01)
  })

  it('웨이브가 진행될수록 재활용 몬스터가 해금되고 챔피언이 나타난다', () => {
    expect(waveFor(1).kinds).toEqual(['slime'])
    expect(waveFor(3).kinds).toContain('skeleton')
    expect(waveFor(3).champions).toEqual(['lord'])
    expect(waveFor(5).champions).toEqual(['lord', 'lich'])
    const all = new Set<HordeKind>([...waveFor(6).kinds, ...waveFor(6).champions])
    expect(all.size).toBe(17)
    for (const c of CHAMPIONS) expect(waveFor(6).kinds).not.toContain(c)
  })

  it('챔피언은 웨이브의 첫 엘리트로만 나온다', () => {
    const d = new Director()
    for (let i = 0; i < 4; i += 1) d.begin()
    const w = d.begin()
    expect(w.n).toBe(5)
    const seen: { kind: HordeKind; elite: boolean }[] = []
    for (let t = 0; t < 400 && seen.length < w.total; t += 1) seen.push(...d.update(0.1, { nestDistance: [3, 4], alive: 0, inBoss: false }))
    const elites = seen.filter((o) => o.elite)
    expect(elites.slice(0, 2).map((o) => o.kind)).toEqual(['lord', 'lich'])
    expect(seen.filter((o) => !o.elite && CHAMPIONS.includes(o.kind))).toEqual([])
  })

  it('걷기 프레임 선택은 항상 범위 안이고 움직이면 순환한다', () => {
    const seen = new Set<number>()
    for (let t = 0; t < 2; t += 0.05) {
      const f = walkFrame(t, 0.3, true, 4)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(4)
      seen.add(f)
    }
    expect(seen.size).toBe(4)
    expect(walkFrame(5, 0.2, true, 1)).toBe(0)
    expect(frameTimes(1, 4)).toEqual([0, 0.25, 0.5, 0.75])
    expect(frameTimes(0, 4)).toEqual([0])
  })

  it('정적 장면 베이크는 재질별 그룹 하나씩, 원거리 LOD는 삼각형을 크게 줄인다', () => {
    const g = new Group()
    const m1 = new MeshBasicMaterial()
    const m2 = new MeshBasicMaterial()
    g.add(new Mesh(new BoxGeometry(1, 1, 1), m1), new Mesh(new SphereGeometry(0.3), m2), new Mesh(new BoxGeometry(0.2, 0.2, 0.2), m1))
    const baked = bakeSkinned(g, null)
    expect(baked.frames.length).toBe(1)
    expect(baked.materials).toEqual([m1, m2])
    expect(baked.frames[0].groups.map((x) => x.materialIndex)).toEqual([0, 1])
    const ball = new SphereGeometry(1, 64, 48)
    const far = decimate(ball, 10)
    expect((far.index?.count ?? 0) / 3).toBeLessThan((ball.index?.count ?? 0) / 3 / 4)
    far.computeBoundingBox()
    expect(far.boundingBox?.max.y).toBeGreaterThan(0.8)
  })
})
