import { describe, expect, it } from 'vitest'
import { BoxGeometry } from 'three'
import { LOOK, keyToFill } from '../src/3d/look'
import { CLOUD_SEA_INNER, CLOUD_SEA_Y } from '../src/3d/decor'
import { ISLAND_RADIUS } from '../src/3d/island'
import { outlineGeometry } from '../src/3d/materials'

describe('look pass', () => {
  it('keeps a readable key-to-fill contrast', () => {
    expect(keyToFill()).toBeGreaterThan(2)
    expect(LOOK.rim.intensity).toBeGreaterThan(LOOK.bounce.intensity)
  })

  it('only blooms true highlights, not the ground', () => {
    expect(LOOK.bloom.threshold).toBeGreaterThan(1)
    expect(LOOK.bloom.strength).toBeLessThan(0.5)
  })

  it('puts the cloud sea below and outside the island, never over play', () => {
    expect(CLOUD_SEA_Y).toBeLessThan(-2)
    expect(CLOUD_SEA_INNER).toBeGreaterThan(ISLAND_RADIUS)
  })

  it('welds split vertices so the ink shell has no cracks', () => {
    const box = new BoxGeometry(1, 1, 1)
    const shell = outlineGeometry(box)
    expect(shell.getAttribute('position').count).toBe(8)
    expect(shell.getAttribute('normal')).toBeTruthy()
    expect(outlineGeometry(box)).toBe(shell)
  })
})
