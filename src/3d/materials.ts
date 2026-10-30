import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Vector3,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  RedFormat,
  SkinnedMesh,
  type Material,
  type Texture,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

let gradient: DataTexture | null = null

export function toonGradient(): DataTexture {
  if (gradient) return gradient
  const data = new Uint8Array([64, 150, 255])
  gradient = new DataTexture(data, 3, 1, RedFormat)
  gradient.magFilter = NearestFilter
  gradient.minFilter = NearestFilter
  gradient.needsUpdate = true
  return gradient
}

export function toon(color: number, emissive = 0x000000, emissiveIntensity = 0): MeshToonMaterial {
  return new MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    emissive: new Color(emissive),
    emissiveIntensity,
  })
}

export function applyToon(root: Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    const source = mesh.material
    const list = Array.isArray(source) ? source : [source]
    const next = list.map((material) => toonFrom(material))
    mesh.material = Array.isArray(source) ? next : next[0]
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}

function toonFrom(material: Material): MeshToonMaterial {
  const colored = material as Material & { map?: Texture; color?: Color; name?: string }
  const mat = new MeshToonMaterial({
    color: colored.color ? colored.color.clone() : new Color(0xffffff),
    map: colored.map ?? null,
    gradientMap: toonGradient(),
  })
  mat.name = colored.name ?? ''
  return mat
}

export const OUTLINE_COLOR = 0x3a2448

const outlineMats = new Map<string, MeshBasicMaterial>()
const outlineGeoms = new WeakMap<BufferGeometry, BufferGeometry>()

/** Back-face shell pushed along smooth normals. Shared per colour + width. */
export function outlineMaterial(width: number, color = OUTLINE_COLOR): MeshBasicMaterial {
  const key = `${color}:${width.toFixed(5)}`
  let mat = outlineMats.get(key)
  if (mat) return mat
  mat = new MeshBasicMaterial({ color, side: BackSide })
  const uniform = { value: width }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = uniform
    shader.vertexShader = 'uniform float uOutline;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#ifdef USE_SKINNING\n  transformed += normalize(objectNormal) * uOutline;\n#else\n  transformed += normalize(normal) * uOutline;\n#endif\n#include <project_vertex>',
    )
  }
  mat.customProgramCacheKey = () => 'outline-shell'
  outlineMats.set(key, mat)
  return mat
}

/**
 * Outline geometry with welded, smooth normals. Meshy meshes split vertices on every UV seam,
 * so pushing along their own normals tears the shell open; welding by position closes it.
 */
export function outlineGeometry(source: BufferGeometry): BufferGeometry {
  const cached = outlineGeoms.get(source)
  if (cached) return cached
  let geo = new BufferGeometry()
  for (const name of ['position', 'skinIndex', 'skinWeight']) {
    const attr = source.getAttribute(name)
    if (!attr) continue
    const size = attr.itemSize
    const data = name === 'skinIndex' ? new Uint16Array(attr.count * size) : new Float32Array(attr.count * size)
    for (let i = 0; i < attr.count; i += 1) {
      data[i * size] = attr.getX(i)
      if (size > 1) data[i * size + 1] = attr.getY(i)
      if (size > 2) data[i * size + 2] = attr.getZ(i)
      if (size > 3) data[i * size + 3] = attr.getW(i)
    }
    geo.setAttribute(name, new BufferAttribute(data, size))
  }
  if (source.index) geo.setIndex(source.index.clone())
  geo = mergeVertices(geo, 1e-3)
  geo.computeVertexNormals()
  outlineGeoms.set(source, geo)
  return geo
}

/**
 * Adds an ink outline to every mesh under root. Width is in world metres, measured at the
 * mesh's current world scale, so a 2.5 m boss and a 0.8 m slime get the same line.
 */
export function addOutline(root: Object3D, width = 0.016, color = OUTLINE_COLOR): void {
  root.updateWorldMatrix(true, true)
  const targets: Mesh[] = []
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh || mesh.userData.outline || mesh.userData.noOutline || (mesh as InstancedMesh).isInstancedMesh) return
    if (mesh.children.some((child) => child.userData.outline)) return
    targets.push(mesh)
  })
  const scale = new Vector3()
  for (const mesh of targets) {
    mesh.getWorldScale(scale)
    const local = width / Math.max(1e-4, (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3)
    const geo = outlineGeometry(mesh.geometry)
    let shell: Mesh
    if ((mesh as SkinnedMesh).isSkinnedMesh) {
      const skin = mesh as SkinnedMesh
      const s = new SkinnedMesh(geo, outlineMaterial(local, color))
      s.bind(skin.skeleton, skin.bindMatrix)
      shell = s
    } else shell = new Mesh(geo, outlineMaterial(local, color))
    shell.userData.outline = true
    shell.castShadow = false
    shell.receiveShadow = false
    shell.frustumCulled = false
    shell.raycast = () => {}
    mesh.add(shell)
  }
}

/**
 * Wraps an existing onBeforeCompile (e.g. Mochi's gait deformation) so the outline push runs
 * after it. Use for shells that must follow a custom vertex shader.
 */
export function chainOutlinePush(material: MeshBasicMaterial, width: number, key: string): void {
  const inner = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    inner.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `transformed += normalize(normal) * ${width.toFixed(5)};\n#include <project_vertex>`,
    )
  }
  material.customProgramCacheKey = () => key
}

/** Outline for an InstancedMesh: a second instanced shell sharing the same instance matrices. */
export function outlineInstanced(mesh: InstancedMesh, width: number, color = OUTLINE_COLOR): InstancedMesh {
  const shell = new InstancedMesh(outlineGeometry(mesh.geometry), outlineMaterial(width, color), mesh.count)
  shell.instanceMatrix = mesh.instanceMatrix
  shell.count = mesh.count
  shell.frustumCulled = false
  shell.userData.outline = true
  shell.raycast = () => {}
  return shell
}
