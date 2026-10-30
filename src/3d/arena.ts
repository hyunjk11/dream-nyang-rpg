import {
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CAMERA_YAW, cameraOffset, clampCameraDistance, focusPoint } from './feel'
import { buildIsland } from './decor'
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
  // Fog only touches the far dream, never the play area, so foes read early.
  scene.fog = new Fog(0x8a6ab8, 22, 58)
  scene.add(new HemisphereLight(0xfff0fa, 0x9ccf9a, 0.75))
  const sun = new DirectionalLight(0xfff6ec, 1.2)
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

  const island = buildIsland(scene, mobile)
  renderer.info.autoReset = true
  const stars = starField()
  scene.add(stars)

  const camera = new PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 80)
  const focus = new Vector3()
  const desired = new Vector3()
  let distance = CAMERA_DISTANCE
  let currentDistance = distance
  let lastFollow = 0
  let focusReady = false
  bindZoom(canvas, (delta) => {
    distance = clampCameraDistance(distance + delta)
  })

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
      island.tick(performance.now() / 1000)
      if (composer) composer.render()
      else renderer.render(scene, camera)
    },
    follow: (px, py, pz, aimX, aimZ, shake) => {
      const now = performance.now()
      const dt = Math.min(0.05, lastFollow ? (now - lastFollow) / 1000 : 1)
      lastFollow = now
      const look = focusPoint(px, py, pz, aimX, aimZ)
      // Frame-rate independent follow: tight on her body, softer on the aim lead.
      const k = 1 - Math.exp(-9 * dt)
      if (!focusReady) focus.set(look.x, look.y, look.z)
      focusReady = true
      focus.x += (look.x - focus.x) * k
      focus.y += (look.y - focus.y) * k
      focus.z += (look.z - focus.z) * k
      currentDistance += (distance - currentDistance) * (1 - Math.exp(-10 * dt))
      const offset = cameraOffset(CAMERA_YAW, CAMERA_PITCH_DEG, currentDistance)
      desired.set(focus.x + offset.x, focus.y + offset.y, focus.z + offset.z)
      camera.position.copy(desired)
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake
        camera.position.y += (Math.random() - 0.5) * shake * 0.45
      }
      camera.lookAt(focus)
    },
  }
}

function bindZoom(canvas: HTMLCanvasElement, onDelta: (delta: number) => void): void {
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    onDelta(Math.sign(event.deltaY) * 0.28)
  }, { passive: false })
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size < 2) return
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinch > 0) onDelta((pinch - dist) * 0.012)
    pinch = dist
  })
  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = 0
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
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
