export interface SheetDef {
  key: string
  file: string
  frameWidth: number
  frameHeight: number
  frames: number
}

export const SHEETS: SheetDef[] = [
  { key: 'byeolha_walk_side', file: 'byeolha_walk_side.png', frameWidth: 300, frameHeight: 400, frames: 6 },
  { key: 'byeolha_walk_front', file: 'byeolha_walk_front.png', frameWidth: 300, frameHeight: 400, frames: 6 },
  { key: 'byeolha_walk_back', file: 'byeolha_walk_back.png', frameWidth: 300, frameHeight: 400, frames: 6 },
  { key: 'byeolha_idle', file: 'byeolha_idle.png', frameWidth: 300, frameHeight: 400, frames: 4 },
  { key: 'byeolha_hit', file: 'byeolha_hit.png', frameWidth: 300, frameHeight: 400, frames: 4 },
  { key: 'byeolha_dash', file: 'byeolha_dash.png', frameWidth: 300, frameHeight: 400, frames: 4 },
  { key: 'byeolha_death', file: 'byeolha_death.png', frameWidth: 300, frameHeight: 400, frames: 4 },
  { key: 'mochi_walk', file: 'mochi_walk.png', frameWidth: 280, frameHeight: 260, frames: 6 },
  { key: 'mochi_idle', file: 'mochi_idle.png', frameWidth: 280, frameHeight: 260, frames: 4 },
]
