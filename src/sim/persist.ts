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

export function loadSettings(): Settings {
  const raw = store()?.getItem(SETTINGS_KEY)
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed }
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
    parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings }
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
