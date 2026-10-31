/**
 * The 13 procedural monsters from lucky-defense-3d (src/render/monsters3d.js, same author),
 * ported to TypeScript and restyled into the dream palette. Each kind is built from primitives
 * once, posed through a 4-frame walk cycle (legs, wings, tail) and merged into plain vertex-colour
 * geometry so the sewer horde can draw them with one InstancedMesh per frame.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export type LuckyKind = 'jelly' | 'wolf' | 'goblin' | 'knight' | 'wraith' | 'golem' | 'drake' | 'lord'

/** Archetype table (original names kept), recoloured from neon to pastel dream tones. */
export const LUCKY: Record<LuckyKind, { name: string; scale: number; color: number; eye: number; crown?: number; source: string }> = {
  jelly: { name: '꿈 젤리', source: 'slime 네온 슬라임', scale: 0.85, color: 0x9ee8d8, eye: 0xffffff },
  wolf: { name: '잠꼬대 늑대', source: 'wolf 그림자 늑대', scale: 0.92, color: 0x9a8cc8, eye: 0xffe28a },
  goblin: { name: '베개 도둑', source: 'goblin 차원 정찰병', scale: 0.9, color: 0xa8e0a0, eye: 0xff9fc0 },
  knight: { name: '구름 기사', source: 'knight 흑철 기사', scale: 1.02, color: 0x9ec9ff, eye: 0xfff0a0 },
  wraith: { name: '이불 망령', source: 'wraith 공허 망령', scale: 1.05, color: 0xc8a8ff, eye: 0x9af0ff },
  golem: { name: '마시멜로 골렘', source: 'golem 암석 골렘', scale: 1.25, color: 0xffc8a8, eye: 0xfff2b0 },
  drake: { name: '솜사탕 드레이크', source: 'drake 화염 드레이크', scale: 1.28, color: 0xffa8c4, eye: 0xffe28a },
  // One body for boss10–50 and the bounty boss; the six variants become instance tints.
  lord: { name: '악몽 군주', source: 'boss10·20·30·40·50·bounty', scale: 1.75, color: 0xf4ecff, eye: 0x9af0ff, crown: 0xffe08a },
}

/** Instance tints for the six lord variants (boss10…boss50, bounty), pastel takes on the originals. */
export const LORD_TINTS = [0xffb0b0, 0xa8ecf4, 0xffc8a0, 0xe0b0f4, 0xffa0c0, 0xfff0a0]

const S = (r: number, ws = 14, hs = 10) => new SphereGeometry(r, ws, hs)
const Box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)
const Cone = (r: number, h: number, s = 8) => new ConeGeometry(r, h, s)
const Cyl = (a: number, b: number, h: number, s = 10) => new CylinderGeometry(a, b, h, s)
const RBox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r)

interface Rig {
  root: Group
  legs: Mesh[]
  wings: { m: Mesh; sx: number }[]
  tail: Mesh | null
}

/** Mesh with its vertex colour stashed in userData (glow parts are brightened). */
function mk(geo: BufferGeometry, color: number, x: number, y: number, z: number, parent: Object3D, glow = 0): Mesh {
  const m = new Mesh(geo)
  m.position.set(x, y, z)
  const c = new Color(color)
  if (glow) c.multiplyScalar(Math.min(1.5, 0.8 + glow * 0.25))
  m.userData.color = c
  parent.add(m)
  return m
}

function build(kind: LuckyKind): Rig {
  const a = LUCKY[kind]
  const root = new Group()
  const inner = new Group()
  root.add(inner)
  inner.scale.setScalar(a.scale * 0.8)
  const main = a.color
  const light = new Color(a.color).lerp(new Color(0xffffff), 0.38).getHex()
  const dark = new Color(a.color).lerp(new Color(0x4a3470), 0.55).getHex()
  const eye = a.eye
  const legs: Mesh[] = []
  const wings: { m: Mesh; sx: number }[] = []
  let tail: Mesh | null = null
  if (kind === 'jelly') {
    mk(S(0.56, 18, 12), main, 0, 0.44, 0, inner).scale.set(1.15, 0.84, 1.1)
    for (const sx of [-0.18, 0.18]) {
      mk(S(0.085, 8, 6), eye, sx, 0.54, 0.48, inner, 2.2)
      mk(S(0.06, 6, 6), 0xff9fb8, sx * 1.6, 0.44, 0.45, inner, 1.5)
    }
    mk(Cyl(0.035, 0.05, 0.25, 6), main, 0, 0.92, 0, inner)
    mk(S(0.11, 10, 8), 0xffffff, 0, 1.08, 0, inner, 1.8)
  } else if (kind === 'wolf') {
    mk(S(0.38, 14, 10), main, 0, 0.56, 0, inner).scale.set(0.95, 0.85, 1.6)
    mk(S(0.32, 12, 10), light, 0, 0.62, 0.32, inner)
    mk(S(0.27, 12, 10), main, 0, 0.82, 0.52, inner).scale.set(1, 0.92, 1.15)
    mk(S(0.14, 10, 8), light, 0, 0.76, 0.76, inner).scale.set(0.9, 0.75, 1.4)
    mk(S(0.055, 8, 6), dark, 0, 0.8, 0.94, inner)
    for (const sx of [-0.14, 0.14]) {
      mk(Cone(0.09, 0.26, 6), dark, sx, 1.08, 0.46, inner)
      mk(S(0.055, 8, 6), eye, sx * 0.85, 0.86, 0.72, inner, 2.2)
    }
    for (let k = 0; k < 3; k += 1) mk(Cone(0.07, 0.24, 5), light, 0, 0.92 - k * 0.04, 0.22 - k * 0.22, inner).rotation.x = -0.45
    tail = mk(Cone(0.11, 0.52, 8), main, 0, 0.68, -0.68, inner)
    tail.rotation.x = -Math.PI / 2 - 0.4
    for (const [lx, lz] of [
      [-0.18, 0.34],
      [0.18, 0.34],
      [-0.18, -0.34],
      [0.18, -0.34],
    ])
      legs.push(mk(Cyl(0.065, 0.05, 0.44, 8), dark, lx, 0.24, lz, inner))
  } else if (kind === 'goblin') {
    mk(Cyl(0.24, 0.3, 0.52, 10), dark, 0, 0.46, 0, inner)
    mk(Cone(0.34, 0.55, 8), 0x7a5aa8, 0, 0.48, -0.14, inner).rotation.x = 0.25
    mk(S(0.33, 14, 10), main, 0, 0.92, 0.04, inner)
    for (const sx of [-1, 1]) {
      mk(Cone(0.095, 0.38, 6), main, sx * 0.38, 0.94, 0, inner).rotation.z = -sx * 1.15
      mk(S(0.06, 8, 6), eye, sx * 0.13, 0.94, 0.3, inner, 2.2)
      // Twin daggers became twin glowing spoons.
      mk(Cone(0.055, 0.42, 4), 0x9ad7ff, sx * 0.34, 0.52, 0.28, inner, 1.6).rotation.x = Math.PI / 2
      legs.push(mk(Cyl(0.075, 0.06, 0.36, 8), dark, sx * 0.13, 0.18, 0, inner))
    }
  } else if (kind === 'knight') {
    mk(RBox(0.58, 0.66, 0.44, 0.06), main, 0, 0.64, 0, inner)
    for (const sx of [-0.36, 0.36]) mk(S(0.16, 10, 8), light, sx, 0.88, 0, inner)
    mk(Cyl(0.27, 0.29, 0.4, 12), dark, 0, 1.16, 0, inner)
    mk(Box(0.4, 0.085, 0.14), eye, 0, 1.17, 0.25, inner, 2.2)
    mk(Cone(0.14, 0.42, 8), 0xff9fc8, 0, 1.5, -0.06, inner, 1.5).rotation.x = -0.3
    mk(RBox(0.12, 0.64, 0.5, 0.04), light, -0.4, 0.64, 0.14, inner)
    mk(Box(0.09, 0.78, 0.14), 0x9ad7ff, 0.4, 0.8, 0.28, inner, 1.8)
    for (const sx of [-0.15, 0.15]) legs.push(mk(Cyl(0.095, 0.085, 0.4, 8), dark, sx, 0.2, 0, inner))
  } else if (kind === 'wraith') {
    mk(Cone(0.54, 1.28, 12), main, 0, 0.74, 0, inner).scale.z = 0.88
    mk(S(0.3, 12, 10), dark, 0, 1.3, 0.06, inner)
    mk(Cone(0.34, 0.42, 8), main, 0, 1.54, -0.04, inner).rotation.x = -0.25
    for (const sx of [-0.11, 0.11]) mk(S(0.06, 8, 6), eye, sx, 1.3, 0.32, inner, 2.2)
    // The reaper's scythe is now a crescent-moon crook.
    mk(Cyl(0.03, 0.03, 1.45, 8), dark, 0.44, 0.85, 0.18, inner).rotation.z = -0.15
    mk(Cone(0.14, 0.68, 4), 0xbff4ff, 0.22, 1.48, 0.28, inner, 2).rotation.z = Math.PI / 2 + 0.25
  } else if (kind === 'golem') {
    mk(RBox(0.86, 0.86, 0.66, 0.1), main, 0, 0.8, 0, inner)
    mk(new OctahedronGeometry(0.22, 0), eye, 0, 0.84, 0.32, inner, 2.2)
    mk(RBox(0.48, 0.4, 0.44, 0.06), dark, 0, 1.36, 0.08, inner)
    mk(Box(0.34, 0.095, 0.12), eye, 0, 1.38, 0.29, inner, 2.2)
    for (const sx of [-1, 1]) {
      mk(new OctahedronGeometry(0.22, 0), 0xffb0d8, sx * 0.48, 1.28, 0, inner, 1.8).scale.y = 1.6
      mk(RBox(0.3, 0.72, 0.3, 0.06), dark, sx * 0.6, 0.74, 0.08, inner)
      legs.push(mk(RBox(0.28, 0.46, 0.3, 0.05), dark, sx * 0.25, 0.24, 0, inner))
    }
  } else if (kind === 'drake') {
    mk(S(0.52, 14, 10), main, 0, 0.7, 0, inner).scale.set(0.98, 0.92, 1.5)
    mk(S(0.36, 12, 10), light, 0, 0.68, 0.38, inner)
    mk(S(0.34, 12, 10), main, 0, 1.12, 0.56, inner)
    tail = mk(Cone(0.18, 0.75, 8), main, 0, 0.62, -0.78, inner)
    tail.rotation.x = -Math.PI / 2 - 0.2
    for (const sx of [-1, 1]) {
      mk(Cone(0.085, 0.36, 6), 0xffe08a, sx * 0.22, 1.4, 0.44, inner, 1.6)
      mk(S(0.06, 8, 6), eye, sx * 0.15, 1.16, 0.82, inner, 2.2)
      const wg = mk(Box(0.88, 0.06, 0.52), 0xffc0dc, sx * 0.64, 0.98, -0.05, inner, 1.5)
      wg.rotation.z = sx * 0.35
      wings.push({ m: wg, sx })
      legs.push(mk(Cyl(0.11, 0.095, 0.44, 8), dark, sx * 0.25, 0.22, 0.1, inner))
    }
  } else {
    const crown = a.crown ?? 0xffe08a
    mk(RBox(0.95, 1.0, 0.7, 0.1), main, 0, 0.9, 0, inner)
    mk(new OctahedronGeometry(0.25, 0), eye, 0, 0.95, 0.36, inner, 2.2)
    mk(S(0.4, 14, 12), dark, 0, 1.6, 0.06, inner)
    for (const sx of [-1, 1]) {
      mk(S(0.075, 8, 6), eye, sx * 0.15, 1.62, 0.4, inner, 2.2)
      mk(Cone(0.12, 0.54, 8), crown, sx * 0.38, 1.92, 0, inner, 2.1).rotation.z = -sx * 0.45
      mk(RBox(0.4, 0.34, 0.44, 0.06), crown, sx * 0.68, 1.28, 0, inner, 1.5)
      const wg = mk(Box(0.95, 0.07, 0.55), 0xffc8e8, sx * 0.72, 1.25, -0.28, inner, 1.8)
      wg.rotation.z = sx * 0.38
      wings.push({ m: wg, sx })
      legs.push(mk(RBox(0.3, 0.52, 0.34, 0.05), dark, sx * 0.27, 0.26, 0, inner))
    }
    // Halo and the great sword (now a starlit wand).
    const halo = mk(new TorusGeometry(0.92, 0.055, 8, 24), crown, 0, 1.42, -0.44, inner, 2.5)
    halo.rotation.set(0, 0, 0)
    mk(Box(0.16, 1.48, 0.28), 0x9af0ff, 0.76, 1.2, 0.4, inner, 2.4)
  }
  return { root, legs, wings, tail }
}

/** Pose the rig at walk phase p (radians), as updateMonsterVisual did per frame. */
function pose(rig: Rig, p: number): void {
  rig.legs.forEach((lg, i) => {
    lg.rotation.x = Math.sin(p + (i % 2 ? Math.PI : 0)) * 0.58
  })
  for (const w of rig.wings) w.m.rotation.z = w.sx * (0.35 + Math.sin(p * 1.6) * 0.26)
  if (rig.tail) rig.tail.rotation.y = Math.sin(p * 1.5) * 0.35
}

/** Merge every part of the posed rig into one non-indexed geometry with vertex colours. */
function merge(root: Object3D): BufferGeometry {
  root.updateMatrixWorld(true)
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const v = new Vector3()
  const n = new Vector3()
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
    const p = g.getAttribute('position')
    const nn = g.getAttribute('normal')
    const c = m.userData.color as Color
    for (let i = 0; i < p.count; i += 1) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
      n.fromBufferAttribute(nn, i).transformDirection(m.matrixWorld)
      pos.push(v.x, v.y, v.z)
      nor.push(n.x, n.y, n.z)
      col.push(c.r, c.g, c.b)
    }
  })
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  out.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  return out
}

/** `frames` walk-cycle poses of one lucky monster, merged and ready to instance. */
export function luckyFrames(kind: LuckyKind, frames = 4): BufferGeometry[] {
  const rig = build(kind)
  const out: BufferGeometry[] = []
  for (let f = 0; f < frames; f += 1) {
    pose(rig, (f / frames) * Math.PI * 2)
    out.push(merge(rig.root))
  }
  return out
}

export const LUCKY_KINDS = Object.keys(LUCKY) as LuckyKind[]
