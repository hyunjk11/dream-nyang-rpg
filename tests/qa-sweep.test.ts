import { describe, expect, it } from 'vitest'
import { ACTIVES, TREE_BY_ID, hotbarName } from '../src/data/tree'
import { BOSS_FLOOR, Delve } from '../src/sim/delve'
import { freshSave } from '../src/sim/mutate'
import { summaryLines } from '../src/ui/summary'

const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: URL, enc: string) => string }
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

describe('자체 QA 스윕에서 찾은 버그', () => {
  it('핫바 스킬 이름은 버튼에 들어가게 5글자 이하다 (하트 사탕 오라 → 사탕 오라)', () => {
    for (const id of ACTIVES) expect(hotbarName(TREE_BY_ID[id]).length).toBeLessThanOrEqual(5)
    expect(hotbarName(TREE_BY_ID.candy_aura)).toBe('사탕 오라')
    expect(TREE_BY_ID.candy_aura.name).toBe('하트 사탕 오라')
  })

  it('핫바 이름이 넘치면 말줄임, 조작 안내는 낱말 중간에서 줄바꿈하지 않는다', () => {
    const css = read('../src/ui/style.css')
    expect(css).toMatch(/#hint \{[^}]*word-break: keep-all/)
    expect(css).toMatch(/#hotbar b \{[^}]*text-overflow: ellipsis/)
  })

  it('보스만 잡고 끝내도 요약의 처치 수에 보스가 들어간다 (한 번만)', () => {
    const save = freshSave()
    const run = Delve.start(save, 1, BOSS_FLOOR)!
    run.bossCleared(save)
    run.bossCleared(save)
    const sum = run.finish(save, 'clear', 2)
    expect(sum.kills).toBe(1)
    expect(summaryLines(sum).stats.find(([k]) => k === '처치')?.[1]).toBe('1마리')
  })
})
