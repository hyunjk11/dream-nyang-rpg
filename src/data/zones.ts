import { mulberry32 } from '../sim/rng'

export interface PropDef {
  key: string
  x: number
  y: number
  h: number
  block?: { w: number; h: number }
  sort?: boolean
  flip?: boolean
}

export interface NpcDef {
  id: string
  key: string
  x: number
  y: number
  h: number
}

export interface SpotDef {
  id: string
  x: number
  y: number
  r: number
}

export interface EnemySpawn {
  id: string
  x: number
  y: number
  tags: string[]
  elite?: string
  fixed?: boolean
}

export interface ExitDef {
  x: number
  y: number
  w: number
  h: number
  to: string
  spawn: string
  seal?: 'boss'
}

export interface PickupDef {
  kind: 'material' | 'gold' | 'potion'
  id?: string
  amount: number
  x: number
  y: number
}

export interface PathDef {
  x: number
  y: number
  w: number
  h: number
}

export interface ZoneDef {
  id: string
  name: string
  bgm: 'village' | 'battle'
  ground: string
  tint: number
  width: number
  height: number
  spawns: Record<string, { x: number; y: number }>
  props: PropDef[]
  npcs: NpcDef[]
  spots: SpotDef[]
  enemies: EnemySpawn[]
  exits: ExitDef[]
  pickups: PickupDef[]
  paths: PathDef[]
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function hits(x: number, y: number, avoid: Rect[]): boolean {
  return avoid.some((rect) => Math.abs(x - rect.x) < rect.w / 2 && Math.abs(y - rect.y) < rect.h / 2)
}

function scatter(opts: {
  seed: number
  count: number
  area: Rect
  key: string
  minH: number
  maxH: number
  avoid: Rect[]
  block?: { w: number; h: number }
  sort?: boolean
}): PropDef[] {
  const rng = mulberry32(opts.seed)
  const out: PropDef[] = []
  let guard = 0
  while (out.length < opts.count && guard < 800) {
    guard += 1
    const x = opts.area.x + rng() * opts.area.w
    const y = opts.area.y + rng() * opts.area.h
    if (hits(x, y, opts.avoid)) continue
    out.push({
      key: opts.key,
      x,
      y,
      h: opts.minH + rng() * (opts.maxH - opts.minH),
      block: opts.block,
      sort: opts.sort,
      flip: rng() > 0.5,
    })
  }
  return out
}

function trees(seed: number, width: number, height: number, avoid: Rect[]): PropDef[] {
  return scatter({
    seed,
    count: 18,
    area: { x: 40, y: 40, w: width - 80, h: height - 80 },
    key: 'prop_tree',
    minH: 180,
    maxH: 250,
    avoid,
    block: { w: 46, h: 28 },
    sort: true,
  }).filter((prop) => {
    const edge = prop.x < 150 || prop.x > width - 150 || prop.y < 130 || prop.y > height - 130
    return edge
  })
}

const meadowAvoid: Rect[] = [
  { x: 900, y: 620, w: 280, h: 280 },
  { x: 900, y: 1020, w: 280, h: 220 },
  { x: 1120, y: 760, w: 160, h: 160 },
]

const villageAvoid: Rect[] = [
  { x: 1200, y: 800, w: 260, h: 900 },
  { x: 640, y: 940, w: 280, h: 260 },
  { x: 1760, y: 940, w: 300, h: 260 },
  { x: 1200, y: 250, w: 260, h: 200 },
  { x: 1200, y: 1380, w: 260, h: 220 },
]

const forestAvoid: Rect[] = [{ x: 1100, y: 750, w: 280, h: 1100 }]
const valeAvoid: Rect[] = [{ x: 1100, y: 750, w: 300, h: 1100 }]
export const ZONES: Record<string, ZoneDef> = {
  meadow: {
    id: 'meadow',
    name: '꿈의 초원',
    bgm: 'village',
    ground: 'tex_grass',
    tint: 0xfff4fb,
    width: 1800,
    height: 1200,
    spawns: {
      default: { x: 900, y: 560 },
      fromVillage: { x: 900, y: 900 },
    },
    paths: [{ x: 900, y: 780, w: 180, h: 520 }],
    props: [
      { key: 'prop_portal', x: 900, y: 1080, h: 210, sort: true },
      { key: 'prop_crystal', x: 1280, y: 420, h: 90, sort: true, block: { w: 36, h: 24 } },
      { key: 'prop_mushroom', x: 480, y: 860, h: 150, sort: true, block: { w: 48, h: 28 } },
      ...trees(11, 1800, 1200, meadowAvoid),
      ...scatter({
        seed: 21,
        count: 16,
        area: { x: 160, y: 160, w: 1480, h: 860 },
        key: 'prop_flower',
        minH: 42,
        maxH: 64,
        avoid: meadowAvoid,
      }),
    ],
    npcs: [],
    spots: [],
    enemies: [{ id: 'slime', x: 1280, y: 900, tags: ['tutorial'], fixed: true }],
    exits: [{ x: 900, y: 1040, w: 280, h: 240, to: 'village', spawn: 'fromMeadow' }],
    pickups: [],
  },
  village: {
    id: 'village',
    name: '꿈의 마을',
    bgm: 'village',
    ground: 'tex_grass',
    tint: 0xfff8ee,
    width: 2400,
    height: 1600,
    spawns: {
      default: { x: 1200, y: 960 },
      fromMeadow: { x: 1200, y: 480 },
      fromForest: { x: 1200, y: 820 },
    },
    paths: [
      { x: 1200, y: 800, w: 200, h: 1180 },
      { x: 900, y: 980, w: 420, h: 120 },
      { x: 1500, y: 980, w: 420, h: 120 },
    ],
    props: [
      { key: 'prop_fountain', x: 1200, y: 760, h: 190, sort: true, block: { w: 70, h: 36 } },
      { key: 'prop_house', x: 560, y: 900, h: 270, sort: true, block: { w: 130, h: 80 } },
      { key: 'prop_workshop', x: 1840, y: 900, h: 270, sort: true, block: { w: 140, h: 80 } },
      { key: 'prop_house', x: 400, y: 520, h: 240, sort: true, flip: true, block: { w: 120, h: 70 } },
      { key: 'prop_board', x: 1040, y: 560, h: 130, sort: true },
      { key: 'prop_well', x: 720, y: 980, h: 140, sort: true, block: { w: 70, h: 40 } },
      { key: 'prop_portal', x: 1200, y: 210, h: 200, sort: true },
      { key: 'prop_portal', x: 1200, y: 1180, h: 170, sort: true },
      { key: 'prop_lantern', x: 1040, y: 640, h: 96, sort: true },
      { key: 'prop_lantern', x: 1360, y: 640, h: 96, sort: true },
      { key: 'prop_lantern', x: 1040, y: 1100, h: 96, sort: true },
      { key: 'prop_lantern', x: 1360, y: 1100, h: 96, sort: true },
      ...trees(31, 2400, 1600, villageAvoid),
      ...scatter({
        seed: 32,
        count: 18,
        area: { x: 180, y: 180, w: 2040, h: 1240 },
        key: 'prop_flower',
        minH: 40,
        maxH: 62,
        avoid: villageAvoid,
      }),
    ],
    npcs: [
      { id: 'luna', key: 'npc_luna', x: 1200, y: 560, h: 156 },
      { id: 'popo', key: 'npc_popo', x: 760, y: 1040, h: 150 },
      { id: 'kiki', key: 'npc_kiki', x: 1640, y: 1040, h: 156 },
    ],
    spots: [
      { id: 'well', x: 720, y: 940, r: 64 },
      { id: 'board', x: 1040, y: 530, r: 64 },
    ],
    enemies: [],
    exits: [
      { x: 1200, y: 230, w: 360, h: 200, to: 'meadow', spawn: 'fromVillage' },
      { x: 1200, y: 1160, w: 320, h: 280, to: 'forest', spawn: 'fromVillage' },
    ],
    pickups: [],
  },
  forest: {
    id: 'forest',
    name: '몽환의 숲',
    bgm: 'battle',
    ground: 'tex_grass',
    tint: 0xe7ffe9,
    width: 2200,
    height: 1500,
    spawns: {
      default: { x: 1100, y: 520 },
      fromVillage: { x: 1100, y: 520 },
      fromVale: { x: 1100, y: 1040 },
    },
    paths: [{ x: 1100, y: 750, w: 210, h: 1240 }],
    props: [
      { key: 'prop_portal', x: 1100, y: 180, h: 200, sort: true },
      { key: 'prop_portal', x: 1100, y: 1360, h: 200, sort: true },
      { key: 'prop_mushroom', x: 620, y: 520, h: 170, sort: true, block: { w: 54, h: 30 } },
      { key: 'prop_mushroom', x: 1560, y: 980, h: 180, sort: true, block: { w: 54, h: 30 } },
      { key: 'prop_crystal', x: 1500, y: 420, h: 100, sort: true, block: { w: 36, h: 22 } },
      ...trees(41, 2200, 1500, forestAvoid),
      ...scatter({
        seed: 42,
        count: 14,
        area: { x: 200, y: 220, w: 1800, h: 1060 },
        key: 'prop_flower',
        minH: 40,
        maxH: 60,
        avoid: forestAvoid,
      }),
    ],
    npcs: [],
    spots: [],
    enemies: [
      { id: 'slime', x: 860, y: 480, tags: ['wild'] },
      { id: 'slime', x: 1340, y: 560, tags: ['wild'] },
      { id: 'slime', x: 760, y: 820, tags: ['wild'] },
      { id: 'slime', x: 1420, y: 900, tags: ['wild'] },
      { id: 'slime', x: 980, y: 1080, tags: ['wild'] },
      { id: 'bug', x: 1240, y: 420, tags: ['wild'] },
      { id: 'bug', x: 820, y: 1000, tags: ['wild'] },
      { id: 'bug', x: 1360, y: 1140, tags: ['wild'] },
      { id: 'bug', x: 1520, y: 680, tags: ['wild'] },
    ],
    exits: [
      { x: 1100, y: 220, w: 280, h: 220, to: 'village', spawn: 'fromForest' },
      { x: 1100, y: 1320, w: 280, h: 240, to: 'vale', spawn: 'fromForest' },
    ],
    pickups: [
      { kind: 'material', id: 'dream_dust', amount: 1, x: 1000, y: 600 },
      { kind: 'material', id: 'dream_dust', amount: 1, x: 1280, y: 960 },
      { kind: 'material', id: 'toy_part', amount: 1, x: 1500, y: 760 },
    ],
  },
  vale: {
    id: 'vale',
    name: '버섯 골짜기',
    bgm: 'battle',
    ground: 'tex_grass',
    tint: 0xe7f0ff,
    width: 2200,
    height: 1500,
    spawns: {
      default: { x: 1100, y: 520 },
      fromForest: { x: 1100, y: 520 },
      fromAltar: { x: 1100, y: 1040 },
    },
    paths: [{ x: 1100, y: 750, w: 200, h: 1200 }],
    props: [
      { key: 'prop_portal', x: 1100, y: 180, h: 200, sort: true },
      { key: 'prop_portal', x: 1100, y: 1360, h: 200, sort: true },
      { key: 'prop_mushroom', x: 520, y: 460, h: 200, sort: true, block: { w: 60, h: 34 } },
      { key: 'prop_mushroom', x: 1680, y: 640, h: 210, sort: true, block: { w: 60, h: 34 } },
      { key: 'prop_mushroom', x: 600, y: 1100, h: 180, sort: true, block: { w: 56, h: 30 } },
      { key: 'prop_crystal', x: 1500, y: 1080, h: 120, sort: true, block: { w: 40, h: 26 } },
      { key: 'prop_crystal', x: 760, y: 700, h: 100, sort: true, block: { w: 36, h: 22 } },
      ...trees(51, 2200, 1500, valeAvoid),
      ...scatter({
        seed: 52,
        count: 12,
        area: { x: 180, y: 200, w: 1840, h: 1080 },
        key: 'prop_flower',
        minH: 42,
        maxH: 66,
        avoid: valeAvoid,
      }),
    ],
    npcs: [],
    spots: [],
    enemies: [
      { id: 'rabbit', x: 780, y: 500, tags: ['wild'] },
      { id: 'rabbit', x: 1460, y: 640, tags: ['wild'] },
      { id: 'rabbit', x: 900, y: 980, tags: ['wild'] },
      { id: 'bat', x: 1240, y: 460, tags: ['wild'] },
      { id: 'bat', x: 1560, y: 900, tags: ['wild'] },
      { id: 'bat', x: 700, y: 1120, tags: ['wild'] },
      { id: 'rabbit', x: 1100, y: 760, tags: ['wild'], elite: 'swift' },
      { id: 'slime', x: 1320, y: 1100, tags: ['wild'], elite: 'volatile' },
    ],
    exits: [
      { x: 1100, y: 220, w: 280, h: 220, to: 'forest', spawn: 'fromVale' },
      { x: 1100, y: 1320, w: 280, h: 240, to: 'altar', spawn: 'fromVale' },
    ],
    pickups: [
      { kind: 'material', id: 'dream_dust', amount: 1, x: 860, y: 700 },
      { kind: 'material', id: 'dream_dust', amount: 1, x: 1400, y: 520 },
      { kind: 'material', id: 'toy_part', amount: 1, x: 1180, y: 1000 },
    ],
  },
  altar: {
    id: 'altar',
    name: '별빛 제단',
    bgm: 'battle',
    ground: 'tex_altar',
    tint: 0xffffff,
    width: 1800,
    height: 1400,
    spawns: {
      default: { x: 900, y: 980 },
      fromVale: { x: 900, y: 980 },
    },
    paths: [],
    props: [
      { key: 'prop_portal', x: 900, y: 1280, h: 200, sort: true },
      { key: 'prop_crystal', x: 520, y: 480, h: 130, sort: true, block: { w: 40, h: 24 } },
      { key: 'prop_crystal', x: 1280, y: 480, h: 140, sort: true, block: { w: 40, h: 24 } },
      { key: 'prop_crystal', x: 420, y: 860, h: 120, sort: true, block: { w: 40, h: 24 } },
      { key: 'prop_crystal', x: 1380, y: 860, h: 130, sort: true, block: { w: 40, h: 24 } },
      { key: 'prop_mushroom', x: 300, y: 640, h: 160, sort: true, block: { w: 50, h: 28 } },
      { key: 'prop_mushroom', x: 1500, y: 640, h: 170, sort: true, block: { w: 50, h: 28 } },
    ],
    npcs: [],
    spots: [],
    enemies: [{ id: 'bloom', x: 900, y: 640, tags: ['boss'] }],
    exits: [{ x: 900, y: 1240, w: 280, h: 240, to: 'vale', spawn: 'fromAltar', seal: 'boss' }],
    pickups: [],
  },
}
