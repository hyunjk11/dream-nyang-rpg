import type { EquipSlot, StatKey, WeaponKind } from '../sim/types'

export interface WeaponStats {
  kind: WeaponKind
  damage: number
  cooldown: number
  speed: number
  life: number
  pierce: number
  aoe: number
  spread: number
}

export interface ItemDef {
  id: string
  name: string
  description: string
  price: number
  slot?: EquipSlot
  stats?: Partial<Record<StatKey, number>>
  weapon?: WeaponStats
}

export const ITEMS: Record<string, ItemDef> = {
  gun_water: {
    id: 'gun_water',
    name: '별빛 물총',
    description: '빠르고 가벼운 물줄기. 가까운 꿈을 시원하게 깨운다.',
    price: 40,
    slot: 'weapon',
    weapon: { kind: 'water', damage: 12, cooldown: 0.15, speed: 700, life: 0.4, pierce: 1, aoe: 0, spread: 0.07 },
  },
  gun_bubble: {
    id: 'gun_bubble',
    name: '비누방울 총',
    description: '느린 비눗방울이 닿으면 터지며 주변을 적신다.',
    price: 120,
    slot: 'weapon',
    weapon: { kind: 'bubble', damage: 17, cooldown: 0.46, speed: 340, life: 0.9, pierce: 1, aoe: 78, spread: 0.02 },
  },
  gun_dart: {
    id: 'gun_dart',
    name: '꿈다트 총',
    description: '한 방이 깊고, 여러 마리를 꿰뚫는다.',
    price: 150,
    slot: 'weapon',
    weapon: { kind: 'dart', damage: 26, cooldown: 0.3, speed: 920, life: 0.52, pierce: 3, aoe: 0, spread: 0 },
  },
  hat_beret: {
    id: 'hat_beret',
    name: '별조각 베레모',
    description: '루나가 눌러 준 베레모. 꿈이 조금 덜 차갑다.',
    price: 80,
    slot: 'hat',
    stats: { hp: 22, def: 3 },
  },
  hat_mushroom: {
    id: 'hat_mushroom',
    name: '버섯 후드캡',
    description: '숲의 포자가 행운처럼 달라붙는 모자.',
    price: 70,
    slot: 'hat',
    stats: { hp: 12, luck: 8 },
  },
  outfit_hoodie: {
    id: 'outfit_hoodie',
    name: '꿈결 크롭 후드',
    description: '별하가 늘 입던 후드. 꿈에서도 따뜻하다.',
    price: 90,
    slot: 'outfit',
    stats: { hp: 32, def: 5 },
  },
  outfit_cape: {
    id: 'outfit_cape',
    name: '별무리 케이프',
    description: '걸음이 별빛처럼 가벼워지는 짧은 망토.',
    price: 85,
    slot: 'outfit',
    stats: { hp: 16, moveSpeed: 16 },
  },
  acc_charm: {
    id: 'acc_charm',
    name: '달빛 부적',
    description: '빈틈을 별처럼 집어내는 작은 부적.',
    price: 110,
    slot: 'accessory',
    stats: { atk: 3, critChance: 0.04 },
  },
  acc_ring: {
    id: 'acc_ring',
    name: '별사탕 반지',
    description: '단내가 나면, 좋은 꿈이 더 자주 떨어진다.',
    price: 95,
    slot: 'accessory',
    stats: { atk: 2, luck: 10 },
  },
  collar_bell: {
    id: 'collar_bell',
    name: '방울 목걸이',
    description: '모찌의 방울. 찰랑일 때마다 운이 붙는다.',
    price: 75,
    slot: 'collar',
    stats: { luck: 8, def: 2 },
  },
  collar_ribbon: {
    id: 'collar_ribbon',
    name: '별빛 리본',
    description: '모찌가 앞장설 때 총구가 조금 더 매서워진다.',
    price: 100,
    slot: 'collar',
    stats: { atk: 4, critChance: 0.02 },
  },
}

export const WEAPON_IDS = ['gun_water', 'gun_bubble', 'gun_dart']
export const GEAR_IDS = [
  'hat_beret',
  'hat_mushroom',
  'outfit_hoodie',
  'outfit_cape',
  'acc_charm',
  'acc_ring',
  'collar_bell',
  'collar_ribbon',
]

export const MATERIAL_KO: Record<string, string> = {
  dream_dust: '꿈가루',
  toy_part: '장난감 부품',
}

export interface ShopEntry {
  kind: 'potion' | 'item'
  price: number
  defId?: string
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  name: string
  blurb: string
}

export const SHOP: ShopEntry[] = [
  { kind: 'potion', price: 28, name: '별사탕 포션', blurb: '체력을 크게 회복한다. 최대 20개.' },
  { kind: 'item', defId: 'gun_bubble', rarity: 'uncommon', price: 180, name: '비누방울 총', blurb: '터지는 범위 공격.' },
  { kind: 'item', defId: 'hat_mushroom', rarity: 'uncommon', price: 120, name: '버섯 후드캡', blurb: '행운이 붙는 모자.' },
  { kind: 'item', defId: 'outfit_hoodie', rarity: 'uncommon', price: 150, name: '꿈결 크롭 후드', blurb: '체력과 방어.' },
  { kind: 'item', defId: 'acc_ring', rarity: 'uncommon', price: 140, name: '별사탕 반지', blurb: '공격과 행운.' },
  { kind: 'item', defId: 'collar_bell', rarity: 'uncommon', price: 130, name: '방울 목걸이', blurb: '모찌의 행운.' },
  { kind: 'item', defId: 'outfit_cape', rarity: 'rare', price: 260, name: '별무리 케이프', blurb: '가벼운 발걸음.' },
]
