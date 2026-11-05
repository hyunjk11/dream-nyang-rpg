import { describe, expect, it } from 'vitest'
import { engageFor } from '../src/data/guns'
import { HUNT_ENGAGE, HUNT_LOOT, aimAt, autoHuntAfterKey, huntAllowed, huntIsTown, planHunt, stepAim, type HuntQuery, type HuntSkill } from '../src/sim/autohunt'
import type { HuntGrid } from '../src/sim/huntpath'

function query(over: Partial<HuntQuery> = {}): HuntQuery {
  return {
    active: true,
    px: 0,
    pz: 0,
    yaw: 0,
    pitch: 0.1,
    time: 0,
    hp: 100,
    maxHp: 100,
    kind: 'water',
    foes: [],
    drops: [],
    skills: [],
    manual: false,
    manualX: 0,
    manualZ: 0,
    sinceDash: 10,
    ...over,
  }
}

/** 4 m tiles. Wall on (1,1) so the diagonal from (0,0) to (2,2) is blocked. */
function cornerGrid(): HuntGrid {
  return {
    w: 4,
    h: 4,
    open: (x, y) => x >= 0 && y >= 0 && x < 4 && y < 4 && !(x === 1 && y === 1),
    toTile: (x, z) => ({ x: Math.floor(x / 4), y: Math.floor(z / 4) }),
    toWorld: (x, y) => ({ x: x * 4 + 2, z: y * 4 + 2 }),
  }
}

function openRow(n: number): HuntGrid {
  return {
    w: n,
    h: 3,
    open: (x, y) => x >= 0 && y >= 0 && x < n && y < 3,
    toTile: (x, z) => ({ x: Math.floor(x / 4), y: Math.floor(z / 4) }),
    toWorld: (x, y) => ({ x: x * 4 + 2, z: y * 4 + 2 }),
  }
}

const dot = (x: number, z: number, tx: number, tz: number) => {
  const l = Math.hypot(tx, tz) || 1
  return (x * tx + z * tz) / l
}

describe('자동 사냥', () => {
  it('꺼져 있거나 마을·대화·메뉴·죽음·귀환 중에는 입력을 건드리지 않는다', () => {
    const off = planHunt(query({ active: false, foes: [{ x: 4, z: 0, r: 0.4, hp: 10, priority: 0 }] }))
    expect(off.active).toBe(false)
    expect(off.fire).toBe(false)
    expect(off.wishX).toBe(0)
    expect(huntAllowed({ on: true, alive: true, talking: false, menu: false, town: false, recalling: false })).toBe(true)
    expect(huntAllowed({ on: false, alive: true, talking: false, menu: false, town: false, recalling: false })).toBe(false)
    expect(huntAllowed({ on: true, alive: false, talking: false, menu: false, town: false, recalling: false })).toBe(false)
    expect(huntAllowed({ on: true, alive: true, talking: true, menu: false, town: false, recalling: false })).toBe(false)
    expect(huntAllowed({ on: true, alive: true, talking: false, menu: true, town: false, recalling: false })).toBe(false)
    expect(huntAllowed({ on: true, alive: true, talking: false, menu: false, town: true, recalling: false })).toBe(false)
    expect(huntAllowed({ on: true, alive: true, talking: false, menu: false, town: false, recalling: true })).toBe(false)
  })

  it('V만 토글하고, 이동 키나 키 반복은 끄지 않는다', () => {
    expect(autoHuntAfterKey(false, 'KeyV', false)).toBe(true)
    expect(autoHuntAfterKey(true, 'KeyV', false)).toBe(false)
    expect(autoHuntAfterKey(true, 'KeyV', true)).toBe(true)
    expect(autoHuntAfterKey(true, 'KeyW', false)).toBe(true)
    expect(autoHuntAfterKey(true, 'KeyR', false)).toBe(true)
  })

  it('가까운 괴물 쪽으로 다가가 방아쇠를 당기고, 사거리 밖은 쫓지 않는다', () => {
    const water = engageFor('water', false)
    const near = planHunt(query({ foes: [{ x: water.sweet + 4, z: 0, r: 0.4, hp: 20, priority: 0 }] }))
    expect(near.fire).toBe(true)
    expect(dot(near.wishX, near.wishZ, 1, 0)).toBeGreaterThan(0.7)
    expect(near.running).toBe(true)
    const past = planHunt(query({ foes: [{ x: 0, z: water.far + 8, r: 0.4, hp: 20, priority: 0 }] }))
    expect(past.fire).toBe(false)
    expect(past.wishX).toBe(0)
    expect(past.wishZ).toBe(0)
    const gone = planHunt(query({ foes: [{ x: HUNT_ENGAGE + 5, z: 0, r: 0.4, hp: 20, priority: 0 }] }))
    expect(gone.fire).toBe(false)
    expect(gone.wishX).toBe(0)
  })

  it('정예가 조금 더 멀어도 잡몹보다 우선이고, 저격은 거리를 벌린다', () => {
    const picked = planHunt(query({
      foes: [
        { x: 10, z: 0, r: 0.4, hp: 20, priority: 0 },
        { x: 8, z: 10, r: 0.5, hp: 80, priority: 1 },
      ],
    }))
    const aim = aimAt(0, 0, 8, 10)
    expect(picked.aimYaw).toBeCloseTo(aim.yaw, 5)
    const kite = planHunt(query({ kind: 'dart', foes: [{ x: 4, z: 0, r: 0.4, hp: 40, priority: 0 }] }))
    expect(kite.fire).toBe(true)
    expect(dot(kite.wishX, kite.wishZ, 1, 0)).toBeLessThan(-0.5)
    const shotgun = planHunt(query({ kind: 'bubble', foes: [{ x: 11, z: 0, r: 0.4, hp: 20, priority: 0 }] }))
    expect(shotgun.fire).toBe(true)
    expect(dot(shotgun.wishX, shotgun.wishZ, 1, 0)).toBeGreaterThan(0.5)
  })

  it('방아쇠를 누르고 있는 것만으로 연사·점사·저격·쌍권총이 각자 간격대로 나간다', () => {
    for (const kind of ['water', 'bubble', 'star', 'dart'] as const) {
      const plan = planHunt(query({ kind, foes: [{ x: 5, z: 1, r: 0.4, hp: 10, priority: 0 }] }))
      expect(plan.fire, kind).toBe(true)
    }
  })

  it('위협이 없으면 가까운 전리품으로 걷고, 먼 전리품은 따라가지 않는다', () => {
    const loot = planHunt(query({ drops: [{ x: 2, z: 2 }, { x: 30, z: 0 }] }))
    expect(loot.fire).toBe(false)
    expect(dot(loot.wishX, loot.wishZ, 1, 1)).toBeGreaterThan(0.9)
    const far = planHunt(query({ drops: [{ x: HUNT_LOOT + 2, z: 0 }] }))
    expect(far.wishX).toBe(0)
    const fight = planHunt(query({
      foes: [{ x: engageFor('water').sweet + 6, z: 0, r: 0.4, hp: 10, priority: 0 }],
      drops: [{ x: 6, z: 0 }],
    }))
    expect(fight.fire).toBe(true)
    expect(dot(fight.wishX, fight.wishZ, 1, 0)).toBeGreaterThan(0.5)
  })

  it('스틱을 밀면 그 방향으로 걷고, 조준과 사격은 계속한다', () => {
    const plan = planHunt(query({
      manual: true,
      manualX: 0,
      manualZ: -1,
      foes: [{ x: 6, z: 0, r: 0.4, hp: 10, priority: 0 }],
    }))
    expect(plan.wishZ).toBe(-1)
    expect(plan.fire).toBe(true)
    expect(plan.running).toBe(false)
    expect(plan.dash).toBe(false)
  })

  it('준비된 스킬만 쓴다: 체력이 낮으면 오라, 무리가 있으면 폭탄, 쿨이면 없음', () => {
    const skills: HuntSkill[] = [
      { slot: 0, kind: 'bomb', ready: true },
      { slot: 1, kind: 'overdrive', ready: false },
      { slot: 2, kind: 'rush', ready: false },
      { slot: 3, kind: 'aura', ready: true },
    ]
    const hurt = planHunt(query({
      hp: 40,
      skills,
      foes: [{ x: 6, z: 0, r: 0.4, hp: 10, priority: 0 }],
    }))
    expect(hurt.skill).toBe(3)
    const pack = planHunt(query({
      skills: skills.map((s) => (s.kind === 'aura' ? { ...s, ready: false } : s)),
      foes: [
        { x: 5, z: 0, r: 0.4, hp: 10, priority: 0 },
        { x: 5, z: 2, r: 0.4, hp: 10, priority: 0 },
      ],
    }))
    expect(pack.skill).toBe(0)
    const cooling = planHunt(query({
      skills: skills.map((s) => ({ ...s, ready: false })),
      foes: [{ x: 5, z: 0, r: 0.4, hp: 10, priority: 1 }],
    }))
    expect(cooling.skill).toBe(-1)
  })

  it('사거리는 engageFor 하나다: sweet에 머물고 far 밖은 안 쫓는다', () => {
    const dual = engageFor('water', true)
    const solo = engageFor('water', false)
    const dart = engageFor('dart')
    const bubble = engageFor('bubble')
    expect(dual.sweet).toBeLessThan(solo.sweet)
    expect(dual.far).toBeLessThan(solo.far)
    expect(bubble.sweet).toBeLessThan(solo.sweet)
    expect(dart.sweet).toBeGreaterThan(solo.sweet)
    expect(dart.far).toBeGreaterThan(bubble.far)
    const paired = planHunt(query({ kind: 'water', paired: true, foes: [{ x: 9, z: 0, r: 0.4, hp: 10, priority: 0 }] }))
    const alone = planHunt(query({ kind: 'water', foes: [{ x: 9, z: 0, r: 0.4, hp: 10, priority: 0 }] }))
    expect(dot(paired.wishX, paired.wishZ, 1, 0)).toBeGreaterThan(0.5)
    expect(Math.abs(dot(alone.wishX, alone.wishZ, 1, 0))).toBeLessThan(0.35)
    const hold = planHunt(query({ kind: 'dart', foes: [{ x: 22, z: 0, r: 0.4, hp: 40, priority: 0 }] }))
    expect(hold.fire).toBe(true)
    expect(Math.abs(dot(hold.wishX, hold.wishZ, 1, 0))).toBeLessThan(0.35)
    const reach = planHunt(query({ kind: 'dart', foes: [{ x: 34, z: 0, r: 0.4, hp: 40, priority: 0 }] }))
    expect(dot(reach.wishX, reach.wishZ, 1, 0)).toBeGreaterThan(0.5)
  })

  it('미로 모서리에서는 벽 타일이 아니라 열린 칸으로 걷고, 벽 너머는 쏘지 않는다', () => {
    const grid = cornerGrid()
    const plan = planHunt(query({
      kind: 'bubble',
      px: 2,
      pz: 2,
      grid,
      foes: [{ x: 10, z: 10, r: 0.4, hp: 20, priority: 0 }],
    }))
    expect(plan.fire).toBe(false)
    expect(Math.min(Math.abs(plan.wishX), Math.abs(plan.wishZ))).toBeLessThan(0.2)
    const step = grid.toTile(2 + plan.wishX * 4, 2 + plan.wishZ * 4)
    expect(grid.open(step.x, step.y)).toBe(true)
    expect(step.x === 1 && step.y === 1).toBe(false)
  })

  it('던전에서는 far 밖의 무리까지 길을 따라가고, 열린 땅에서는 그 밖에서 멈춘다', () => {
    const grid = openRow(16)
    const seek = planHunt(query({
      kind: 'bubble',
      px: 2,
      pz: 2,
      grid,
      foes: [{ x: 40, z: 2, r: 0.4, hp: 20, priority: 0 }],
    }))
    expect(seek.fire).toBe(false)
    expect(seek.wishX).toBeGreaterThan(0.5)
    const idle = planHunt(query({ kind: 'bubble', foes: [{ x: 40, z: 0, r: 0.4, hp: 20, priority: 0 }] }))
    expect(idle.wishX).toBe(0)
    expect(idle.fire).toBe(false)
  })

  it('싸우는 중인 런은 마을이 아니고, 세워 둔 층·몽실·마을은 쉰다', () => {
    expect(huntIsTown({ parked: false, mongsil: false, inRun: true, village: false })).toBe(false)
    expect(huntIsTown({ parked: false, mongsil: false, inRun: true, village: true })).toBe(false)
    expect(huntIsTown({ parked: true, mongsil: false, inRun: true, village: false })).toBe(true)
    expect(huntIsTown({ parked: false, mongsil: true, inRun: true, village: false })).toBe(true)
    expect(huntIsTown({ parked: false, mongsil: false, inRun: false, village: true })).toBe(true)
    expect(huntAllowed({ on: true, alive: true, talking: false, menu: false, town: huntIsTown({ parked: false, mongsil: false, inRun: true, village: false }), recalling: false })).toBe(true)
  })

  it('시선은 목표 쪽으로만 조금씩 돈다', () => {
    const want = aimAt(0, 0, 10, 0)
    const step = stepAim(0, 0.1, want.yaw, want.pitch, 0.016)
    expect(Math.abs(step.yaw)).toBeGreaterThan(0)
    expect(Math.abs(step.yaw)).toBeLessThan(Math.abs(want.yaw))
    const held = stepAim(want.yaw, want.pitch, want.yaw, want.pitch, 0.05)
    expect(held.yaw).toBeCloseTo(want.yaw, 5)
  })
})
