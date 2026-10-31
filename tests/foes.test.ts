import { describe, expect, it } from 'vitest'
import { FOE_HOMES } from '../src/combat/combat'
import { FOE_KINDS, FOE_SPECS, foePose, popIn, type PoseInput } from '../src/combat/foes'
import { WALK_RADIUS } from '../src/world/town/island'

const shipped = import.meta.glob('../public/models/3d/*_mobile.glb', { query: '?url' })
const idle: PoseInput = { t: 0.3, phase: 0.2, moving: false, windup: 0, hurt: 0, spawn: 1, dying: 0 }

describe('Meshy 적', () => {
  it('모든 적 모델이 배포되는 _mobile.glb 로 들어 있다', () => {
    for (const kind of FOE_KINDS) {
      const file = FOE_SPECS[kind].file
      expect(file.endsWith('_mobile.glb'), kind).toBe(true)
      expect(Object.keys(shipped), file).toContain(`../public/models/3d/${file}`)
    }
  })

  it('적 배치는 걸을 수 있는 섬 안이고 보스는 하나다', () => {
    for (const [x, z] of FOE_HOMES) expect(Math.hypot(x, z)).toBeLessThan(WALK_RADIUS - 1)
    expect(FOE_HOMES.filter(([, , k]) => k === 'bloom')).toHaveLength(1)
    // Nobody starts on top of Byeolha's spawn point.
    for (const [x, z] of FOE_HOMES) expect(Math.hypot(x, z)).toBeGreaterThan(4)
  })

  it('보스는 일반 적보다 훨씬 크고 단단하다', () => {
    for (const kind of FOE_KINDS) {
      if (kind === 'bloom') continue
      expect(FOE_SPECS.bloom.hp).toBeGreaterThan(FOE_SPECS[kind].hp * 4)
      expect(FOE_SPECS.bloom.height).toBeGreaterThan(FOE_SPECS[kind].height * 2)
      expect(FOE_SPECS[kind].height).toBeLessThan(1.62)
    }
  })

  it('공격 전에 읽을 수 있는 예비 동작이 있다', () => {
    for (const kind of FOE_KINDS) {
      expect(FOE_SPECS[kind].windup, kind).toBeGreaterThanOrEqual(0.25)
      const calm = foePose(kind, idle)
      const coiled = foePose(kind, { ...idle, windup: 1 })
      expect(coiled.sy, kind).toBeLessThan(calm.sy)
      expect(coiled.lean, kind).toBeLessThan(calm.lean)
      expect(coiled.stride, kind).toBe(0)
    }
  })

  it('슬라임은 뛸 때 늘어나고 착지할 때 눌리며 부피를 대략 지킨다', () => {
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < 40; i += 1) {
      const p = foePose('slime', { ...idle, moving: true, t: i / 96 })
      minY = Math.min(minY, p.sy)
      maxY = Math.max(maxY, p.sy)
      expect(p.sx * p.sy * p.sz).toBeGreaterThan(0.9)
      expect(p.sx * p.sy * p.sz).toBeLessThan(1.1)
    }
    expect(maxY).toBeGreaterThan(1.1)
    expect(minY).toBeLessThan(0.88)
  })

  it('토끼는 공중에 있을 때만 앞으로 나간다', () => {
    for (let i = 0; i < 40; i += 1) {
      const p = foePose('rabbit', { ...idle, moving: true, t: i / 84 })
      if (p.y < 0.01) expect(p.stride).toBeLessThan(0.05)
    }
  })

  it('박쥐는 떠 있고 날갯짓한다', () => {
    const xs = Array.from({ length: 30 }, (_, i) => foePose('bat', { ...idle, t: i / 60 }))
    for (const p of xs) expect(p.y).toBeGreaterThan(0.5)
    expect(Math.max(...xs.map((p) => p.sx)) - Math.min(...xs.map((p) => p.sx))).toBeGreaterThan(0.15)
  })

  it('맞으면 찌그러지고, 죽으면 부풀었다가 사라지고, 다시 나올 때 튀어나온다', () => {
    for (const kind of FOE_KINDS) {
      expect(foePose(kind, { ...idle, hurt: 1 }).sy).toBeLessThan(foePose(kind, idle).sy)
      expect(foePose(kind, { ...idle, dying: 0.2 }).sy).toBeGreaterThan(foePose(kind, idle).sy)
      expect(foePose(kind, { ...idle, dying: 1 }).sy).toBeLessThan(0.01)
      expect(foePose(kind, { ...idle, spawn: 0 }).sy).toBeLessThan(0.01)
    }
    expect(popIn(0)).toBe(0)
    expect(popIn(1)).toBe(1)
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => popIn(i / 50)))
    expect(peak).toBeGreaterThan(1.02)
    expect(peak).toBeLessThan(1.25)
  })
})
