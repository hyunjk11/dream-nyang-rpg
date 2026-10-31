export type Behavior = 'hop' | 'kiter' | 'dasher' | 'swoop' | 'boss'

export interface EnemyDef {
  id: string
  name: string
  behavior: Behavior
  hp: number
  atk: number
  def: number
  speed: number
  xp: number
  radius: number
  contact: number
  knock: number
  gold: [number, number]
  gear: number
  weapon: number
  dust: number
  part: number
  potion: number
  projectile?: { speed: number; life: number; damage: number; kind: string }
}
