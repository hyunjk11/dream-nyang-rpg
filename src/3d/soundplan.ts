/** Pure sound design data for the 3D slice: which files play for each cue, and the music mix. */

export interface Cue {
  /** Files under assets/; one is picked per play so repeats do not sound robotic. */
  files: readonly string[]
  volume: number
  /** Random pitch spread (+/-), as a playback-rate fraction. */
  pitch: number
  /** Minimum ms between two plays of this cue. */
  gap: number
}

const k = (name: string) => `audio3d/${name}.mp3`
const own = (name: string) => `audio/${name}.wav`

/** Kenney CC0 packs for impacts, steps and UI; the project's own synth for guns and pickups. */
export const CUES = {
  shoot_water: { files: [own('shoot_water')], volume: 0.42, pitch: 0.05, gap: 70 },
  shoot_bubble: { files: [own('shoot_bubble')], volume: 0.36, pitch: 0.06, gap: 90 },
  dash: { files: [own('dash')], volume: 0.5, pitch: 0.04, gap: 120 },
  hit: { files: [k('hit_0'), k('hit_1'), k('hit_2')], volume: 0.7, pitch: 0.08, gap: 40 },
  boss_hit: { files: [k('boss_hit')], volume: 0.32, pitch: 0.05, gap: 160 },
  pop: { files: [k('pop_0'), k('pop_1')], volume: 0.7, pitch: 0.1, gap: 60 },
  hurt: { files: [k('hurt_0'), k('hurt_1')], volume: 0.75, pitch: 0.05, gap: 120 },
  coin: { files: [own('coin')], volume: 0.4, pitch: 0.08, gap: 45 },
  heal: { files: [own('heal'), k('heal_ui')], volume: 0.5, pitch: 0, gap: 300 },
  step: { files: [k('step_0'), k('step_1'), k('step_2'), k('step_3')], volume: 0.22, pitch: 0.1, gap: 150 },
  splash: { files: [k('splash')], volume: 0.35, pitch: 0.15, gap: 60 },
  windup: { files: [k('windup')], volume: 0.4, pitch: 0.03, gap: 400 },
  ui: { files: [k('ui')], volume: 0.5, pitch: 0, gap: 45 },
  talk_open: { files: [k('talk_open')], volume: 0.5, pitch: 0, gap: 150 },
  talk_next: { files: [k('talk_next')], volume: 0.5, pitch: 0.04, gap: 60 },
  victory: { files: [k('victory')], volume: 0.55, pitch: 0, gap: 1500 },
  down: { files: [k('down')], volume: 0.55, pitch: 0, gap: 1500 },
} as const satisfies Record<string, Cue>

export type CueName = keyof typeof CUES

export const MUSIC = {
  village: 'audio3d/bgm_village.mp3',
  battle: 'audio3d/bgm_battle.mp3',
  /** Music sits under the effects. */
  level: 0.34,
  /** Seconds for a full crossfade. */
  fade: 1.6,
  /** Seconds of calm before the battle track gives way again. */
  calm: 4,
} as const

/** Pick a variant without repeating the last one when there is a choice. */
export function pickVariant(count: number, last: number, roll: number): number {
  if (count <= 1) return 0
  const pick = Math.floor(roll * (count - 1))
  return pick >= last ? pick + 1 : pick
}

export interface MusicState {
  /** 0 = village, 1 = battle. */
  mix: number
  /** Seconds since the last threat. */
  calm: number
}

/**
 * Ease the village/battle mix toward battle while a foe is close (or striking), and back to
 * the village track after a few calm seconds. Returns the new state; gains are equal-power.
 */
export function stepMusic(state: MusicState, dt: number, threat: boolean): MusicState {
  const calm = threat ? 0 : state.calm + dt
  const want = calm < MUSIC.calm ? 1 : 0
  const rate = dt / MUSIC.fade
  const mix = want > state.mix ? Math.min(1, state.mix + rate) : Math.max(0, state.mix - rate)
  return { mix, calm }
}

export function musicGains(mix: number): { village: number; battle: number } {
  return { village: Math.cos((mix * Math.PI) / 2), battle: Math.sin((mix * Math.PI) / 2) }
}
