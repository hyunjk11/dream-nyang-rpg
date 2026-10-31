/**
 * What she wears, on the model: a hat on her head, an outfit piece at the neck / back and chunky
 * shoes, from cheap procedural meshes (no assets). Each piece rides an anchor bone: the bind-pose
 * offset is kept and the bone's rotation since the bind pose is applied, so it moves with her.
 */
import { CylinderGeometry, DoubleSide, Group, Mesh, Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry, type Material } from 'three'
import { toon } from '../core/materials'
import type { Rarity } from '../sim/types'

export type Anchor = 'head' | 'neck' | 'lfoot' | 'rfoot'

/** Equipped bases (item defIds) and their rarities. */
export interface WearLook {
  hat?: { id: string; rarity: Rarity }
  outfit?: { id: string; rarity: Rarity }
  shoes?: { id: string; rarity: Rarity }
}

/** Rarity glow on the cloth (epic and legendary shimmer a little). */
export const WEAR_GLOW: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0.08, epic: 0.2, legendary: 0.32 }

interface Slot {
  bone: Object3D
  /** Bone position / rotation in the hero's frame at bind, and the anchor point. */
  bindPos: Vector3
  bindQ: Quaternion
  offset: Vector3
  group: Group
}

const _q = new Quaternion()
const _r = new Quaternion()
const _v = new Vector3()

/** The wearable mesh for one base, built at the origin of its anchor (y up, +z forward). */
export function wearMesh(id: string, rarity: Rarity, size: number): { anchor: Anchor | 'feet'; mesh: Group } | null {
  const g = new Group()
  g.name = `wear-${id}`
  const glow = WEAR_GLOW[rarity]
  const m = (color: number) => toon(color, color, glow)
  const add = (geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geo, mat)
    mesh.position.set(x, y, z)
    g.add(mesh)
    return mesh
  }
  const r = size
  switch (id) {
    case 'hat_beret': {
      const top = add(new SphereGeometry(r * 1.05, 18, 10), m(0xff9fb8), 0, 0, -r * 0.08)
      top.scale.set(1, 0.34, 1)
      add(new CylinderGeometry(r * 0.08, r * 0.1, r * 0.22, 8), m(0xff9fb8), 0, r * 0.38, -r * 0.08)
      add(new SphereGeometry(r * 0.16, 8, 6), m(0xffe066), r * 0.55, r * 0.12, r * 0.6)
      g.rotation.z = 0.22
      return { anchor: 'head', mesh: g }
    }
    case 'hat_mushroom': {
      const cap = add(new SphereGeometry(r * 1.08, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m(0xff6b6b), 0, -r * 0.12, -r * 0.05)
      cap.scale.set(1, 0.72, 1)
      const band = add(new TorusGeometry(r * 0.98, r * 0.1, 6, 24), m(0xfff1d6), 0, -r * 0.12, -r * 0.05)
      band.rotation.x = Math.PI / 2
      const dot = m(0xffffff)
      for (const [a, h] of [[0.3, 0.55], [2.0, 0.4], [3.6, 0.6], [5.0, 0.35], [1.1, 0.25]] as const) {
        add(new SphereGeometry(r * 0.15, 8, 6), dot, Math.cos(a) * r * 0.75 * (1 - h * 0.4), -r * 0.12 + r * 0.72 * h, Math.sin(a) * r * 0.75 * (1 - h * 0.4) - r * 0.05)
      }
      return { anchor: 'head', mesh: g }
    }
    case 'hat_pin': {
      const star = add(new SphereGeometry(r * 0.2, 5, 2), m(0xffe066), r * 0.78, -r * 0.35, r * 0.35)
      star.scale.set(1, 1, 0.4)
      star.rotation.y = -0.8
      add(new CylinderGeometry(r * 0.03, r * 0.03, r * 0.6, 6), m(0xd8d0ff), r * 0.82, -r * 0.5, r * 0.15).rotation.x = 1.2
      return { anchor: 'head', mesh: g }
    }
    case 'outfit_hoodie': {
      // A soft hood folded behind her neck.
      const hood = add(new TorusGeometry(r * 0.62, r * 0.26, 8, 18, Math.PI), m(0xc7b2ff), 0, 0, -r * 0.42)
      hood.rotation.set(-0.35, 0, Math.PI)
      add(new SphereGeometry(r * 0.12, 8, 6), m(0xffffff), r * 0.26, -r * 0.55, r * 0.42)
      add(new SphereGeometry(r * 0.12, 8, 6), m(0xffffff), -r * 0.26, -r * 0.55, r * 0.42)
      return { anchor: 'neck', mesh: g }
    }
    case 'outfit_cape': {
      const cape = add(new CylinderGeometry(r * 0.72, r * 1.35, r * 2.9, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76), m(0x5b6fd6), 0, -r * 1.5, -r * 0.05)
      ;(cape.material as Material).side = DoubleSide
      add(new SphereGeometry(r * 0.16, 10, 8), m(0xffe066), 0, -r * 0.08, r * 0.5)
      return { anchor: 'neck', mesh: g }
    }
    case 'outfit_knit': {
      // Cloud collar: a fluffy ring of puffs round the neck.
      const puff = m(0xfff1d6)
      for (let k = 0; k < 9; k += 1) {
        const a = (k / 9) * Math.PI * 2
        add(new SphereGeometry(r * 0.22, 8, 6), puff, Math.sin(a) * r * 0.62, -r * 0.2, Math.cos(a) * r * 0.55)
      }
      return { anchor: 'neck', mesh: g }
    }
    case 'shoes_boots': {
      const boot = add(new SphereGeometry(r * 0.42, 12, 8), m(0xd79a6a), 0, r * 0.1, r * 0.2)
      boot.scale.set(0.9, 0.7, 1.45)
      const cuff = add(new TorusGeometry(r * 0.34, r * 0.14, 6, 14), m(0xffffff), 0, r * 0.5, 0)
      cuff.rotation.x = Math.PI / 2
      return { anchor: 'feet', mesh: g }
    }
    case 'shoes_sneakers': {
      const up = add(new SphereGeometry(r * 0.4, 12, 8), m(0x9be7c7), 0, r * 0.14, r * 0.22)
      up.scale.set(0.9, 0.62, 1.45)
      const sole = add(new CylinderGeometry(r * 0.4, r * 0.4, r * 0.14, 14), m(0xffffff), 0, -r * 0.08, r * 0.22)
      sole.scale.set(0.95, 1, 1.5)
      return { anchor: 'feet', mesh: g }
    }
  }
  return null
}

export class Wear {
  readonly group = new Group()
  private readonly slots = new Map<Anchor, Slot>()
  private worn = ''
  /** Head size (m) the meshes are scaled to. */
  private size = 0.13

  constructor() {
    this.group.name = 'wear'
  }

  /**
   * Remember the anchor bones in the bind pose. `root` is the hero object (the frame pieces are
   * placed in), `headTop` the top of her head in that frame.
   */
  bind(root: Object3D, bones: Partial<Record<Anchor, Object3D | null>>, headTop: number): void {
    root.updateMatrixWorld(true)
    const inv = root.getWorldQuaternion(new Quaternion()).invert()
    const head = bones.head
    const headPos = head ? root.worldToLocal(head.getWorldPosition(new Vector3())) : new Vector3(0, headTop - 0.1, 0)
    this.size = Math.max(0.08, Math.min(0.2, (headTop - headPos.y) * 0.62))
    for (const key of ['head', 'neck', 'lfoot', 'rfoot'] as Anchor[]) {
      const bone = bones[key]
      if (!bone) continue
      const bindPos = root.worldToLocal(bone.getWorldPosition(new Vector3()))
      const bindQ = inv.clone().multiply(bone.getWorldQuaternion(new Quaternion()))
      const offset =
        key === 'head' ? new Vector3(bindPos.x, headTop - this.size * 0.42, bindPos.z + this.size * 0.05) : key === 'neck' ? new Vector3(bindPos.x, headPos.y - this.size * 0.15, bindPos.z) : new Vector3(bindPos.x, 0.06, bindPos.z)
      const group = new Group()
      group.name = `wear-${key}`
      this.group.add(group)
      this.slots.set(key, { bone, bindPos, bindQ, offset, group })
    }
  }

  /** Swap the worn meshes (no-op when nothing changed). */
  set(look: WearLook): void {
    const key = [look.hat, look.outfit, look.shoes].map((p) => (p ? `${p.id}:${p.rarity}` : '-')).join('|')
    if (key === this.worn) return
    this.worn = key
    for (const s of this.slots.values()) {
      for (const child of [...s.group.children]) {
        child.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          mesh.geometry.dispose()
          ;(mesh.material as Material).dispose()
        })
        child.removeFromParent()
      }
    }
    for (const piece of [look.hat, look.outfit, look.shoes]) {
      if (!piece) continue
      const built = wearMesh(piece.id, piece.rarity, this.size)
      if (!built) continue
      if (built.anchor === 'feet') {
        const left = this.slots.get('lfoot')
        const right = this.slots.get('rfoot')
        if (left) left.group.add(built.mesh)
        const twin = wearMesh(piece.id, piece.rarity, this.size)
        if (right && twin) right.group.add(twin.mesh)
      } else this.slots.get(built.anchor)?.group.add(built.mesh)
    }
  }

  /** Worn mesh names (QA / tests). */
  get pieces(): string[] {
    const out: string[] = []
    for (const s of this.slots.values()) for (const c of s.group.children) out.push(c.name)
    return out
  }

  /** Follow the bones (after the animation and IK for this frame). */
  update(root: Object3D): void {
    if (!this.slots.size) return
    root.updateMatrixWorld(true)
    const inv = root.getWorldQuaternion(_r).invert()
    for (const [key, s] of this.slots) {
      if (!s.group.children.length) continue
      const now = root.worldToLocal(s.bone.getWorldPosition(_v))
      // Rotation since bind, in the hero's frame. Feet only take their yaw (the soles stay flat).
      const q = _q.copy(inv).multiply(s.bone.getWorldQuaternion(new Quaternion())).multiply(s.bindQ.clone().invert())
      if (key === 'lfoot' || key === 'rfoot') {
        const fwd = new Vector3(0, 0, 1).applyQuaternion(q)
        q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z))
        s.group.position.set(now.x, Math.max(0.04, now.y - s.bindPos.y + s.offset.y), now.z)
      } else {
        const rel = s.offset.clone().sub(s.bindPos).applyQuaternion(q)
        s.group.position.copy(now).add(rel)
      }
      s.group.quaternion.copy(q)
    }
  }
}
