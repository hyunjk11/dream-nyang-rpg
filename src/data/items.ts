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
  hat_beret: D({ id: 'hat_beret', name: '별조각 베레모', description: '루나가 눌러 준 베레모. 꿈이 조금 덜 차갑다.', price: 80, slot: 'hat', stats: { hp: 40, armor: 0.04 }, icon: 'beret' }),
  hat_mushroom: D({ id: 'hat_mushroom', name: '버섯 후드캡', description: '숲의 포자가 행운처럼 달라붙는 모자.', price: 70, slot: 'hat', stats: { hp: 28, armor: 0.03, luck: 10 }, icon: 'mushroom' }),
  hat_pin: D({ id: 'hat_pin', name: '별 머리핀', description: '앞머리에 꽂는 별. 빈틈이 반짝 보인다.', price: 75, slot: 'hat', stats: { hp: 20, armor: 0.03, critChance: 0.04 }, icon: 'pin' }),
  outfit_hoodie: D({ id: 'outfit_hoodie', name: '꿈결 크롭 후드', description: '별하가 늘 입던 후드. 꿈에서도 따뜻하다.', price: 90, slot: 'outfit', stats: { hp: 70, armor: 0.04 }, icon: 'hoodie' }),
  outfit_cape: D({ id: 'outfit_cape', name: '별무리 케이프', description: '걸음이 별빛처럼 가벼워지는 짧은 망토.', price: 85, slot: 'outfit', stats: { hp: 35, moveSpeed: 0.06 }, icon: 'cape' }),
  outfit_knit: D({ id: 'outfit_knit', name: '구름 니트 조끼', description: '폭신한 조끼. 맞아도 덜 아프다.', price: 95, slot: 'outfit', stats: { hp: 50, armor: 0.08 }, icon: 'knit' }),
  shoes_boots: D({ id: 'shoes_boots', name: '폭신 털부츠', description: '쿵 하고 밟아도 폭신. 튼튼한 발걸음.', price: 70, slot: 'shoes', stats: { hp: 25, moveSpeed: 0.06 }, icon: 'boots' }),
  shoes_sneakers: D({ id: 'shoes_sneakers', name: '구름 운동화', description: '통통 튀는 밑창. 이동이 빨라진다.', price: 80, slot: 'shoes', stats: { moveSpeed: 0.1 }, icon: 'sneakers' }),
  acc_charm: D({ id: 'acc_charm', name: '달빛 부적', description: '빈틈을 별처럼 집어내는 작은 부적.', price: 110, slot: 'accessory', stats: { critChance: 0.06 }, icon: 'charm' }),
  acc_ring: D({ id: 'acc_ring', name: '별사탕 반지', description: '단내가 나면, 물총이 더 매서워진다.', price: 95, slot: 'accessory', stats: { damage: 0.1 }, icon: 'ring' }),
  acc_bell: D({ id: 'acc_bell', name: '딸랑 방울 팔찌', description: '찰랑일 때마다 좋은 꿈이 더 자주 떨어지고, 손이 조금 빨라진다.', price: 90, slot: 'accessory', stats: { luck: 12, fireRate: 0.06 }, icon: 'bracelet' }),
  collar_bell: D({ id: 'collar_bell', name: '방울 목걸이', description: '모찌의 방울. 찰랑일 때마다 운이 붙는다.', price: 75, slot: 'collar', stats: { luck: 10 }, icon: 'bell' }),
  collar_ribbon: D({ id: 'collar_ribbon', name: '별빛 리본', description: '모찌가 앞장설 때 총구가 조금 더 매서워진다.', price: 100, slot: 'collar', stats: { damage: 0.06 }, icon: 'ribbon' }),
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

/** What each material is for (tooltips and the H help card). */
export const MATERIAL_HELP: Record<string, string> = {
  dream_dust: '괴물과 장비 분해에서 나와. 공방에서 강화하거나 옵션을 다시 굴릴 때 써.',
  toy_part: '정예 괴물과 희귀 장비 분해에서 나와. 공방에서 속성(얼음·사탕·별빛)을 붙일 때 써.',
  star_shard: '영웅·전설 장비 분해와 보스 의뢰에서 나와. +8부터 강화할 때 필요해.',
}

export interface ShopEntry {
  kind: 'potion' | 'item'
  price: number
  defId?: string
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  name: string
  blurb: string
}

/** Shop line for a base item: the name always comes from ITEMS (no stale copies). */
const stock = (defId: string, rarity: ShopEntry['rarity'], price: number, blurb: string): ShopEntry => ({ kind: 'item', defId, rarity, price, name: ITEMS[defId].name, blurb })

export const SHOP: ShopEntry[] = [
  { kind: 'potion', price: 28, name: '별사탕 포션', blurb: '체력을 크게 회복한다. 최대 20개.' },
  stock('gun_bubble', 'uncommon', 180, '가까이서 비눗방울 여섯 발.'),
  stock('hat_mushroom', 'uncommon', 120, '체력·방어에 행운까지.'),
  stock('outfit_hoodie', 'uncommon', 150, '체력과 방어가 크게.'),
  stock('acc_ring', 'uncommon', 140, '공격력이 오른다.'),
  stock('collar_bell', 'uncommon', 130, '모찌의 행운.'),
  stock('outfit_cape', 'rare', 260, '체력과 가벼운 발걸음.'),
]
