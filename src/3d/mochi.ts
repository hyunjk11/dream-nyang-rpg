import {
  Box3,
  ConeGeometry,
  Group,
  Material,
  Mesh,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { applyToon, toon } from './materials'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

export class Mochi {
  readonly object = new Group()
  private visual = new Group()
  private time = 0
  private hop = 0
  private baseY = 0
  readonly fishMuzzle = new Object3D()
  private uniforms: { value: number }[] = []

  constructor() {
    this.object.add(this.visual)
    this.fishMuzzle.position.set(0, 0.35, 0.45)
    this.object.add(this.fishMuzzle)
  }

  async load(url: string): Promise<boolean> {
    try {
      const gltf = await loader.loadAsync(url)
      const model = gltf.scene
      model.rotation.y = (30 * Math.PI) / 180
      const box = new Box3().setFromObject(model)
      const height = box.max.y - box.min.y
      const scale = height > 0.05 ? 0.62 / height : 1
      model.scale.setScalar(scale)
      model.position.y = -box.min.y * scale
      applyToon(model)
      model.traverse((obj) => {
        const mesh = obj as Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) wiggle(material, this.uniforms)
        mesh.castShadow = true
      })
      this.visual.add(model)
      this.baseY = 0
      return true
    } catch (error) {
      console.warn('모찌 모델을 열지 못했습니다. 임시 고양이로 이어갑니다.', error)
      this.visual.add(placeholderCat())
      this.baseY = 0
      return false
    }
  }

  update(dt: number, target: Vector3, look: Vector3): void {
    this.time += dt
    const flat = target.clone()
    flat.y = 0
    const current = this.object.position
    const dx = flat.x - current.x
    const dz = flat.z - current.z
    const dist = Math.hypot(dx, dz)
    const moving = dist > 0.08
    const k = 1 - Math.exp(-dt * (moving ? 4.5 : 2))
    current.x += dx * k
    current.z += dz * k
    this.hop = moving ? Math.abs(Math.sin(this.time * 10)) : 0
    current.y = this.baseY + this.hop * 0.16
    const squash = 1 - this.hop * 0.18
    const stretch = 1 + this.hop * 0.12
    this.visual.scale.set(stretch, squash * (1 + Math.sin(this.time * 3) * 0.03), stretch)
    const face = Math.atan2(look.x - current.x, look.z - current.z)
    const turn = Math.atan2(Math.sin(face - this.object.rotation.y), Math.cos(face - this.object.rotation.y))
    this.object.rotation.y += turn * (1 - Math.exp(-dt * 6))
    for (const uniform of this.uniforms) uniform.value = this.time
  }
}

function wiggle(material: Material, store: { value: number }[]): void {
  const uniform = { value: 0 }
  store.push(uniform)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniform
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float ear = smoothstep(0.08, 0.28, transformed.y);
      float tail = smoothstep(0.0, 0.22, -transformed.z);
      transformed.x += sin(uTime * 7.0) * 0.035 * ear;
      transformed.y += sin(uTime * 3.2) * 0.012;
      transformed.x += sin(uTime * 5.0 + transformed.z * 6.0) * 0.06 * tail;`,
    )
  }
}

function placeholderCat(): Object3D {
  const cat = new Group()
  const body = new Mesh(new SphereGeometry(0.22, 16, 12), toon(0xfff1e4))
  body.scale.set(1.15, 0.9, 0.95)
  body.position.y = 0.24
  const head = new Mesh(new SphereGeometry(0.16, 16, 12), toon(0xfff6ea))
  head.position.set(0, 0.42, 0.1)
  const earL = new Mesh(new ConeGeometry(0.05, 0.1, 6), toon(0xffd0ea))
  const earR = earL.clone()
  earL.position.set(-0.07, 0.56, 0.08)
  earR.position.set(0.07, 0.56, 0.08)
  const tail = new Mesh(new SphereGeometry(0.05, 8, 8), toon(0xffe4d2))
  tail.scale.set(1, 1, 2.4)
  tail.position.set(0, 0.28, -0.24)
  const scarf = new Mesh(new SphereGeometry(0.08, 10, 8), toon(0xc9b6ff))
  scarf.scale.set(1.4, 0.45, 1.2)
  scarf.position.set(0, 0.34, 0.12)
  body.castShadow = true
  head.castShadow = true
  cat.add(body, head, earL, earR, tail, scarf)
  return cat
}
