import { ITEMS, SHOP } from '../data/items'
import { SKILLS } from '../data/skills'
import { dismantleYield, makeItem, rerollCost, rollAffixes, sellValue } from './loot'
import { addItem, equipItem, findItem, removeItem, unequipItem } from './inventory'
import { addMaterial, initialQuestState, onTalk, startQuest, turnIn } from './quests'
import { computeStats, gainGold, healAmount, healFull, reclampHp, spendGold } from './stats'
import {
  DEFAULT_SETTINGS,
  POTION_CAP,
  emptyResult,
  mergeResult,
  type Action,
  type EquipSlot,
  type MutationResult,
  type SaveData,
} from './types'

export interface ActionOutcome {
  result: MutationResult
  openShop?: boolean
  openTinker?: boolean
  openQuests?: boolean
}

export function freshSave(settings = DEFAULT_SETTINGS): SaveData {
  const now = Date.now()
  const save: SaveData = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    playSeconds: 0,
    level: 1,
    xp: 0,
    gold: 30,
    hp: 1,
    potions: 2,
    materials: { dream_dust: 0, toy_part: 0 },
    items: [],
    equipment: {},
    byeolhaPoints: 1,
    mochiPoints: 1,
    learnedSkills: ['spray', 'taunt'],
    quests: initialQuestState(),
    flags: {},
    zoneId: 'meadow',
    spawn: 'default',
    settings: { ...settings },
    delve: { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null },
    build: { points: 1, ranks: {} },
  }
  const gun = makeItem('gun_water', 'common', () => 0.2, 1)
  addItem(save, gun, true)
  save.equipment.weapon = gun.uid
  save.hp = computeStats(save).maxHp
  return save
}

export function usePotion(save: SaveData): { ok: boolean; reason?: string; healed?: number } {
  if (save.potions <= 0) return { ok: false, reason: '포션이 없어.' }
  const max = computeStats(save).maxHp
  if (save.hp >= max) return { ok: false, reason: '체력이 이미 가득이야.' }
  save.potions -= 1
  const healed = healAmount(save, Math.max(30, Math.round(max * 0.42)))
  return { ok: true, healed }
}

export function learnSkill(save: SaveData, id: string): { ok: boolean; reason?: string } {
  const def = SKILLS[id]
  if (!def) return { ok: false, reason: '없는 기술이야.' }
  if (save.learnedSkills.includes(id)) return { ok: false, reason: '이미 배웠어.' }
  if (def.requires.some((req) => !save.learnedSkills.includes(req))) {
    return { ok: false, reason: '앞의 기술을 먼저 배워야 해.' }
  }
  if (def.owner === 'byeolha') {
    if (save.byeolhaPoints < 1) return { ok: false, reason: '별하 스킬 포인트가 없어.' }
    save.byeolhaPoints -= 1
  } else {
    if (save.mochiPoints < 1) return { ok: false, reason: '모찌 스킬 포인트가 없어.' }
    save.mochiPoints -= 1
  }
  save.learnedSkills.push(id)
  return { ok: true }
}

export function tryEquip(save: SaveData, id: string, prefer?: EquipSlot): { ok: boolean; reason?: string } {
  const before = computeStats(save).maxHp
  const result = equipItem(save, id, prefer)
  if (!result.ok) return result
  reclampHp(save, before)
  return result
}

export function tryUnequip(save: SaveData, slot: EquipSlot): { ok: boolean; reason?: string } {
  const before = computeStats(save).maxHp
  const result = unequipItem(save, slot)
  if (!result.ok) return result
  reclampHp(save, before)
  return result
}

export function sellOwned(save: SaveData, id: string): { ok: boolean; reason?: string; gold?: number } {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '없는 물건이야.' }
  if (save.equipment.weapon === id) return { ok: false, reason: '쓰고 있는 총은 팔 수 없어.' }
  const before = computeStats(save).maxHp
  const gold = sellValue(item)
  removeItem(save, id)
  gainGold(save, gold)
  reclampHp(save, before)
  return { ok: true, gold }
}

/** Break an item into workshop materials (dust, parts, star shards). */
export function dismantleOwned(save: SaveData, id: string): { ok: boolean; reason?: string; got?: Record<string, number> } {
  const item = findItem(save, id)
  if (!item) return { ok: false, reason: '없는 물건이야.' }
  if (save.equipment.weapon === id) return { ok: false, reason: '쓰고 있는 총은 분해할 수 없어.' }
  const before = computeStats(save).maxHp
  const got = dismantleYield(item)
  removeItem(save, id)
  for (const [mat, n] of Object.entries(got)) save.materials[mat] = (save.materials[mat] ?? 0) + n
  reclampHp(save, before)
  return { ok: true, got }
}

export function rerollWeapon(save: SaveData, rng: () => number = Math.random): { ok: boolean; reason?: string } {
  const item = findItem(save, save.equipment.weapon)
  if (!item) return { ok: false, reason: '장착한 총이 없어.' }
  if (item.affixes.length === 0) return { ok: false, reason: '이 총은 너무 단순해서 재조정할 부분이 없어.' }
  const cost = rerollCost(item)
  if (!spendGold(save, cost)) return { ok: false, reason: `골드가 모자라. ${cost} 필요해.` }
  const slot = ITEMS[item.defId]?.slot ?? 'weapon'
  item.affixes = rollAffixes(slot, item.rarity, rng, item.itemLevel)
  return { ok: true }
}

export function buyEntry(save: SaveData, index: number, rng: () => number = Math.random): { ok: boolean; reason?: string } {
  const entry = SHOP[index]
  if (!entry) return { ok: false, reason: '진열대에 없는 물건이야.' }
  if (!spendGold(save, entry.price)) return { ok: false, reason: '골드가 모자라.' }
  if (entry.kind === 'potion') {
    if (save.potions >= POTION_CAP) {
      gainGold(save, entry.price)
      return { ok: false, reason: '포션은 20개까지야.' }
    }
    save.potions += 1
    return { ok: true }
  }
  const item = makeItem(entry.defId ?? 'gun_water', entry.rarity ?? 'common', rng, save.level)
  if (!addItem(save, item)) {
    gainGold(save, entry.price)
    return { ok: false, reason: '가방이 가득 찼어.' }
  }
  return { ok: true }
}

export function applyActions(save: SaveData, actions: Action[], rng: () => number = Math.random): ActionOutcome {
  let result = emptyResult()
  const outcome: ActionOutcome = { result }
  for (const action of actions) {
    if (action.type === 'flag') save.flags[action.id] = true
    else if (action.type === 'talk') result = mergeResult(result, onTalk(save, action.npc, rng))
    else if (action.type === 'quest-start') result = mergeResult(result, startQuest(save, action.id, rng))
    else if (action.type === 'quest-turnin') result = mergeResult(result, turnIn(save, action.id, rng))
    else if (action.type === 'heal-full') {
      healFull(save)
      result = mergeResult(result, { toasts: ['체력이 가득 찼다.'], leveled: false, questPop: false })
    } else if (action.type === 'open-shop') outcome.openShop = true
    else if (action.type === 'open-tinker') outcome.openTinker = true
    else if (action.type === 'open-quests') outcome.openQuests = true
  }
  outcome.result = result
  return outcome
}

export function onDeath(save: SaveData): number {
  const lost = Math.min(save.gold, Math.max(0, Math.floor(save.gold * 0.1)))
  save.gold -= lost
  healFull(save)
  const home = save.quests.q_awaken?.status === 'turnedIn' ? 'village' : 'meadow'
  save.zoneId = home
  save.spawn = 'default'
  return lost
}

export function collectMaterial(save: SaveData, id: string, amount: number, rng: () => number = Math.random): MutationResult {
  return addMaterial(save, id, amount, rng)
}
