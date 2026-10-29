import { DEFAULT_SETTINGS, type SaveData, type Settings } from './types'

export const SAVE_KEY = 'dream-nyang-rpg-save-v1'
export const SETTINGS_KEY = 'dream-nyang-rpg-settings'

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** The first release saved these loud slider defaults into every new game. */
const LEGACY_LOUD = { master: 1, bgm: 0.55, sfx: 0.85 }

export function coalesceSettings(partial?: Partial<Settings>): Settings {
  const next: Settings = { ...DEFAULT_SETTINGS, ...partial }
  if (next.master === LEGACY_LOUD.master && next.bgm === LEGACY_LOUD.bgm && next.sfx === LEGACY_LOUD.sfx) {
    next.master = DEFAULT_SETTINGS.master
    next.bgm = DEFAULT_SETTINGS.bgm
    next.sfx = DEFAULT_SETTINGS.sfx
  }
  return next
}

export function loadSettings(): Settings {
  const raw = store()?.getItem(SETTINGS_KEY)
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>
    const next = coalesceSettings(parsed)
    if (next.master !== parsed.master || next.bgm !== parsed.bgm || next.sfx !== parsed.sfx) saveSettings(next)
    return next
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  store()?.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadGame(): SaveData | null {
  const raw = store()?.getItem(SAVE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SaveData
    if (!parsed || parsed.version !== 1 || !parsed.quests || !Array.isArray(parsed.items)) return null
    parsed.settings = coalesceSettings(parsed.settings)
    parsed.materials = { dream_dust: 0, toy_part: 0, ...parsed.materials }
    return parsed
  } catch {
    return null
  }
}

export function saveGame(save: SaveData): void {
  save.updatedAt = Date.now()
  store()?.setItem(SAVE_KEY, JSON.stringify(save))
}

export function hasGame(): boolean {
  return loadGame() !== null
}

export function clearGame(): void {
  store()?.removeItem(SAVE_KEY)
}
