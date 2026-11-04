import { describe, expect, it } from 'vitest'
import { ttkRows } from '../tools/ttk-rows'
import { SKILL_BITE } from '../src/data/tree'
import { TREE_BY_ID } from '../src/data/tree'

const rows = ttkRows()
const rare = rows.filter((r) => r.gun.endsWith('희귀'))

describe('밸런스 패스: 구역별 희귀 총 처치 시간 (스킬 없이, 레벨·iLv는 그 구역에 맞게)', () => {
  it('일반 몹(슬라임)은 0.6~1.3초', () => {
    for (const r of rare) {
      expect(r.normal, `${r.area} ${r.gun}`).toBeGreaterThanOrEqual(0.6)
      expect(r.normal, `${r.area} ${r.gun}`).toBeLessThanOrEqual(1.3)
    }
  })
  it('정예는 4~8.5초 (스킬 한두 번 섞으면 4~7초)', () => {
    for (const r of rare) {
      expect(r.elite, `${r.area} ${r.gun}`).toBeGreaterThanOrEqual(4)
      expect(r.elite, `${r.area} ${r.gun}`).toBeLessThanOrEqual(8.5)
    }
  })
  it('보스는 총만 쓰면 55~100초: 스킬(25~35%)을 섞으면 45~75초 싸움이다', () => {
    for (const r of rare.filter((x) => x.area.includes('보스'))) {
      expect(r.boss, `${r.area} ${r.gun}`).toBeGreaterThanOrEqual(55)
      expect(r.boss, `${r.area} ${r.gun}`).toBeLessThanOrEqual(100)
    }
  })
  it('전설·유니크는 같은 구역 희귀보다 빨리 잡는다', () => {
    for (const area of new Set(rows.map((r) => r.area))) {
      const best = Math.max(...rare.filter((r) => r.area === area).map((r) => r.dps))
      for (const r of rows.filter((x) => x.area === area && !x.gun.endsWith('희귀'))) expect(r.dps, `${area} ${r.gun}`).toBeGreaterThan(best)
    }
  })
  it('네 총의 DPS는 물총의 75% 이상으로 모여 있다 (별총·저격 상향)', () => {
    for (const area of new Set(rows.map((r) => r.area))) {
      const w = rare.find((r) => r.area === area && r.gun.startsWith('물총'))!.dps
      for (const r of rare.filter((x) => x.area === area)) expect(r.dps / w, `${area} ${r.gun}`).toBeGreaterThanOrEqual(0.75)
    }
  })
  it('몹 체력은 구역이 깊어질수록 오른다 (미로 1층 < 2장 시계탑 < 달빛 둥지)', () => {
    const hp = (a: string) => rows.find((r) => r.area === a)!.normalHp
    expect(hp('1장 미로 1층')).toBeLessThan(hp('2장 시계탑 2층'))
    expect(hp('2장 시계탑 2층')).toBeLessThan(hp('2장 달빛 둥지 보스'))
  })
})

describe('밸런스 패스: 스킬은 보조 피해 (보스전 25~35%)', () => {
  it('보스 60초 동안 쿨마다 네 스킬을 75% 쓰면, 스킬 몫이 전체 피해의 25~35%다', () => {
    const cds: Record<string, [keyof typeof SKILL_BITE, number]> = {
      bubble_bomb: ['bomb', TREE_BY_ID.bubble_bomb.cooldown!(1)],
      overdrive: ['wave', TREE_BY_ID.overdrive.cooldown!(1)],
      mochi_rush: ['rush', TREE_BY_ID.mochi_rush.cooldown!(1)],
      candy_aura: ['aura', TREE_BY_ID.candy_aura.cooldown!(1)],
    }
    const T = 60
    // 총만으로 T초에 1.0을 깎는 속도. 스킬은 쿨마다 75% 확률로 사용.
    let skill = 0
    for (const [kind, cd] of Object.values(cds)) skill += (T / cd) * 0.75 * SKILL_BITE[kind].boss
    const gun = 1
    const share = skill / (skill + gun)
    expect(share).toBeGreaterThanOrEqual(0.25)
    expect(share).toBeLessThanOrEqual(0.35)
  })
})
