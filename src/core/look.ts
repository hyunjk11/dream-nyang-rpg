/**
 * One place for the dream island's light and grade. Pure numbers so tests can hold the
 * contrast ratios: a strong warm key, a cool lavender rim from behind, and a soft sky fill.
 */
export const LOOK = {
  exposure: 1.0,
  clear: 0x1b1030,
  fog: { color: 0x9a78c4, near: 24, far: 62 },
  hemi: { sky: 0xffeefa, ground: 0x6f9a86, intensity: 0.55 },
  key: { color: 0xffe6cf, intensity: 2.1, position: [-6, 13, 8] as const },
  rim: { color: 0xb9a6ff, intensity: 1.15, position: [5, 6, -10] as const },
  bounce: { color: 0xffc6e2, intensity: 0.28, position: [8, 3, 6] as const },
  shadow: { size: 2048, radius: 3 },
  bloom: { strength: 0.3, radius: 0.4, threshold: 1.55 },
  msaa: 4,
} as const

/** Key-to-fill ratio (key vs hemisphere + bounce); a flat look sits near 1:1. */
export function keyToFill(look = LOOK): number {
  return look.key.intensity / (look.hemi.intensity + look.bounce.intensity)
}
