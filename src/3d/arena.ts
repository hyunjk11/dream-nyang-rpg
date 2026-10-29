import {
  BackSide,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
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
import { CAMERA_DISTANCE, CAMERA_PITCH_DEG, CAMERA_YAW, cameraOffset, clampCameraDistance, focusPoint } from './feel'
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
  scene.fog = new Fog(0x3a2458, 10, 26)
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

  const island = buildIsland(scene, mobile)
  const stars = starField()
  scene.add(stars)

  const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 80)
  const focus = new Vector3()
  const desired = new Vector3()
  let distance = CAMERA_DISTANCE
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
      island.tick()
      if (composer) composer.render()
      else renderer.render(scene, camera)
    },
    follow: (px, py, pz, aimX, aimZ, shake) => {
      const look = focusPoint(px, py, pz, aimX, aimZ)
      const offset = cameraOffset(CAMERA_YAW, CAMERA_PITCH_DEG, distance)
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

function buildIsland(scene: Scene, lowPower: boolean): { tick: () => void } {
  const sky = new Mesh(new SphereGeometry(48, 20, 14), new MeshBasicMaterial({ color: 0x24143f, side: BackSide }))
  scene.add(sky)
  const ground = new Mesh(coloredDisc(14.5, 56), toon(0xffffff))
  const groundMat = ground.material as ReturnType<typeof toon>
  groundMat.vertexColors = true
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0.02
  ground.receiveShadow = true
  scene.add(ground)
  const rim = new Mesh(new CylinderGeometry(14.5, 11.4, 2.2, 36, 1, true), toon(0xf0b7d4))
  rim.position.y = -1.05
  scene.add(rim)
  const underside = new Mesh(new CircleGeometry(11.6, 24), toon(0xd989b8))
  underside.rotation.x = Math.PI / 2
  underside.position.y = -2.1
  scene.add(underside)

  const pathX = new Mesh(new CircleGeometry(1, 16), toon(0xffe7f3))
  pathX.scale.set(7.2, 1.15, 1)
  pathX.rotation.x = -Math.PI / 2
  pathX.position.y = 0.035
  scene.add(pathX)
  const pathZ = pathX.clone()
  pathZ.scale.set(1.15, 6.4, 1)
  scene.add(pathZ)
  const patchColors = [0xc6f3c4, 0xf7d2ea, 0xd7f0ff]
  for (let i = 0; i < 5; i += 1) {
    const patch = new Mesh(new CircleGeometry(1.1 + (i % 3) * 0.35, 14), toon(patchColors[i % 3]))
    patch.rotation.x = -Math.PI / 2
    patch.position.set(Math.cos(i * 1.3) * (2.4 + i), 0.028, Math.sin(i * 1.7) * (2.2 + i * 0.4))
    scene.add(patch)
  }

  scatter(scene, new ConeGeometry(0.035, 0.22, 4), 0x8ed98a, lowPower ? 70 : 150, 1.1, 8.2, 0.12, (i) => 0.7 + (i % 5) * 0.18, false)
  scatter(scene, new ConeGeometry(0.045, 0.11, 5), 0xffb7d5, lowPower ? 40 : 80, 0.8, 7.4, 0.06, (i) => 0.55 + (i % 4) * 0.2, false, [0xffb7d5, 0xffe08a, 0xb7e6ff, 0xffffff])
  scatter(scene, new SphereGeometry(0.06, 6, 4), 0xf4d7ea, lowPower ? 24 : 48, 0.6, 7.8, 0.045, () => 1, false)
  scatter(scene, new SphereGeometry(0.55, 8, 6), 0xfff6fb, lowPower ? 10 : 18, 9.5, 13.2, 0.35, (i) => 0.7 + (i % 3) * 0.35, false)

  const stems = scatter(scene, new CylinderGeometry(0.07, 0.1, 0.32, 6), 0xfff3e4, lowPower ? 8 : 12, 2.4, 7.2, 0.16, () => 1, !lowPower)
  const caps = scatter(scene, new SphereGeometry(0.22, 8, 6), 0xff8fb4, lowPower ? 8 : 12, 2.4, 7.2, 0.42, () => 1, !lowPower)
  copyLayout(stems, caps, 0.26)

  const crystalMat = toon(0xffb7ea, 0xffd6f2, 0.45)
  const crystalCount = lowPower ? 6 : 9
  for (let i = 0; i < crystalCount; i += 1) {
    const angle = (i / crystalCount) * Math.PI * 2 + 0.4
    const radius = 3.1 + (i % 3) * 1.15
    const height = 0.55 + (i % 3) * 0.28
    const crystal = new Mesh(new ConeGeometry(0.16, height, 5), crystalMat)
    crystal.position.set(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius)
    crystal.castShadow = !lowPower
    scene.add(crystal)
  }

  const moteCount = lowPower ? 18 : 36
  const motes = new InstancedMesh(new SphereGeometry(0.035, 5, 4), toon(0xfff6c8, 0xfff3b0, 0.7), moteCount)
  const moteBase: { x: number; y: number; z: number; phase: number }[] = []
  const dummy = new Object3D()
  for (let i = 0; i < moteCount; i += 1) {
    const angle = i * 2.17
    const radius = 1.4 + (i % 7) * 0.85
    moteBase.push({ x: Math.cos(angle) * radius, y: 0.35 + (i % 4) * 0.22, z: Math.sin(angle) * radius, phase: i })
    dummy.position.set(moteBase[i].x, moteBase[i].y, moteBase[i].z)
    dummy.updateMatrix()
    motes.setMatrixAt(i, dummy.matrix)
  }
  scene.add(motes)
  let time = 0
  return {
    tick: () => {
      time += 0.016
      for (let i = 0; i < moteBase.length; i += 1) {
        const mote = moteBase[i]
        dummy.position.set(mote.x, mote.y + Math.sin(time * 1.6 + mote.phase) * 0.08, mote.z)
        dummy.scale.setScalar(0.7 + Math.sin(time * 2 + mote.phase) * 0.25)
        dummy.updateMatrix()
        motes.setMatrixAt(i, dummy.matrix)
      }
      motes.instanceMatrix.needsUpdate = true
    },
  }
}

function coloredDisc(radius: number, segments: number) {
  const geo = new CircleGeometry(radius, segments)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const r = Math.hypot(x, y) / radius
    const wave = Math.sin(x * 0.85) * Math.cos(y * 0.65)
    colors[i * 3] = 0.55 + wave * 0.06 + r * 0.18
    colors[i * 3 + 1] = 0.78 + wave * 0.08 - r * 0.22
    colors[i * 3 + 2] = 0.48 + wave * 0.04
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

function scatter(
  scene: Scene,
  geometry: ConeGeometry | SphereGeometry | CylinderGeometry,
  color: number,
  count: number,
  minR: number,
  maxR: number,
  y: number,
  scaleOf: (index: number) => number,
  shadow: boolean,
  palette?: number[],
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, toon(color), count)
  mesh.castShadow = shadow
  mesh.receiveShadow = false
  const dummy = new Object3D()
  for (let i = 0; i < count; i += 1) {
    const angle = i * 2.399 + minR
    const radius = minR + ((i * 37) % 100) / 100 * (maxR - minR)
    const scale = scaleOf(i)
    dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    dummy.rotation.y = angle
    dummy.scale.set(scale, scale * (0.75 + (i % 3) * 0.2), scale)
    if (geometry instanceof SphereGeometry) dummy.scale.y *= 0.45
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    if (palette && mesh.setColorAt) mesh.setColorAt(i, new Color(palette[i % palette.length]))
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  scene.add(mesh)
  return mesh
}

function copyLayout(from: InstancedMesh, to: InstancedMesh, lift: number): void {
  const dummy = new Object3D()
  for (let i = 0; i < from.count; i += 1) {
    from.getMatrixAt(i, dummy.matrix)
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
    dummy.position.y += lift
    dummy.scale.y *= 0.55
    dummy.updateMatrix()
    to.setMatrixAt(i, dummy.matrix)
  }
  to.instanceMatrix.needsUpdate = true
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
