// 퀘스트 수첩 점검: questBook + HUD tracker at four story points. Run: npx vite-node tools/quest-audit.ts
import { freshSave } from '../src/sim/mutate'
import { skipGuide, takeQuest, chaptersOf } from '../src/sim/chapters'
import { enterMaze, passMaze, storyTalk, storyEvent, dreamOf, STORY } from '../src/sim/dreamstory'
import { boardOf, takeContract } from '../src/sim/contracts'
import { questBook, trackedQuests, pinsOf } from '../src/sim/questbook'
import { startQuest } from '../src/sim/quests'
import { mulberry32 } from '../src/sim/rng'
import type { SaveData } from '../src/sim/types'

const r = mulberry32(7)
function show(tag: string, save: SaveData): void {
  const book = questBook(save)
  console.log(`\n== ${tag} (챕터 ${chaptersOf(save).current})`)
  for (const q of book) console.log(`  [${q.group}] ${q.title} | ${q.line} | ${q.prog} | ${(q as { area?: string }).area ?? '-'}`)
  console.log('  HUD:', trackedQuests(book, pinsOf(save)).shown.map((q) => q.title).join(' / '))
}
const a = freshSave()
show('1장 시작', a)
const b = freshSave()
skipGuide(b)
startQuest(b, 'q_dust', r)
startQuest(b, 'q_parts', r)
enterMaze(b)
show('꿈 미로 안', b)
passMaze(b)
show('꿈 미로 뒤', b)
const c = b
storyTalk(c, r)
for (const id of ['c2_slime', 'c2_bat']) takeQuest(c, id)
const k = boardOf(c, r)[0]
if (k) takeContract(c, k.id)
show('몽실 마을', c)
const d = c
for (let i = 0; i < 12 && !dreamOf(d).story.done; i++) {
  const q = STORY[dreamOf(d).story.step]
  if (!q) break
  if (dreamOf(d).story.state === 'offer' || dreamOf(d).story.state === 'ready') { storyTalk(d, r); continue }
  if (q.kind === 'spark') storyEvent(d, { type: 'spark', amount: q.goal })
  else if (q.kind === 'area') storyEvent(d, { type: 'area', area: q.where as 'loft' })
  else storyEvent(d, { type: 'boss', area: q.where as 'moon' })
}
storyTalk(d, r)
show('3장', d)
