/**
 * Byeolha's locomotion, and knockback rules. Pure math (no Three.js) so the feel is
 * unit-tested. All smoothing is exponential (1 - e^-λdt), so it behaves the same at 30, 60 or 144 FPS.
 */
import { wrapAngle } from './feel'

export const MOVE = {
  walk: 3.15,
  run: 5.1,
  dash: 9.2,
  /** Start/stop smoothing (1/s): about 0.25 s to full speed and ~0.3 s to a stop, so the legs settle. */
  accel: 12,
  brake: 11,
  /** Facing: λ and the hard cap on turn speed (rad/s), so a 180° flip takes ~0.3 s, not one frame. */
  turnMove: 12,
  turnMoveMax: 11,
  turnAim: 18,
  turnAimMax: 16,
  turnIdle: 8,
  turnIdleMax: 7,
  /** Idle and not shooting: she only turns her feet once the cursor is this far behind her shoulder. */
  idleTurnStart: 1.3,
  idleTurnStop: 0.15,
  /** While shooting, the legs point at most this far from the aim (rest is spine twist). */
  legOffsetMax: 0.85,
}

/** Clip facts measured from byeolha_animated (stance-foot speed in m/s, cycle length in s). */
export const GAIT = {
  walk: { speed: 1.41, cycle: 0.967 },
  run: { speed: 4.42, cycle: 0.7 },
  /** Run share ramps in between these speeds; walking speed (3.15) is a brisk walk/jog mix. */
  runFrom: 1.6,
  runTo: 4.4,
  /** Locomotion fades in over this speed range, so stopping settles into idle instead of popping. */
  moveFrom: 0.12,
  moveTo: 0.9,
  /** Dash is short; don't let the legs spin faster than a sprint. */
  phaseSpeedCap: 5.6,
}

export const KNOCK = {
  /** Initial push (m/s) and decay (1/s): travels speed/decay ≈ 0.72 m over ~0.4 s. */
  speed: 6.5,
  decay: 9,
  /** Share of her own steering removed while the push is strong, so input doesn't fight it. */
  controlLoss: 0.6,
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Exponential approach, frame-rate independent. */
export function approach(current: number, target: number, dt: number, lambda: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/** Turn toward a target angle with damping and a max angular speed. */
export function turnToward(current: number, target: number, dt: number, lambda: number, maxRate: number): number {
  const diff = wrapAngle(target - current)
  let step = diff * (1 - Math.exp(-lambda * dt))
  const cap = maxRate * dt
  if (step > cap) step = cap
  if (step < -cap) step = -cap
  return wrapAngle(current + step)
}

/** Weights for idle / walk / run from her real ground speed. */
export function gaitBlend(speed: number): { idle: number; walk: number; run: number } {
  const move = smoothstep(GAIT.moveFrom, GAIT.moveTo, speed)
  const run = smoothstep(GAIT.runFrom, GAIT.runTo, speed)
  return { idle: 1 - move, walk: move * (1 - run), run: move * run }
}

/**
 * Cycles per second for the synced walk/run blend at this speed. Distance per cycle is blended by
 * the run share, so the planted foot moves backward at about her ground speed (no ice skating).
 */
export function gaitRate(speed: number): number {
  const run = smoothstep(GAIT.runFrom, GAIT.runTo, Math.abs(speed))
  const stride = GAIT.walk.speed * GAIT.walk.cycle * (1 - run) + GAIT.run.speed * GAIT.run.cycle * run
  const s = Math.sign(speed) * Math.min(Math.abs(speed), GAIT.phaseSpeedCap)
  return s / stride
}

/**
 * Leg direction while shooting: torso squares up to the aim, legs lean toward travel (strafe) or
 * away from it (backpedal), capped, so the walk cycle runs along the legs instead of sideways.
 */
export function legYaw(moveYaw: number, aimYaw: number, maxOffset = MOVE.legOffsetMax): number {
  const rel = wrapAngle(moveYaw - aimYaw)
  // Moving behind her: legs face the aim and the cycle plays backward.
  const toward = Math.abs(rel) <= Math.PI / 2 ? rel : wrapAngle(rel + Math.PI)
  const off = Math.max(-maxOffset, Math.min(maxOffset, toward))
  return wrapAngle(aimYaw + off)
}

/** Knockback velocity multiplier after dt (frame-rate independent decay). */
export function knockDecay(dt: number, decay = KNOCK.decay): number {
  return Math.exp(-decay * dt)
}

/** Total distance a push of `speed` travels before it dies out. */
export function knockDistance(speed = KNOCK.speed, decay = KNOCK.decay): number {
  return speed / decay
}
