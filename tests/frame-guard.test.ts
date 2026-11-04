import { describe, expect, it } from 'vitest'
import { GUARD_GRID, GUARD_PROBE_SHADER, HDR_MAX, NONFINITE_GLSL, SANITIZE_SHADER, guardMean, guardVerdict, safeHdr } from '../src/core/safeframe'
import { aimHintWanted, cursorLook } from '../src/core/cursor'

const [W, H] = GUARD_GRID
function cells(fill: (x: number, y: number) => { lum?: number; bad?: number; dark?: number; blown?: number }) {
  const n = W * H
  const lum = new Float32Array(n).fill(0.6), bad = new Float32Array(n), dark = new Float32Array(n), blown = new Float32Array(n)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = fill(x, y), i = y * W + x
    if (c.lum !== undefined) lum[i] = c.lum
    if (c.bad !== undefined) bad[i] = c.bad
    if (c.dark !== undefined) dark[i] = c.dark
    if (c.blown !== undefined) blown[i] = c.blown
  }
  return { lum, bad, dark, blown }
}

describe('프레임 가드 (화면 깨짐 자동 복구)', () => {
  it('정상 화면은 ok', () => {
    expect(guardVerdict(cells(() => ({})), W, H, true)).toBe('ok')
  })
  it('NaN/Inf 칸이 하나라도 있으면 nonfinite', () => {
    expect(guardVerdict(cells((x, y) => (x === 3 && y === 2 ? { bad: 1 / 9 } : {})), W, H, true)).toBe('nonfinite')
    expect(guardVerdict(cells((x, y) => (x === 0 && y === 0 ? { lum: NaN } : {})), W, H, true)).toBe('nonfinite')
  })
  it('밝던 화면 가운데가 절반 넘게 새까매지면 black, 원래 어두운 화면은 아님', () => {
    const block = cells((x) => (x >= 6 && x < 26 ? { dark: 1, lum: 0 } : {}))
    expect(guardVerdict(block, W, H, true)).toBe('black')
    expect(guardVerdict(block, W, H, false)).toBe('ok')
  })
  it('가운데가 절반 넘게 하얗게 타면 white', () => {
    expect(guardVerdict(cells((x) => (x >= 6 && x < 26 ? { blown: 1, lum: 20 } : {})), W, H, true)).toBe('white')
    expect(guardVerdict(cells((x) => (x === 16 ? { blown: 1, lum: 20 } : {})), W, H, true)).toBe('ok')
  })
  it('평균 밝기는 NaN을 건너뛴다', () => {
    expect(guardMean([1, NaN, 3])).toBe(2)
  })
  it('정리 패스는 비트 검사(floatBitsToUint)로 NaN을 잡고 HDR 상한은 8', () => {
    expect(NONFINITE_GLSL).toContain('floatBitsToUint')
    expect(SANITIZE_SHADER.fragmentShader).toContain('nonFinite')
    expect(GUARD_PROBE_SHADER.fragmentShader).toContain('nonFinite')
    expect(HDR_MAX).toBe(8)
    expect(safeHdr(30)).toBe(8)
    expect(safeHdr(NaN)).toBe(0)
  })
})

describe('플레이 중 마우스 커서', () => {
  const play = { armed: true, touch: false, free: false }
  it('플레이 중이면 잠금 여부와 상관없이 커서를 숨긴다(aim)', () => {
    expect(cursorLook(play)).toBe('aim')
  })
  it('패널·Alt·타이틀에서는 발바닥 커서, 폰은 기본', () => {
    expect(cursorLook({ ...play, free: true })).toBe('free')
    expect(cursorLook({ ...play, armed: false })).toBe('free')
    expect(cursorLook({ ...play, touch: true })).toBe('touch')
  })
  it('잠금이 정말 없을 때만 "클릭하면 조준" 힌트', () => {
    const base = { ...play, locked: false, refused: false, relock: false, pending: false }
    expect(aimHintWanted(base)).toBe(true)
    expect(aimHintWanted({ ...base, locked: true })).toBe(false)
    expect(aimHintWanted({ ...base, relock: true })).toBe(false)
    expect(aimHintWanted({ ...base, refused: true })).toBe(false)
    expect(aimHintWanted({ ...base, pending: true })).toBe(false)
    expect(aimHintWanted({ ...base, free: true })).toBe(false)
  })
})
