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
export const HDR_MAX = 8
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

/**
 * GLSL: is this float NaN or ±Inf? Reads the exponent bits (all ones), so a GPU compiler running
 * with fast-math — which may fold `v != v` or `!(v < L)` to false and let NaN through, as some
 * real drivers do — cannot optimise the test away. Needs WebGL2 (GLSL ES 3.00), which three r170 requires.
 */
export const NONFINITE_GLSL = /* glsl */ `
bool nonFinite(float v) { return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u; }
`

/** Full-screen pass: non-finite → 0 (bit test), then clamp to [0, HDR_MAX]. */
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
${NONFINITE_GLSL}
float safe(float v) {
  if (nonFinite(v)) return 0.0;
  return clamp(v, 0.0, uMax);
}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  // One bad channel poisons the pixel: drop all of it (a NaN red next to a finite green is still garbage).
  if (nonFinite(c.r) || nonFinite(c.g) || nonFinite(c.b)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  gl_FragColor = vec4(safe(c.r), safe(c.g), safe(c.b), clamp(safe(c.a), 0.0, 1.0));
}`,
}

/** Probe grid the frame guard reads back (cells across × down). */
export const GUARD_GRID: readonly [number, number] = [32, 18]

/**
 * Frame guard probe: each cell of a GUARD_GRID target gets r = mean luminance of its finite taps,
 * g = share of non-finite taps, b = share of near-black taps, a = share of blown (lum > 6) taps.
 * Reads the final HDR frame (after bloom, before tone mapping); nothing is drawn to the screen.
 */
export const GUARD_PROBE_SHADER = {
  name: 'FrameGuardProbe',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
${NONFINITE_GLSL}
void main() {
  vec2 cell = vec2(1.0 / ${f(GUARD_GRID[0])}, 1.0 / ${f(GUARD_GRID[1])});
  float lum = 0.0, bad = 0.0, dark = 0.0, blown = 0.0, n = 0.0;
  for (int y = 0; y < 3; y++) for (int x = 0; x < 3; x++) {
    vec3 c = texture2D(tDiffuse, vUv + (vec2(float(x), float(y)) - 1.0) * cell * 0.33).rgb;
    if (nonFinite(c.r) || nonFinite(c.g) || nonFinite(c.b)) { bad += 1.0; continue; }
    float l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
    lum += min(l, 64.0); n += 1.0;
    if (l < 0.004) dark += 1.0;
    if (l > 6.0) blown += 1.0;
  }
  gl_FragColor = vec4(n > 0.0 ? lum / n : 0.0, bad / 9.0, dark / 9.0, blown / 9.0);
}`,
}

export interface GuardCells {
  /** Mean luminance per cell. */
  lum: ArrayLike<number>
  bad: ArrayLike<number>
  dark: ArrayLike<number>
  blown: ArrayLike<number>
}

export type GuardVerdict = 'ok' | 'nonfinite' | 'black' | 'white'

/**
 * Pure verdict over one probe read. `wasLit`: the last good read had a lit picture (a scene that is
 * meant to be dark never trips 'black'). Black/white look at the central half of the frame.
 */
export function guardVerdict(c: GuardCells, cols: number, rows: number, wasLit: boolean): GuardVerdict {
  let bad = 0
  let dark = 0
  let blown = 0
  let mid = 0
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x
      const b = Number(c.bad[i])
      if (b > 0 || !Number.isFinite(b) || !Number.isFinite(Number(c.lum[i]))) bad += 1
      const central = x >= cols / 4 && x < (cols * 3) / 4 && y >= rows / 5 && y < (rows * 4) / 5
      if (!central) continue
      mid += 1
      if (Number(c.dark[i]) > 0.66) dark += 1
      if (Number(c.blown[i]) > 0.66) blown += 1
    }
  }
  if (bad > 0) return 'nonfinite'
  if (mid > 0 && wasLit && dark / mid >= 0.5) return 'black'
  if (mid > 0 && blown / mid >= 0.5) return 'white'
  return 'ok'
}

/** Mean luminance of the probe (is the picture lit?). */
export function guardMean(lum: ArrayLike<number>): number {
  let s = 0
  let n = 0
  for (let i = 0; i < lum.length; i += 1) {
    const v = Number(lum[i])
    if (Number.isFinite(v)) {
      s += v
      n += 1
    }
  }
  return n ? s / n : 0
}

/** Frames the guard keeps bloom off (and the HDR cap low) after a bad read. */
export const GUARD_HOLD = 90
/** Read the probe back every N frames (a tiny 32×18 readback). */
export const GUARD_EVERY = 8
/** HDR cap while recovering from a white frame. */
export const HDR_SAFE = 3

/** Every entry finite (a matrix's elements, a vector). */
export function allFinite(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i += 1) if (!Number.isFinite(values[i])) return false
  return true
}
