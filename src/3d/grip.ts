import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { wrapAngle } from './feel'

/** Standing height of the chibi Byeolha model in metres (the old realistic model was 1.62). */
export const HERO_HEIGHT = 1.45
/** World size of the water pistol in her hand. */
export const GUN_SIZE = 1.0
/** Barrel never swings further than this from her chest line, so it can't point across her back. */
export const BARREL_CONE = (70 * Math.PI) / 180
/** Relaxed "low ready" when she isn't shooting: barrel forward and down. */
export const REST_PITCH = (-32 * Math.PI) / 180
/** Character ink: thin, softer than the scenery ink, and thinner still when the lens is close. */
export const CHARACTER_INK = { width: 0.0085, color: 0x55395f, near: { ref: 6, min: 0.45 } }

/** Fixed transform of the gun inside the RightHand bone. */
export interface Grip {
  rotation: Quaternion
  offset: Vector3
  handScale: number
}

/**
 * Work out how the pistol sits in her right hand from the bind pose (Meshy rigs bind in an A-pose
 * with the palms toward the thighs): the barrel continues the forearm->hand line, the palm presses
 * on the grip's +X side, and the grip sits a little past the wrist joint, inside the fist.
 */
export function calibrateGrip(root: Object3D, fore: Object3D, hand: Object3D, reach = 0.045): Grip {
  root.updateMatrixWorld(true)
  const handPos = hand.getWorldPosition(new Vector3())
  const forePos = fore.getWorldPosition(new Vector3())
  const center = root.getWorldPosition(new Vector3())
  const f = handPos.clone().sub(forePos).normalize()
  // Palm normal: toward her body (horizontal), made perpendicular to the fingers.
  let p = new Vector3(center.x - handPos.x, 0, center.z - handPos.z)
  if (p.lengthSq() < 1e-6 || Math.abs(p.clone().normalize().dot(f)) > 0.9) p = new Vector3(0, -1, 0)
  p.normalize().addScaledVector(f, -p.dot(f)).normalize()
  const up = new Vector3().crossVectors(f, p).normalize()
  const gunWorld = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(p, up, f))
  const handQ = hand.getWorldQuaternion(new Quaternion())
  const handScale = Math.max(1e-6, hand.getWorldScale(new Vector3()).x)
  const rotation = handQ.clone().invert().multiply(gunWorld)
  const offset = f.clone().multiplyScalar(reach).addScaledVector(p, 0.012).applyQuaternion(handQ.clone().invert()).divideScalar(handScale)
  return { rotation, offset, handScale }
}

/** Barrel heading: toward the aim, kept inside a cone in front of her chest; straight ahead once she is down. */
export function barrelYaw(want: number, facing: number, alive = true): number {
  if (!alive) return facing
  const off = wrapAngle(want - facing)
  return Math.abs(off) > BARREL_CONE ? facing + Math.sign(off) * BARREL_CONE : want
}

/** World rotation of a gun whose +Z barrel points at (yaw, pitch) with its top kept up. */
export function barrelQuaternion(yaw: number, pitch: number, out = new Quaternion()): Quaternion {
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitch)
  return out.copy(qy).multiply(qx)
}

/** Hand world rotation that puts a gun with this grip at `gunWorld`. */
export function handForGun(gunWorld: Quaternion, grip: Grip, out = new Quaternion()): Quaternion {
  return out.copy(gunWorld).multiply(grip.rotation.clone().invert())
}
