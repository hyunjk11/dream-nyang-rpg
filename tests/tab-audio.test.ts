import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioBus } from '../src/audio/audio'
import { playChime } from '../src/audio/chime'
import { GunSound, VoicePool } from '../src/audio/gunsound'
import { stepsInLookahead } from '../src/audio/music'
import { AudioFocus, pageAudible, watchPage, type PageDoc, type PageWin } from '../src/audio/tabgate'

const MAIN = import.meta.glob('../src/main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const MASTER_KEY = 'dream-nyang-3d-master'
const BGM_KEY = 'dnr3d.bgm'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  sets: string[]
}

interface Param {
  value: number
  events: { type: string; value: number }[]
  setValueAtTime(value: number): void
  setTargetAtTime(value: number): void
  cancelScheduledValues(): void
  linearRampToValueAtTime(value: number): void
  exponentialRampToValueAtTime(value: number): void
}

interface Node {
  links: Node[]
  connect(dest: Node): Node
  disconnect(): void
}

interface FakeCtx {
  state: string
  currentTime: number
  sampleRate: number
  destination: Node
  suspendCalls: number
  resumeCalls: number
  oscillators: number
  sources: { loop: boolean; started: boolean; stopped: boolean; links: Node[] }[]
  gains: { gain: Param; links: Node[] }[]
  suspend: () => Promise<void>
  resume: () => Promise<void>
  createGain: () => { gain: Param; links: Node[]; connect(dest: Node): Node; disconnect(): void }
  createBufferSource: () => FakeCtx['sources'][number] & {
    buffer: unknown
    playbackRate: { value: number }
    connect(dest: Node): Node
    start: () => void
    stop: () => void
    disconnect: () => void
    onended: (() => void) | null
  }
  decodeAudioData: () => Promise<{ duration: number }>
  createOscillator: () => {
    type: string
    frequency: Param
    detune: Param
    connect(dest: Node): Node
    start: () => void
    stop: () => void
    onended: (() => void) | null
  }
  createBiquadFilter: () => { type: string; frequency: Param; connect(dest: Node): Node }
  createBuffer: (ch: number, length: number, rate: number) => { duration: number; length: number; copyToChannel: () => void }
  createDynamicsCompressor: () => Node & {
    threshold: { value: number }
    knee: { value: number }
    ratio: { value: number }
    attack: { value: number }
    release: { value: number }
  }
  createStereoPanner: () => { pan: { value: number }; connect(dest: Node): Node; disconnect(): void }
}

function param(value = 1): Param {
  const p: Param = {
    value,
    events: [],
    setValueAtTime(v) {
      p.value = v
      p.events.push({ type: 'set', value: v })
    },
    setTargetAtTime(v) {
      p.value = v
      p.events.push({ type: 'target', value: v })
    },
    cancelScheduledValues() {},
    linearRampToValueAtTime(v) {
      p.value = v
    },
    exponentialRampToValueAtTime(v) {
      p.value = v
    },
  }
  return p
}

function node(): Node {
  const n: Node = {
    links: [],
    connect(dest) {
      n.links.push(dest)
      return dest
    },
    disconnect() {
      n.links.length = 0
    },
  }
  return n
}

function fakeCtx(): FakeCtx {
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    suspendCalls: 0,
    resumeCalls: 0,
    oscillators: 0,
    sources: [] as FakeCtx['sources'],
    gains: [] as FakeCtx['gains'],
    suspend() {
      ctx.suspendCalls += 1
      ctx.state = 'suspended'
      return Promise.resolve()
    },
    resume() {
      ctx.resumeCalls += 1
      ctx.state = 'running'
      return Promise.resolve()
    },
    createGain() {
      const gain = param(1)
      const n = node()
      const g = { gain, links: n.links, connect: n.connect.bind(n), disconnect: n.disconnect.bind(n) }
      // connect() pushes onto n.links, which is the same array as g.links.
      ctx.gains.push(g)
      return g
    },
    createBufferSource() {
      const n = node()
      const src = {
        buffer: null as unknown,
        loop: false,
        started: false,
        stopped: false,
        playbackRate: { value: 1 },
        links: n.links,
        connect: n.connect.bind(n),
        disconnect: n.disconnect.bind(n),
        onended: null as (() => void) | null,
        start() {
          src.started = true
        },
        stop() {
          src.stopped = true
        },
      }
      ctx.sources.push(src)
      return src
    },
    decodeAudioData() {
      return Promise.resolve({ duration: 0.2 })
    },
    createOscillator() {
      ctx.oscillators += 1
      return {
        type: 'sine',
        frequency: param(440),
        detune: param(0),
        connect(dest: Node) {
          return dest
        },
        start() {},
        stop() {},
        onended: null,
      }
    },
    createBiquadFilter() {
      return { type: 'lowpass', frequency: param(0), connect(dest: Node) { return dest } }
    },
    createBuffer(_ch: number, length: number) {
      return { duration: length / ctx.sampleRate, length, copyToChannel() {} }
    },
    createDynamicsCompressor() {
      const n = node()
      return {
        ...n,
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      }
    },
    createStereoPanner() {
      const n = node()
      return { pan: { value: 0 }, connect: n.connect.bind(n), disconnect: n.disconnect.bind(n) }
    },
  }
  return ctx
}

function memory(): Store {
  const map = new Map<string, string>()
  const store: Store = {
    sets: [],
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem(key, value) {
      store.sets.push(`${key}=${value}`)
      map.set(key, value)
    },
  }
  return store
}

function fakePage(visibility = 'visible'): { doc: PageDoc & { emit(type: string): void; visibilityState: string }; win: PageWin & { emit(type: string): void }; counts: Record<string, number> } {
  const handlers = new Map<string, (() => void)[]>()
  const counts: Record<string, number> = {}
  const listen = (type: string, fn: () => void) => {
    counts[type] = (counts[type] ?? 0) + 1
    const list = handlers.get(type) ?? []
    list.push(fn)
    handlers.set(type, list)
  }
  const doc = {
    visibilityState: visibility,
    addEventListener: listen,
    emit(type: string) {
      for (const fn of handlers.get(type) ?? []) fn()
    },
  }
  const win = {
    addEventListener: listen,
    emit(type: string) {
      for (const fn of handlers.get(type) ?? []) fn()
    },
  }
  return { doc, win, counts }
}

async function flush(bus?: AudioBus): Promise<void> {
  if (bus) await bus.settled()
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function masterGain(ctx: FakeCtx): Param {
  return ctx.gains[0].gain
}

async function boot(options?: { visibility?: string; master?: string; bgm?: string; ctx?: FakeCtx }) {
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))
  const store = memory()
  if (options?.master !== undefined) store.setItem(MASTER_KEY, options.master)
  if (options?.bgm !== undefined) store.setItem(BGM_KEY, options.bgm)
  store.sets.length = 0
  const page = fakePage(options?.visibility ?? 'visible')
  const ctx = options?.ctx ?? fakeCtx()
  const bus = new AudioBus({
    storage: store,
    document: page.doc,
    window: page.win,
    context: () => ctx as unknown as AudioContext,
  })
  bus.start()
  bus.start()
  await flush(bus)
  return { bus, store, page, ctx }
}

async function unlock(bus: AudioBus, page: { win: { emit(type: string): void } }): Promise<void> {
  page.win.emit('pointerdown')
  await flush(bus)
}

describe('탭을 벗어나면 소리가 멈춘다', () => {
  it('숨김·frozen·pagehide 는 들리지 않고, 보이는 페이지만 들린다', () => {
    expect(pageAudible({ visibilityState: 'visible', frozen: false, away: false })).toBe(true)
    expect(pageAudible({ visibilityState: 'hidden', frozen: false, away: false })).toBe(false)
    expect(pageAudible({ visibilityState: 'visible', frozen: true, away: false })).toBe(false)
    expect(pageAudible({ visibilityState: 'visible', frozen: false, away: true })).toBe(false)
  })

  it('같은 문서에 리스너를 두 번 붙이지 않는다', () => {
    const page = fakePage()
    let hits = 0
    watchPage(page.doc, page.win, () => {
      hits += 1
    })
    watchPage(page.doc, page.win, () => {
      hits += 1
    })
    expect(hits).toBe(1)
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    expect(hits).toBe(2)
    expect(page.counts.visibilitychange).toBe(1)
    expect(page.counts.pagehide).toBe(1)
    expect(page.counts.freeze).toBe(1)
  })

  it('숨으면 마스터를 즉시 0으로 닫고, 돌아오면 저장해 둔 음량·배경음 그대로다', async () => {
    const { bus, store, page, ctx } = await boot({ master: '0.62', bgm: '0.2' })
    await unlock(bus, page)
    expect(bus.master).toBe(0.62)
    expect(bus.bgm).toBe(0.2)
    expect(masterGain(ctx).value).toBeCloseTo(0.62)
    const loops = ctx.sources.filter((s) => s.loop).length
    expect(loops).toBe(2)

    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    // Gain closes in the same turn. Suspend lands on the following microtask.
    expect(bus.pageAudible).toBe(false)
    expect(masterGain(ctx).events.at(-1)).toEqual({ type: 'set', value: 0 })
    expect(masterGain(ctx).value).toBe(0)
    expect(bus.context()).toBeNull()
    await flush(bus)
    expect(ctx.state).toBe('suspended')
    expect(bus.master).toBe(0.62)
    expect(bus.bgm).toBe(0.2)
    expect(store.sets).toEqual([])

    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(bus.pageAudible).toBe(true)
    expect(bus.master).toBe(0.62)
    expect(bus.bgm).toBe(0.2)
    expect(masterGain(ctx).value).toBeCloseTo(0.62)
    expect(masterGain(ctx).events.at(-1)).toMatchObject({ type: 'target', value: 0.62 })
    expect(ctx.state).toBe('running')
    expect(store.getItem(MASTER_KEY)).toBe('0.62')
    expect(store.getItem(BGM_KEY)).toBe('0.2')
    expect(store.sets).toEqual([])
    // Music beds keep looping; the return does not start them over.
    expect(ctx.sources.filter((s) => s.loop).length).toBe(loops)
    expect(bus.context()).not.toBeNull()
  })

  it('의도적으로 음소거한 게임은 탭을 돌아와도 음소거 그대로다', async () => {
    const { bus, store, page, ctx } = await boot({ master: '0', bgm: '0.5' })
    await unlock(bus, page)
    expect(bus.master).toBe(0)
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(bus.master).toBe(0)
    expect(bus.bgm).toBe(0.5)
    expect(masterGain(ctx).value).toBe(0)
    expect(store.getItem(MASTER_KEY)).toBe('0')
    expect(store.sets).toEqual([])
  })

  it('숨은 동안 바꾼 음량은 침묵을 유지한 채 저장되고, 돌아오면 그 값으로 돌아온다', async () => {
    const { bus, store, page, ctx } = await boot()
    await unlock(bus, page)
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    bus.setMaster(0.15)
    bus.setBgm(0.33)
    expect(bus.master).toBe(0.15)
    expect(bus.bgm).toBe(0.33)
    expect(masterGain(ctx).value).toBe(0)
    expect(store.getItem(MASTER_KEY)).toBe('0.15')
    expect(store.getItem(BGM_KEY)).toBe('0.33')
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(masterGain(ctx).value).toBeCloseTo(0.15)
    expect(bus.master).toBe(0.15)
    expect(bus.bgm).toBe(0.33)
  })

  it('숨은 동안의 효과음은 버려지고, 돌아온 뒤에 쌓여 있던 것을 재생하지 않는다', async () => {
    const { bus, page, ctx } = await boot()
    await unlock(bus, page)
    await flush(bus)
    const before = ctx.sources.length
    bus.sfx('ui')
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(ctx.sources.length).toBe(before)
    for (let i = 0; i < 12; i += 1) bus.sfx('coin')
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(ctx.sources.length).toBe(before)
    expect(bus.context()).not.toBeNull()
    // 'ui' was requested just before the hide, so its gap is still open. A different cue must play, and only once.
    bus.sfx('coin')
    await flush(bus)
    expect(ctx.sources.length).toBe(before + 1)
    const shot = ctx.sources.at(-1) as { links: { links: { gain?: Param }[] }[] }
    expect(shot.links[0].links[0]).toBeDefined()
  })

  it('이미 나가던 효과는 돌아와도 다시 들리지 않고, 음악 루프는 유지된다', async () => {
    const { bus, page, ctx } = await boot()
    await unlock(bus, page)
    bus.sfx('coin')
    await flush(bus)
    const shot = ctx.sources.find((s) => !s.loop)
    expect(shot?.started).toBe(true)
    const shotBus = shot?.links[0].links[0] as unknown as { gain: Param }
    const voices = { cuts: 0, targets: 0 }
    bus.attachVoices({
      cut() {
        voices.cuts += 1
      },
      retarget() {
        voices.targets += 1
      },
    })
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    expect(shotBus.gain.value).toBe(0)
    expect(voices).toEqual({ cuts: 1, targets: 1 })
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(shotBus.gain.value).toBe(0)
    expect(ctx.sources.filter((s) => s.loop).length).toBe(2)
  })

  it('제스처 없이 돌아오면 컨텍스트를 깨우지 않는다', async () => {
    const { bus, page, ctx } = await boot()
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(ctx.resumeCalls).toBe(0)
    expect(ctx.state).toBe('suspended')
    expect(bus.master).toBeGreaterThan(0)
  })

  it('숨은 동안의 제스처는 기억만 하고, 보이는 순간에 재생을 되돌린다', async () => {
    const { bus, page, ctx } = await boot()
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    page.win.emit('pointerdown')
    await flush(bus)
    expect(ctx.resumeCalls).toBe(0)
    expect(ctx.state).toBe('suspended')
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(ctx.state).toBe('running')
    expect(masterGain(ctx).value).toBeCloseTo(bus.master)
  })

  it('pagehide 와 freeze 로 내려간 모바일 배경에서도 닫고, 아직 숨은 pageshow 에서는 열지 않는다', async () => {
    const { bus, page, ctx } = await boot()
    await unlock(bus, page)
    page.win.emit('pagehide')
    expect(page.doc.visibilityState).toBe('visible')
    expect(bus.pageAudible).toBe(false)
    expect(masterGain(ctx).value).toBe(0)
    await flush(bus)
    expect(ctx.state).toBe('suspended')
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(bus.pageAudible).toBe(true)
    expect(ctx.state).toBe('running')

    page.doc.emit('freeze')
    expect(bus.pageAudible).toBe(false)
    expect(masterGain(ctx).value).toBe(0)
    page.doc.visibilityState = 'hidden'
    page.doc.emit('resume')
    expect(bus.pageAudible).toBe(false)
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(bus.pageAudible).toBe(true)

    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    page.win.emit('pageshow')
    expect(bus.pageAudible).toBe(false)
    expect(masterGain(ctx).value).toBe(0)
  })

  it('숨김과 복귀가 겹쳐도 마지막 상태만 남고, 음소거 값은 건드리지 않는다', async () => {
    const { bus, page, ctx } = await boot({ master: '0.4' })
    await unlock(bus, page)
    let releaseSuspend = () => {}
    ctx.suspend = () =>
      new Promise<void>((resolve) => {
        releaseSuspend = () => {
          ctx.state = 'suspended'
          resolve()
        }
      })
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    expect(masterGain(ctx).value).toBe(0)
    await Promise.resolve()
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    expect(masterGain(ctx).value).toBeCloseTo(0.4)
    expect(bus.master).toBe(0.4)
    releaseSuspend()
    await flush(bus)
    expect(ctx.state).toBe('running')
    expect(masterGain(ctx).value).toBeCloseTo(0.4)
    expect(bus.master).toBe(0.4)
  })

  it('복귀 도중 다시 숨으면 끝나서는 조용한 쪽이 이긴다', async () => {
    const { bus, page, ctx } = await boot({ master: '0.4' })
    await unlock(bus, page)
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    await flush(bus)
    expect(ctx.state).toBe('suspended')
    let releaseResume = () => {}
    ctx.resume = () =>
      new Promise<void>((resolve) => {
        releaseResume = () => {
          ctx.state = 'running'
          resolve()
        }
      })
    page.doc.visibilityState = 'visible'
    page.doc.emit('visibilitychange')
    await Promise.resolve()
    page.doc.visibilityState = 'hidden'
    page.doc.emit('visibilitychange')
    expect(masterGain(ctx).value).toBe(0)
    releaseResume()
    await flush(bus)
    expect(ctx.state).toBe('suspended')
    expect(masterGain(ctx).value).toBe(0)
    expect(bus.master).toBe(0.4)
  })

  it('숨은 채 오디오 클록이 흘러도 절차 음악은 밀린 박을 쏟지 않고, 돌아오면 이어서만 낸다', async () => {
    vi.useFakeTimers()
    const ctx = fakeCtx()
    const { bus, page } = await boot({ ctx })
    try {
      await unlock(bus, page)
      bus.setScene('dungeon', 1)
      let releaseSuspend = () => {}
      ctx.suspend = () =>
        new Promise<void>((resolve) => {
          releaseSuspend = () => {
            ctx.state = 'suspended'
            resolve()
          }
        })
      page.doc.visibilityState = 'hidden'
      page.doc.emit('visibilitychange')
      const atHide = ctx.oscillators
      for (let i = 0; i < 40; i += 1) {
        ctx.currentTime += 0.25
        await vi.advanceTimersByTimeAsync(250)
      }
      expect(ctx.oscillators).toBe(atHide)
      releaseSuspend()
      await flush(bus)
      page.doc.visibilityState = 'visible'
      page.doc.emit('visibilitychange')
      await flush(bus)
      expect(ctx.state).toBe('running')
      for (let i = 0; i < 4; i += 1) {
        ctx.currentTime += 0.25
        await vi.advanceTimersByTimeAsync(250)
      }
      const added = ctx.oscillators - atHide
      expect(added).toBeGreaterThan(0)
      expect(added).toBeLessThan(20)
      bus.setScene('town')
    } finally {
      vi.useRealTimers()
    }
  })

  it('시작부터 숨은 탭은 마스터를 열지 않는다', async () => {
    const { bus, ctx } = await boot({ visibility: 'hidden', master: '0.5' })
    expect(bus.pageAudible).toBe(false)
    expect(masterGain(ctx).value).toBe(0)
    expect(ctx.resumeCalls).toBe(0)
    expect(bus.master).toBe(0.5)
  })

  it('포인터 리스너와 페이지 리스너는 한 번씩만 붙는다', async () => {
    const { page } = await boot()
    expect(page.counts.pointerdown).toBe(1)
    expect(page.counts.keydown).toBe(1)
    expect(page.counts.touchstart).toBe(1)
    expect(page.counts.visibilitychange).toBe(1)
    expect(page.counts.pagehide).toBe(1)
    expect(page.counts.pageshow).toBe(1)
  })

  it('총소리 배선은 숨은 탭의 버스 교체에 포함된다', () => {
    const main = MAIN['../src/main.ts']
    expect(main).toContain('audio.attachVoices(gunSound)')
  })
})

describe('오디오 포커스 경합', () => {
  it('suspend 가 늦은 뒤에 보이는 쪽이 resume 로 끝난다', async () => {
    const focus = new AudioFocus()
    focus.unlock()
    let release = () => {}
    const ctx = {
      state: 'running',
      suspendCalls: 0,
      resumeCalls: 0,
      suspend() {
        ctx.suspendCalls += 1
        return new Promise<void>((resolve) => {
          release = () => {
            ctx.state = 'suspended'
            resolve()
          }
        })
      },
      resume() {
        ctx.resumeCalls += 1
        ctx.state = 'running'
        return Promise.resolve()
      },
    }
    focus.setPageOn(false)
    const pending = focus.request(ctx)
    await Promise.resolve()
    focus.setPageOn(true)
    const back = focus.request(ctx)
    release()
    await pending
    await back
    expect(ctx.state).toBe('running')
    expect(ctx.suspendCalls).toBe(1)
    expect(ctx.resumeCalls).toBe(1)
  })

  it('한 번도 열리지 않았으면 resume 하지 않고, 거절돼도 예외를 흘리지 않는다', async () => {
    const focus = new AudioFocus()
    const ctx = {
      state: 'suspended',
      resumeCalls: 0,
      suspend() {
        return Promise.resolve()
      },
      resume() {
        ctx.resumeCalls += 1
        return Promise.reject(new Error('autoplay'))
      },
    }
    focus.setPageOn(true)
    await focus.request(ctx)
    expect(ctx.resumeCalls).toBe(0)
    focus.unlock()
    await focus.request(ctx)
    expect(ctx.resumeCalls).toBeGreaterThan(0)
    expect(ctx.state).toBe('suspended')
  })

  it('이미 맞으면 키 반복이 resume 를 다시 부르지 않는다', async () => {
    const focus = new AudioFocus()
    focus.unlock()
    const ctx = {
      state: 'running',
      resumeCalls: 0,
      suspendCalls: 0,
      resume() {
        ctx.resumeCalls += 1
        return Promise.resolve()
      },
      suspend() {
        ctx.suspendCalls += 1
        return Promise.resolve()
      },
    }
    focus.setPageOn(true)
    await focus.request(ctx)
    await focus.request(ctx)
    expect(ctx.resumeCalls).toBe(0)
    expect(ctx.suspendCalls).toBe(0)
  })

  it('interrupted 로 끊긴 컨텍스트는 보이는 탭에서만 다시 깨운다', async () => {
    const focus = new AudioFocus()
    focus.unlock()
    const ctx = {
      state: 'interrupted',
      resume() {
        ctx.state = 'running'
        return Promise.resolve()
      },
      suspend() {
        ctx.state = 'suspended'
        return Promise.resolve()
      },
    }
    focus.setPageOn(false)
    await focus.request(ctx)
    expect(ctx.state).toBe('interrupted')
    focus.setPageOn(true)
    await focus.request(ctx)
    expect(ctx.state).toBe('running')
  })
})

describe('밀린 음표는 한꺼번에 나지 않는다', () => {
  it('스케줄러는 멈춘 동안 0박, 한참 뒤처져도 룩어헤드만 낸다', () => {
    expect(stepsInLookahead(0, 100, 0.05, false)).toBe(0)
    const stalled = stepsInLookahead(0, 100, 0.05, true)
    expect(stalled).toBeGreaterThan(0)
    expect(stalled).toBeLessThan(8)
    expect(stepsInLookahead(10, 10, 0.2, true)).toBe(2)
  })
})

describe('이미 나가던 총성과 차임', () => {
  it('보이스 풀을 비우면 라이브가 남지 않는다', () => {
    const pool = new VoicePool<string>(4)
    pool.add('a', 0, 2)
    pool.add('b', 0, 2)
    expect(pool.drain().sort()).toEqual(['a', 'b'])
    expect(pool.size).toBe(0)
  })

  it('cut 은 이미 시작한 총을 멈추고, 멈춘 컨텍스트에는 새 총을 예약하지 않는다', () => {
    const ctx = fakeCtx()
    ctx.state = 'running'
    const out = node()
    const gun = new GunSound(ctx as unknown as AudioContext, out as unknown as AudioNode)
    gun.play('tick')
    const started = ctx.sources.filter((s) => s.started)
    expect(started.length).toBe(1)
    gun.cut()
    expect(started[0].stopped).toBe(true)
    ctx.state = 'suspended'
    gun.play('tick')
    expect(ctx.sources.filter((s) => s.started).length).toBe(1)
    ctx.state = 'running'
    const next = node()
    gun.retarget(next as unknown as AudioNode)
    gun.play('tick')
    expect(ctx.sources.filter((s) => s.started).length).toBe(2)
  })

  it('차임은 돌아가는 컨텍스트에서만 예약된다', () => {
    const ctx = fakeCtx()
    const bus = node()
    playChime(ctx as unknown as AudioContext, bus as unknown as AudioNode, 'skill')
    expect(ctx.oscillators).toBe(0)
    ctx.state = 'running'
    playChime(ctx as unknown as AudioContext, bus as unknown as AudioNode, 'skill')
    expect(ctx.oscillators).toBeGreaterThan(0)
  })
})
