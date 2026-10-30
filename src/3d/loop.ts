import { resolveDialogue, npcMarker } from '../data/dialogues'
import { applyActions, freshSave, onDeath, type ActionOutcome } from '../sim/mutate'
import { addMaterial, onEnter, onKill, onTalk, tracker } from '../sim/quests'
import { gainGold } from '../sim/stats'
import { emptyResult, mergeResult, type Action, type MutationResult, type SaveData } from '../sim/types'
import type { FoeKind } from './foes'
import type { ZoneId } from './zones3d'
import { ZONE_IDS } from './zones3d'

/** Its own slot: the 3D slice never overwrites the 2D game's save. */
export const SAVE_KEY_3D = 'dream-nyang-rpg-3d-save-v1'

export interface Storageish {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type Loot = 'dream_dust' | 'toy_part'

/**
 * What a sleeping foe leaves behind: elites always hold a toy part (Kiki's errand), wild foes in
 * the forest and vale drop dream dust about half the time (Luna's errand). Gold always drops.
 */
export function killLoot(zone: ZoneId, tags: readonly string[], elite: string | undefined, roll: number): Loot[] {
  const out: Loot[] = []
  if (elite) out.push('toy_part')
  if (tags.includes('wild') && (zone === 'forest' || zone === 'vale') && roll < 0.5) out.push('dream_dust')
  return out
}

/**
 * The game loop's state without any DOM or three.js: the 2D save shape and quest rules
 * (src/sim), driven by 3D events — kills, pickups, portal hops and dialogue actions.
 */
export class GameState {
  save: SaveData
  constructor(save: SaveData = freshSave()) {
    this.save = save
  }

  get zone(): ZoneId {
    return (ZONE_IDS as readonly string[]).includes(this.save.zoneId) ? (this.save.zoneId as ZoneId) : 'meadow'
  }

  /** Step into a zone: counts 'enter' objectives (arriving in the village ends the prologue). */
  enter(zone: ZoneId): MutationResult {
    this.save.zoneId = zone
    this.save.spawn = 'default'
    return onEnter(this.save, zone)
  }

  kill(kind: FoeKind, tags: readonly string[]): MutationResult {
    return onKill(this.save, kind, [...tags])
  }

  pickup(id: Loot | 'gold', amount = 1): MutationResult {
    if (id === 'gold') {
      gainGold(this.save, amount)
      return emptyResult()
    }
    return addMaterial(this.save, id, amount)
  }

  talked(npc: string): MutationResult {
    return onTalk(this.save, npc)
  }

  dialogueFor(npc: string): string {
    return resolveDialogue(npc, this.save)
  }

  marker(npc: string): '' | '!' | '?' {
    return npcMarker(this.save, npc)
  }

  run(actions: Action[]): ActionOutcome {
    return applyActions(this.save, actions)
  }

  /** Lose a little gold and wake at home (the meadow before the prologue ends, else the village). */
  died(): { lost: number; home: ZoneId } {
    const lost = onDeath(this.save)
    return { lost, home: this.zone }
  }

  tracker(): { title: string; lines: string[] }[] {
    return tracker(this.save)
  }

  /** The bloom has been put to sleep and reported to Luna: the night's story is done. */
  get finished(): boolean {
    return this.save.quests.q_bloom?.status === 'turnedIn'
  }

  persist(store: Storageish | null): void {
    if (!store) return
    this.save.updatedAt = Date.now()
    try {
      store.setItem(SAVE_KEY_3D, JSON.stringify(this.save))
    } catch {
      /* private mode or full: play on without saving */
    }
  }

  static load(store: Storageish | null): GameState | null {
    const raw = store?.getItem(SAVE_KEY_3D)
    if (!raw) return null
    try {
      const save = JSON.parse(raw) as SaveData
      if (!save || save.version !== 1 || !save.quests || !Array.isArray(save.items)) return null
      save.materials = { dream_dust: 0, toy_part: 0, ...save.materials }
      return new GameState(save)
    } catch {
      return null
    }
  }
}

export function merge(...results: MutationResult[]): MutationResult {
  return results.reduce(mergeResult, emptyResult())
}
