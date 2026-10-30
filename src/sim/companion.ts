/**
 * Mochi's follow brain. Pure math, no Three.js, so the gait and leash rules are testable.
 *
 * The old follow aimed Mochi at a slot behind Byeolha's *facing*, which turns with the mouse.
 * Sweeping the aim swung the slot around her at up to ~7 m/s and Mochi chased it with an
 * exponential snap, so the cat skated across the screen while she stood still. The same rule
 * lived in the 2D scene. Here the slot trails her *travel* heading, Mochi only sets off once
 * she has left a leash radius, and its speed and acceleration are capped like a walking cat.
 */

export const CAT = {
  behind: 1.25,
  side: 0.7,
  /** Start walking when the slot is this far away, stop when this close (hysteresis). */
  wake: 0.85,
  settle: 0.22,
  walkSpeed: 3.4,
  runSpeed: 6.2,
  /** Beyond this distance Mochi breaks into a run. */
  runFrom: 2.2,
  accel: 10,
  brake: 14,
  /** Far enough that walking over would look silly (respawn, restart): place it at the slot. */
  snap: 11,
  /** Stride length (m) per full gait cycle at walk and run. */
  strideWalk: 0.5,
  strideRun: 0.9,
  turnRate: 9,
  /** Max share of the slot pointing toward the camera, so Mochi does not cover her. */
  cameraSide: 0.3,
  /** Min sideways gap (m) between them as seen from the camera. */
  screenGap: 0.75,
} as const

export interface CatBrain {
  x: number
  z: number
  vx: number
  vz: number
  yaw: number
  moving: boolean
  /** Gait cycle phase in radians, advanced by distance travelled. */
  phase: number
  /** Smoothed heading of Byeolha's travel (unit). */
  hx: number
  hz: number
  /** Which side of her (as seen from the camera) Mochi keeps: +1 screen right, -1 left. */
  side: number
}

export function createCat(x = 0.9, z = -0.9): CatBrain {
  return { x, z, vx: 0, vz: 0, yaw: 0, moving: false, phase: 0, hx: 0, hz: 1, side: 1 }
}

/** Follow slot: behind and to one side of where she is heading, kept off the camera side. */
export function catSlot(heroX: number, heroZ: number, hx: number, hz: number, camX: number, camZ: number, prefer = 1): { x: number; z: number; lateral: number } {
  // Right of the heading (screen-consistent with the hero rig: right = (-hz, hx) in X/Z).
  let dx = -hx * CAT.behind + -hz * CAT.side
  let dz = -hz * CAT.behind + hx * CAT.side
  const len = Math.hypot(dx, dz)
  const cl = Math.hypot(camX, camZ) || 1
  const cx = camX / cl
  const cz = camZ / cl
  const toward = (dx * cx + dz * cz) / len
  if (toward > CAT.cameraSide) {
    const cut = (toward - CAT.cameraSide) * len
    dx -= cx * cut
    dz -= cz * cut
  }
  // Keep a sideways gap on screen too, so she never hides Mochi (or Mochi her) along the view axis.
  const rx = -cz
  const rz = cx
  const lateral = dx * rx + dz * rz
  if (Math.abs(lateral) < CAT.screenGap) {
    // Stay on the side it was already on, so a slow turn never flips it across her.
    const sign = prefer < 0 ? -1 : 1
    const push = sign * CAT.screenGap - lateral
    dx += rx * push
    dz += rz * push
  }
  return { x: heroX + dx, z: heroZ + dz, lateral }
}

export function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/**
 * One step. heroVx/heroVz is her actual ground velocity this frame (m/s), camX/camZ points from
 * her toward the camera on the ground plane. Returns the slot for debugging.
 */
export function stepCat(cat: CatBrain, dt: number, heroX: number, heroZ: number, heroVx: number, heroVz: number, camX: number, camZ: number, limit = Infinity): { x: number; z: number } {
  const heroSpeed = Math.hypot(heroVx, heroVz)
  if (heroSpeed > 0.6) {
    const k = 1 - Math.exp(-3.2 * dt)
    let hx = cat.hx + (heroVx / heroSpeed - cat.hx) * k
    let hz = cat.hz + (heroVz / heroSpeed - cat.hz) * k
    const hl = Math.hypot(hx, hz)
    if (hl < 1e-3) {
      hx = heroVx / heroSpeed
      hz = heroVz / heroSpeed
    } else {
      hx /= hl
      hz /= hl
    }
    cat.hx = hx
    cat.hz = hz
  }
  const slot = catSlot(heroX, heroZ, cat.hx, cat.hz, camX, camZ, cat.side)
  if (Math.abs(slot.lateral) > CAT.screenGap * 1.4) cat.side = slot.lateral < 0 ? -1 : 1
  let tx = slot.x - cat.x
  let tz = slot.z - cat.z
  let dist = Math.hypot(tx, tz)
  if (dist > CAT.snap) {
    cat.x = slot.x
    cat.z = slot.z
    cat.vx = 0
    cat.vz = 0
    cat.moving = false
    tx = 0
    tz = 0
    dist = 0
  }
  if (!cat.moving && dist > CAT.wake) cat.moving = true
  if (cat.moving && dist < CAT.settle && heroSpeed < 0.6) cat.moving = false
  let wantX = 0
  let wantZ = 0
  if (cat.moving && dist > 1e-4) {
    const runK = Math.min(1, Math.max(0, (dist - CAT.runFrom) / 1.2))
    const cap = CAT.walkSpeed + (CAT.runSpeed - CAT.walkSpeed) * runK
    // Arrive: ease in over the last metre, but keep pace with her when she is walking.
    const speed = Math.min(cap, Math.max(dist * 2.4, Math.min(cap, heroSpeed * 1.05)))
    wantX = (tx / dist) * speed
    wantZ = (tz / dist) * speed
  }
  const ax = wantX - cat.vx
  const az = wantZ - cat.vz
  const al = Math.hypot(ax, az)
  const speeding = Math.hypot(wantX, wantZ) >= Math.hypot(cat.vx, cat.vz)
  const maxDv = (speeding ? CAT.accel : CAT.brake) * dt
  if (al > maxDv) {
    cat.vx += (ax / al) * maxDv
    cat.vz += (az / al) * maxDv
  } else {
    cat.vx = wantX
    cat.vz = wantZ
  }
  cat.x += cat.vx * dt
  cat.z += cat.vz * dt
  const r = Math.hypot(cat.x, cat.z)
  if (r > limit) {
    cat.x *= limit / r
    cat.z *= limit / r
  }
  const speed = Math.hypot(cat.vx, cat.vz)
  const stride = gaitStride(speed)
  cat.phase = (cat.phase + (speed * dt * Math.PI * 2) / stride) % (Math.PI * 2)
  // Face travel while moving; at rest turn toward her, slowly.
  const face = speed > 0.25 ? Math.atan2(cat.vx, cat.vz) : Math.atan2(heroX - cat.x, heroZ - cat.z)
  const turn = wrap(face - cat.yaw)
  const rate = speed > 0.25 ? CAT.turnRate : 2.5
  const stepTurn = turn * (1 - Math.exp(-rate * dt))
  const maxTurn = 7 * dt
  cat.yaw = wrap(cat.yaw + Math.max(-maxTurn, Math.min(maxTurn, stepTurn)))
  return slot
}

export function gaitStride(speed: number): number {
  const runK = Math.min(1, Math.max(0, (speed - CAT.walkSpeed) / (CAT.runSpeed - CAT.walkSpeed)))
  return CAT.strideWalk + (CAT.strideRun - CAT.strideWalk) * runK
}

/** 0 at rest, 1 at full walk; run blend 0..1 above walk speed. */
export function gaitWeights(speed: number): { walk: number; run: number } {
  const walk = Math.min(1, speed / 1.2)
  const run = Math.min(1, Math.max(0, (speed - CAT.walkSpeed * 0.9) / (CAT.runSpeed - CAT.walkSpeed * 0.9)))
  return { walk, run }
}
