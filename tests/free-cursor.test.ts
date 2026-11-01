import { describe, expect, it } from 'vitest'
import { ALT_LABEL, altStep, cursorWanted, needsRelock } from '../src/core/cursor'
import { slotFits } from '../src/sim/inventory'

const base = { armed: true, touch: false, locked: false, free: false, hadLock: true, refused: false }

describe('Alt 키 마우스 커서', () => {
  it('누르는 동안 모드: Alt를 누르면 커서가 나오고 떼면 다시 숨는다', () => {
    expect(altStep('hold', false, 'down')).toBe(true)
    expect(altStep('hold', true, 'up')).toBe(false)
  })

  it('전환 모드: 누를 때마다 커서가 켜졌다 꺼지고, 떼는 건 무시한다', () => {
    expect(altStep('toggle', false, 'down')).toBe(true)
    expect(altStep('toggle', true, 'up')).toBe(true)
    expect(altStep('toggle', true, 'down')).toBe(false)
    expect(altStep('toggle', false, 'up')).toBe(false)
  })

  it('키 반복 입력은 상태를 바꾸지 않는다', () => {
    expect(altStep('toggle', true, 'down', true)).toBe(true)
    expect(altStep('hold', true, 'down', true)).toBe(true)
  })

  it('창이 열려 있거나 Alt가 눌려 있으면 커서가 필요하다', () => {
    expect(cursorWanted(false, false)).toBe(false)
    expect(cursorWanted(true, false)).toBe(true)
    expect(cursorWanted(false, true)).toBe(true)
  })

  it('설정 이름이 두 가지 모드를 한국어로 보여 준다', () => {
    expect(ALT_LABEL.hold).toContain('누르는 동안')
    expect(ALT_LABEL.toggle).toContain('전환')
  })
})

describe('포인터 잠금 다시 걸기', () => {
  it('플레이 중 커서를 닫았는데 잠금이 풀려 있으면 "클릭해서 계속"을 보여 준다', () => {
    expect(needsRelock(base)).toBe(true)
  })

  it('잠겨 있거나, 아직 커서가 필요하거나, 터치 화면이면 안내하지 않는다', () => {
    expect(needsRelock({ ...base, locked: true })).toBe(false)
    expect(needsRelock({ ...base, free: true })).toBe(false)
    expect(needsRelock({ ...base, touch: true })).toBe(false)
  })

  it('한 번도 잠근 적이 없거나 브라우저가 잠금을 거부하면 안내하지 않는다', () => {
    expect(needsRelock({ ...base, hadLock: false })).toBe(false)
    expect(needsRelock({ ...base, refused: true })).toBe(false)
    expect(needsRelock({ ...base, armed: false })).toBe(false)
  })
})

describe('가방 끌어다 놓기 칸 검사', () => {
  it('무기는 무기 칸에만, 반지는 두 장신구 칸 모두에 들어간다', () => {
    expect(slotFits('weapon', 'weapon')).toBe(true)
    expect(slotFits('weapon', 'hat')).toBe(false)
    expect(slotFits('accessory', 'accessory')).toBe(true)
    expect(slotFits('accessory', 'accessory2')).toBe(true)
    expect(slotFits(undefined, 'weapon')).toBe(false)
  })
})
