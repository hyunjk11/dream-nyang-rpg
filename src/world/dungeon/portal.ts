import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
  type Vector3,
} from 'three'

const SWIRL_FRAG = /* glsl */ `
uniform float time;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float a = atan(c.y, c.x);
  float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - time * 3.2);
  float edge = smoothstep(1.0, 0.75, r);
  vec3 col = mix(tint, vec3(1.0), swirl * 0.55 * (1.0 - r));
  gl_FragColor = vec4(col * 1.6, edge * (0.45 + 0.4 * swirl));
}
`

const SWIRL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** A floor portal: spinning ring, swirling disc and a soft light column. */
export class Portal {
  readonly group = new Group()
  readonly radius = 1.1
  private readonly ring: Mesh
  private readonly swirl: ShaderMaterial
  private readonly column: Mesh

  constructor(at: Vector3, color = 0x9ad7ff) {
    const c = new Color(color)
    this.ring = new Mesh(
      new RingGeometry(0.7, 0.95, 40),
      new MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.05
    this.swirl = new ShaderMaterial({
      uniforms: { time: { value: 0 }, tint: { value: c } },
      vertexShader: SWIRL_VERT,
      fragmentShader: SWIRL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const disc = new Mesh(new CircleGeometry(0.75, 40), this.swirl)
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.045
    this.column = new Mesh(
      new CylinderGeometry(0.8, 0.95, 3.6, 24, 1, true).translate(0, 1.8, 0),
      new MeshBasicMaterial({ color: c.clone().multiplyScalar(0.55), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    )
    this.group.add(this.ring, disc, this.column)
    this.group.position.copy(at)
    this.group.name = 'sewer-portal'
  }

  set active(on: boolean) {
    this.group.visible = on
  }

  get active(): boolean {
    return this.group.visible
  }

  update(time: number): void {
    this.swirl.uniforms.time.value = time
    this.ring.rotation.z = time * 0.8
    this.column.scale.set(1 + Math.sin(time * 2.1) * 0.04, 1, 1 + Math.sin(time * 2.1) * 0.04)
  }

  /** She is standing in it. */
  contains(x: number, z: number): boolean {
    return this.group.visible && Math.hypot(x - this.group.position.x, z - this.group.position.z) < this.radius
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.geometry.dispose()
      ;(m.material as MeshBasicMaterial).dispose()
    })
    this.group.removeFromParent()
  }
}
