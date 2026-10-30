import {
  BackSide,
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

export function addOutline(root: Object3D, color = 0x4a3358): void {
  const created: Object3D[] = []
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh || mesh.userData.outline) return
    if ((mesh as SkinnedMesh).isSkinnedMesh) {
      const skin = mesh as SkinnedMesh
      const shell = new SkinnedMesh(
        skin.geometry,
        new MeshBasicMaterial({ color, side: BackSide }),
      )
      shell.bind(skin.skeleton, skin.bindMatrix)
      shell.userData.outline = true
      inflate(shell.material as MeshBasicMaterial)
      created.push(shell)
      skin.parent?.add(shell)
      return
    }
    const shell = new Mesh(mesh.geometry, new MeshBasicMaterial({ color, side: BackSide }))
    shell.position.copy(mesh.position)
    shell.quaternion.copy(mesh.quaternion)
    shell.scale.copy(mesh.scale).multiplyScalar(1.06)
    shell.userData.outline = true
    created.push(shell)
    mesh.parent?.add(shell)
  })
  for (const shell of created) shell.userData.outline = true
}

function inflate(material: MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(objectNormal) * 0.018;',
    )
  }
}
