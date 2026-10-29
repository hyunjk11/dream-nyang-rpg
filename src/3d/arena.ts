import {
  BackSide,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  MeshBasicMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { cameraOffset, focusPoint } from './feel'
import { toon } from './materials'

export interface Stage {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  render: () => void
  resize: () => void
  follow: (px: number, py: number, pz: number, aimX: number, aimZ: number, shake: number) => void
  mobile: boolean
  touch: boolean
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const narrow = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 520
  const renderer = new WebGLRenderer({ canvas, antialias: !narrow, alpha: false, powerPreference: 'high-performance' })
  const gl = renderer.getContext()
  const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = gpuInfo ? String(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)) : ''
  const software = /swiftshader|llvmpipe|softpipe/i.test(gpu)
  const mobile = software || narrow
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6))
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.shadowMap.enabled = !mobile
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.setClearColor(0x1b1030, 1)

  const scene = new Scene()
  scene.fog = new Fog(0x2a1848, 18, 42)
  scene.add(new HemisphereLight(0xfff4f8, 0x8fbf86, 0.55))
  const sun = new DirectionalLight(0xfffaf2, 1.15)
  sun.position.set(-6, 12, 8)
  if (!mobile) {
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 40
    sun.shadow.camera.left = -16
    sun.shadow.camera.right = 16
    sun.shadow.camera.top = 16
    sun.shadow.camera.bottom = -16
    sun.shadow.bias = -0.0004
  }
  scene.add(sun)
  const fill = new DirectionalLight(0xffd0e8, 0.18)
  fill.position.set(8, 4, -6)
  scene.add(fill)

  buildIsland(scene)
  const stars = starField()
  scene.add(stars)

  const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 80)
  const focus = new Vector3()
  const desired = new Vector3()
  const offset = cameraOffset()

  let composer: EffectComposer | null = null
  if (!mobile) {
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), 0.22, 0.35, 0.94)
    composer.addPass(bloom)
  }

  const resize = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    composer?.setSize(width, height)
  }

  return {
    scene,
    camera,
    renderer,
    mobile,
    touch: narrow,
    resize,
    render: () => {
      stars.rotation.y += 0.0004
      if (composer) composer.render()
      else renderer.render(scene, camera)
    },
    follow: (px, py, pz, aimX, aimZ, shake) => {
      const look = focusPoint(px, py, pz, aimX, aimZ)
      focus.set(look.x, look.y, look.z)
      desired.set(focus.x + offset.x, focus.y + offset.y, focus.z + offset.z)
      camera.position.lerp(desired, 0.12)
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake
        camera.position.y += (Math.random() - 0.5) * shake * 0.45
      }
      camera.lookAt(focus)
    },
  }
}

function buildIsland(scene: Scene): void {
  const sky = new Mesh(new SphereGeometry(48, 28, 18), new MeshBasicMaterial({ color: 0x24143f, side: BackSide }))
  scene.add(sky)
  const ground = new Mesh(new CircleGeometry(14.5, 48), toon(0x7ecf8c))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0.03
  ground.receiveShadow = true
  scene.add(ground)
  const rim = new Mesh(new CylinderGeometry(14.5, 12.2, 1.8, 40, 1, true), toon(0xf3c6e4))
  rim.position.y = -0.9
  rim.receiveShadow = true
  scene.add(rim)
  const path = new Mesh(new CircleGeometry(3.2, 24), toon(0xffe4f2))
  path.rotation.x = -Math.PI / 2
  path.position.y = 0.02
  path.receiveShadow = true
  scene.add(path)

  const crystals = [
    [8.5, 6.2, 0xff8fd0, 1.5],
    [-7.4, 7.1, 0x9ad7ff, 1.8],
    [6.2, -8.4, 0xd7b6ff, 1.3],
    [-9.1, -4.2, 0xffe08a, 1.6],
    [2.4, 10.2, 0xb8f2d0, 1.2],
  ] as const
  for (const [x, z, color, height] of crystals) {
    const crystal = new Mesh(new ConeGeometry(0.38, height, 5), toon(color, color, 0.55))
    crystal.position.set(x, height * 0.45, z)
    crystal.castShadow = true
    scene.add(crystal)
  }
  const mushrooms = [
    [4.6, 3.4],
    [-3.8, 4.8],
    [5.2, -3.6],
    [-5.5, -2.4],
    [0.8, -6.4],
  ]
  for (const [x, z] of mushrooms) {
    const shroom = new Group()
    const stem = new Mesh(new CylinderGeometry(0.12, 0.16, 0.45, 8), toon(0xfff6ea))
    stem.position.y = 0.22
    const cap = new Mesh(new SphereGeometry(0.38, 12, 10), toon(0xff8fb8, 0xffb7d5, 0.15))
    cap.scale.y = 0.55
    cap.position.y = 0.48
    shroom.add(stem, cap)
    shroom.position.set(x, 0, z)
    shroom.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh) mesh.castShadow = true
    })
    scene.add(shroom)
  }

  const dummy = new Object3D()
  const flowers = new InstancedMesh(new ConeGeometry(0.08, 0.16, 5), toon(0xffd0ea, 0xffd6ef, 0.2), 48)
  for (let i = 0; i < 48; i += 1) {
    const angle = (i / 48) * Math.PI * 2
    const radius = 4.2 + (i % 5) * 1.5
    dummy.position.set(Math.cos(angle) * radius, 0.08, Math.sin(angle) * radius)
    dummy.scale.setScalar(0.8 + (i % 3) * 0.25)
    dummy.updateMatrix()
    flowers.setMatrixAt(i, dummy.matrix)
    flowers.setColorAt(i, new Color(i % 2 ? 0xffb7d5 : 0xb7e6ff))
  }
  flowers.instanceColor!.needsUpdate = true
  scene.add(flowers)
}

function starField(): InstancedMesh {
  const mesh = new InstancedMesh(new SphereGeometry(0.03, 4, 3), toon(0xfff6ea, 0xffffff, 0.8), 220)
  const dummy = new Object3D()
  for (let i = 0; i < 220; i += 1) {
    const radius = 22 + (i % 7) * 2
    const angle = i * 2.4
    dummy.position.set(Math.cos(angle) * radius, 6 + (i % 9) * 1.4, Math.sin(angle) * radius)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  return mesh
}
