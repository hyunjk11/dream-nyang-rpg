/**
 * Byeolha's toy guns, built from a few primitives (no downloaded models). The water gun is the
 * original pistol; the shotgun gets a fat double barrel and bubble drum, the burst rifle a long
 * barrel with a star scope, the dart gun a long thin barrel with a sight. Rarity adds a glowing
 * gem on top in the rarity colour. Origin is the grip; the barrel points along +Z.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry, type Object3D } from 'three'
import { addOutline, toon } from '../core/materials'
import type { WeaponKind } from '../sim/types'

export interface GunLook {
  body: number
  tank: number
  barrel: number
  tracer: number
  barrelLen: number
  size: number
}

export const WATER_LOOK: GunLook = { body: 0xffa9cd, tank: 0x8fd0ff, barrel: 0x7ec8ff, tracer: 0xbfeaff, barrelLen: 1, size: 1 }

function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k))
  const b = Math.min(255, Math.round((c & 255) * k))
  return (r << 16) | (g << 8) | b
}

/** Fill `gun` (emptied first) with parts for this kind and look; places the muzzle. */
export function buildToyGun(gun: Group, muzzle: Object3D, kind: WeaponKind = 'water', look: GunLook = WATER_LOOK, gem: number | null = null): void {
  for (const child of [...gun.children]) {
    child.removeFromParent()
    child.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) m.geometry.dispose()
    })
  }
  gun.userData.kind = kind
  const bodyMat = toon(look.body)
  const gripMat = toon(shade(look.body, 0.88))
  const tankMat = toon(look.tank, look.tank, 0.45)
  const barrelMat = toon(look.barrel, look.barrel, 0.15)
  const L = look.barrelLen
  const parts: Mesh[] = []
  const add = (m: Mesh) => {
    parts.push(m)
    return m
  }
  const body = add(new Mesh(new BoxGeometry(0.06, 0.075, 0.17), bodyMat))
  body.position.set(0, 0.055, 0.045)
  const grip = add(new Mesh(new BoxGeometry(0.036, 0.085, 0.045), gripMat))
  grip.rotation.x = -0.25
  const guard = add(new Mesh(new BoxGeometry(0.012, 0.03, 0.05), gripMat))
  guard.position.set(0, 0.006, 0.045)
  let tip = 0.27
  if (kind === 'bubble') {
    // 방울 샷건: a stubby double barrel and a round bubble drum underneath.
    for (const x of [-0.019, 0.019]) {
      const b = add(new Mesh(new CylinderGeometry(0.019, 0.022, 0.1 * L, 12), barrelMat))
      b.rotation.x = Math.PI / 2
      b.position.set(x, 0.062, 0.13 + 0.05 * L)
      const ring = add(new Mesh(new TorusGeometry(0.019, 0.006, 6, 12), toon(0xffffff, 0xffffff, 0.4)))
      ring.position.set(x, 0.062, 0.13 + 0.1 * L)
    }
    const drum = add(new Mesh(new SphereGeometry(0.05, 14, 10), tankMat))
    drum.position.set(0, 0.03, 0.1)
    const top = add(new Mesh(new SphereGeometry(0.026, 10, 8), tankMat))
    top.position.set(0, 0.112, 0.03)
    tip = 0.14 + 0.1 * L
  } else if (kind === 'star') {
    // 별똥 점사총: long barrel, a star-shaped scope and a little stock.
    const b = add(new Mesh(new CylinderGeometry(0.014, 0.018, 0.12 * L, 10), barrelMat))
    b.rotation.x = Math.PI / 2
    b.position.set(0, 0.06, 0.12 + 0.06 * L)
    const scope = add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.08, 10), toon(shade(look.body, 0.7))))
    scope.rotation.x = Math.PI / 2
    scope.position.set(0, 0.118, 0.06)
    const star = add(new Mesh(new ConeGeometry(0.024, 0.03, 5), toon(0xffe08a, 0xffe08a, 0.6)))
    star.position.set(0, 0.15, 0.06)
    const stock = add(new Mesh(new BoxGeometry(0.04, 0.05, 0.08), gripMat))
    stock.position.set(0, 0.05, -0.07)
    tip = 0.12 + 0.12 * L
  } else if (kind === 'dart') {
    // 저격 다트총: a long slim barrel, a scope and a feathered dart peeking out.
    const b = add(new Mesh(new CylinderGeometry(0.01, 0.014, 0.13 * L, 10), barrelMat))
    b.rotation.x = Math.PI / 2
    b.position.set(0, 0.06, 0.12 + 0.065 * L)
    const scope = add(new Mesh(new CylinderGeometry(0.017, 0.017, 0.11, 12), toon(0x5b4a7a)))
    scope.rotation.x = Math.PI / 2
    scope.position.set(0, 0.122, 0.07)
    const lens = add(new Mesh(new SphereGeometry(0.016, 10, 8), toon(0xbfe9ff, 0xbfe9ff, 0.8)))
    lens.position.set(0, 0.122, 0.128)
    const feather = add(new Mesh(new ConeGeometry(0.02, 0.04, 4), toon(0xff9fd2, 0xff9fd2, 0.3)))
    feather.rotation.x = -Math.PI / 2
    feather.position.set(0, 0.06, 0.02)
    const stock = add(new Mesh(new BoxGeometry(0.036, 0.055, 0.1), gripMat))
    stock.position.set(0, 0.045, -0.08)
    tip = 0.12 + 0.13 * L
  } else {
    const tank = add(new Mesh(new SphereGeometry(0.042, 12, 8), tankMat))
    tank.scale.set(0.9, 0.8, 1.1)
    tank.position.set(0, 0.112, 0.02)
    const barrel = add(new Mesh(new CylinderGeometry(0.016, 0.02, 0.12 * L, 10), barrelMat))
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.06, 0.12 + 0.06 * L)
    const star = add(new Mesh(new ConeGeometry(0.018, 0.03, 5), toon(0xffe08a, 0xffe08a, 0.35)))
    star.position.set(0, 0.097, 0.09)
    tip = 0.12 + 0.12 * L + 0.03
  }
  const nose = add(new Mesh(new SphereGeometry(kind === 'bubble' ? 0.012 : 0.022, 10, 8), toon(0xe8f8ff, 0xffffff, 0.5)))
  nose.position.set(0, 0.06, tip - 0.025)
  if (kind === 'bubble') nose.visible = false
  if (gem !== null) {
    const g = add(new Mesh(new SphereGeometry(0.016, 10, 8), toon(gem, gem, 1.1)))
    g.position.set(0, 0.1, kind === 'water' ? 0.12 : 0.0)
    g.userData.noOutline = true
    g.name = 'rarity-gem'
  }
  muzzle.position.set(0, 0.06, tip)
  gun.add(...parts, muzzle)
  gun.scale.multiplyScalar(1)
  for (const m of parts) m.castShadow = true
  gun.userData.size = look.size
  addOutline(gun, 0.01)
}

/** Fresh gun group (the starter water pistol unless told otherwise). */
export function createToyGun(muzzle: Object3D, kind: WeaponKind = 'water', look: GunLook = WATER_LOOK, gem: number | null = null): Group {
  const gun = new Group()
  gun.name = 'water-gun'
  buildToyGun(gun, muzzle, kind, look, gem)
  return gun
}
