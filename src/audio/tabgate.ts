/**
 * Tab / app background gate for the Web Audio graph.
 *
 * Audible only while the document is the visible page: a hidden tab, a frozen mobile
 * page, and pagehide (older iOS and bfcache) all count as background. Suspend and resume
 * are serialized so a fast hide/show cannot finish in the wrong order. Resume runs only
 * after a user gesture has unlocked audio, which is what browsers allow.
 */

export interface PageDoc {
  visibilityState: string
  addEventListener(type: string, listener: () => void): void
}

export interface PageWin {
  addEventListener(type: string, listener: () => void, options?: { passive?: boolean }): void
}

export interface FocusCtx {
  state: string
  resume(): Promise<void>
  suspend(): Promise<void>
}

/** True only for a visible, unfrozen page that has not been sent to pagehide. */
export function pageAudible(input: { visibilityState: string; frozen: boolean; away: boolean }): boolean {
  return !input.frozen && !input.away && input.visibilityState === 'visible'
}

const watched = new WeakSet<object>()

/**
 * Install one set of page-lifecycle listeners. A second call on the same document is ignored
 * so a repeated start() cannot stack suspend/resume races.
 */
export function watchPage(doc: PageDoc, win: PageWin, onChange: (audible: boolean) => void): void {
  if (watched.has(doc)) return
  watched.add(doc)
  let frozen = false
  let away = false
  const emit = () => onChange(pageAudible({ visibilityState: doc.visibilityState, frozen, away }))
  doc.addEventListener('visibilitychange', () => {
    // Coming back to the foreground clears a pagehide that raced ahead of visibility.
    if (doc.visibilityState === 'visible') away = false
    emit()
  })
  doc.addEventListener('freeze', () => {
    frozen = true
    emit()
  })
  doc.addEventListener('resume', () => {
    frozen = false
    emit()
  })
  win.addEventListener('pagehide', () => {
    away = true
    emit()
  })
  win.addEventListener('pageshow', () => {
    away = false
    emit()
  })
  emit()
}

/** Serialized suspend/resume. Later visibility wins; a rejected resume stays suspended. */
export class AudioFocus {
  unlocked = false
  private audible = true
  private queued = false
  private tail: Promise<void> = Promise.resolve()

  get pageOn(): boolean {
    return this.audible
  }

  setPageOn(on: boolean): void {
    this.audible = on
  }

  unlock(): void {
    this.unlocked = true
  }

  /** Wait until the queued suspend/resume has finished. */
  settled(): Promise<void> {
    return this.tail
  }

  request(ctx: FocusCtx): Promise<void> {
    const wantRun = this.audible && this.unlocked && ctx.state !== 'closed'
    // Already there, and nothing is in flight: a held key must not stack resume calls.
    if (!this.queued && (ctx.state === 'running') === wantRun) return this.tail
    if (this.queued) return this.tail
    this.queued = true
    this.tail = this.tail.then(() => this.drain(ctx)).catch(() => {})
    return this.tail
  }

  private async drain(ctx: FocusCtx): Promise<void> {
    this.queued = false
    await this.transition(ctx)
    if (this.queued || ctx.state === 'closed') return
    const wantRun = this.audible && this.unlocked
    const running = ctx.state === 'running'
    // The browser finished the opposite transition (hide overlapped show). Correct once.
    if (wantRun !== running) await this.transition(ctx)
  }

  private async transition(ctx: FocusCtx): Promise<void> {
    try {
      if (!this.audible && ctx.state === 'running') {
        // It was sounding, so a gesture already happened — remember that for the return.
        this.unlocked = true
        await ctx.suspend()
      } else if (this.audible && this.unlocked && ctx.state !== 'running' && ctx.state !== 'closed') {
        await ctx.resume()
      }
    } catch {
      // Autoplay blocked the resume, or the context is gone. A later gesture retries.
    }
  }
}
