import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { JUICE, Juice, inCloud, reflect, rollCloud, rollStar, seekNext, type JuiceWorld } from '../src/combat/juice'
import type { SkillBody } from '../src/combat/skills'
import type { Vfx } from '../src/core/vfx'
import { AFFIXES } from '../src/data/affixes'
import { makeItem } from '../src/sim/loot'
import { freshSave } from '../src/sim/mutate'
import { addItem } from '../src/sim/inventory'
import { GUN_JUICE, computeStats } from '../src/sim/stats'
import { hitStopFor } from '../src/combat/gunfeel'
import { numberPunch } from '../src/ui/hudfx'

const vfx = { burst: () => {}, ring: () => {}, hit: () => {} } as unknown as Vfx

function body(id: string, x: number, z: number, log: { id: string; amount: number }[]): SkillBody {
  return { id, x, z, r: 0.5, tone: 'n', hit: (amount) => (log.push({ id, amount }), false) }
}

function juice(lowPower = false) {
  const nums: string[] = []
  const sounds: string[] = []
  const j = new Juice({ vfx, lowPower, number: (_n, _at, tone) => nums.push(tone), sound: (c) => sounds.push(c) })
  return { j, nums, sounds }
}

const open: JuiceWorld = { solid: (_ox, _oy, _oz, _dx, _dy, _dz, max) => max, normal: () => ({ x: 0, y: 1, z: 0 }) }

function run(j: Juice, world: JuiceWorld, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) j.update(1 / 60, world)
}

describe('팡팡 총 맛: 별 도탄과 솜사탕 구름', () => {
  it('별 도탄은 옵션이 없어도 7발마다 한 번, 옵션이 있으면 확률로 더 나온다', () => {
    const plain = Array.from({ length: 70 }, (_, i) => rollStar(i + 1, 0, 0.99)).filter(Boolean).length
    expect(plain).toBe(10)
    expect(rollStar(3, 0.1, 0.05)).toBe(true)
    expect(rollStar(3, 0.1, 0.5)).toBe(false)
  })

  it('솜사탕 구름은 치명타일 때 훨씬 잘 피어나고, 옵션 확률이 더해진다', () => {
    expect(rollCloud(false, 0, JUICE.cloudBase + 0.01)).toBe(false)
    expect(rollCloud(true, 0, JUICE.cloudBase + 0.01)).toBe(true)
    expect(rollCloud(false, 0.1, JUICE.cloudBase + 0.05)).toBe(true)
  })

  it('벽에 맞은 별은 속도를 잃지 않고 반사된다', () => {
    const r = reflect({ x: 3, y: 0, z: 4 }, { x: -1, y: 0, z: 0 })
    expect(r).toEqual({ x: -3, y: 0, z: 4 })
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(5)
  })

  it('튕긴 별은 아직 안 맞은 가장 가까운 몹을 찾아간다', () => {
    const log: { id: string; amount: number }[] = []
    const bodies = [body('a', 1, 0, log), body('b', 4, 0, log), body('c', 30, 0, log)]
    expect(seekNext(bodies, 0, 0, new Set(['a']), JUICE.starSeek)?.id).toBe('b')
    expect(seekNext(bodies, 0, 0, new Set(['a', 'b']), JUICE.starSeek)).toBeNull()
  })

  it('별 하나가 몹에서 몹으로 통통 튀며 여러 마리를 때린다', () => {
    const log: { id: string; amount: number }[] = []
    const bodies = [body('a', 4, 0, log), body('b', 4, 4, log), body('c', 0, 5, log)]
    const { j, nums, sounds } = juice()
    j.star(new Vector3(0, 1.1, 0), new Vector3(1, 0, 0), 10)
    run(j, { ...open, bodies: () => bodies }, 1.2)
    const ids = log.map((l) => l.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('a')
    expect(log.every((l) => l.amount === 10)).toBe(true)
    expect(nums.filter((n) => n === 'star').length).toBe(3)
    expect(sounds).toContain('star')
    expect(sounds).toContain('boing')
  })

  it('벽에 맞으면 튕겨 나오고, 튕길 수 있는 횟수가 다 되면 사라진다', () => {
    const { j } = juice()
    // A box 2 m wide: walls at x = ±1 bounce the star back and forth.
    const box: JuiceWorld = {
      solid: (ox, _oy, _oz, dx, _dy, _dz, max) => (dx > 0 ? Math.min(max, (1 - ox) / dx) : dx < 0 ? Math.min(max, (-1 - ox) / dx) : max),
      normal: (_e, d) => ({ x: d.x > 0 ? -1 : 1, y: 0, z: 0 }),
    }
    j.star(new Vector3(0, 1, 0), new Vector3(1, 0, 0), 5)
    run(j, box, 0.08)
    expect(j.live.stars).toBe(1)
    run(j, box, JUICE.starLife)
    expect(j.live.stars).toBe(0)
  })

  it('솜사탕 구름은 안에 있는 몹에게만 조금씩 여러 번 피해를 준다', () => {
    const log: { id: string; amount: number }[] = []
    const bodies = [body('in', 0.5, 0, log), body('out', 6, 0, log)]
    expect(inCloud(bodies, 0, 0, JUICE.cloudRadius).map((b) => b.id)).toEqual(['in'])
    const { j, nums } = juice()
    j.cloud(new Vector3(0, 1, 0), 20)
    run(j, { ...open, bodies: () => bodies }, JUICE.cloudLife + 0.2)
    const ticks = log.filter((l) => l.id === 'in')
    expect(ticks.length).toBeGreaterThanOrEqual(5)
    expect(ticks[0].amount).toBe(Math.round(20 * JUICE.cloudShare))
    expect(log.some((l) => l.id === 'out')).toBe(false)
    expect(nums).toContain('candy')
    expect(j.live.clouds).toBe(0)
  })

  it('모바일에서는 별·구름 개수 상한이 더 낮다 (풀링, 오래된 것부터 교체)', () => {
    const { j } = juice(true)
    for (let i = 0; i < 20; i += 1) {
      j.star(new Vector3(0, 1, 0), new Vector3(1, 0, 0), 1)
      j.cloud(new Vector3(0, 1, 0), 1)
    }
    expect(j.live.stars).toBe(JUICE.maxStars[1])
    expect(j.live.clouds).toBe(JUICE.maxClouds[1])
    const big = juice(false).j
    for (let i = 0; i < 40; i += 1) big.star(new Vector3(), new Vector3(1, 0, 0), 1)
    expect(big.live.stars).toBe(JUICE.maxStars[0])
  })

  it("총 옵션 '별도탄 확률'·'솜사탕 구름'이 있고, 별똥 점사총·방울 산탄총은 기본으로 더 잘 터진다", () => {
    const ids = AFFIXES.map((a) => a.stat)
    expect(ids).toContain('starShot')
    expect(ids).toContain('cloud')
    const save = freshSave()
    expect(computeStats(save).starShot).toBe(0)
    const star = makeItem('gun_star', 'common', () => 0.2, 1)
    addItem(save, star, true)
    save.equipment.weapon = star.uid
    expect(computeStats(save).starShot).toBeCloseTo(GUN_JUICE.starRifle)
    star.affixes.push({ id: 'ricochet', name: '통통 튀는', stat: 'starShot', value: 0.08 })
    expect(computeStats(save).starShot).toBeCloseTo(GUN_JUICE.starRifle + 0.08)
  })

  it('일반 몹도 처치·치명타에 아주 짧은 히트스톱, 별·솜사탕 숫자는 따로 보인다', () => {
    expect(hitStopFor({ kill: true })).toBeGreaterThan(hitStopFor({ crit: true }))
    expect(hitStopFor({})).toBe(0)
    expect(numberPunch('star')).toBeGreaterThan(numberPunch('candy'))
  })
})
