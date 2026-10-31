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
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { LOOK } from './look'
import { buildIsland } from '../world/town/decor'
import { toon } from './materials'
import { TPS } from './tps'

export interface Stage {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  render: () => void
  resize: () => void
  mobile: boolean
  touch: boolean
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

  // Placed every frame by the shared ShoulderRig (shooter.ts); town and dungeon use the same one.
  const camera = new PerspectiveCamera(TPS.fov, window.innerWidth / window.innerHeight, 0.1, 80)

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
  }
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
