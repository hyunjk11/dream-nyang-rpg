import { DETAIL } from './quality'
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
  ShaderMaterial,
  SphereGeometry,
  UniformsUtils,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { GUARD_EVERY, GUARD_GRID, GUARD_HOLD, GUARD_PROBE_SHADER, HDR_MAX, HDR_SAFE, SANITIZE_SHADER, allFinite, guardMean, guardVerdict, type GuardVerdict } from './safeframe'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
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
  /** Adaptive quality level (see core/quality.ts DETAIL). */
  setDetail: (level: number) => void
  /** Draw calls in the last rendered frame (QA). */
  readonly drawCalls: number
  /** Frame guard readout. */
  readonly guard: GuardStats
  /** QA: scan the raw HDR scene buffer (before the sanitize pass) of the last frame. Null on the no-composer path. */
  hdrScan: () => HdrScan | null
}

/** Frame guard readout (window.__dnrGuard, prod too): what it caught and fixed on this GPU. */
export interface GuardStats {
  reads: number
  nonfinite: number
  black: number
  white: number
  contextLost: number
  contextRestored: number
  /** Frames left with bloom off after the last catch. */
  hold: number
  last: GuardVerdict | ''
}

/** Reads the final HDR frame into a 32×18 probe target; draws nothing on screen. */
class GuardProbePass extends Pass {
  readonly target: WebGLRenderTarget
  private readonly quad: FullScreenQuad
  private readonly material: ShaderMaterial
  constructor() {
    super()
    this.needsSwap = false
    this.target = new WebGLRenderTarget(GUARD_GRID[0], GUARD_GRID[1], { type: HalfFloatType, depthBuffer: false })
    this.material = new ShaderMaterial({ ...GUARD_PROBE_SHADER, uniforms: UniformsUtils.clone(GUARD_PROBE_SHADER.uniforms) })
    this.quad = new FullScreenQuad(this.material)
  }
  render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = read.texture
    const was = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    this.quad.render(renderer)
    renderer.setRenderTarget(was)
  }
}

export interface HdrScan {
  pixels: number
  nan: number
  inf: number
  max: number
  over4: number
  over24: number
  /** First bad pixel (device px from the bottom-left), if any. */
  at: [number, number] | null
}

function halfToFloat(h: number): number {
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  const sign = h & 0x8000 ? -1 : 1
  if (e === 0) return sign * m * 2 ** -24
  if (e === 31) return m ? NaN : sign * Infinity
  return sign * (1 + m / 1024) * 2 ** (e - 15)
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
  let sceneTarget: WebGLRenderTarget | null = null
  let sanitize: ShaderPass | null = null
  let probe: GuardProbePass | null = null
  let bloomWanted = true
  const guard: GuardStats = { reads: 0, nonfinite: 0, black: 0, white: 0, contextLost: 0, contextRestored: 0, hold: 0, last: '' }
  let guardLit = false
  let guardFrame = 0
  let reading = false
  let lost = false
  canvas.addEventListener('webglcontextlost', (event) => {
    // Keep the context restorable; three rebuilds its GPU state on restore.
    event.preventDefault()
    lost = true
    guard.contextLost += 1
  })
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false
    guard.contextRestored += 1
    guard.hold = GUARD_HOLD
    resize()
  })
  ;(window as unknown as { __dnrGuard?: GuardStats }).__dnrGuard = guard

  /** Read the probe back and react: bloom off and a low HDR cap for a while after a bad frame. */
  const checkFrame = () => {
    if (!probe) return
    if (guard.hold > 0) {
      guard.hold -= 1
      if (guard.hold === 0) {
        if (bloomPass) bloomPass.enabled = bloomWanted
        if (sanitize) sanitize.uniforms.uMax.value = HDR_MAX
      }
    }
    if (++guardFrame % GUARD_EVERY !== 0 || reading) return
    const [w, h] = GUARD_GRID
    const buf = new Uint16Array(w * h * 4)
    reading = true
    // Async (PBO + fence): no GPU stall on the frame that asks.
    renderer
      .readRenderTargetPixelsAsync(probe.target, 0, 0, w, h, buf)
      .then(() => judge(buf, w, h))
      .catch(() => {})
      .finally(() => {
        reading = false
      })
  }
  const judge = (buf: Uint16Array, w: number, h: number) => {
    const n = w * h
    const lum = new Float32Array(n)
    const bad = new Float32Array(n)
    const dark = new Float32Array(n)
    const blown = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      lum[i] = halfToFloat(buf[i * 4])
      bad[i] = halfToFloat(buf[i * 4 + 1])
      dark[i] = halfToFloat(buf[i * 4 + 2])
      blown[i] = halfToFloat(buf[i * 4 + 3])
    }
    guard.reads += 1
    const verdict = guardVerdict({ lum, bad, dark, blown }, w, h, guardLit)
    guard.last = verdict
    if (verdict === 'ok') {
      guardLit = guardMean(lum) > 0.03
      return
    }
    guard[verdict] += 1
    guard.hold = GUARD_HOLD
    if (bloomPass) bloomPass.enabled = false
    if (sanitize && verdict === 'white') sanitize.uniforms.uMax.value = HDR_SAFE
  }
  let bloomPass: UnrealBloomPass | null = null
  if (!mobile) {
    // HalfFloat + MSAA target: the composer path used to drop antialiasing (jaggy outlines) and
    // had no OutputPass, so tone mapping and sRGB conversion never ran on desktop.
    const ratio = renderer.getPixelRatio()
    const target = new WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, {
      type: HalfFloatType,
      samples: Math.min(LOOK.msaa, renderer.capabilities.maxSamples || 0),
    })
    composer = new EffectComposer(renderer, target)
    const scenePass = new RenderPass(scene, camera)
    const draw = scenePass.render.bind(scenePass)
    scenePass.render = (r, w, read, dt, mask) => {
      sceneTarget = read
      draw(r, w, read, dt, mask)
    }
    composer.addPass(scenePass)
    // 화면 깨짐 방지: a NaN/Inf pixel (or a blown-out HDR one) never reaches the bloom mips.
    sanitize = new ShaderPass(SANITIZE_SHADER)
    composer.addPass(sanitize)
    const bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold)
    composer.addPass(bloom)
    // Frame guard: a 32×18 look at the final HDR frame (before tone mapping), read back every few frames.
    probe = new GuardProbePass()
    composer.addPass(probe)
    composer.addPass(new OutputPass())
    bloomPass = bloom
  }
  const basePr = renderer.getPixelRatio()
  let shadowEvery = 1
  let frameNo = 0
  // Last camera pose with finite numbers: a NaN pose (a bad aim vector) blanks the whole frame.
  const goodPos = camera.position.clone()
  const goodQuat = camera.quaternion.clone()

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
    guard,
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
    setDetail: (level) => {
      const d = DETAIL[Math.max(0, Math.min(DETAIL.length - 1, level))]
      const pr = Math.max(0.5, basePr * d.pr)
      if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) {
        renderer.setPixelRatio(pr)
        composer?.setPixelRatio(pr)
        resize()
      }
      bloomWanted = d.bloom
      if (bloomPass) bloomPass.enabled = d.bloom && guard.hold === 0
      // Shadows refresh every N frames instead of recompiling materials without them.
      shadowEvery = d.shadowEvery
      renderer.shadowMap.autoUpdate = shadowEvery === 1
      renderer.shadowMap.needsUpdate = true
    },
    hdrScan: () => {
      const t = sceneTarget
      if (!t) return null
      const w = t.width
      const h = t.height
      const buf = new Uint16Array(w * h * 4)
      renderer.readRenderTargetPixels(t, 0, 0, w, h, buf)
      const out: HdrScan = { pixels: w * h, nan: 0, inf: 0, max: 0, over4: 0, over24: 0, at: null }
      for (let i = 0; i < buf.length; i += 4) {
        let worst = 0
        for (let c = 0; c < 3; c += 1) {
          const v = halfToFloat(buf[i + c])
          if (Number.isNaN(v)) out.nan += 1
          else if (!Number.isFinite(v)) out.inf += 1
          else worst = Math.max(worst, v)
          if (!Number.isFinite(v) && !out.at) out.at = [(i / 4) % w, Math.floor(i / 4 / w)]
        }
        if (worst > out.max) out.max = worst
        if (worst > 4) out.over4 += 1
        if (worst > 24) out.over24 += 1
      }
      return out
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
      if (shadowEvery > 1 && frameNo++ % shadowEvery === 0) renderer.shadowMap.needsUpdate = true
      camera.updateMatrixWorld()
      if (allFinite(camera.matrixWorld.elements)) {
        goodPos.copy(camera.position)
        goodQuat.copy(camera.quaternion)
      } else {
        camera.position.copy(goodPos)
        camera.quaternion.copy(goodQuat)
        camera.updateMatrixWorld()
      }
      if (lost) return
      if (composer) {
        composer.render()
        checkFrame()
      } else renderer.render(scene, camera)
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
