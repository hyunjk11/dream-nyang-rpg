export interface Pad {
  x: number
  y: number
  fire: boolean
  dash: boolean
  pointer: boolean
  px: number
  py: number
}

const keys = new Set<string>()

export const pad: Pad = { x: 0, y: 0, fire: false, dash: false, pointer: false, px: 0, py: 0 }

let dashQueued = false

export function installInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    keys.add(event.code)
    if (event.code === 'Space' && !event.repeat) dashQueued = true
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  window.addEventListener('blur', () => {
    keys.clear()
    pad.fire = false
  })
  canvas.addEventListener('pointerdown', (event) => {
    pad.pointer = true
    pad.fire = event.button === 0
    pad.px = event.clientX
    pad.py = event.clientY
  })
  window.addEventListener('pointermove', (event) => {
    if (event.target === canvas || pad.fire) {
      pad.pointer = true
      pad.px = event.clientX
      pad.py = event.clientY
    }
  })
  window.addEventListener('pointerup', () => {
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
  })
  const stick = document.getElementById('stick')
  const knob = document.getElementById('knob')
  if (stick && knob) bindStick(stick, knob)
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
