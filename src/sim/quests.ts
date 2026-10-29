import { ITEMS } from '../data/items'
import { QUESTS, QUEST_ORDER, type ObjectiveDef, type QuestDef, type QuestRewards } from '../data/quests'
import { makeItem } from './loot'
import { addItem } from './inventory'
import { gainGold, gainXp, healFull } from './stats'
import {
  RARITY_KO,
  emptyResult,
  mergeResult,
  type MutationResult,
  type SaveData,
} from './types'

export function initialQuestState(): SaveData['quests'] {
  const quests: SaveData['quests'] = {}
  for (const id of QUEST_ORDER) {
    quests[id] = { status: id === 'q_awaken' ? 'active' : 'inactive', counts: {} }
  }
  return quests
}

function current(save: SaveData, questId: string, objective: ObjectiveDef): number {
  if (objective.type === 'collect') return save.materials[objective.target] ?? 0
  return save.quests[questId]?.counts[objective.id] ?? 0
}

export function objectiveLine(save: SaveData, questId: string, objective: ObjectiveDef): string {
  const value = Math.min(objective.count, current(save, questId, objective))
  if (objective.count <= 1) return `${objective.label}${value >= 1 ? ' 완료' : ''}`
  return `${objective.label} ${value}/${objective.count}`
}

function rewardText(rewards: QuestRewards): string {
  const bits: string[] = []
  if (rewards.gold) bits.push(`골드 ${rewards.gold}`)
  if (rewards.xp) bits.push(`경험치 ${rewards.xp}`)
  if (rewards.potions) bits.push(`포션 ${rewards.potions}`)
  if (rewards.byeolhaPoints) bits.push(`별하 포인트 ${rewards.byeolhaPoints}`)
  if (rewards.mochiPoints) bits.push(`모찌 포인트 ${rewards.mochiPoints}`)
  if (rewards.items) {
    bits.push(
      rewards.items.map((item) => `${RARITY_KO[item.rarity]} ${ITEMS[item.defId]?.name ?? item.defId}`).join(', '),
    )
  }
  return bits.join(' · ')
}

export function grantRewards(save: SaveData, rewards: QuestRewards, rng: () => number): MutationResult {
  let result = emptyResult()
  if (rewards.gold) {
    gainGold(save, rewards.gold)
    result.toasts.push(`골드 +${rewards.gold}`)
  }
  if (rewards.xp) {
    result = mergeResult(result, gainXp(save, rewards.xp))
    result.toasts.splice(result.toasts.length - (result.leveled ? 1 : 0), 0, `경험치 +${rewards.xp}`)
  }
  if (rewards.potions) {
    save.potions += rewards.potions
    result.toasts.push(`별사탕 포션 +${rewards.potions}`)
  }
  if (rewards.byeolhaPoints) {
    save.byeolhaPoints += rewards.byeolhaPoints
    result.toasts.push(`별하 스킬 포인트 +${rewards.byeolhaPoints}`)
  }
  if (rewards.mochiPoints) {
    save.mochiPoints += rewards.mochiPoints
    result.toasts.push(`모찌 스킬 포인트 +${rewards.mochiPoints}`)
  }
  for (const spec of rewards.items ?? []) {
    const item = makeItem(spec.defId, spec.rarity, rng, save.level)
    addItem(save, item, true)
    result.toasts.push(`${RARITY_KO[item.rarity]} ${ITEMS[item.defId]?.name ?? item.defId} 획득`)
  }
  if (rewards.consume) {
    for (const [id, count] of Object.entries(rewards.consume)) {
      save.materials[id] = Math.max(0, (save.materials[id] ?? 0) - count)
    }
  }
  return result
}

export function refreshCompletion(save: SaveData, rng: () => number = Math.random): MutationResult {
  let result = emptyResult()
  for (const def of Object.values(QUESTS)) {
    const state = save.quests[def.id]
    if (!state || state.status !== 'active') continue
    const done = def.objectives.every((objective) => current(save, def.id, objective) >= objective.count)
    if (!done) continue
    state.status = 'completed'
    if (def.autoTurnIn) {
      result = mergeResult(result, turnIn(save, def.id, rng))
    } else {
      result.questPop = true
      result.toasts.push(`기록 달성: ${def.title}. 의뢰인에게 돌아가자.`)
    }
  }
  return result
}

export function turnIn(save: SaveData, id: string, rng: () => number = Math.random): MutationResult {
  const def = QUESTS[id]
  const state = save.quests[id]
  const result = emptyResult()
  if (!def || !state || state.status !== 'completed') return result
  if (def.rewards.consume) {
    for (const [mat, count] of Object.entries(def.rewards.consume)) {
      if ((save.materials[mat] ?? 0) < count) {
        result.toasts.push('재료가 아직 부족해.')
        return result
      }
    }
  }
  state.status = 'turnedIn'
  const granted = grantRewards(save, def.rewards, rng)
  granted.questPop = true
  granted.toasts.unshift(`${def.title} 완료!`)
  return mergeResult(result, granted)
}

export function startQuest(save: SaveData, id: string, rng: () => number = Math.random): MutationResult {
  const def = QUESTS[id]
  const state = save.quests[id]
  const result = emptyResult()
  if (!def || !state || state.status !== 'inactive') return result
  if (def.requires && save.quests[def.requires]?.status !== 'turnedIn') {
    result.toasts.push('아직 그 이야기는 열리지 않았어.')
    return result
  }
  state.status = 'active'
  result.questPop = true
  result.toasts.push(`새 기록: ${def.title}`)
  return mergeResult(result, refreshCompletion(save, rng))
}

function bump(save: SaveData, type: ObjectiveDef['type'], target: string, tags: string[] = []): void {
  for (const def of Object.values(QUESTS)) {
    const state = save.quests[def.id]
    if (state?.status !== 'active') continue
    for (const objective of def.objectives) {
      if (objective.type !== type) continue
      const hit = objective.target === target || tags.includes(objective.target)
      if (!hit) continue
      const value = state.counts[objective.id] ?? 0
      if (value < objective.count) state.counts[objective.id] = value + 1
    }
  }
}

export function onKill(save: SaveData, enemyId: string, tags: string[], rng: () => number = Math.random): MutationResult {
  bump(save, 'kill', enemyId, tags)
  return refreshCompletion(save, rng)
}

export function onEnter(save: SaveData, zoneId: string, rng: () => number = Math.random): MutationResult {
  bump(save, 'enter', zoneId)
  const result = refreshCompletion(save, rng)
  if (zoneId === 'village') healFull(save)
  return result
}

export function onTalk(save: SaveData, npcId: string, rng: () => number = Math.random): MutationResult {
  bump(save, 'talk', npcId)
  return refreshCompletion(save, rng)
}

export function addMaterial(save: SaveData, id: string, amount: number, rng: () => number = Math.random): MutationResult {
  save.materials[id] = (save.materials[id] ?? 0) + amount
  return refreshCompletion(save, rng)
}

export interface QuestView {
  id: string
  title: string
  summary: string
  status: string
  statusKey: SaveData['quests'][string]['status']
  lines: string[]
  reward: string
  side?: boolean
}

const STATUS_KO = {
  inactive: '아직',
  active: '진행 중',
  completed: '보고 가능',
  turnedIn: '완료',
} as const

export function questLog(save: SaveData): QuestView[] {
  return QUEST_ORDER.map((id) => {
    const def = QUESTS[id]
    const state = save.quests[id]
    return {
      id,
      title: def.title,
      summary: def.summary,
      status: STATUS_KO[state?.status ?? 'inactive'],
      statusKey: state?.status ?? 'inactive',
      lines: def.objectives.map((objective) => objectiveLine(save, id, objective)),
      reward: rewardText(def.rewards),
      side: def.side,
    }
  }).filter((entry) => entry.statusKey !== 'inactive' || !QUESTS[entry.id].requires || save.quests[QUESTS[entry.id].requires!]?.status === 'turnedIn')
}

export function tracker(save: SaveData): { title: string; lines: string[] }[] {
  const views: { title: string; lines: string[] }[] = []
  for (const id of QUEST_ORDER) {
    const state = save.quests[id]
    const def: QuestDef | undefined = QUESTS[id]
    if (!def || !state) continue
    if (state.status !== 'active' && state.status !== 'completed') continue
    views.push({
      title: state.status === 'completed' ? `보고 · ${def.title}` : def.title,
      lines: def.objectives.map((objective) => objectiveLine(save, id, objective)),
    })
    if (views.length >= 2) break
  }
  return views
}
