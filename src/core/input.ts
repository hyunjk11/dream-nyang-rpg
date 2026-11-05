import { StickTaps, autoRunAfterKey } from '../sim/autorun'
import { aimHintWanted, cursor, cursorLook, needsRelock, setAlt } from './cursor'

export interface Pad {
  /** Virtual stick (touch), -1..1. */
  x: number
  y: number
  /** Trigger held: left mouse (once the view is locked) or the touch fire button. */
  fire: boolean
}

const keys = new Set<string>()

export const pad: Pad = { x: 0, y: 0, fire: false }

/** 편의성: auto-run (R / NumLock, or double-tap the stick); any move input cancels it. */
let autoRun = false
let autoRunListener: ((on: boolean) => void) | null = null
const stickTaps = new StickTaps()

export function autoRunOn(): boolean {
  return autoRun
}

/** Turn auto-run on or off (world swaps, death and menus switch it off). */
export function setAutoRun(on: boolean): void {
  if (autoRun === on) return
  autoRun = on
  autoRunListener?.(on)
}

export function onAutoRun(fn: (on: boolean) => void): void {
  autoRunListener = fn
}

let dashQueued = false
let talkQueued = false
let mapQueued = false
let recallQueued = false
let candyQueued = false
let equipQueued = false
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
/** "클릭해서 계속" was clicked: play goes on even if the browser turned the lock down this time. */
let resumed = false
/**
 * The click asked for the lock and Chrome may still be in its post-Esc cooldown (a real Escape
 * rejects the request for about half a second). Keep asking on a short timer while the gesture's
 * activation lasts, so that one click finishes the resume instead of leaving a second click.
 */
let resumeWanted = false
let resumeTries = 0
let resumeTimer = 0
let fireFinger = -1
let lockedAt = 0
let lockErrors = 0
const refuse = () => {
  lockErrors += 1
  if (!everLocked) lockRefused = true
}
/** How many quiet retries one click may spend, and the gap between them. Cooldown is ~0.5 s. */
export const LOCK_RETRY_MS = 100
export const LOCK_RETRY_CAP = 16
/** Try the lock again without another click? Pure. */
export function shouldRetryLock(s: { attempt: number; active: boolean; locked: boolean; refused: boolean; free: boolean }): boolean {
  return s.active && !s.locked && !s.refused && !s.free && s.attempt < LOCK_RETRY_CAP
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerlockchange', () => {
    lockedAt = performance.now()
    if (document.pointerLockElement) {
      everLocked = true
      // A refusal was only for that try (no gesture yet, a cooldown): a granted lock clears it.
      lockRefused = false
      stopResume()
    }
    // Losing the lock (Esc, a tab switch) asks for a fresh "클릭해서 계속".
    else {
      resumed = false
      stopResume()
    }
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

let view: HTMLCanvasElement | null = null
let lockAsked = 0

function stopResume(): void {
  resumeWanted = false
  if (typeof window !== 'undefined') window.clearTimeout(resumeTimer)
}

/** The request was turned down. One click keeps trying through Chrome's post-Esc cooldown. */
function failLock(): void {
  refuse()
  if (!resumeWanted || typeof window === 'undefined') return
  window.clearTimeout(resumeTimer)
  resumeTimer = window.setTimeout(() => {
    if (!shouldRetryLock({ attempt: resumeTries, active: gestureActive(), locked: shoulder.locked, refused: lockRefused, free: cursor.free })) {
      // Out of gestures or tries: the button comes back instead of pretending play resumed.
      if (!shoulder.locked) resumed = false
      stopResume()
      return
    }
    resumeTries += 1
    if (view) requestLock(view)
  }, LOCK_RETRY_MS)
}

function requestLock(canvas: HTMLCanvasElement): void {
  lockAsked = typeof performance === 'undefined' ? 0 : performance.now()
  if (!canvas.requestPointerLock) {
    lockRefused = true
    return
  }
  try {
    const out = canvas.requestPointerLock() as Promise<void> | undefined
    if (out && typeof out.catch === 'function') out.catch(() => failLock())
  } catch {
    failLock()
  }
}

/** Take the view lock again (the end of a free-cursor spell). */
export function relockView(): void {
  if (view && !lockRefused && !shoulder.locked) requestLock(view)
}

/**
 * One click on "클릭해서 계속" (or the start buttons): play resumes on this gesture. Chrome rejects
 * a fresh lock for about half a second after a real Escape; the same click keeps asking until the
 * cooldown lifts (the activation from the click is still good), so a second click is not required.
 */
export function resumeView(): void {
  resumed = true
  resumeWanted = true
  resumeTries = 0
  lockAsked = 0
  relockView()
}

/** May the lock be asked for now? Only inside a user gesture; a refused first ask would mark the browser as lock-less. */
export function gestureActive(): boolean {
  const ua = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return !!ua?.isActive
}

let wasFree = false
/**
 * Once a frame: drop the lock while the cursor should be free, take it back when that ends (the
 * close click still counts as the user gesture browsers ask for), and paint the cursor state.
 * Returns whether the "클릭해서 계속" button should show.
 */
export function syncCursor(armed: boolean, touch: boolean): boolean {
  if (typeof document === 'undefined') return false
  const free = cursor.free
  const locked = shoulder.locked
  if (free && locked) document.exitPointerLock?.()
  if (free && fireFinger < 0) pad.fire = false
  if (free && !wasFree) resumed = false
  if (wasFree && !free && armed && !touch && everLocked && !locked) relockView()
  wasFree = free
  const pending = performance.now() - lockAsked < 400
  const relock = !pending && needsRelock({ armed, touch, locked, free, hadLock: everLocked, refused: lockRefused, resumed })
  // While the "클릭해서 계속" button is up the paw shows so it can be clicked; otherwise, while
  // playing, the cursor is hidden whether or not the lock took (2026-11).
  const look = cursorLook({ armed: armed && !relock, touch, free })
  const body = document.body.classList
  if (body.contains('cursor-free') !== (look === 'free' && !locked)) body.toggle('cursor-free', look === 'free' && !locked)
  if (body.contains('cursor-aim') !== (look === 'aim')) body.toggle('cursor-aim', look === 'aim')
  aiming = look === 'aim'
  lockHint = aimHintWanted({ armed, touch, free, locked, refused: lockRefused, relock, pending })
  return relock
}

let aiming = false
let lockHint = false
/** Show the small "클릭하면 조준" hint (lock truly missing while playing). */
export function aimHint(): boolean {
  return lockHint
}

/** Lock state for QA and the HUD. */
export function lockState(): { locked: boolean; refused: boolean; everLocked: boolean; resumed: boolean; aiming: boolean; errors: number } {
  return { locked: shoulder.locked, refused: lockRefused, everLocked, resumed, aiming, errors: lockErrors }
}

/** A key or click while playing without the lock: ask again (keys and clicks are user gestures). */
function retryLock(): void {
  if (!view || !aiming || shoulder.locked || cursor.free) return
  if (performance.now() - lockAsked < 600) return
  requestLock(view)
}

let mapClick = false
/** A click on the minimap (opens or closes the big map). */
export function queueMap(): void {
  mapClick = true
}

export function installInput(canvas: HTMLCanvasElement): void {
  view = canvas
  // The browser menu would pop over the game.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    keys.add(event.code)
    setAutoRun(autoRunAfterKey(autoRun, event.code, event.repeat))
    if (event.code === 'Space' && !event.repeat) dashQueued = true
    if ((event.code === 'KeyE' || event.code === 'Enter') && !event.repeat) talkQueued = true
    if (event.code === 'KeyM' && !event.repeat) mapQueued = true
    if (event.code === 'KeyT' && !event.repeat) recallQueued = true
    if (event.code === 'KeyQ' && !event.repeat) candyQueued = true
    if (event.code === 'KeyG' && !event.repeat) equipQueued = true
    if (event.code === 'Tab') event.preventDefault()
    if (event.repeat) return
    // Lost or refused lock while playing: any key press is a fresh gesture to take it back.
    if (shoulder.on && event.code !== 'Escape' && !event.altKey) retryLock()
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
  // A click that lands on the HUD (not the canvas) while aiming without the lock also retries it.
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !shoulder.on || event.target === canvas) return
    const el = event.target as HTMLElement | null
    if (el?.closest?.('button, a, input, select, textarea, [data-tip], #minimap, .panel, #inv, #town')) return
    retryLock()
  }, true)
  let lookFinger = -1
  let lookX = 0
  let lookY = 0
  canvas.addEventListener('pointerdown', (event) => {
    if (!shoulder.on) return
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return
      // A free cursor never shoots; a click on the game view ends an Alt spell and takes the lock.
      if (cursor.free) {
        if (cursor.alt && !cursor.panel()) {
          setAlt(false)
          requestLock(canvas)
        }
        return
      }
      if (clickAction(shoulder.locked, lockRefused) === 'lock') {
        // Same rule as the button: this click resumes, and rides out a post-Esc cooldown.
        resumed = true
        resumeWanted = true
        resumeTries = 0
        requestLock(canvas)
      } else {
        pad.fire = true
        // Refused before (no gesture yet, a cooldown): this click is a fresh gesture, ask again.
        if (!shoulder.locked) retryLock()
      }
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
      if (shoulder.locked && !cursor.free && performance.now() - lockedAt > 90 && Math.abs(event.movementX) < 300 && Math.abs(event.movementY) < 300) {
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
  document.getElementById('candy')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    candyQueued = true
  })
  document.getElementById('bag-btn')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    menuQueued = 'bag'
  })
  const stick = document.getElementById('stick')
  const knob = document.getElementById('knob')
  if (stick && knob) bindStick(stick, knob)
}

/** M: toggle the big dungeon map. */
export function consumeMap(): boolean {
  const had = mapQueued || mapClick
  mapQueued = false
  mapClick = false
  return had
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

/** Q / the 사탕 button: eat a heart candy. */
export function consumeCandy(): boolean {
  const had = candyQueued
  candyQueued = false
  return had
}

/** G (or the pickup toast's button): wear the newest pickup. */
export function consumeQuickEquip(): boolean {
  const had = equipQueued
  equipQueued = false
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
  candyQueued = false
  equipQueued = false
}

export function consumeDash(): boolean {
  const had = dashQueued
  dashQueued = false
  return had
}

export function runningHeld(): boolean {
  return autoRun || keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(pad.x, pad.y) > 0.9
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
  if (len === 0) return autoRun ? { x: 0, y: 1 } : { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

function bindStick(el: HTMLElement, knob: HTMLElement): void {
  const radius = 46
  el.addEventListener('pointerdown', (event) => {
    el.setPointerCapture(event.pointerId)
    const rect = el.getBoundingClientRect()
    const originX = rect.left + rect.width / 2
    const originY = rect.top + rect.height / 2
    const downAt = performance.now()
    const startX = event.clientX
    const startY = event.clientY
    let travel = 0
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
      travel = Math.max(travel, Math.hypot(ev.clientX - startX, ev.clientY - startY) / radius)
    }
    const up = () => {
      // A double tap toggles auto-run; a real drag cancels it.
      const kind = stickTaps.release(downAt, performance.now(), travel)
      if (kind === 'double') setAutoRun(!autoRun)
      else if (kind === 'drag') setAutoRun(false)
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
