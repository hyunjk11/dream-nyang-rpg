import type { EquipSlot, StatKey, WeaponKind } from '../sim/types'

export interface ItemDef {
  id: string
  name: string
  description: string
  price: number
  slot?: EquipSlot
  /** Implicit stats at item level 1, common (3D scale: fractions, hp flat). */
  stats?: Partial<Record<StatKey, number>>
  /** Gun base (weapon slot only). */
  gun?: WeaponKind
  /** Little icon in the bag grid. */
  icon: string
}

const D = (d: ItemDef): ItemDef => d

export const ITEMS: Record<string, ItemDef> = {
  gun_water: D({ id: 'gun_water', name: '별빛 물총', description: '두두두두! 가볍게 쏟아지는 연사 물줄기.', price: 40, slot: 'weapon', gun: 'water', icon: 'gun' }),
  gun_bubble: D({ id: 'gun_bubble', name: '방울 샷건', description: '퐁! 한 번에 비눗방울 여섯 개. 가까이서 아주 세다.', price: 120, slot: 'weapon', gun: 'bubble', icon: 'shotgun' }),
  gun_star: D({ id: 'gun_star', name: '별똥 점사총', description: '탕탕탕, 별 세 발씩. 치명타가 잘 터지고 한 마리를 꿰뚫는다.', price: 140, slot: 'weapon', gun: 'star', icon: 'rifle' }),
  gun_dart: D({ id: 'gun_dart', name: '꿈다트 저격총', description: '한 방이 깊고, 줄 선 괴물을 여럿 꿰뚫는다.', price: 150, slot: 'weapon', gun: 'dart', icon: 'dart' }),
  hat_beret: D({ id: 'hat_beret', name: '별조각 베레모', description: '루나가 눌러 준 베레모. 꿈이 조금 덜 차갑다.', price: 80, slot: 'hat', stats: { hp: 14, armor: 0.02 }, icon: 'hat' }),
  hat_mushroom: D({ id: 'hat_mushroom', name: '버섯 후드캡', description: '숲의 포자가 행운처럼 달라붙는 모자.', price: 70, slot: 'hat', stats: { hp: 8, luck: 6 }, icon: 'hat' }),
  hat_pin: D({ id: 'hat_pin', name: '별 머리핀', description: '앞머리에 꽂는 별. 빈틈이 반짝 보인다.', price: 75, slot: 'hat', stats: { critChance: 0.02 }, icon: 'pin' }),
  outfit_hoodie: D({ id: 'outfit_hoodie', name: '꿈결 크롭 후드', description: '별하가 늘 입던 후드. 꿈에서도 따뜻하다.', price: 90, slot: 'outfit', stats: { hp: 22, armor: 0.03 }, icon: 'outfit' }),
  outfit_cape: D({ id: 'outfit_cape', name: '별무리 케이프', description: '걸음이 별빛처럼 가벼워지는 짧은 망토.', price: 85, slot: 'outfit', stats: { hp: 10, moveSpeed: 0.03 }, icon: 'outfit' }),
  outfit_knit: D({ id: 'outfit_knit', name: '구름 니트 조끼', description: '폭신한 조끼. 맞아도 덜 아프다.', price: 95, slot: 'outfit', stats: { armor: 0.05 }, icon: 'outfit' }),
  shoes_boots: D({ id: 'shoes_boots', name: '폭신 털부츠', description: '쿵 하고 밟아도 폭신. 튼튼한 발걸음.', price: 70, slot: 'shoes', stats: { hp: 10, moveSpeed: 0.02 }, icon: 'shoes' }),
  shoes_sneakers: D({ id: 'shoes_sneakers', name: '구름 운동화', description: '통통 튀는 밑창. 이동이 빨라진다.', price: 80, slot: 'shoes', stats: { moveSpeed: 0.05 }, icon: 'shoes' }),
  acc_charm: D({ id: 'acc_charm', name: '달빛 부적', description: '빈틈을 별처럼 집어내는 작은 부적.', price: 110, slot: 'accessory', stats: { critChance: 0.03 }, icon: 'charm' }),
  acc_ring: D({ id: 'acc_ring', name: '별사탕 반지', description: '단내가 나면, 물총이 더 매서워진다.', price: 95, slot: 'accessory', stats: { damage: 0.04 }, icon: 'ring' }),
  acc_bell: D({ id: 'acc_bell', name: '딸랑 방울 팔찌', description: '찰랑일 때마다 좋은 꿈이 더 자주 떨어진다.', price: 90, slot: 'accessory', stats: { luck: 8 }, icon: 'ring' }),
  collar_bell: D({ id: 'collar_bell', name: '방울 목걸이', description: '모찌의 방울. 찰랑일 때마다 운이 붙는다.', price: 75, slot: 'collar', stats: { luck: 6 }, icon: 'collar' }),
  collar_ribbon: D({ id: 'collar_ribbon', name: '별빛 리본', description: '모찌가 앞장설 때 총구가 조금 더 매서워진다.', price: 100, slot: 'collar', stats: { damage: 0.03 }, icon: 'collar' }),
}

export const WEAPON_IDS = ['gun_water', 'gun_bubble', 'gun_star', 'gun_dart']
/** Gear that drops (Mochi's collars only come from old saves / quests). */
export const GEAR_IDS = [
  'hat_beret',
  'hat_mushroom',
  'hat_pin',
  'outfit_hoodie',
  'outfit_cape',
  'outfit_knit',
  'shoes_boots',
  'shoes_sneakers',
  'acc_charm',
  'acc_ring',
  'acc_bell',
]

export const MATERIAL_KO: Record<string, string> = {
  dream_dust: '꿈가루',
  toy_part: '장난감 부품',
  star_shard: '별조각',
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
