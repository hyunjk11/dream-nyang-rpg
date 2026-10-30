import {
  ACESFilmicToneMapping,
  DirectionalLight,
  Fog,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { LOOK } from './look'
import { CAMERA_DISTANCE, CAMERA_FOV, CAMERA_PITCH_DEG, CAMERA_YAW, cameraOffset, clampCameraDistance, focusPoint } from './feel'
import { boomLength, cameraColliders, cameraRig, wheelStep, type CameraCollider } from './camera'
import type { Place } from './places'
import { buildIsland } from './decor'
import { ORBIT, createOrbit, orbitDrag, orbitStep } from './motion'
import { FADE_FOCUS, toon } from './materials'

export interface Stage {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  render: () => void
  resize: () => void
  follow: (px: number, py: number, pz: number, aimX: number, aimZ: number, shake: number) => void
  mobile: boolean
  touch: boolean
  /** Rotate the view by a drag of (dx, dy) pixels (right-drag on desktop, two fingers on touch). */
  orbit: (dx: number, dy: number, touch?: boolean) => void
  /** Live view pitch in degrees (smoothed). */
  readonly pitch: number
  /** Landmarks the camera must not pass through in this zone. */
  setColliders: (places: readonly Place[]) => void
  /** Current (smoothed) camera yaw, for camera-relative movement. */
  readonly yaw: number
  /** Island hub or the sewer dungeon: the island, sky stars, sun shadows and fog swap out. */
  setWorld: (world: 'island' | 'sewer', fog?: { color: number; near: number; far: number }) => void
  /** Draw calls in the last rendered frame (QA). */
  readonly drawCalls: number
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
  renderer.setClearColor(LOOK.clear, 1)
  // Filmic grade: pastel highlights roll off instead of clipping to flat white.
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = LOOK.exposure

  const scene = new Scene()
  // Fog only touches the far dream, never the play area, so foes read early.
  scene.fog = new Fog(LOOK.fog.color, LOOK.fog.near, LOOK.fog.far)
  scene.add(new HemisphereLight(LOOK.hemi.sky, LOOK.hemi.ground, LOOK.hemi.intensity))
  const sun = new DirectionalLight(LOOK.key.color, LOOK.key.intensity)
  sun.position.set(...LOOK.key.position)
  if (!mobile) {
    sun.castShadow = true
    sun.shadow.mapSize.set(LOOK.shadow.size, LOOK.shadow.size)
    sun.shadow.radius = LOOK.shadow.radius
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 40
    sun.shadow.camera.left = -16
    sun.shadow.camera.right = 16
    sun.shadow.camera.top = 16
    sun.shadow.camera.bottom = -16
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
  }
  scene.add(sun)
  // Cool rim from behind the view: separates characters from the green ground.
  const rim = new DirectionalLight(LOOK.rim.color, LOOK.rim.intensity)
  rim.position.set(...LOOK.rim.position)
  scene.add(rim)
  const fill = new DirectionalLight(LOOK.bounce.color, LOOK.bounce.intensity)
  fill.position.set(...LOOK.bounce.position)
  scene.add(fill)

  const island = buildIsland(scene, mobile)
  renderer.info.autoReset = false
  const stars = starField()
  scene.add(stars)

  const camera = new PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 80)
  const focus = new Vector3()
  const desired = new Vector3()
  // Wheel zoom; the real boom length also shortens as the view drops (see cameraRig).
  let zoom = CAMERA_DISTANCE
  let currentZoom = zoom
  let colliders: CameraCollider[] = []
  let boom = -1
  let lastFollow = 0
  let focusReady = false
  let leadX = 0
  let leadZ = 0
  const view = createOrbit(CAMERA_YAW, CAMERA_PITCH_DEG)
  let shakeT = 0
  bindZoom(canvas, (dir) => {
    const next = wheelStep({ zoom, pitch: view.pitchTarget }, dir)
    zoom = next.zoom
    view.pitchTarget = next.pitch
  }, (delta) => {
    zoom = clampCameraDistance(zoom + delta)
  }, (dx, dy) => orbitDrag(view, dx, dy, ORBIT.touchYawPerPx, ORBIT.touchPitchPerPx))

  let composer: EffectComposer | null = null
  if (!mobile) {
    // HalfFloat + MSAA target: the composer path used to drop antialiasing (jaggy outlines) and
    // had no OutputPass, so tone mapping and sRGB conversion never ran on desktop.
    const ratio = renderer.getPixelRatio()
    const target = new WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, {
      type: HalfFloatType,
      samples: Math.min(LOOK.msaa, renderer.capabilities.maxSamples || 0),
    })
    composer = new EffectComposer(renderer, target)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
  }

  const resize = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    composer?.setSize(width, height)
  }

  const islandRoot = scene.getObjectByName('island')
  let calls = 0
  return {
    get drawCalls() {
      return calls
    },
    setWorld: (world, fogLook) => {
      const sewer = world === 'sewer'
      if (islandRoot) islandRoot.visible = !sewer
      stars.visible = !sewer
      sun.castShadow = !mobile && !sewer
      const fog = scene.fog instanceof Fog ? scene.fog : null
      const look = fogLook ?? LOOK.fog
      if (fog) {
        fog.color.set(look.color)
        fog.near = look.near
        fog.far = look.far
      }
      if (!sewer) {
        camera.fov = CAMERA_FOV
        camera.updateProjectionMatrix()
        focusReady = false
        boom = -1
      }
    },
    get yaw() {
      return view.yaw
    },
    get pitch() {
      return view.pitch
    },
    orbit: (dx, dy, touch) => orbitDrag(view, dx, dy, touch ? ORBIT.touchYawPerPx : ORBIT.yawPerPx, touch ? ORBIT.touchPitchPerPx : ORBIT.pitchPerPx),
    setColliders: (places) => {
      colliders = cameraColliders(places)
    },
    scene,
    camera,
    renderer,
    mobile,
    touch: narrow,
    resize,
    render: () => {
      stars.rotation.y += 0.0004
      island.tick(performance.now() / 1000)
      renderer.info.reset()
      if (composer) composer.render()
      else renderer.render(scene, camera)
      calls = renderer.info.render.calls
    },
    follow: (px, py, pz, aimX, aimZ, shake) => {
      const now = performance.now()
      const dt = Math.min(0.05, lastFollow ? (now - lastFollow) / 1000 : 1)
      lastFollow = now
      // The aim lead gets its own slow filter: flicking the mouse across her used to swing the
      // whole view 1.8 m in about a third of a second, which read as the screen lurching.
      const lead = focusPoint(0, 0, 0, aimX, aimZ)
      const kl = 1 - Math.exp(-3.5 * dt)
      leadX += (lead.x - leadX) * kl
      leadZ += (lead.z - leadZ) * kl
      const lookX = px + leadX
      // Low views look a little higher on her, so she isn't tiny and the horizon shows.
      const rig = cameraRig(view.pitch, currentZoom)
      const lookY = py + rig.lookY
      const lookZ = pz + leadZ
      // Frame-rate independent follow on her body.
      const k = 1 - Math.exp(-10 * dt)
      if (!focusReady) focus.set(lookX, lookY, lookZ)
      focusReady = true
      focus.x += (lookX - focus.x) * k
      focus.y += (lookY - focus.y) * k
      focus.z += (lookZ - focus.z) * k
      currentZoom += (zoom - currentZoom) * (1 - Math.exp(-10 * dt))
      orbitStep(view, dt)
      const length = cameraRig(view.pitch, currentZoom).distance
      const offset = cameraOffset(view.yaw, view.pitch, length)
      desired.set(focus.x + offset.x, focus.y + offset.y, focus.z + offset.z)
      // Pull the camera in front of a house, tree or the portal behind her: in fast so the lens
      // never shows the inside of a wall, back out slowly so it doesn't pump.
      const allowed = boomLength(focus.x, focus.y, focus.z, desired.x, desired.y, desired.z, colliders)
      if (boom < 0) boom = allowed
      boom += (allowed - boom) * (1 - Math.exp(-(allowed < boom ? 30 : 4) * dt))
      boom = Math.min(boom, length)
      camera.position.copy(focus).addScaledVector(desired.sub(focus), boom / length)
      // Smooth shake (a few summed sines) instead of a fresh random offset each frame, which
      // looked like the picture skipping.
      shakeT += dt
      if (shake > 0) {
        const sx = Math.sin(shakeT * 61) * 0.6 + Math.sin(shakeT * 37 + 1.3) * 0.4
        const sy = Math.sin(shakeT * 53 + 0.7) * 0.6 + Math.sin(shakeT * 29 + 2.1) * 0.4
        camera.position.x += sx * shake * 0.5
        camera.position.y += sy * shake * 0.22
      }
      camera.lookAt(focus)
      FADE_FOCUS.value.copy(focus)
    },
  }
}

function bindZoom(canvas: HTMLCanvasElement, onWheel: (dir: number) => void, onDelta: (delta: number) => void, onTwist: (dx: number, dy: number) => void): void {
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    onWheel(Math.sign(event.deltaY))
  }, { passive: false })
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch = 0
  let midX = 0
  let midY = 0
  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size < 2) return
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const mid = (a.x + b.x) / 2
    const midV = (a.y + b.y) / 2
    if (pinch > 0) {
      onDelta((pinch - dist) * 0.012)
      // Two fingers sliding together: sideways turns the view, up/down tilts it.
      onTwist(mid - midX, midV - midY)
    }
    pinch = dist
    midX = mid
    midY = midV
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
