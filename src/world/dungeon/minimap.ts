import { Tile, worldToTile, type Maze } from './maze'

/** What a marker is; each draws its own little glyph. */
export type MapIcon = 'portal' | 'exit' | 'chest' | 'shrine' | 'nest' | 'key' | 'door' | 'done'

interface Mark {
  id: string
  x: number
  y: number
  color: string
  icon: MapIcon
  /** Shown even on tiles she has not seen yet (e.g. a dropped key). */
  always: boolean
}

const LEGEND: [MapIcon, string, string][] = [
  ['chest', '#ffd166', '상자'],
  ['shrine', '#8fd8ff', '제단'],
  ['nest', '#ff8fc8', '둥지'],
  ['key', '#ffe36e', '별 열쇠'],
  ['door', '#f2b64c', '별 문'],
  ['exit', '#7be0a8', '출구'],
]

/**
 * Minimap with fog of war: tiles she has seen (2-tile reveal radius), icons for chests, the
 * shrine, nests, the star key, the star door and the exit once found, chasing foes near her,
 * and her heading. M toggles a big centred map with a legend.
 */
export class Minimap {
  readonly el: HTMLCanvasElement | null
  readonly seen: Uint8Array
  private readonly maze: Maze
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly cell: number
  private readonly legend: HTMLElement | null
  private clock = 0
  private readonly marks: Mark[] = []
  private dots: { x: number; z: number }[] = []
  big = false
  private seq = 0

  constructor(maze: Maze, parent: HTMLElement | null, cell = 12) {
    this.maze = maze
    this.cell = cell
    this.seen = new Uint8Array(maze.w * maze.h)
    if (typeof document === 'undefined' || !parent) {
      this.el = null
      this.ctx = null
      this.legend = null
      return
    }
    const el = document.createElement('canvas')
    el.id = 'minimap'
    el.width = maze.w * cell
    el.height = maze.h * cell
    parent.appendChild(el)
    this.el = el
    this.ctx = el.getContext('2d')
    const legend = document.createElement('div')
    legend.id = 'map-legend'
    legend.innerHTML =
      '<b>지도</b>' +
      LEGEND.map(([, c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('') +
      '<span><i style="background:#ff5a7a"></i>쫓아오는 몹</span><small>M 닫기</small>'
    parent.appendChild(legend)
    this.legend = legend
  }

  /** Pin a marker on a tile; drawn once that tile is seen (or always). Returns its id. */
  mark(x: number, y: number, color: string, icon: MapIcon = 'portal', always = false, id = `m${this.seq++}`): string {
    this.unmark(id)
    this.marks.push({ id, x, y, color, icon, always })
    return id
  }

  unmark(id: string): void {
    const i = this.marks.findIndex((m) => m.id === id)
    if (i >= 0) this.marks.splice(i, 1)
  }

  /** Change a marker's icon (a looted chest goes grey). */
  restyle(id: string, icon: MapIcon, color: string): void {
    const m = this.marks.find((k) => k.id === id)
    if (m) {
      m.icon = icon
      m.color = color
    }
  }

  has(id: string): boolean {
    return this.marks.some((m) => m.id === id)
  }

  /** Toggle the big map (M). */
  toggle(force?: boolean): boolean {
    this.big = force ?? !this.big
    this.el?.classList.toggle('big', this.big)
    this.legend?.classList.toggle('on', this.big)
    this.clock = 0
    return this.big
  }

  /** Chasing foes to draw (world metres); only those on seen tiles show. */
  foes(list: { x: number; z: number }[]): void {
    this.dots = list
  }

  /** Reveal around her; returns true when new tiles came into view. */
  reveal(wx: number, wz: number, radius = 2): boolean {
    const { x, y } = worldToTile(this.maze, wx, wz)
    let fresh = false
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const tx = x + dx
        const ty = y + dy
        if (tx < 0 || ty < 0 || tx >= this.maze.w || ty >= this.maze.h) continue
        const i = ty * this.maze.w + tx
        if (!this.seen[i]) {
          this.seen[i] = 1
          fresh = true
        }
      }
    }
    return fresh
  }

  /** Share of open tiles seen so far (0..1). */
  get explored(): number {
    let open = 0
    let seen = 0
    for (let i = 0; i < this.maze.tiles.length; i += 1) {
      if (this.maze.tiles[i] === Tile.Solid) continue
      open += 1
      if (this.seen[i]) seen += 1
    }
    return open ? seen / open : 0
  }

  update(dt: number, wx: number, wz: number, yaw: number): void {
    this.reveal(wx, wz)
    this.clock -= dt
    if (this.clock > 0 || !this.ctx) return
    this.clock = 0.12
    const { ctx, cell, maze } = this
    ctx.clearRect(0, 0, maze.w * cell, maze.h * cell)
    for (let ty = 0; ty < maze.h; ty += 1) {
      for (let tx = 0; tx < maze.w; tx += 1) {
        const i = ty * maze.w + tx
        if (!this.seen[i]) continue
        const kind = maze.tiles[i]
        if (kind === Tile.Solid) ctx.fillStyle = 'rgba(58,40,88,0.85)'
        else if (kind === Tile.Boss) ctx.fillStyle = 'rgba(255,150,205,0.95)'
        else if (kind === Tile.Start) ctx.fillStyle = 'rgba(160,220,255,0.95)'
        else if (kind === Tile.Chamber) ctx.fillStyle = 'rgba(140,230,215,0.92)'
        else ctx.fillStyle = 'rgba(215,200,255,0.92)'
        ctx.fillRect(tx * cell, ty * cell, cell, cell)
      }
    }
    for (const m of this.marks) {
      if (!m.always && !this.seen[m.y * maze.w + m.x]) continue
      this.glyph(m)
    }
    ctx.fillStyle = '#ff5a7a'
    for (const f of this.dots) {
      const t = worldToTile(maze, f.x, f.z)
      if (!this.seen[t.y * maze.w + t.x]) continue
      ctx.beginPath()
      ctx.arc((f.x / (maze.w * 3.4) + 0.5) * maze.w * cell, (f.z / (maze.h * 3.4) + 0.5) * maze.h * cell, cell * 0.18, 0, Math.PI * 2)
      ctx.fill()
    }
    const p = worldToTile(maze, wx, wz)
    const cx = (p.x + 0.5) * cell
    const cy = (p.y + 0.5) * cell
    // Heading arrow: world +z is down the map, +x is right.
    const s = Math.sin(yaw)
    const c = Math.cos(yaw)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#3a2448'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx + s * cell * 0.9, cy + c * cell * 0.9)
    ctx.lineTo(cx + c * cell * 0.5 - s * cell * 0.4, cy - s * cell * 0.5 - c * cell * 0.4)
    ctx.lineTo(cx - c * cell * 0.5 - s * cell * 0.4, cy + s * cell * 0.5 - c * cell * 0.4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  private glyph(m: Mark): void {
    const ctx = this.ctx as CanvasRenderingContext2D
    const cell = this.cell
    const x = (m.x + 0.5) * cell
    const y = (m.y + 0.5) * cell
    const r = cell * 0.42
    ctx.fillStyle = m.color
    ctx.strokeStyle = '#3a2448'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    switch (m.icon) {
      case 'chest':
        ctx.rect(x - r, y - r * 0.7, r * 2, r * 1.4)
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x - r, y - r * 0.1)
        ctx.lineTo(x + r, y - r * 0.1)
        break
      case 'done':
        ctx.rect(x - r * 0.7, y - r * 0.5, r * 1.4, r)
        break
      case 'shrine':
        ctx.moveTo(x, y - r)
        ctx.lineTo(x + r * 0.75, y)
        ctx.lineTo(x, y + r)
        ctx.lineTo(x - r * 0.75, y)
        ctx.closePath()
        break
      case 'key':
      case 'exit':
        for (let k = 0; k < 10; k += 1) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5
          const rr = k % 2 ? r * 0.45 : r * 1.1
          if (k) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
          else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
        }
        ctx.closePath()
        break
      case 'door':
        ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8)
        break
      case 'nest':
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.fillStyle = '#3a2448'
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2)
        break
      default:
        ctx.arc(x, y, cell * 0.38, 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.stroke()
  }

  dispose(): void {
    this.el?.remove()
    this.legend?.remove()
  }
}
