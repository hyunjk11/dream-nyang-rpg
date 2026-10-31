import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Tile, distances, generateMaze, tileCentre, walkable, worldToTile } from '../src/3d/dungeon/maze'
import { TPS, createView, forwardOf, kick, look, pose, recover, rightOf, wishFrom } from '../src/3d/tps'
import { collideCircle, rayHit, solidAt } from '../src/3d/dungeon/walls'
import type { Maze } from '../src/3d/dungeon/maze'

const ray = (m: Maze) => (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => rayHit(m, ox, oy, oz, dx, dy, dz, max)
import { Sewer, wallFaces } from '../src/3d/dungeon/sewer'
import { CEILING, TILE } from '../src/3d/dungeon/maze'

describe('꿈 하수도 미궁 생성', () => {
  it('같은 시드는 같은 미궁, 다른 시드는 다른 미궁', () => {
    const a = generateMaze(7)
    const b = generateMaze(7)
    const c = generateMaze(8)
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles))
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles))
  })

  it('모든 통로가 시작 지점에서 이어지고 보스 방까지 닿는다', () => {
    for (const seed of [1, 42, 1234, 99991]) {
      const m = generateMaze(seed)
      const d = distances(m.tiles, m.w, m.h, m.start.x, m.start.y)
      for (let y = 0; y < m.h; y += 1)
        for (let x = 0; x < m.w; x += 1) if (walkable(m, x, y)) expect(d[y * m.w + x]).toBeGreaterThanOrEqual(0)
      const boss = m.bossRoom
      const bx = boss.x + Math.floor(boss.w / 2)
      const by = boss.y + Math.floor(boss.h / 2)
      expect(m.tiles[by * m.w + bx]).toBe(Tile.Boss)
      expect(d[by * m.w + bx]).toBeGreaterThan(8)
    }
  })

  it('테두리는 모두 벽이고 둥지는 통로 끝 막다른 곳에 있다', () => {
    const m = generateMaze(5)
    for (let i = 0; i < m.w; i += 1) {
      expect(walkable(m, i, 0)).toBe(false)
      expect(walkable(m, i, m.h - 1)).toBe(false)
      expect(walkable(m, 0, i)).toBe(false)
      expect(walkable(m, m.w - 1, i)).toBe(false)
    }
    expect(m.nests.length).toBeGreaterThan(0)
    for (const n of m.nests) expect(walkable(m, n.x, n.y)).toBe(true)
  })

  it('타일 중심 좌표와 월드 좌표가 서로 되돌아간다', () => {
    const m = generateMaze(3)
    const c = tileCentre(m, 4, 6)
    expect(worldToTile(m, c.x, c.z)).toEqual({ x: 4, y: 6 })
  })
})

describe('벽 충돌과 시선 광선', () => {
  const m = generateMaze(11)
  const s = tileCentre(m, m.start.x, m.start.y)

  it('벽으로 밀어붙여도 몸은 통로 안에 남는다', () => {
    for (const k of [1.45, 1.55, 1.6]) {
      const out = collideCircle(m, s.x - TILE * k, s.z - TILE * k, 0.34)
      expect(solidAt(m, out.x, out.z)).toBe(false)
      expect(solidAt(m, out.x - 0.33, out.z)).toBe(false)
      expect(solidAt(m, out.x, out.z - 0.33)).toBe(false)
    }
    const out = collideCircle(m, s.x, s.z, 0.34)
    expect(out.x).toBeCloseTo(s.x)
    expect(out.z).toBeCloseTo(s.z)
  })

  it('광선은 바닥·천장·벽에서 멈춘다', () => {
    expect(rayHit(m, s.x, 1, s.z, 0, -1, 0, 50)).toBeCloseTo(1)
    expect(rayHit(m, s.x, 1, s.z, 0, 1, 0, 50)).toBeCloseTo(CEILING - 1)
    const wall = rayHit(m, s.x, 1, s.z, -1, 0, 0, 50)
    expect(wall).toBeGreaterThan(0)
    expect(wall).toBeLessThan(TILE * 3)
    expect(rayHit(m, s.x, 1, s.z, 1, 0, 0, 0.5)).toBe(0.5)
  })

  it('벽 면은 열린 타일 쪽을 향하고 한 번의 인스턴스 묶음으로 그려진다', () => {
    const faces = wallFaces(m)
    expect(faces.length).toBeGreaterThan(50)
    for (const f of faces) expect(walkable(m, f.x, f.y)).toBe(true)
    const sewer = new Sewer(m)
    let meshes = 0
    sewer.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes += 1
    })
    expect(meshes).toBeLessThanOrEqual(4)
    sewer.dispose()
  })
})

describe('어깨 너머 3인칭 카메라', () => {
  it('마우스를 오른쪽으로 밀면 시선이 오른쪽으로 돈다', () => {
    const v = createView(0, 0)
    const before = forwardOf(v.yaw, 0)
    look(v, 120, 0, TPS.mouse)
    const after = forwardOf(v.yaw, 0)
    const r = rightOf(0)
    expect(after.x * r.x + after.z * r.z).toBeGreaterThan(before.x * r.x + before.z * r.z)
  })

  it('위아래 시선은 한계 각도에서 멈춘다', () => {
    const v = createView(0, 0)
    look(v, 0, 99999, TPS.mouse)
    expect(v.pitch).toBe(TPS.maxPitch)
    look(v, 0, -99999, TPS.mouse)
    expect(v.pitch).toBe(TPS.minPitch)
  })

  it('W는 카메라가 보는 쪽, D는 카메라 오른쪽으로 걷는다', () => {
    for (const yaw of [0, 1.1, -2.3]) {
      const f = forwardOf(yaw, 0)
      const fw = wishFrom(0, 1, yaw)
      expect(fw.x).toBeCloseTo(f.x)
      expect(fw.z).toBeCloseTo(f.z)
      const r = rightOf(yaw)
      const rw = wishFrom(1, 0, yaw)
      expect(rw.x).toBeCloseTo(r.x)
      expect(rw.z).toBeCloseTo(r.z)
    }
  })

  it('반동은 위로 튀고 시간이 지나면 돌아온다', () => {
    const v = createView(0, 0)
    for (let i = 0; i < 50; i += 1) kick(v, 0.02, 0.01)
    expect(v.kickPitch).toBeLessThanOrEqual(0.16)
    expect(Math.abs(v.kickYaw)).toBeLessThanOrEqual(0.05)
    for (let i = 0; i < 120; i += 1) recover(v, 1 / 60)
    expect(v.kickPitch).toBeLessThan(0.01)
  })

  it('넓은 방에서는 그녀가 화면 왼쪽 아래, 조준점이 화면 정중앙', () => {
    const m = generateMaze(21)
    const room = m.bossRoom
    const c = tileCentre(m, room.x + 2, room.y + 2)
    const v = createView(0.3, 0.05)
    let p = pose(v, ray(m), c.x, 0, c.z, 1)
    for (let i = 0; i < 60; i += 1) p = pose(v, ray(m), c.x, 0, c.z, 1 / 30)
    const cam = new PerspectiveCamera(TPS.fov, 16 / 9, 0.05, 80)
    cam.position.set(p.x, p.y, p.z)
    cam.lookAt(p.x + p.fx, p.y + p.fy, p.z + p.fz)
    cam.updateMatrixWorld()
    const hero = new Vector3(c.x, 1.0, c.z).project(cam)
    expect(hero.x).toBeLessThan(-0.05)
    expect(hero.z).toBeLessThan(1)
    const ahead = new Vector3(p.x + p.fx * 10, p.y + p.fy * 10, p.z + p.fz * 10).project(cam)
    expect(ahead.x).toBeCloseTo(0, 3)
    expect(ahead.y).toBeCloseTo(0, 3)
  })

  it('좁은 통로에서 뒤가 벽이면 카메라가 앞으로 당겨진다', () => {
    const m = generateMaze(21)
    const s = tileCentre(m, m.start.x, m.start.y)
    // Start room sits in the corner: looking away from the corner puts the corner wall behind her.
    const v = createView(Math.PI / 4, 0)
    for (let i = 0; i < 60; i += 1) pose(v, ray(m), s.x, 0, s.z, i ? 1 / 30 : 1)
    const back = tileCentre(m, 1, 1)
    const v2 = createView(Math.PI / 4, 0)
    let tight = pose(v2, ray(m), back.x - TILE * 0.35, 0, back.z - TILE * 0.35, 1)
    for (let i = 0; i < 60; i += 1) tight = pose(v2, ray(m), back.x - TILE * 0.35, 0, back.z - TILE * 0.35, 1 / 30)
    expect(solidAt(m, tight.x, tight.z)).toBe(false)
    expect(v2.boom).toBeLessThan(v.boom)
  })
})
