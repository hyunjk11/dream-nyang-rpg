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
export function outlineMaterial(width: number, color = OUTLINE_COLOR, fade = 0): MeshBasicMaterial {
  const key = `${color}:${width.toFixed(5)}:${fade}`
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
  if (fade > 0) nearFade(mat, fade)
  outlineMats.set(key, mat)
  return mat
}

/** Her chest in world space, updated by the camera each frame; decor between it and the lens thins out. */
export const FADE_FOCUS = { value: new Vector3(0, 1, 0) }

/**
 * Dither away whatever comes within `near` metres of the lens, and thin out decor standing
 * between the lens and her. Low views sweep the camera
 * through the crystal and mushroom clumps; instead of a wall of pastel filling the frame they
 * dissolve into a fine screen-door pattern (no transparency sorting, shadows untouched).
 */
export function nearFade<T extends Material>(mat: T, near = 1.6): T {
  const prev = mat.onBeforeCompile
  const prevKey = mat.customProgramCacheKey.bind(mat)
  const uniform = { value: near }
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer)
    shader.uniforms.uFadeNear = uniform
    shader.uniforms.uFadeFocus = FADE_FOCUS
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n#ifdef USE_INSTANCING\n  vFadeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n  vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;\nuniform float uFadeNear;\nuniform vec3 uFadeFocus;')
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  {\n    float keep = smoothstep(uFadeNear * 0.4, uFadeNear, distance(vFadeWorld, cameraPosition));\n    vec3 boom = uFadeFocus - cameraPosition;\n    float len = max(length(boom), 0.001);\n    vec3 rel = vFadeWorld - cameraPosition;\n    float along = dot(rel, boom) / len;\n    float off = length(rel - boom * (along / len));\n    if (along > 0.0 && along < len - 0.45) keep = min(keep, max(0.3, smoothstep(0.5, 1.0, off)));\n    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\n    if (keep < ign) discard;\n  }',
      )
  }
  mat.customProgramCacheKey = () => `${prevKey()}|fade${near}`
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
export function outlineInstanced(mesh: InstancedMesh, width: number, color = OUTLINE_COLOR, fade = 0): InstancedMesh {
  const shell = new InstancedMesh(outlineGeometry(mesh.geometry), outlineMaterial(width, color, fade), mesh.count)
  shell.instanceMatrix = mesh.instanceMatrix
  shell.count = mesh.count
  shell.frustumCulled = false
  shell.userData.outline = true
  shell.raycast = () => {}
  return shell
}
