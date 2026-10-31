/**
 * Floor loot: little coins, heart candies, dream dust and gift boxes that pop out of a downed
 * foe (or the boss chest), bob on the water and fly to her when she comes close. Three.js only
 * for the look; what each pickup *is* comes from sim/loot (Drop).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  DoubleSide,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  OctahedronGeometry,
  SphereGeometry,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  ConeGeometry,
  type BufferGeometry,
  type Material,
} from 'three'
import { toonGradient } from '../../core/materials'
import { itemName, type Drop } from '../../sim/loot'
import { ITEMS } from '../../data/items'
import { RARITY_COLOR } from '../../sim/types'

interface Piece {
  drop: Drop
  mesh: Mesh
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  /** Flying to her. */
  pulled: boolean
  /** Rarity light beam / glow ring under an item (null for coins and candy). */
  beam: Mesh | null
  /** Floating name tag in rarity colour (items only). */
  label: Sprite | null
}

/** Beam height per rarity: common gets only a soft ring, legendary a tall pillar. */
export const BEAM_HEIGHT: Record<string, number> = { common: 0, uncommon: 1.4, rare: 2.4, epic: 3.4, legendary: 5 }

/** Pickups beyond this are folded into the oldest coin pile (no runaway mesh count). */
const CAP = 70
/** She draws pickups in from this far (m)... */
export const MAGNET = 2.4
/** ...and collects them here. */
const GRAB = 0.55
/** Seconds a pickup lies about before it fades. */
const LIFE = 40

type GeoKey = 'coin' | 'heart' | 'dust' | 'box' | 'beam' | 'ring' | ItemShape

/** Ground shape per item kind, so a hat on the floor reads as a hat. */
export type ItemShape = 'gun' | 'hat' | 'outfit' | 'shoes' | 'band' | 'pin' | 'collar'

export function itemShape(defId: string): ItemShape {
  const def = ITEMS[defId]
  if (!def) return 'pin'
  if (def.slot === 'weapon') return 'gun'
  if (def.slot === 'hat') return def.icon === 'pin' ? 'pin' : 'hat'
  if (def.slot === 'outfit') return 'outfit'
  if (def.slot === 'shoes') return 'shoes'
  if (def.slot === 'collar') return 'collar'
  return def.icon === 'ring' || def.icon === 'bracelet' ? 'band' : 'pin'
}

export class LootView {
  readonly group = new Group()
  private readonly pieces: Piece[] = []
  private readonly geo: Record<GeoKey, BufferGeometry>
  private readonly mats = new Map<string, Material>()
  private tagRow = 0

  private readonly collide: (x: number, z: number) => { x: number; z: number }

  /** `collide` pushes a point out of the walls (the maze's circle test). */
  constructor(collide: (x: number, z: number) => { x: number; z: number } = (x, z) => ({ x, z })) {
    this.collide = collide
    this.group.name = 'sewer-loot'
    this.geo = {
      coin: new CylinderGeometry(0.16, 0.16, 0.05, 14).rotateX(Math.PI / 2),
      heart: new SphereGeometry(0.17, 12, 8),
      dust: new OctahedronGeometry(0.15),
      box: new BoxGeometry(0.34, 0.3, 0.34),
      beam: new CylinderGeometry(0.11, 0.2, 1, 12, 1, true).translate(0, 0.5, 0),
      ring: new CylinderGeometry(0.42, 0.42, 0.06, 20, 1, true),
      gun: new BoxGeometry(0.46, 0.15, 0.13),
      hat: new ConeGeometry(0.22, 0.26, 14),
      outfit: new BoxGeometry(0.36, 0.34, 0.1),
      shoes: new SphereGeometry(0.15, 12, 8).scale(1, 0.7, 1.6),
      band: new TorusGeometry(0.13, 0.045, 8, 18),
      pin: new OctahedronGeometry(0.15).scale(1, 1, 0.45),
      collar: new TorusGeometry(0.16, 0.035, 6, 18).rotateX(Math.PI / 2),
    }
  }

  get count(): number {
    return this.pieces.length
  }

  /** Drop pickups around (x, z) with a little pop. */
  spill(drops: Drop[], x: number, z: number, spread = 1): void {
    drops.forEach((drop, i) => {
      if (drop.kind === 'gold' && this.pieces.length >= CAP) {
        const pile = this.pieces.find((p) => p.drop.kind === 'gold')
        if (pile) {
          pile.drop.amount += drop.amount
          return
        }
      }
      const a = Math.random() * Math.PI * 2
      const s = (0.6 + Math.random() * 1.2) * spread
      const mesh = new Mesh(this.shape(drop), this.material(drop))
      mesh.scale.setScalar(drop.kind === 'gold' ? 1 + Math.min(1, drop.amount / 20) : drop.kind === 'item' ? 1.15 : 1)
      const beam = drop.kind === 'item' ? this.beamFor(drop) : null
      const label = drop.kind === 'item' && drop.item ? nameLabel(itemName(drop.item), RARITY_COLOR[drop.item.rarity]) : null
      const piece: Piece = { drop, mesh, x, y: 0.6, z, vx: Math.cos(a) * s, vy: 3.2 + i * 0.25, vz: Math.sin(a) * s, age: 0, pulled: false, beam, label }
      mesh.position.set(x, 0.6, z)
      this.group.add(mesh)
      if (beam) this.group.add(beam)
      if (label) {
        // Tags from one spill sit on staggered rows so the names don't print over each other.
        label.userData.lift = (this.tagRow++ % 4) * 0.34
        this.group.add(label)
      }
      this.pieces.push(piece)
    })
  }

  /** Advance; returns the drops she touched this frame. */
  update(dt: number, hx: number, hz: number, alive: boolean, time: number): Drop[] {
    const got: Drop[] = []
    for (let i = this.pieces.length - 1; i >= 0; i -= 1) {
      const p = this.pieces[i]
      p.age += dt
      const dx = hx - p.x
      const dz = hz - p.z
      const d = Math.hypot(dx, dz)
      if (alive && p.age > 0.45 && d < MAGNET) p.pulled = true
      if (p.pulled && alive) {
        const pull = 9 + p.age * 2
        p.x += (dx / Math.max(d, 1e-3)) * Math.min(d, pull * dt)
        p.z += (dz / Math.max(d, 1e-3)) * Math.min(d, pull * dt)
        p.y += (0.9 - p.y) * Math.min(1, dt * 8)
        if (d < GRAB) {
          got.push(p.drop)
          this.remove(i)
          continue
        }
      } else {
        p.vy -= 12 * dt
        p.x += p.vx * dt
        p.z += p.vz * dt
        p.y += p.vy * dt
        const out = this.collide(p.x, p.z)
        p.x = out.x
        p.z = out.z
        p.vx *= Math.max(0, 1 - dt * 2.5)
        p.vz *= Math.max(0, 1 - dt * 2.5)
        const rest = 0.28 + Math.sin(time * 3 + i) * 0.06
        if (p.y < rest) {
          p.y = rest
          p.vy = Math.abs(p.vy) > 1.5 ? Math.abs(p.vy) * 0.3 : 0
        }
      }
      if (p.age > LIFE) {
        this.remove(i)
        continue
      }
      p.mesh.position.set(p.x, p.y, p.z)
      p.mesh.rotation.y = time * 2.4 + i
      p.mesh.visible = p.age < LIFE - 4 || Math.sin(p.age * 18) > 0
      if (p.label) {
        p.label.position.set(p.x, p.y + 0.62 + (p.label.userData.lift as number), p.z)
        p.label.visible = p.mesh.visible && !p.pulled
      }
      if (p.beam) {
        p.beam.position.set(p.x, 0.02, p.z)
        p.beam.visible = p.mesh.visible && !p.pulled
        const pulse = 0.85 + Math.sin(time * 4 + i) * 0.15
        ;(p.beam.material as MeshBasicMaterial).opacity = (p.beam.userData.alpha as number) * pulse
      }
    }
    return got
  }

  clear(): void {
    for (let i = this.pieces.length - 1; i >= 0; i -= 1) this.remove(i)
  }

  dispose(): void {
    this.clear()
    for (const g of Object.values(this.geo)) g.dispose()
    for (const m of this.mats.values()) m.dispose()
    this.group.removeFromParent()
  }

  /** Item light pillars on the floor (rarities show from across the room). */
  get beams(): { rarity: string; height: number }[] {
    return this.pieces.filter((p) => p.beam).map((p) => ({ rarity: p.drop.item?.rarity ?? 'common', height: BEAM_HEIGHT[p.drop.item?.rarity ?? 'common'] }))
  }

  private beamFor(drop: Drop): Mesh {
    const rarity = drop.item?.rarity ?? 'common'
    const h = BEAM_HEIGHT[rarity]
    const color = new Color(RARITY_COLOR[rarity]).multiplyScalar(1.4)
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: h ? 0.5 : 0.6, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
    const group = new Mesh(h ? this.geo.beam : this.geo.ring, mat)
    group.userData.alpha = h ? 0.5 : 0.6
    if (h) {
      group.scale.set(1, h, 1)
      const ring = new Mesh(this.geo.ring, mat)
      ring.scale.set(1, 1 / h, 1)
      group.add(ring)
    }
    group.name = `beam-${rarity}`
    return group
  }

  /** Item name tags on the floor (QA / tests). */
  get labels(): string[] {
    return this.pieces.filter((p) => p.label).map((p) => p.label!.name)
  }

  private remove(i: number): void {
    const tag = this.pieces[i].label
    if (tag) {
      tag.removeFromParent()
      tag.material.map?.dispose()
      tag.material.dispose()
    }
    const b = this.pieces[i].beam
    if (b) {
      b.removeFromParent()
      ;(b.material as MeshBasicMaterial).dispose()
    }
    this.pieces[i].mesh.removeFromParent()
    this.pieces.splice(i, 1)
  }

  private shape(drop: Drop): BufferGeometry {
    if (drop.kind === 'gold') return this.geo.coin
    if (drop.kind === 'potion') return this.geo.heart
    if (drop.kind === 'material') return this.geo.dust
    return drop.item ? this.geo[itemShape(drop.item.defId)] : this.geo.box
  }

  private material(drop: Drop): Material {
    const key = drop.kind === 'item' ? `item:${drop.item?.rarity ?? 'common'}` : drop.kind === 'material' ? `mat:${drop.matId}` : drop.kind
    let m = this.mats.get(key)
    if (m) return m
    if (drop.kind === 'gold') m = new MeshBasicMaterial({ color: new Color(0xffd35a).multiplyScalar(1.5) })
    else if (drop.kind === 'potion') m = new MeshBasicMaterial({ color: new Color(0xff7fb0).multiplyScalar(1.5) })
    else if (drop.kind === 'material') m = new MeshBasicMaterial({ color: new Color(drop.matId === 'toy_part' ? 0xc9b8ff : 0x9fe8ff).multiplyScalar(1.6) })
    else {
      const c = new Color(RARITY_COLOR[drop.item?.rarity ?? 'common'])
      m = new MeshToonMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, gradientMap: toonGradient() })
    }
    this.mats.set(key, m)
    return m
  }
}

/** A small canvas tag: the item's full name in its rarity colour, dark rim for any floor. */
function nameLabel(text: string, color: string): Sprite | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const font = 'bold 30px "Pretendard", "Noto Sans KR", sans-serif'
  ctx.font = font
  const w = Math.min(512, Math.ceil(ctx.measureText(text).width) + 28)
  canvas.width = w
  canvas.height = 48
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(20, 16, 40, 0.62)'
  ctx.beginPath()
  ctx.roundRect(2, 4, w - 4, 40, 14)
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(16, 10, 30, 0.9)'
  ctx.strokeText(text, w / 2, 25)
  ctx.fillStyle = color
  ctx.fillText(text, w / 2, 25)
  const map = new CanvasTexture(canvas)
  const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false }))
  const h = 0.3
  sprite.scale.set((w / 48) * h, h, 1)
  sprite.renderOrder = 5
  sprite.name = text
  return sprite
}
