export interface Pad {
  x: number
  y: number
  fire: boolean
  dash: boolean
  pointer: boolean
  px: number
  py: number
  /** Fire came from a finger (attack button or a tap), so auto-aim may help. */
  touchFire: boolean
  /** Right mouse button held: dragging turns the camera instead of moving the aim. */
  orbiting: boolean
}

const keys = new Set<string>()

export const pad: Pad = { x: 0, y: 0, fire: false, dash: false, pointer: false, px: 0, py: 0, touchFire: false, orbiting: false }

let dashQueued = false
let talkQueued = false

export function installInput(canvas: HTMLCanvasElement, orbit: (dx: number, dy: number) => void = () => {}): void {
  // Right-drag turns the view; the browser menu would pop over the game.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  let orbitX = 0
  let orbitY = 0
  // Fingers on the canvas: a second one means pinch/turn the view, not shoot.
  const touches = new Set<number>()
  const lift = (event: PointerEvent) => touches.delete(event.pointerId)
  canvas.addEventListener('pointerup', lift)
  canvas.addEventListener('pointercancel', lift)
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    keys.add(event.code)
    if (event.code === 'Space' && !event.repeat) dashQueued = true
    if ((event.code === 'KeyE' || event.code === 'Enter') && !event.repeat) talkQueued = true
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  window.addEventListener('blur', () => {
    keys.clear()
    pad.fire = false
    pad.orbiting = false
  })
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button === 2) {
      // Keep the cursor (and so the aim) where it was; only the drag delta turns the camera.
      pad.orbiting = true
      orbitX = event.clientX
      orbitY = event.clientY
      canvas.setPointerCapture?.(event.pointerId)
      return
    }
    if (event.pointerType === 'touch') {
      touches.add(event.pointerId)
      if (touches.size >= 2) {
        pad.fire = false
        return
      }
    }
    pad.pointer = true
    if (event.button === 0) pad.fire = true
    pad.touchFire = event.pointerType !== 'mouse'
    pad.px = event.clientX
    pad.py = event.clientY
  })
  window.addEventListener('pointermove', (event) => {
    if (pad.orbiting) {
      orbit(event.clientX - orbitX, event.clientY - orbitY)
      orbitX = event.clientX
      orbitY = event.clientY
      return
    }
    if (event.target === canvas || pad.fire) {
      pad.pointer = true
      pad.px = event.clientX
      pad.py = event.clientY
    }
  })
  window.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'mouse' && event.button === 2) {
      pad.orbiting = false
      // Resume aiming from wherever the cursor ended up; her turn-rate cap smooths it.
      pad.px = event.clientX
      pad.py = event.clientY
      return
    }
    pad.fire = false
  })
  const dash = document.getElementById('dash')
  dash?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    dashQueued = true
  })
  const fire = document.getElementById('fire')
  fire?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    pad.fire = true
    pad.touchFire = true
  })
  document.getElementById('talk')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    talkQueued = true
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
