export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type EquipSlot = 'weapon' | 'hat' | 'outfit' | 'accessory' | 'collar'

export type StatKey =
  | 'hp'
  | 'atk'
  | 'def'
  | 'critChance'
  | 'critDamage'
  | 'attackSpeed'
  | 'moveSpeed'
  | 'luck'
  | 'weaponDamage'

export type WeaponKind = 'water' | 'bubble' | 'dart'

export interface Affix {
  id: string
  name: string
  stat: StatKey
  value: number
}

export interface ItemInstance {
  uid: string
  defId: string
  rarity: Rarity
  itemLevel: number
  affixes: Affix[]
}

export type QuestStatus = 'inactive' | 'active' | 'completed' | 'turnedIn'

export interface QuestState {
  status: QuestStatus
  counts: Record<string, number>
}

export interface Settings {
  master: number
  bgm: number
  sfx: number
  vibration: boolean
  shake: boolean
  showTouch: boolean
}

export interface SaveData {
  version: 1
  createdAt: number
  updatedAt: number
  playSeconds: number
  level: number
  xp: number
  gold: number
  hp: number
  potions: number
  materials: Record<string, number>
  items: ItemInstance[]
  equipment: Partial<Record<EquipSlot, string>>
  byeolhaPoints: number
  mochiPoints: number
  learnedSkills: string[]
  quests: Record<string, QuestState>
  flags: Record<string, boolean>
  zoneId: string
  spawn: string
  settings: Settings
}

export type Action =
  | { type: 'flag'; id: string }
  | { type: 'talk'; npc: string }
  | { type: 'quest-start'; id: string }
  | { type: 'quest-turnin'; id: string }
  | { type: 'heal-full' }
  | { type: 'open-shop' }
  | { type: 'open-tinker' }
  | { type: 'open-quests' }

export interface MutationResult {
  toasts: string[]
  leveled: boolean
  questPop: boolean
}

export const emptyResult = (): MutationResult => ({ toasts: [], leveled: false, questPop: false })

export function mergeResult(a: MutationResult, b: MutationResult): MutationResult {
  return {
    toasts: a.toasts.concat(b.toasts),
    leveled: a.leveled || b.leveled,
    questPop: a.questPop || b.questPop,
  }
}

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export const RARITY_KO: Record<Rarity, string> = {
  common: '일반',
  uncommon: '고급',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설',
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#efe8df',
  uncommon: '#7dcea0',
  rare: '#7eb6ff',
  epic: '#d59bff',
  legendary: '#ffcf70',
}

export const SLOT_KO: Record<EquipSlot, string> = {
  weapon: '무기',
  hat: '모자',
  outfit: '옷',
  accessory: '장신구',
  collar: '모찌 목걸이',
}

export const STAT_KO: Record<StatKey, string> = {
  hp: '체력',
  atk: '공격력',
  def: '방어력',
  critChance: '치명타 확률',
  critDamage: '치명타 피해',
  attackSpeed: '공격 속도',
  moveSpeed: '이동 속도',
  luck: '행운',
  weaponDamage: '무기 공격력',
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.35,
  bgm: 0.34,
  sfx: 0.5,
  vibration: true,
  shake: true,
  showTouch: false,
}

export const BAG_CAP = 24
export const POTION_CAP = 20

let seq = 0
export function uid(): string {
  seq += 1
  return `i${seq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}
