import { InstancedMesh, Mesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { generateMaze, tileCentre } from '../src/3d/dungeon/maze'
import { Decor } from '../src/3d/dungeon/dream'
import { Minimap } from '../src/3d/dungeon/minimap'
import { Portal } from '../src/3d/dungeon/portal'
import { VAULT, vaultGeometry } from '../src/3d/dungeon/sewer'
import { CEILING, TILE } from '../src/3d/dungeon/maze'

const maze = generateMaze(20261030)

function drawables(decor: Decor): number {
  let n = 0
  decor.group.traverse((o) => {
    if ((o as Mesh).isMesh || o.type === 'Points') n += 1
  })
  return n
}

describe('꿈 하수도 꾸밈', () => {
  it('아치 벽은 바닥에서 천장까지 휘어 올라가 천장 높이에서 끝난다', () => {
    const geo = vaultGeometry()
    const pos = geo.getAttribute('position')
    let top = 0
    let deepest = 0
    for (let i = 0; i < pos.count; i += 1) {
      top = Math.max(top, pos.getY(i))
      deepest = Math.max(deepest, pos.getZ(i))
    }
    expect(top).toBeCloseTo(CEILING, 3)
    expect(deepest).toBeCloseTo(VAULT, 3)
    expect(geo.getAttribute('uv').count).toBe(pos.count)
  })

  it('꾸밈은 인스턴싱으로 묶여 드로우콜이 적다', () => {
    const decor = new Decor(maze, 4)
    expect(drawables(decor)).toBeLessThanOrEqual(24)
    let instances = 0
    decor.group.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh) instances += (o as InstancedMesh).count
    })
    expect(instances).toBeGreaterThan(60)
    expect(decor.lamps.length).toBeGreaterThan(6)
    decor.dispose()
  })

  it('물길은 보스 방에 가까울수록 위상이 작아져 보스 쪽으로 흐른다', () => {
    const decor = new Decor(maze, 0)
    const water = decor.group.getObjectByName('sewer-water') as Mesh
    const pos = water.geometry.getAttribute('position')
    const phase = water.geometry.getAttribute('phase')
    const nearest = (x: number, z: number) => {
      let best = 0
      let bd = Infinity
      for (let i = 0; i < pos.count; i += 1) {
        const d = Math.hypot(pos.getX(i) - x, pos.getZ(i) - z)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      return phase.getX(best)
    }
    const s = tileCentre(maze, maze.start.x, maze.start.y)
    const b = tileCentre(maze, maze.bossRoom.x + 2, maze.bossRoom.y + 2)
    expect(nearest(s.x, s.z)).toBeGreaterThan(nearest(b.x, b.z) + TILE * 4)
    decor.dispose()
  })

  it('둥지 파이프 입구가 있어 몬스터가 쏟아질 자리가 정해진다', () => {
    const decor = new Decor(maze, 0)
    expect(decor.mouths.length).toBeGreaterThanOrEqual(3)
    for (const m of decor.mouths) expect(Math.hypot(m.dir.x, m.dir.z)).toBeCloseTo(1, 5)
    decor.dispose()
  })

  it('조명은 가까운 별 램프로만 옮겨 다닌다', () => {
    const decor = new Decor(maze, 2)
    const s = tileCentre(maze, maze.start.x, maze.start.y)
    decor.update(1, 1, new Vector3(s.x, 1, s.z))
    const lights = decor.group.children.filter((o) => o.type === 'PointLight')
    expect(lights).toHaveLength(2)
    for (const l of lights) expect(l.position.distanceTo(new Vector3(s.x, 1, s.z))).toBeLessThan(TILE * 6)
    decor.dispose()
  })
})

describe('미니맵과 포털', () => {
  it('미니맵은 그녀 주변 타일만 밝혀 나간다', () => {
    const map = new Minimap(maze, null)
    const s = tileCentre(maze, maze.start.x, maze.start.y)
    expect(map.reveal(s.x, s.z)).toBe(true)
    expect(map.reveal(s.x, s.z)).toBe(false)
    const seen = map.seen.reduce((a, v) => a + v, 0)
    expect(seen).toBe(25)
    map.dispose()
  })

  it('포털은 반경 안에서만, 켜져 있을 때만 들어갈 수 있다', () => {
    const p = new Portal(new Vector3(3, 0, 4))
    expect(p.contains(3.5, 4.2)).toBe(true)
    expect(p.contains(5, 4)).toBe(false)
    p.group.visible = false
    expect(p.contains(3, 4)).toBe(false)
    p.dispose()
  })
})
