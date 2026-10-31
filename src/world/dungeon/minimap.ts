import { Tile, worldToTile, type Maze } from './maze'

/**
 * Corner minimap: tiles she has seen (2-tile reveal radius), the boss chamber once found, the
 * portals and her heading. A small 2D canvas redrawn a few times a second.
 */
export class Minimap {
  readonly el: HTMLCanvasElement | null
  readonly seen: Uint8Array
  private readonly maze: Maze
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly cell: number
  private clock = 0
  private readonly marks: { x: number; y: number; color: string }[] = []

  constructor(maze: Maze, parent: HTMLElement | null, cell = 8) {
    this.maze = maze
    this.cell = cell
    this.seen = new Uint8Array(maze.w * maze.h)
    if (typeof document === 'undefined' || !parent) {
      this.el = null
      this.ctx = null
      return
    }
    const el = document.createElement('canvas')
    el.id = 'minimap'
    el.width = maze.w * cell
    el.height = maze.h * cell
    parent.appendChild(el)
    this.el = el
    this.ctx = el.getContext('2d')
  }

  /** Pin a marker (portal, nest) on a tile; drawn once that tile is seen. */
  mark(x: number, y: number, color: string): void {
    this.marks.push({ x, y, color })
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
      if (!this.seen[m.y * maze.w + m.x]) continue
      ctx.fillStyle = m.color
      ctx.beginPath()
      ctx.arc((m.x + 0.5) * cell, (m.y + 0.5) * cell, cell * 0.38, 0, Math.PI * 2)
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

  dispose(): void {
    this.el?.remove()
  }
}
