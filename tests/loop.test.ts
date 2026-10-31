import { describe, expect, it } from 'vitest'
import { INTRO } from '../src/data/story'
import { ZONES } from '../src/data/zones'
import { WALK_RADIUS } from '../src/world/town/island'
import { GameState, SAVE_KEY_3D, killLoot } from '../src/core/loop'
import { insidePlace, placesFor } from '../src/world/town/places'
import { finishActions, talkStep } from '../src/ui/talk'
import { PORTAL_ARRIVAL, ZONE_IDS, destinations, zone3d } from '../src/world/town/zones3d'

const intro = Object.keys(import.meta.glob('../public/assets/*.jpg', { query: '?url' })).map((p) => p.split('/').pop())

function memory() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

/** Play the prologue the way the 3D loop does: meet Mochi, sleep the slime, walk into the village. */
function prologue(game: GameState): void {
  game.run(talkStep('mochi_meet', 99).actions)
  game.kill('slime', ['tutorial'])
  game.enter('village')
}

describe('3D 존', () => {
  it('2D 존 다섯 곳을 이름과 음악 그대로 옮긴다', () => {
    for (const id of ZONE_IDS) {
      const zone = zone3d(id)
      expect(zone.name).toBe(ZONES[id].name)
      expect(zone.bgm).toBe(ZONES[id].bgm)
      expect(zone.foes).toHaveLength(ZONES[id].enemies.length)
    }
    expect(zone3d('village').foes).toHaveLength(0)
    expect(zone3d('altar').foes.map((f) => f.kind)).toEqual(['bloom'])
    expect(zone3d('vale').foes.filter((f) => f.elite)).toHaveLength(2)
  })

  it('적과 줍기 물건은 섬 안, 건물 밖, 도착 지점에서 떨어져 있다', () => {
    for (const id of ZONE_IDS) {
      const zone = zone3d(id)
      for (const p of [...zone.foes, ...zone.pickups]) {
        expect(Math.hypot(p.x, p.z)).toBeLessThan(WALK_RADIUS - 1)
        expect(insidePlace(p.x, p.z, placesFor(id))).toBe(false)
        expect(Math.hypot(p.x - PORTAL_ARRIVAL.x, p.z - PORTAL_ARRIVAL.z)).toBeGreaterThan(3.5)
      }
    }
  })

  it('마을 밖에서는 집과 마을 사람이 사라지고 별문은 남는다', () => {
    const wild = placesFor('forest').map((p) => p.kind)
    expect(wild).toContain('portal')
    expect(wild).not.toContain('kiki')
    expect(wild).not.toContain('house')
    expect(placesFor('village').map((p) => p.kind)).toContain('luna')
  })
})

describe('게임 루프', () => {
  it('인트로 그림 세 장이 모두 들어 있다', () => {
    expect(INTRO).toHaveLength(3)
    for (const slide of INTRO) expect(intro).toContain(`${slide.image}.jpg`)
    expect(intro).toContain('title_bg.jpg')
  })

  it('튜토리얼 슬라임을 잠재워야 초원 별문이 열린다', () => {
    const game = new GameState()
    expect(game.zone).toBe('meadow')
    expect(destinations(game.save, 'meadow')).toEqual([])
    game.kill('slime', ['tutorial'])
    expect(destinations(game.save, 'meadow').map((d) => d.to)).toEqual(['village'])
  })

  it('마을에 도착하면 첫 기록이 자동으로 끝나고 숲이 열린다', () => {
    const game = new GameState()
    prologue(game)
    expect(game.save.quests.q_awaken.status).toBe('turnedIn')
    expect(game.save.gold).toBeGreaterThan(30)
    expect(destinations(game.save, 'village').map((d) => d.to)).toEqual(['meadow', 'forest'])
    expect(game.marker('luna')).toBe('!')
    expect(game.dialogueFor('kiki')).toBe('kiki_offer')
  })

  it('루나의 꿈가루 의뢰를 받고, 숲에서 모아 보고하면 제단이 열린다', () => {
    const game = new GameState()
    prologue(game)
    expect(game.dialogueFor('luna')).toBe('luna_offer')
    const offer = talkStep('luna_offer', 2).choices[0]
    game.run(finishActions('luna_offer', offer))
    expect(game.save.quests.q_dust.status).toBe('active')
    game.enter('forest')
    for (let i = 0; i < 8; i += 1) game.kill('slime', ['wild'])
    for (let i = 0; i < 5; i += 1) game.pickup('dream_dust')
    expect(game.save.quests.q_dust.status).toBe('completed')
    expect(game.marker('luna')).toBe('?')
    const go = talkStep('luna_dust_done', 2).choices[0]
    game.run(finishActions('luna_dust_done', go))
    expect(game.save.quests.q_dust.status).toBe('turnedIn')
    expect(game.save.quests.q_bloom.status).toBe('active')
    expect(destinations(game.save, 'village').map((d) => d.to)).toEqual(['meadow', 'forest', 'vale', 'altar'])
  })

  it('제단 별문은 블룸이 깨어 있는 동안 봉인된다', () => {
    const game = new GameState()
    expect(destinations(game.save, 'altar', true)).toEqual([])
    expect(destinations(game.save, 'altar', false).map((d) => d.to)).toEqual(['village'])
  })

  it('블룸을 잠재우고 루나에게 알리면 이야기가 끝난다', () => {
    const game = new GameState()
    prologue(game)
    game.save.quests.q_dust.status = 'turnedIn'
    game.save.quests.q_bloom.status = 'active'
    game.kill('bloom', ['boss'])
    expect(game.dialogueFor('luna')).toBe('luna_bloom_done')
    game.run(finishActions('luna_bloom_done', null))
    expect(game.finished).toBe(true)
  })

  it('정예는 늘 장난감 부품을, 숲 괴물은 가끔 꿈가루를 떨군다', () => {
    expect(killLoot('vale', ['wild'], 'swift', 0.9)).toEqual(['toy_part'])
    expect(killLoot('forest', ['wild'], undefined, 0.2)).toEqual(['dream_dust'])
    expect(killLoot('forest', ['wild'], undefined, 0.8)).toEqual([])
    expect(killLoot('meadow', ['tutorial'], undefined, 0.1)).toEqual([])
  })

  it('쓰러지면 골드를 조금 잃고 마을에서 깨어난다', () => {
    const game = new GameState()
    prologue(game)
    game.enter('forest')
    const gold = game.save.gold
    const { lost, home } = game.died()
    expect(home).toBe('village')
    expect(lost).toBe(Math.floor(gold * 0.1))
  })

  it('3D 전용 칸에 저장하고 그대로 불러온다', () => {
    const store = memory()
    const game = new GameState()
    prologue(game)
    game.persist(store)
    expect([...store.data.keys()]).toEqual([SAVE_KEY_3D])
    const back = GameState.load(store)
    expect(back?.zone).toBe('village')
    expect(back?.save.quests.q_awaken.status).toBe('turnedIn')
    expect(GameState.load(memory())).toBeNull()
    store.setItem(SAVE_KEY_3D, '{broken')
    expect(GameState.load(store)).toBeNull()
  })
})
