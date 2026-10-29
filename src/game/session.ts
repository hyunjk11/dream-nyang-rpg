import { saveGame, saveSettings, loadSettings } from '../sim/persist'
import type { MutationResult, SaveData, Settings } from '../sim/types'
import { bus } from './bus'

export const live = {
  save: null as SaveData | null,
  paused: false,
}

export const settings = {
  current: loadSettings(),
}

export function applySettings(partial: Partial<Settings>): void {
  settings.current = { ...settings.current, ...partial }
  saveSettings(settings.current)
  if (live.save) {
    live.save.settings = { ...settings.current }
    saveGame(live.save)
  }
}

export function commit(result?: MutationResult): void {
  const save = live.save
  if (!save) return
  save.updatedAt = Date.now()
  save.settings = { ...settings.current }
  saveGame(save)
  if (result) {
    for (const toast of result.toasts) bus.emit('toast', toast)
    if (result.leveled) bus.emit('levelup', undefined)
    if (result.questPop) bus.emit('quest', undefined)
  }
  bus.emit('refresh', undefined)
}
