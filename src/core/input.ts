export interface Pad {
  /** Virtual stick (touch), -1..1. */
  x: number
  y: number
  /** Trigger held: left mouse (once the view is locked) or the touch fire button. */
  fire: boolean
}

const keys = new Set<string>()

export const pad: Pad = { x: 0, y: 0, fire: false }

let dashQueued = false
let talkQueued = false
let recallQueued = false
/** Active skill slots pressed (keys 1–4 or the hotbar), oldest first. */
const skillQueue: number[] = []
/** I / Tab = bag, K = skill tree. */
let menuQueued: 'bag' | 'skills' | null = null

/** Key code → hotbar slot (0–3). E and T stay talk / recall. */
export function skillSlotFor(code: string): number {
  const m = /^(?:Digit|Numpad)([1-4])$/.exec(code)
  return m ? Number(m[1]) - 1 : -1
}

/**
 * Shoulder-camera input, shared by the town and the dungeon. A click locks the pointer and
 * mouse motion turns the view; Esc (the browser) releases it. The click that takes the lock
 * never fires, so grabbing the view doesn't waste a shot. On touch, a drag on the right part of
 * the screen looks around and only the fire button shoots.
 */
export const shoulder = {
  /** World input armed (off on the title screen and while swapping worlds). */
  on: false,
  /** View turn handler: pixels moved and whether it came from a finger. */
  look: (_dx: number, _dy: number, _touch: boolean) => {},
  get locked(): boolean {
    return typeof document !== 'undefined' && !!document.pointerLockElement
  },
}

/** The browser refused pointer lock (headless, iframes, old browsers): clicks fire directly. */
let lockRefused = false
/** Once a lock has worked, a later refusal (Chrome's re-lock cooldown after Esc) is temporary. */
let everLocked = false
let fireFinger = -1
let lockedAt = 0
const refuse = () => {
  if (!everLocked) lockRefused = true
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerlockchange', () => {
    lockedAt = performance.now()
    if (document.pointerLockElement) everLocked = true
  })
  document.addEventListener('pointerlockerror', refuse)
}

/**
 * Decide what a left click on the world does: take the pointer lock (no shot), or fire.
 * Pure so the rule is testable.
 */
export function clickAction(locked: boolean, refused: boolean): 'lock' | 'fire' {
  return locked || refused ? 'fire' : 'lock'
}

function requestLock(canvas: HTMLCanvasElement): void {
  if (!canvas.requestPointerLock) {
    lockRefused = true
    return
  }
  try {
    const out = canvas.requestPointerLock() as Promise<void> | undefined
    if (out && typeof out.catch === 'function') out.catch(refuse)
  } catch {
    refuse()
  }
}

export function installInput(canvas: HTMLCanvasElement): void {
  // The browser menu would pop over the game.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    keys.add(event.code)
    if (event.code === 'Space' && !event.repeat) dashQueued = true
    if ((event.code === 'KeyE' || event.code === 'Enter') && !event.repeat) talkQueued = true
    if (event.code === 'KeyT' && !event.repeat) recallQueued = true
    if (event.code === 'Tab') event.preventDefault()
    if (event.repeat) return
    const slot = skillSlotFor(event.code)
    if (slot >= 0 && skillQueue.length < 4) skillQueue.push(slot)
    if (event.code === 'KeyI' || event.code === 'Tab') menuQueued = 'bag'
    if (event.code === 'KeyK') menuQueued = 'skills'
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  window.addEventListener('blur', () => {
    keys.clear()
    pad.fire = false
  })
  let lookFinger = -1
  let lookX = 0
  let lookY = 0
  canvas.addEventListener('pointerdown', (event) => {
    if (!shoulder.on) return
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return
      if (clickAction(shoulder.locked, lockRefused) === 'lock') requestLock(canvas)
      else pad.fire = true
      return
    }
    // Fingers: the right part of the screen is the look pad (the stick and buttons sit on top).
    if (event.clientX > window.innerWidth * 0.4 && lookFinger < 0) {
      lookFinger = event.pointerId
      lookX = event.clientX
      lookY = event.clientY
    }
  })
  window.addEventListener('pointermove', (event) => {
    if (!shoulder.on) return
    // Browsers report one bogus jump right after the lock engages; drop it and any absurd spike.
    if (event.pointerType === 'mouse') {
      if (shoulder.locked && performance.now() - lockedAt > 90 && Math.abs(event.movementX) < 300 && Math.abs(event.movementY) < 300) {
        shoulder.look(event.movementX, event.movementY, false)
      }
    } else if (event.pointerId === lookFinger) {
      shoulder.look(event.clientX - lookX, event.clientY - lookY, true)
      lookX = event.clientX
      lookY = event.clientY
    }
  })
  window.addEventListener('pointerup', (event) => {
    if (event.pointerId === lookFinger) {
      lookFinger = -1
      return
    }
    if (event.pointerType !== 'mouse') {
      // Lifting the look finger never stops fire; the fire button's own finger does.
      if (event.pointerId === fireFinger) {
        fireFinger = -1
        pad.fire = false
      }
      return
    }
    if (event.button === 0) pad.fire = false
  })
  const dash = document.getElementById('dash')
  dash?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    dashQueued = true
  })
  const fire = document.getElementById('fire')
  fire?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    fireFinger = event.pointerId
    pad.fire = true
  })
  window.addEventListener('pointercancel', (event) => {
    if (event.pointerId === lookFinger) lookFinger = -1
    if (event.pointerId === fireFinger) {
      fireFinger = -1
      pad.fire = false
    }
  })
  document.getElementById('talk')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    talkQueued = true
  })
  document.getElementById('recall')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    recallQueued = true
  })
  document.querySelectorAll<HTMLElement>('#hotbar [data-slot]').forEach((el) => {
    el.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      skillQueue.push(Number(el.dataset.slot))
    })
  })
  document.getElementById('bag-btn')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    menuQueued = 'bag'
  })
  const stick = document.getElementById('stick')
  const knob = document.getElementById('knob')
  if (stick && knob) bindStick(stick, knob)
}

/** E / Enter / the talk button: talk to whoever is close, or advance the line. */
export function consumeTalk(): boolean {
  const had = talkQueued
  talkQueued = false
  return had
}

/** T / the 귀환 button: read the town scroll down in the sewer. */
export function consumeRecall(): boolean {
  const had = recallQueued
  recallQueued = false
  return had
}

/** Next pressed active slot (0–3), or -1. */
export function consumeSkill(): number {
  return skillQueue.shift() ?? -1
}

/** I / Tab / K / the 가방 button since the last frame. */
export function consumeMenu(): 'bag' | 'skills' | null {
  const had = menuQueued
  menuQueued = null
  return had
}

/** Drop queued presses (menus closing, worlds swapping). */
export function clearQueued(): void {
  skillQueue.length = 0
  menuQueued = null
}

export function consumeDash(): boolean {
  const had = dashQueued
  dashQueued = false
  return had
}

export function runningHeld(): boolean {
  return keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(pad.x, pad.y) > 0.9
}

export function axis(): { x: number; y: number } {
  if (Math.hypot(pad.x, pad.y) > 0.12) {
    const len = Math.hypot(pad.x, pad.y)
    return { x: pad.x / len, y: pad.y / len }
  }
  let x = 0
  let y = 0
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1
  const len = Math.hypot(x, y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

function bindStick(el: HTMLElement, knob: HTMLElement): void {
  const radius = 46
  el.addEventListener('pointerdown', (event) => {
    el.setPointerCapture(event.pointerId)
    const rect = el.getBoundingClientRect()
    const originX = rect.left + rect.width / 2
    const originY = rect.top + rect.height / 2
    const move = (ev: PointerEvent) => {
      let dx = ev.clientX - originX
      let dy = ev.clientY - originY
      const len = Math.hypot(dx, dy) || 1
      const clamped = Math.min(radius, len)
      dx = (dx / len) * clamped
      dy = (dy / len) * clamped
      knob.style.transform = `translate(${dx}px, ${dy}px)`
      pad.x = dx / radius
      pad.y = -dy / radius
    }
    const up = () => {
      knob.style.transform = 'translate(0px, 0px)'
      pad.x = 0
      pad.y = 0
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    move(event)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}
