/**
 * Free mouse cursor on desktop. Alt (hold or toggle, picked in ⚙) lets go of the pointer lock so
 * the mouse can click HUD buttons, the minimap and quest rows; any open panel frees it too. While
 * free she stops turning and firing. Letting go of Alt, closing the panel or clicking the game
 * view takes the lock back; browsers only grant a lock right after a user gesture, so a failed
 * re-lock shows a small "클릭해서 계속" button instead.
 */

export type AltMode = 'hold' | 'toggle'

const MODE_KEY = 'dream-nyang-rpg-alt-mode'

/** Next "Alt wants the cursor" state after an Alt key event. Pure. */
export function altStep(mode: AltMode, free: boolean, type: 'down' | 'up', repeat = false): boolean {
  if (type === 'down') {
    if (repeat) return free
    return mode === 'hold' ? true : !free
  }
  return mode === 'hold' ? false : free
}

/** Should the cursor be free (no pointer lock, no aim, no fire)? Pure. */
export function cursorWanted(alt: boolean, panelOpen: boolean): boolean {
  return alt || panelOpen
}

/** Show the "클릭해서 계속" button: the view is armed, nothing wants the cursor, and the lock is gone. Pure. */
export function needsRelock(s: { armed: boolean; touch: boolean; locked: boolean; free: boolean; hadLock: boolean; refused: boolean; resumed?: boolean }): boolean {
  return s.armed && !s.touch && !s.locked && !s.free && s.hadLock && !s.refused && !s.resumed
}

/**
 * Which mouse cursor the page shows (2026-11): 'free' = the paw (title, panels, Alt), 'aim' = none at
 * all while the game is playing — even when the browser has not granted (or has just dropped) the
 * pointer lock, so play never shows a stray arrow — 'touch' = the OS default on phones. Pure.
 */
export function cursorLook(s: { armed: boolean; touch: boolean; free: boolean }): 'free' | 'aim' | 'touch' {
  if (s.touch) return 'touch'
  return s.armed && !s.free ? 'aim' : 'free'
}

/** The tiny "클릭하면 조준" hint: playing, no lock, the browser can lock, and the big resume button is not up. Pure. */
export function aimHintWanted(s: { armed: boolean; touch: boolean; free: boolean; locked: boolean; refused: boolean; relock: boolean; pending: boolean }): boolean {
  return cursorLook(s) === 'aim' && !s.locked && !s.refused && !s.relock && !s.pending
}

export function loadAltMode(): AltMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'toggle' ? 'toggle' : 'hold'
  } catch {
    return 'hold'
  }
}

export function saveAltMode(mode: AltMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // storage blocked: the pick lasts this session
  }
}

export const cursor = {
  mode: loadAltMode() as AltMode,
  /** Alt is asking for the cursor. */
  alt: false,
  /** Any panel up (bag, town, big map, settings, help, cards, talk): set by the game each frame. */
  panel: () => false,
  get free(): boolean {
    return cursorWanted(this.alt, this.panel())
  },
}

export const ALT_LABEL: Record<AltMode, string> = { hold: 'Alt: 누르는 동안 커서', toggle: 'Alt: 눌러서 커서 전환' }

/** Alt keys: browsers open a menu on a lone Alt (Firefox / Windows); the game keeps the key. */
let altListener: (free: boolean) => void = () => {}

/** Set the Alt spell from anywhere (a click on the view ends it, a mode switch resets it) and tell the game. */
export function setAlt(on: boolean): void {
  if (cursor.alt === on) return
  cursor.alt = on
  altListener(on)
}

export function installAlt(onChange: (free: boolean) => void): void {
  altListener = onChange
  if (typeof window === 'undefined') return
  const isAlt = (e: KeyboardEvent) => e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight'
  window.addEventListener('keydown', (e) => {
    if (!isAlt(e)) return
    e.preventDefault()
    const next = altStep(cursor.mode, cursor.alt, 'down', e.repeat)
    setAlt(next)
  })
  window.addEventListener('keyup', (e) => {
    if (!isAlt(e)) return
    e.preventDefault()
    const next = altStep(cursor.mode, cursor.alt, 'up')
    setAlt(next)
  })
  // Alt-tabbing away never leaves a held Alt stuck on.
  window.addEventListener('blur', () => {
    if (cursor.mode === 'hold') setAlt(false)
  })
}
