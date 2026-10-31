import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ASSIST, SENS, TPS, assistPick, clampSens, createView, perPixel, pose, rayCapsule, type AimTarget } from '../src/3d/tps'
import { ShoulderRig, type AimWorld } from '../src/3d/shooter'
import { DIFFICULTY, waveSize } from '../src/3d/difficulty'
import { waveFor, REST, LIVE_CAP } from '../src/3d/dungeon/waves'
import { HORDE, Horde } from '../src/3d/dungeon/horde'
import { BOSS } from '../src/3d/dungeon/boss'
import { generateMaze, tileCentre } from '../src/3d/dungeon/maze'

const sources = import.meta.glob('../src/3d/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const mainSrc = sources['../src/3d/main.ts']

function rigAt(yaw: number, pitch: number): { rig: ShoulderRig; cam: PerspectiveCamera } {
  const cam = new PerspectiveCamera(TPS.fov, 16 / 9, 0.05, 80)
  const rig = new ShoulderRig(cam, yaw, pitch)
  rig.place(1, 0, 0, 0, null)
  return { rig, cam }
}

const open: AimWorld['solid'] = (_ox, _oy, _oz, _dx, _dy, _dz, max) => max

describe('마을·던전 공용 숄더 조준', () => {
  it('조준점은 언제나 카메라 정중앙 광선 위에 있다 (적이 정중앙이면 그 몸에 꽂힌다)', () => {
    const { rig, cam } = rigAt(0, 0)
    const f = cam.getWorldDirection(new Vector3())
    const o = cam.position.clone()
    const at = o.clone().addScaledVector(f, 9)
    const foe: AimTarget = { x: at.x, z: at.z, y0: at.y - 0.4, y1: at.y + 0.4, r: 0.4 }
    rig.aimFrom({ solid: open, targets: () => [foe] }, 1 / 60)
    expect(rig.onTarget).toBe(true)
    const v = rig.aim.clone().project(cam)
    expect(Math.abs(v.x)).toBeLessThan(1e-3)
    expect(Math.abs(v.y)).toBeLessThan(1e-3)
    // The point is the front of the body, not the wall behind it (the old parallax miss).
    expect(rig.aimDistance).toBeLessThan(9)
    expect(rig.aimDistance).toBeGreaterThan(8.3)
  })

  it('총구에서 조준점으로 쏜 물방울은 화면 중앙 조준선과 같은 점에 맞는다', () => {
    const { rig, cam } = rigAt(0.4, 0.1)
    rig.aimFrom({ solid: (_a, _b, _c, _d, _e, _f, max) => Math.min(max, 14), targets: () => [] }, 1 / 60)
    // Muzzle sits low and to the side of the lens; the line from it to the aim point still ends at the centre.
    const muzzle = new Vector3(0.35, 1.0, 0.2)
    const end = muzzle.clone().add(rig.aim.clone().sub(muzzle))
    const v = end.project(cam)
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1e-3)
  })

  it('살짝 빗나가도 보조 원뿔 안의 적에게는 자석처럼 붙고, 시점이 조금 느려진다', () => {
    const { rig, cam } = rigAt(0, 0)
    const f = cam.getWorldDirection(new Vector3())
    const o = cam.position.clone()
    const at = o.clone().addScaledVector(f, 10)
    const foe: AimTarget = { x: at.x + 0.6, z: at.z, y0: at.y - 0.4, y1: at.y + 0.4, r: 0.4 }
    rig.aimFrom({ solid: open, targets: () => [foe] }, 1 / 60)
    expect(rig.onTarget).toBe(false)
    expect(rig.near).toBe(true)
    expect(rig.aim.x).toBeCloseTo(foe.x, 3)
    const before = rig.view.yaw
    rig.look(10, 0, false)
    expect(Math.abs(rig.view.yaw - before)).toBeCloseTo(10 * TPS.mouse * SENS.value * ASSIST.friction, 6)
  })

  it('멀리 비껴간 적이나 벽 뒤의 적에는 보조가 붙지 않는다', () => {
    const o = { x: 0, y: 1.5, z: 0 }
    const far: AimTarget = { x: 3, z: 10, y0: 1, y1: 2, r: 0.4 }
    expect(assistPick(o.x, o.y, o.z, 0, 0, 1, [far], 60)).toBeNull()
    const behind: AimTarget = { x: 0.3, z: 10, y0: 1, y1: 2, r: 0.4 }
    expect(assistPick(o.x, o.y, o.z, 0, 0, 1, [behind], 60)).not.toBeNull()
    expect(assistPick(o.x, o.y, o.z, 0, 0, 1, [behind], 5)).toBeNull()
  })

  it('세로 캡슐 광선 판정: 정면은 맞고, 높이 밖이나 옆은 빗나간다', () => {
    const t: AimTarget = { x: 0, z: 5, y0: 0, y1: 1, r: 0.5 }
    expect(rayCapsule(0, 0.5, 0, 0, 0, 1, t, 60)).toBeCloseTo(4.5, 5)
    expect(rayCapsule(0, 1.8, 0, 0, 0, 1, t, 60)).toBe(-1)
    expect(rayCapsule(2, 0.5, 0, 0, 0, 1, t, 60)).toBe(-1)
    expect(rayCapsule(0, 0.5, 0, 0, 0, 1, t, 3)).toBe(-1)
  })

  it('카메라는 그녀에게 고정(지연 없음): 한 프레임 만에 정해진 숄더 위치에 선다', () => {
    const v = createView(0.7, 0.1)
    const a = pose(v, null, 3, 0, -2, 1 / 60)
    const b = pose(v, null, 3, 0, -2, 1 / 60)
    expect(a).toEqual(b)
    // Lens sits behind and to her right, a little above her head.
    expect(Math.hypot(a.x - 3, a.z + 2)).toBeGreaterThan(TPS.back * 0.8)
    expect(a.y).toBeGreaterThan(TPS.height)
  })

  it('던전 적: 조준선이 몸 위에 있으면 물방울도 그 몸에 맞는다 (같은 캡슐)', () => {
    const m = generateMaze(11)
    const h = new Horde(m)
    const c = tileCentre(m, m.start.x, m.start.y)
    const f = h.spawn('slime', c.x, c.z + 2)!
    f.age = 5
    const cap = h.capsule(f)
    // Ray from a lens 3 m back and above, aimed at the upper rim of the body.
    for (const y of [cap.y0 + 0.05, (cap.y0 + cap.y1) / 2, cap.y1 - 0.05]) {
      const o = new Vector3(c.x, 1.9, c.z - 2)
      const goal = new Vector3(c.x, y, c.z + 2 - cap.r + 0.01)
      const t = rayCapsule(o.x, o.y, o.z, ...goal.clone().sub(o).normalize().toArray(), cap, 60)
      expect(t).toBeGreaterThan(0)
      const aim = o.clone().addScaledVector(goal.clone().sub(o).normalize(), t)
      // A muzzle low and to the right sends its droplet at that aim point: it must hit the same foe.
      const tip = new Vector3(c.x + 0.4, 1.1, c.z - 1.2)
      const d = aim.clone().sub(tip)
      const len = d.length()
      d.normalize()
      const hit = h.raycast(tip.x, tip.y, tip.z, d.x, d.y, d.z, len + 0.5)
      expect(hit?.foe).toBe(f)
    }
  })

  it('감도는 0.3~2.5 사이로 저장되고, 마우스·터치 각속도에 곱해진다', () => {
    expect(clampSens(9)).toBe(SENS.max)
    expect(clampSens(0.01)).toBe(SENS.min)
    expect(perPixel(false, 1, 2)).toBeCloseTo(TPS.mouse * 2, 9)
    expect(perPixel(true, 0.5, 1)).toBeCloseTo(TPS.touch * 0.5, 9)
    // Default is calmer than the old 0.0024 rad/px.
    expect(TPS.mouse).toBeLessThan(0.0024)
  })

  it('마을도 던전과 같은 숄더 카메라·물총을 쓴다 (쿼터뷰 follow/orbit 없음)', () => {
    expect(mainSrc).toContain('rig.place(')
    expect(mainSrc).toContain('rig.aimFrom(townWorld')
    expect(mainSrc).toContain('shooter.update(dt, firing, townWorld)')
    expect(mainSrc).not.toContain('stage.follow(')
    expect(mainSrc).not.toContain('stage.orbit(')
    expect(mainSrc).toContain('shooter,')
  })
})

describe('난이도 완화 (difficulty.ts 한곳)', () => {
  it('첫 웨이브는 작고, 뒤로 갈수록 커진다', () => {
    expect(waveSize(1)).toBeLessThan(14)
    for (let n = 1; n < 10; n += 1) expect(waveSize(n + 1)).toBeGreaterThanOrEqual(waveSize(n))
    expect(waveFor(1).total).toBe(waveSize(1))
    expect(waveFor(2).elites).toBe(0)
    expect(REST).toBeGreaterThan(4)
    expect(LIVE_CAP).toBeLessThan(200)
  })

  it('무리는 덜 아프게, 덜 단단하게 스폰된다', () => {
    const m = generateMaze(7)
    const h = new Horde(m)
    const c = tileCentre(m, m.start.x, m.start.y)
    const f = h.spawn('bug', c.x, c.z)
    expect(f).not.toBeNull()
    expect(f!.damage).toBeLessThan(HORDE.bug.damage)
    expect(f!.maxHp).toBeLessThan(HORDE.bug.hp)
    expect(BOSS.hp).toBeLessThan(1400)
    expect(BOSS.orbDamage).toBeLessThan(8)
  })

  it('별하는 체력이 늘고, 맞은 뒤 무적이 길며, 잠시 안 맞으면 회복한다', () => {
    expect(DIFFICULTY.hero.maxHp).toBeGreaterThan(100)
    expect(DIFFICULTY.hero.iframes).toBeGreaterThan(0.45)
    expect(DIFFICULTY.hero.regenRate).toBeGreaterThan(0)
  })
})
