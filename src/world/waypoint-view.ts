import { AdditiveBlending, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, type Scene } from 'three'

/** Most trail dots drawn at once. */
export const TRAIL_DOTS = 16

/**
 * The glowing ground trail toward a quest waypoint (little arrow heads flowing along the route) and
 * a soft light beam over the goal. One instanced draw for the trail, one mesh for the beam.
 */
export class WaypointView {
  readonly group = new Group()
  private readonly dots: InstancedMesh
  private readonly beam: Mesh
  private readonly dummy = new Object3D()
  private readonly mat: MeshBasicMaterial

  constructor(color = 0xffd36b) {
    const tint = new Color(color)
    // A flat arrow head lying on the floor, pointing +z (rotated per dot along the route).
    const head = new ConeGeometry(0.26, 0.52, 3)
    head.rotateX(Math.PI / 2)
    head.scale(1, 0.25, 1)
    // Solid amber (not additive) so it still reads on the bright meadow grass as well as the dark sewer.
    this.mat = new MeshBasicMaterial({ color: 0xffa51f, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false })
    this.dots = new InstancedMesh(head, this.mat, TRAIL_DOTS)
    this.dots.count = 0
    this.dots.frustumCulled = false
    this.dots.renderOrder = 3
    const beamGeo = new CylinderGeometry(0.35, 0.6, 7, 16, 1, true)
    beamGeo.translate(0, 3.5, 0)
    this.beam = new Mesh(beamGeo, new MeshBasicMaterial({ color: tint.clone().multiplyScalar(1.4), transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
    this.beam.visible = false
    this.group.add(this.dots, this.beam)
    this.group.visible = false
  }

  attach(scene: Scene): void {
    if (this.group.parent !== scene) scene.add(this.group)
  }

  /** Dots with their heading (to the next dot) and the beam over the goal. */
  show(dots: readonly { x: number; z: number; t: number }[], goal: { x: number; z: number } | null, time: number): void {
    this.group.visible = true
    const n = Math.min(TRAIL_DOTS, dots.length)
    for (let i = 0; i < n; i += 1) {
      const d = dots[i]
      const next = dots[i + 1] ?? goal ?? d
      const yaw = Math.atan2(next.x - d.x, next.z - d.z)
      // Fade in near her, fade out at the far end of the visible stretch.
      const s = 0.65 + 0.35 * Math.sin(Math.min(1, d.t * 1.6 + 0.2) * Math.PI)
      this.dummy.position.set(d.x, 0.07, d.z)
      this.dummy.rotation.set(0, yaw, 0)
      this.dummy.scale.setScalar(s)
      this.dummy.updateMatrix()
      this.dots.setMatrixAt(i, this.dummy.matrix)
    }
    this.dots.count = n
    this.dots.instanceMatrix.needsUpdate = true
    this.mat.opacity = 0.82 + 0.14 * Math.sin(time * 5)
    this.beam.visible = !!goal
    if (goal) {
      this.beam.position.set(goal.x, 0, goal.z)
      this.beam.rotation.y = time * 0.8
    }
  }

  hide(): void {
    this.group.visible = false
    this.dots.count = 0
  }

  dispose(): void {
    this.group.removeFromParent()
    this.dots.geometry.dispose()
    this.mat.dispose()
    this.beam.geometry.dispose()
    ;(this.beam.material as MeshBasicMaterial).dispose()
  }
}
