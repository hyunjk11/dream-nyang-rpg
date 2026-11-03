import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { HDR_MAX, NEAR_FADE, POINT_MAX_PX, SANITIZE_SHADER, allFinite, pointGuard, safeHdr } from '../src/core/safeframe'
import { particleAlpha, stepParticle } from '../src/core/vfx'
import { needsRelock } from '../src/core/cursor'
import { clickAction } from '../src/core/input'
import { FIELD_NAME, fieldQuestWay } from '../src/sim/waypoint'
import { CHAPTER2, chapter2Open, chaptersOf, fieldOpen, questHud, skipGuide, takeQuest } from '../src/sim/chapters'
import { passMaze } from '../src/sim/dreamstory'
import { questBook } from '../src/sim/questbook'
import { freshSave } from '../src/sim/mutate'
import { townFoeHp } from '../src/combat/combat'
import { DIFFICULTY } from '../src/combat/difficulty'

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('화면 깨짐 (검은/흰 사각형) 방지', () => {
  it('HDR 정리: NaN·무한대는 0, 너무 밝은 값은 상한으로', () => {
    expect(safeHdr(Number.NaN)).toBe(0)
    expect(safeHdr(Number.POSITIVE_INFINITY)).toBe(0)
    expect(safeHdr(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(safeHdr(-2)).toBe(0)
    expect(safeHdr(1e4)).toBe(HDR_MAX)
    expect(safeHdr(0.5)).toBe(0.5)
  })

  it('정리 패스는 블룸보다 먼저, 렌더 바로 다음에 돈다', () => {
    const arena = src('src/core/arena.ts')
    const render = arena.indexOf('new RenderPass(')
    const clean = arena.indexOf('new ShaderPass(SANITIZE_SHADER)')
    const bloom = arena.indexOf('new UnrealBloomPass(')
    expect(render).toBeGreaterThan(0)
    expect(clean).toBeGreaterThan(render)
    expect(bloom).toBeGreaterThan(clean)
    // NaN은 비교가 모두 거짓이라 !(v < L && v > -L) 로 잡는다.
    expect(SANITIZE_SHADER.fragmentShader).toMatch(/!\(v < [\d.e+]+ && v > -[\d.e+]+\)/)
  })

  it('카메라 행렬에 NaN이 끼면 마지막 정상 자세로 되돌린다', () => {
    expect(allFinite([1, 2, 3])).toBe(true)
    expect(allFinite([1, Number.NaN])).toBe(false)
    expect(src('src/core/arena.ts')).toMatch(/allFinite\(camera\.matrixWorld\.elements\)/)
  })

  it('카메라에 붙은 파티클은 화면만 한 사각형이 되지 않는다 (크기 상한 + 근접 페이드)', () => {
    const lens = pointGuard(0.5, 648, 0.11)
    expect(lens.px).toBeLessThanOrEqual(POINT_MAX_PX)
    expect(lens.fade).toBe(0)
    const far = pointGuard(0.3, 648, 3)
    expect(far.fade).toBe(1)
    expect(far.px).toBeCloseTo(64.8, 1)
    expect(pointGuard(Number.NaN, 648, 1)).toEqual({ px: 0, fade: 0 })
    expect(pointGuard(0.3, 648, -1)).toEqual({ px: 0, fade: 0 })
    expect(NEAR_FADE[0]).toBeGreaterThan(0.1)
  })

  it('포인트 셰이더 3곳 모두 guardPoint를 쓰고 날 것의 size / -mv.z 가 없다', () => {
    for (const f of ['src/core/vfx.ts', 'src/world/town/decor.ts', 'src/world/dungeon/dream.ts']) {
      const s = src(f)
      expect(s, f).toMatch(/guardPoint\(/)
      expect(s, f).not.toMatch(/gl_PointSize\s*=[^;]*\/\s*-mv(Position)?\.z/)
    }
  })

  it('NaN 파티클은 바로 사라지고, 수명 0도 0/0이 되지 않는다', () => {
    const p = { x: Number.NaN, y: 1, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, drag: 0, gravity: 0 }
    expect(stepParticle(p, 0.016)).toBe(false)
    expect(stepParticle({ ...p, x: 0, life: Number.NaN }, 0.016)).toBe(false)
    expect(particleAlpha(0, 0)).toBe(0)
    expect(particleAlpha(Number.NaN, 1)).toBe(0)
    const ok = { x: 0, y: 1, z: 0, vx: 1, vy: 0, vz: 0, age: 0, life: 1, drag: 0, gravity: 0 }
    expect(stepParticle(ok, 0.016)).toBe(true)
  })
})

describe('클릭 한 번으로 계속', () => {
  const base = { armed: true, touch: false, locked: false, free: false, hadLock: true, refused: false }
  it('잠금이 풀리면 버튼이 뜨고, 한 번 누르면 잠금이 거절돼도 다시 뜨지 않는다', () => {
    expect(needsRelock(base)).toBe(true)
    expect(needsRelock({ ...base, resumed: true })).toBe(false)
  })
  it('버튼은 pointerdown 한 번에 바로 계속하고 같은 핸들러에서 잠금을 요청한다', () => {
    const main = src('src/main.ts')
    expect(main).toMatch(/relockBtn\?\.addEventListener\('pointerdown'[\s\S]{0,200}resumeView\(\)/)
    expect(main).toMatch(/gestureActive\(\) && !stage\.touch\) resumeView\(\)/)
  })
  it('잠기지 않은 화면 클릭은 잠금을 가져가고, 잠금 뒤에는 발사', () => {
    expect(clickAction(false, false)).toBe('lock')
    expect(clickAction(true, false)).toBe('fire')
  })
})

describe('몽실 들판 퀘스트 위치', () => {
  it('슬라임·박쥐 퀘스트가 실제 지명(몽실 들판)을 말한다', () => {
    for (const id of ['c2_slime', 'c2_bat']) expect(CHAPTER2.find((d) => d.id === id)!.text).toContain(FIELD_NAME)
  })

  it('몽실 마을에 닿기 전(챕터 1, 챕터 2 미로 전)에는 게시판·추적에 안 나온다', () => {
    const save = freshSave()
    expect(takeQuest(save, 'c2_slime').ok).toBe(false)
    skipGuide(save)
    expect(chapter2Open(save)).toBe(true)
    expect(fieldOpen(save)).toBe(false)
    expect(takeQuest(save, 'c2_slime').ok).toBe(false)
    chaptersOf(save).quests.c2_slime.status = 'active'
    expect(questHud(save)).toEqual([])
    expect(questBook(save).some((q) => q.id === 'c2_slime')).toBe(false)
    passMaze(save)
    expect(fieldOpen(save)).toBe(true)
    expect(questBook(save).find((q) => q.id === 'c2_slime')?.line).toBe('몽실 들판의 솜사탕 슬라임 잡기')
  })

  it('길 안내는 섬 별문 → 몽실 마을 별문 → 들판 슬라임 순서로 이어진다', () => {
    expect(fieldQuestWay('kill', 'slime', false, 'island', 'X')).toEqual({ goal: { kind: 'gate' }, label: 'X · 별문 → 몽실 마을 → 몽실 들판' })
    expect(fieldQuestWay('kill', 'slime', false, 'mongsil', 'X')).toEqual({ goal: { kind: 'gate' }, label: 'X · 몽실 마을 별문 → 몽실 들판' })
    expect(fieldQuestWay('kill', 'slime', false, 'field', 'X').goal).toEqual({ kind: 'foe', target: 'slime' })
    expect(fieldQuestWay('kill', 'bat', false, 'elsewhere', 'X').goal).toEqual({ kind: 'exit' })
    expect(fieldQuestWay('kill', 'bat', true, 'field', 'X').goal).toEqual({ kind: 'board' })
  })
})

describe('챕터 1 튜토리얼 지역 체력', () => {
  const DPS = 137 // 시작 물총 실측
  it('일반 몬스터는 시작 물총으로 0.5~1초', () => {
    for (const k of ['slime', 'bat', 'bug', 'rabbit'] as const) {
      const s = townFoeHp(k, false) / DPS
      expect(s, k).toBeGreaterThanOrEqual(0.5)
      expect(s, k).toBeLessThanOrEqual(1)
    }
  })
  it('버섯 골짜기 정예(토끼·슬라임)는 4~6초', () => {
    for (const k of ['slime', 'rabbit'] as const) {
      const s = townFoeHp(k, true) / DPS
      expect(s, k).toBeGreaterThanOrEqual(4)
      expect(s, k).toBeLessThanOrEqual(6)
    }
  })
  it('별빛 제단 꽃은 예전(약 7150)보다 훨씬 약하고, 하수도·보스층·미로 수치는 그대로', () => {
    expect(townFoeHp('bloom', false)).toBeLessThan(4000)
    expect(townFoeHp('bloom', false) / DPS).toBeGreaterThan(15)
    expect(DIFFICULTY.horde.hp).toBe(9)
    expect(DIFFICULTY.town.skillHp).toBe(11)
  })
})
