import { describe, expect, it } from 'vitest'
import { CUES, MUSIC, musicGains, pickVariant, stepMusic } from '../src/3d/soundplan'
import { particleAlpha, stepParticle } from '../src/3d/vfx'

const assets = Object.keys(import.meta.glob('../public/assets/**/*.{mp3,wav}', { query: '?url' })).map((p) => p.replace('../public/assets/', ''))
const credits = Object.values(import.meta.glob('../CREDITS.md', { query: '?raw', import: 'default', eager: true }))[0] as string

describe('효과음과 음악', () => {
  it('모든 효과음 파일이 실제로 들어 있다', () => {
    for (const [name, cue] of Object.entries(CUES)) for (const file of cue.files) expect(assets, name).toContain(file)
    expect(assets).toContain(MUSIC.village)
    expect(assets).toContain(MUSIC.battle)
  })

  it('외부 효과음은 CREDITS 에 출처와 CC0 가 적혀 있다', () => {
    expect(credits).toContain('Kenney')
    expect(credits).toContain('CC0')
    expect(credits).toContain('audio3d')
  })

  it('같은 변형이 두 번 연속으로 나오지 않는다', () => {
    for (let last = 0; last < 4; last += 1) for (const roll of [0, 0.3, 0.6, 0.99]) expect(pickVariant(4, last, roll)).not.toBe(last)
    expect(pickVariant(1, 0, 0.7)).toBe(0)
  })

  it('적이 다가오면 전투 곡으로, 조용해지면 마을 곡으로 천천히 넘어간다', () => {
    let state = { mix: 0, calm: MUSIC.calm }
    state = stepMusic(state, 0.1, true)
    expect(state.mix).toBeGreaterThan(0)
    expect(state.mix).toBeLessThan(0.2)
    for (let i = 0; i < 40; i += 1) state = stepMusic(state, 0.05, true)
    expect(state.mix).toBe(1)
    for (let i = 0; i < 20; i += 1) state = stepMusic(state, 0.1, false)
    expect(state.mix).toBe(1)
    for (let i = 0; i < 60; i += 1) state = stepMusic(state, 0.1, false)
    expect(state.mix).toBe(0)
  })

  it('크로스페이드는 등전력이라 중간에도 소리가 꺼지지 않는다', () => {
    for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
      const g = musicGains(mix)
      expect(g.village ** 2 + g.battle ** 2).toBeCloseTo(1, 6)
    }
  })
})

describe('이펙트 입자', () => {
  it('중력으로 떨어져 땅에서 멈추고 수명이 다하면 사라진다', () => {
    const p = { x: 0, y: 1, z: 0, vx: 1, vy: 0, vz: 0, age: 0, life: 1, drag: 0, gravity: 10 }
    for (let i = 0; i < 30; i += 1) stepParticle(p, 0.02)
    expect(p.y).toBeGreaterThanOrEqual(0.02)
    expect(p.y).toBeLessThan(1)
    expect(p.x).toBeGreaterThan(0.5)
    expect(stepParticle(p, 1)).toBe(false)
  })

  it('알파는 금방 켜지고 끝에서 0 으로 사라진다', () => {
    expect(particleAlpha(0, 1)).toBe(0)
    expect(particleAlpha(0.1, 1)).toBeGreaterThan(0.7)
    expect(particleAlpha(1, 1)).toBe(0)
    for (let t = 0; t <= 1; t += 0.05) expect(particleAlpha(t, 1)).toBeLessThanOrEqual(1)
  })
})
