/**
 * Bakes a skinned GLB (KayKit skeletons, the Meshy lich) into a few static walk-cycle frames so
 * a crowd of them can be drawn with InstancedMesh: no per-foe skeleton or mixer at run time.
 * Every mesh of the scene (skinned or rigidly parented to a bone) lands in one geometry; one
 * draw group per source material.
 */
import { AnimationMixer, BufferAttribute, BufferGeometry, Vector3, type AnimationClip, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three'

export interface Baked {
  frames: BufferGeometry[]
  materials: Material[]
}

/** Walk-cycle times: `n` evenly spaced samples of the clip (or a single rest pose). */
export function frameTimes(duration: number, n: number): number[] {
  if (!(duration > 0) || n <= 1) return [0]
  return Array.from({ length: n }, (_, i) => (duration * i) / n)
}

export function bakeSkinned(scene: Object3D, clip: AnimationClip | null, n = 4): Baked {
  const meshes: Mesh[] = []
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  const materials: Material[] = []
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    if (!materials.includes(mat)) materials.push(mat)
  }
  // Sort meshes by material so each material is one contiguous draw group.
  meshes.sort((a, b) => materials.indexOf(a.material as Material) - materials.indexOf(b.material as Material))
  const mixer = clip ? new AnimationMixer(scene) : null
  const action = clip && mixer ? mixer.clipAction(clip) : null
  action?.play()
  const v = new Vector3()
  const frames: BufferGeometry[] = []
  for (const t of frameTimes(clip?.duration ?? 0, clip ? n : 1)) {
    mixer?.setTime(t)
    scene.updateMatrixWorld(true)
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const groups: { start: number; count: number; mat: number }[] = []
    for (const m of meshes) {
      const sk = m as SkinnedMesh
      if (sk.isSkinnedMesh) sk.skeleton.update()
      const g = m.geometry
      const p = g.getAttribute('position')
      const u = g.getAttribute('uv')
      const base = pos.length / 3
      for (let i = 0; i < p.count; i += 1) {
        // getVertexPosition applies the skin (and morphs) in the mesh's local space.
        m.getVertexPosition(i, v)
        v.applyMatrix4(m.matrixWorld)
        pos.push(v.x, v.y, v.z)
        if (u) uv.push(u.getComponent(i, 0), u.getComponent(i, 1))
        else uv.push(0, 0)
      }
      const start = index.length
      if (g.index) for (let i = 0; i < g.index.count; i += 1) index.push(base + g.index.getX(i))
      else for (let i = 0; i < p.count; i += 1) index.push(base + i)
      const mat = materials.indexOf(m.material as Material)
      const last = groups[groups.length - 1]
      if (last && last.mat === mat) last.count += index.length - start
      else groups.push({ start, count: index.length - start, mat })
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geo.setIndex(index)
    for (const gr of groups) geo.addGroup(gr.start, gr.count, gr.mat)
    geo.computeVertexNormals()
    frames.push(geo)
  }
  action?.stop()
  return { frames, materials }
}

/**
 * Far LOD by vertex clustering: snap vertices to a grid of `cells` steps across the model's
 * largest extent, keep one vertex per cell and drop triangles that collapse. Crude but pure and
 * dependency-free; at 10+ m in a dark sewer nobody counts finger bones.
 */
export function decimate(geo: BufferGeometry, cells = 16): BufferGeometry {
  const p = geo.getAttribute('position')
  const u = geo.getAttribute('uv')
  geo.computeBoundingBox()
  const box = geo.boundingBox
  if (!box) return geo
  const size = box.getSize(new Vector3())
  const step = Math.max(size.x, size.y, size.z, 1e-6) / cells
  const cellOf = new Map<string, number>()
  const remap = new Int32Array(p.count)
  const pos: number[] = []
  const uv: number[] = []
  const sums: number[] = []
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const key = `${Math.floor((x - box.min.x) / step)},${Math.floor((y - box.min.y) / step)},${Math.floor((z - box.min.z) / step)}`
    let c = cellOf.get(key)
    if (c === undefined) {
      c = pos.length / 3
      cellOf.set(key, c)
      pos.push(0, 0, 0)
      sums.push(0)
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0)
    }
    pos[c * 3] += x
    pos[c * 3 + 1] += y
    pos[c * 3 + 2] += z
    sums[c] += 1
    remap[i] = c
  }
  for (let c = 0; c < sums.length; c += 1) for (let k = 0; k < 3; k += 1) pos[c * 3 + k] /= sums[c]
  const src = geo.index
  const tri = src ? src.count : p.count
  const index: number[] = []
  const seen = new Set<string>()
  for (let t = 0; t + 2 < tri; t += 3) {
    const a = remap[src ? src.getX(t) : t]
    const b = remap[src ? src.getX(t + 1) : t + 1]
    const c = remap[src ? src.getX(t + 2) : t + 2]
    if (a === b || b === c || a === c) continue
    const key = [a, b, c].sort((m, n) => m - n).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    index.push(a, b, c)
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  out.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  out.setIndex(index)
  out.computeVertexNormals()
  return out
}
