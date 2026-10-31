import { describe, expect, it } from 'vitest'
import { Group, Object3D, Quaternion, Vector3 } from 'three'
import {
  BARREL_CONE,
  CHARACTER_INK,
  REST_PITCH,
  barrelQuaternion,
  barrelYaw,
  calibrateGrip,
  handForGun,
} from '../src/actors/grip'

/** A-포즈 오른팔: 몸 중심(0,1,0)에서 +X 쪽으로 비스듬히 내려간 팔뚝과 손. */
function armRig() {
  const root = new Group()
  const fore = new Object3D()
  fore.position.set(0.25, 1.0, 0)
  const hand = new Object3D()
  hand.position.set(0.15, -0.15, 0)
  hand.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.7)
  root.add(fore)
  fore.add(hand)
  root.updateMatrixWorld(true)
  return { root, fore, hand }
}

const forward = (q: Quaternion) => new Vector3(0, 0, 1).applyQuaternion(q)

describe('손에 쥔 물총 그립', () => {
  it('총열은 팔뚝→손 방향을 그대로 이어간다', () => {
    const { root, fore, hand } = armRig()
    const grip = calibrateGrip(root, fore, hand)
    const handQ = hand.getWorldQuaternion(new Quaternion())
    const gunWorld = handQ.clone().multiply(grip.rotation)
    const fingers = new Vector3(0.15, -0.15, 0).normalize()
    expect(forward(gunWorld).dot(fingers)).toBeGreaterThan(0.999)
  })

  it('손바닥(총의 +X)은 몸 안쪽을 향한다', () => {
    const { root, fore, hand } = armRig()
    const grip = calibrateGrip(root, fore, hand)
    const gunWorld = hand.getWorldQuaternion(new Quaternion()).multiply(grip.rotation)
    const palm = new Vector3(1, 0, 0).applyQuaternion(gunWorld)
    expect(palm.x).toBeLessThan(-0.5)
  })

  it('그립 위치는 손목보다 손가락 쪽으로 조금 나가 있다', () => {
    const { root, fore, hand } = armRig()
    const grip = calibrateGrip(root, fore, hand, 0.05)
    const world = hand.localToWorld(grip.offset.clone())
    const wrist = hand.getWorldPosition(new Vector3())
    const along = world.clone().sub(wrist).dot(new Vector3(0.15, -0.15, 0).normalize())
    expect(along).toBeCloseTo(0.05, 3)
    expect(world.distanceTo(wrist)).toBeLessThan(0.06)
  })

  it('handForGun 은 손 회전과 그립을 곱하면 원래 총 회전으로 돌아온다', () => {
    const { root, fore, hand } = armRig()
    const grip = calibrateGrip(root, fore, hand)
    const want = barrelQuaternion(1.1, 0.2)
    const handWorld = handForGun(want, grip)
    const back = handWorld.clone().multiply(grip.rotation)
    expect(Math.abs(back.dot(want))).toBeCloseTo(1, 6)
  })
})

describe('총구 방향', () => {
  it('barrelQuaternion: yaw 0, pitch 0 은 +Z, 양의 pitch 는 위, 쉬는 자세는 아래', () => {
    expect(forward(barrelQuaternion(0, 0)).z).toBeCloseTo(1, 6)
    expect(forward(barrelQuaternion(0, 0.3)).y).toBeGreaterThan(0.25)
    expect(forward(barrelQuaternion(0, REST_PITCH)).y).toBeLessThan(-0.4)
    const side = forward(barrelQuaternion(Math.PI / 2, 0))
    expect(side.x).toBeCloseTo(1, 6)
  })

  it('총구 윗면은 기울어져도 위쪽을 유지한다', () => {
    const top = new Vector3(0, 1, 0).applyQuaternion(barrelQuaternion(2.0, 0.3))
    expect(top.y).toBeGreaterThan(0.9)
  })

  it('barrelYaw: 가슴 앞 원뿔 안에서는 그대로, 밖이면 경계로 잘린다', () => {
    expect(barrelYaw(0.4, 0)).toBeCloseTo(0.4)
    expect(barrelYaw(2.5, 0)).toBeCloseTo(BARREL_CONE)
    expect(barrelYaw(-2.5, 0)).toBeCloseTo(-BARREL_CONE)
  })

  it('쓰러지면 총구는 몸 방향을 따른다', () => {
    expect(barrelYaw(1.2, 0.3, false)).toBe(0.3)
  })
})

describe('캐릭터 잉크', () => {
  it('배경 잉크보다 얇고, 가까울수록 더 얇아진다', () => {
    expect(CHARACTER_INK.width).toBeLessThan(0.016)
    expect(CHARACTER_INK.near.min).toBeGreaterThan(0.2)
    expect(CHARACTER_INK.near.min).toBeLessThan(1)
  })
})
