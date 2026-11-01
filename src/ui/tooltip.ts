/**
 * Hover tooltips for the free mouse cursor: anything with data-tip (items, skills, hotbar slots,
 * materials, quest rows) shows a small card by the pointer, kept inside the screen.
 * Mouse only; fingers and a locked pointer never see it.
 */

/** Place a w×h tip near (x, y) without leaving the view. Pure. */
export function tipSpot(x: number, y: number, w: number, h: number, vw: number, vh: number, gap = 14): { left: number; top: number } {
  let left = x + gap
  let top = y + gap
  if (left + w > vw - 6) left = x - gap - w
  if (top + h > vh - 6) top = y - gap - h
  return { left: Math.max(6, Math.min(left, vw - w - 6)), top: Math.max(6, Math.min(top, vh - h - 6)) }
}

export function installTooltips(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const tip = document.createElement('div')
  tip.id = 'tip'
  tip.className = 'hidden'
  tip.setAttribute('role', 'tooltip')
  document.body.append(tip)
  let owner: HTMLElement | null = null
  const hide = () => {
    owner = null
    tip.classList.add('hidden')
  }
  const place = (x: number, y: number) => {
    const r = tip.getBoundingClientRect()
    const at = tipSpot(x, y, r.width, r.height, window.innerWidth, window.innerHeight)
    tip.style.left = `${at.left}px`
    tip.style.top = `${at.top}px`
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || document.pointerLockElement) return hide()
    const t = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null
    if (!t) return hide()
    const text = t.dataset.tip ?? ''
    if (!text) return hide()
    if (owner !== t) {
      owner = t
      const [head, ...rest] = text.split('\n')
      tip.replaceChildren()
      const b = document.createElement('b')
      b.textContent = head
      tip.append(b)
      for (const line of rest) {
        const s = document.createElement('span')
        s.textContent = line
        tip.append(s)
      }
      tip.classList.remove('hidden')
    }
    place(e.clientX, e.clientY)
  })
  document.addEventListener('pointermove', (e) => {
    if (!owner) return
    if (!owner.isConnected || document.pointerLockElement) return hide()
    place(e.clientX, e.clientY)
  })
  document.addEventListener('pointerdown', hide)
  document.addEventListener('pointerlockchange', hide)
  return tip
}
