/**
 * 화면 깨짐 방지 (render glitch guards).
 *
 * 1. 검은 사각형: one NaN/Inf pixel in the HalfFloat scene buffer is blurred by every bloom mip; the
 *    smallest mip's kernel turns it into a full-height block, and ACES maps Inf/Inf to NaN → black.
 *    SANITIZE_SHADER runs right after the RenderPass and zeroes any non-finite value and caps HDR.
 * 2. 흰 사각형: a spark or mote that drifts into the camera became a GPU-max-size point sprite
 *    (size / depth with no cap). POINT_GUARD caps the size and fades points closer than NEAR_FADE.
 * Pure helpers mirror the GLSL so tests can hold the numbers.
 */

/** Highest HDR value let into bloom (ACES is white well before this). */
export const HDR_MAX = 24
/** Largest point sprite, in device pixels. */
export const POINT_MAX_PX = 192
/** Points fade out between these camera distances (m) and vanish below the first. */
export const NEAR_FADE: readonly [number, number] = [0.35, 0.9]

const LIMIT = 6.0e4

/** One channel as the sanitize pass leaves it. */
export function safeHdr(v: number, max = HDR_MAX): number {
  if (!(v < LIMIT && v > -LIMIT)) return 0
  return Math.min(max, Math.max(0, v))
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Point sprite size (px) and alpha multiplier at view depth `depth` (m in front of the camera). */
export function pointGuard(size: number, scale: number, depth: number, maxPx = POINT_MAX_PX): { px: number; fade: number } {
  if (!Number.isFinite(size) || !Number.isFinite(depth) || depth <= 0) return { px: 0, fade: 0 }
  const px = Math.min(maxPx, Math.max(0, (size * scale) / Math.max(depth, 0.05)))
  return { px, fade: smooth(NEAR_FADE[0], NEAR_FADE[1], depth) }
}

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`)

/**
 * GLSL for a point vertex shader: `guardPoint(sizeTimesScale, mv)` returns the capped size and sets
 * `vNearFade` (multiply the fragment alpha by it).
 */
export const POINT_GUARD = /* glsl */ `
varying float vNearFade;
float guardPoint(float sizeScale, vec4 mv) {
  float depth = -mv.z;
  vNearFade = smoothstep(${f(NEAR_FADE[0])}, ${f(NEAR_FADE[1])}, depth);
  if (!(depth > 0.0) || !(sizeScale >= 0.0)) { vNearFade = 0.0; return 0.0; }
  return min(sizeScale / max(depth, 0.05), ${f(POINT_MAX_PX)});
}
`

/** Fragment side of POINT_GUARD. */
export const POINT_GUARD_FRAG = /* glsl */ `
varying float vNearFade;
`

/** Full-screen pass: non-finite → 0, then clamp to [0, HDR_MAX]. */
export const SANITIZE_SHADER = {
  name: 'SanitizeHdr',
  uniforms: { tDiffuse: { value: null }, uMax: { value: HDR_MAX } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uMax;
varying vec2 vUv;
float safe(float v) {
  // NaN fails both comparisons; ±Inf fails one.
  if (!(v < ${f(LIMIT)} && v > -${f(LIMIT)})) return 0.0;
  return clamp(v, 0.0, uMax);
}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(safe(c.r), safe(c.g), safe(c.b), clamp(safe(c.a), 0.0, 1.0));
}`,
}

/** Every entry finite (a matrix's elements, a vector). */
export function allFinite(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i += 1) if (!Number.isFinite(values[i])) return false
  return true
}
