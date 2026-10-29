export type MenuAction = 'inventory' | 'skills' | 'quests' | 'pause' | 'close' | 'advance'

const down = new Set<string>()
const skillQueue: string[] = []
const menuQueue: MenuAction[] = []
let dashQueued = false
let interactQueued = false
let potionQueued = false

export const gate = {
  suspended: false,
  onAdvance: null as null | (() => void),
  onClose: null as null | (() => void),
}

export const controls = {
  attackHeld: false,
  stickX: 0,
  stickY: 0,
  stickOn: false,
  queueDash(): void {
    dashQueued = true
  },
  consumeDash(): boolean {
    const had = dashQueued
    dashQueued = false
    return had
  },
  queueInteract(): void {
    interactQueued = true
  },
  consumeInteract(): boolean {
    const had = interactQueued
    interactQueued = false
    return had
  },
  queuePotion(): void {
    potionQueued = true
  },
  consumePotion(): boolean {
    const had = potionQueued
    potionQueued = false
    return had
  },
  queueSkill(id: string): void {
    skillQueue.push(id)
  },
  consumeSkill(): string | null {
    return skillQueue.shift() ?? null
  },
  queueMenu(action: MenuAction): void {
    menuQueue.push(action)
  },
  consumeMenu(): MenuAction | null {
    return menuQueue.shift() ?? null
  },
  axis(): { x: number; y: number } {
    if (this.stickOn) {
      const len = Math.hypot(this.stickX, this.stickY)
      if (len < 0.12) return { x: 0, y: 0 }
      return { x: this.stickX / len, y: this.stickY / len }
    }
    let x = 0
    let y = 0
    if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1
    if (down.has('KeyD') || down.has('ArrowRight')) x += 1
    if (down.has('KeyW') || down.has('ArrowUp')) y -= 1
    if (down.has('KeyS') || down.has('ArrowDown')) y += 1
    const len = Math.hypot(x, y)
    if (len === 0) return { x: 0, y: 0 }
    return { x: x / len, y: y / len }
  },
}

const SKILL_KEYS: Record<string, string> = {
  Digit1: 'spray',
  Digit2: 'shield',
  Digit3: 'focus',
  Digit4: 'taunt',
  KeyZ: 'heal',
  KeyX: 'pounce',
}

let installed = false

export function installInput(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    if (isMove(event.code)) {
      down.add(event.code)
      return
    }
    if (event.repeat) return
    if (gate.suspended) {
      if (event.code === 'Escape') gate.onClose?.()
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'KeyE') gate.onAdvance?.()
      return
    }
    if (SKILL_KEYS[event.code]) controls.queueSkill(SKILL_KEYS[event.code])
    else if (event.code === 'Space') controls.queueDash()
    else if (event.code === 'KeyE') controls.queueInteract()
    else if (event.code === 'KeyR') controls.queuePotion()
    else if (event.code === 'KeyI') controls.queueMenu('inventory')
    else if (event.code === 'KeyK') controls.queueMenu('skills')
    else if (event.code === 'KeyQ') controls.queueMenu('quests')
    else if (event.code === 'Escape') controls.queueMenu('pause')
  })
  window.addEventListener('keyup', (event) => down.delete(event.code))
  window.addEventListener('blur', () => {
    down.clear()
    controls.attackHeld = false
    controls.stickOn = false
  })
  window.addEventListener('pointerup', () => {
    controls.attackHeld = false
  })
  window.addEventListener('pointercancel', () => {
    controls.attackHeld = false
    controls.stickOn = false
  })
}

function isMove(code: string): boolean {
  return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' || code.startsWith('Arrow')
}

export function bindStick(el: HTMLElement, knob: HTMLElement): void {
  const radius = 46
  const set = (clientX: number, clientY: number, originX: number, originY: number) => {
    let dx = clientX - originX
    let dy = clientY - originY
    const len = Math.hypot(dx, dy) || 1
    const clamped = Math.min(radius, len)
    dx = (dx / len) * clamped
    dy = (dy / len) * clamped
    knob.style.transform = `translate(${dx}px, ${dy}px)`
    controls.stickOn = true
    controls.stickX = dx / radius
    controls.stickY = dy / radius
  }
  const reset = () => {
    knob.style.transform = 'translate(0px, 0px)'
    controls.stickOn = false
    controls.stickX = 0
    controls.stickY = 0
  }
  el.addEventListener('pointerdown', (event) => {
    el.setPointerCapture(event.pointerId)
    const rect = el.getBoundingClientRect()
    const originX = rect.left + rect.width / 2
    const originY = rect.top + rect.height / 2
    set(event.clientX, event.clientY, originX, originY)
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== event.pointerId) return
      set(ev.clientX, ev.clientY, originX, originY)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== event.pointerId) return
      reset()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}
