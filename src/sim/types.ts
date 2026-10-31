export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** Equipment slots. A ring/charm (`accessory` item) fits either accessory slot; `collar` is Mochi's (old saves). */
export type EquipSlot = 'weapon' | 'hat' | 'outfit' | 'shoes' | 'accessory' | 'accessory2' | 'collar'

/** Slots shown in the equipment panel, in order. */
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'hat', 'outfit', 'shoes', 'accessory', 'accessory2']

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
  // 3D game stats (fractions unless noted)
  | 'damage'
  | 'fireRate'
  | 'lifesteal'
  /** Extra foes a droplet passes through (whole number). */
  | 'pierce'
  /** Share of incoming damage blocked. */
  | 'armor'
  /** Element proc chances on hit. */
  | 'sparkle'
  | 'ice'
  | 'candy'

/** Toy gun bases: full-auto water gun, bubble shotgun, star burst rifle, dream dart sniper. */
export type WeaponKind = 'water' | 'bubble' | 'star' | 'dart'

export type Element = 'sparkle' | 'ice' | 'candy'

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
  /** 2 = 3D affix scale. Items without it come from older saves and are converted on load. */
  v?: 2
  /** Gun workshop upgrade level (+1..+10); absent = +0. */
  plus?: number
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
  /** Dream-sewer delve progress (see sim/delve.ts); old saves get it on load. */
  delve?: {
    unlocked: number
    cleared: number
    checkpoint: { depth: number; floor: number } | null
    runs: number
    /** The trip in progress (run gold etc.), so a reload mid-run banks it instead of losing it. */
    open?: OpenRun | null
  }
  /** Skill tree (3D): unspent points and ranks per skill. Old saves get it on load. */
  build?: { points: number; ranks: Record<string, number> }
  /** Stage 4 town services: shop stock, buy-back, stash, scrolls and the contract board. */
  town?: import('./town').TownSave
}

export interface OpenRun {
  depth: number
  floor: number
  gold: number
  kills: number
  elites: number
  seconds: number
  floorsCleared: number
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
  common: '보통',
  uncommon: '매직',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설',
}

/** White → blue → yellow → violet → orange, the loot-game ladder in pastel. */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#f3ece4',
  uncommon: '#7fb8ff',
  rare: '#ffe066',
  epic: '#d59bff',
  legendary: '#ffa45c',
}

export const SLOT_KO: Record<EquipSlot, string> = {
  weapon: '총',
  hat: '모자·머리핀',
  outfit: '옷',
  shoes: '신발',
  accessory: '장신구',
  accessory2: '장신구 2',
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
  damage: '피해',
  fireRate: '연사 속도',
  lifesteal: '생명 흡수',
  pierce: '관통',
  armor: '피해 감소',
  sparkle: '반짝 속성',
  ice: '얼음 속성',
  candy: '사탕 속성',
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.35,
  bgm: 0.34,
  sfx: 0.5,
  vibration: true,
  shake: true,
  showTouch: false,
}

export const BAG_CAP = 30
export const POTION_CAP = 20

let seq = 0
export function uid(): string {
  seq += 1
  return `i${seq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}
