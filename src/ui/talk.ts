import { DIALOGUES, type Line } from '../data/dialogues'
import type { Action } from '../sim/types'

export interface TalkChoice {
  text: string
  actions?: Action[]
  /** Portal choices carry the zone to travel to. */
  go?: string
}

export interface TalkDef {
  lines: Line[]
  actions?: Action[]
  choices?: TalkChoice[]
}

export interface TalkStep {
  line: Line | null
  /** Actions to run once the last line is dismissed. */
  actions: Action[]
  /** Choices offered under the last line. */
  choices: TalkChoice[]
}

function lookup(def: string | TalkDef): TalkDef | undefined {
  return typeof def === 'string' ? DIALOGUES[def] : def
}

/** Pure walk through one dialogue: step 0 shows the first line; past the end returns null. */
export function talkStep(id: string | TalkDef, index: number): TalkStep {
  const def = lookup(id)
  if (!def) return { line: null, actions: [], choices: [] }
  const last = index === def.lines.length - 1
  if (index < def.lines.length) return { line: def.lines[index], actions: [], choices: last ? (def.choices ?? []) : [] }
  return { line: null, actions: def.actions ?? [], choices: [] }
}

/** Everything a finished dialogue does: its own actions first, then the picked choice's. */
export function finishActions(id: string | TalkDef, choice: TalkChoice | null): Action[] {
  return [...(lookup(id)?.actions ?? []), ...(choice?.actions ?? [])]
}

/** The 3D slice's dialogue box: speaker, painted portrait, line text and choices. */
export class TalkBox {
  private def: TalkDef | null = null
  private id: string | TalkDef = ''
  private index = 0
  private choices: TalkChoice[] = []
  private picked = 0
  private readonly box = document.getElementById('dialog')
  private readonly name = document.getElementById('dlg-name')
  private readonly text = document.getElementById('dlg-text')
  private readonly face = document.getElementById('dlg-face') as HTMLImageElement | null
  private readonly list = document.getElementById('dlg-choices')
  private readonly help = document.getElementById('dlg-help')

  constructor(
    private readonly base: string,
    /** Called once a dialogue ends with every action to run and the picked choice (if any). */
    private readonly done: (actions: Action[], choice: TalkChoice | null, id: string | TalkDef) => void,
  ) {
    window.addEventListener('keydown', (event) => {
      if (!this.choices.length) return
      const n = Number(event.key)
      if (n >= 1 && n <= this.choices.length) {
        event.preventDefault()
        this.pick(n - 1)
      } else if (event.code === 'ArrowDown' || event.code === 'KeyS') this.highlight(this.picked + 1)
      else if (event.code === 'ArrowUp' || event.code === 'KeyW') this.highlight(this.picked - 1)
    })
  }

  get open(): boolean {
    return this.def !== null
  }

  /** Waiting on a choice: movement keys steer the highlight instead of her feet. */
  get choosing(): boolean {
    return this.choices.length > 0
  }

  start(id: string | TalkDef): void {
    const def = lookup(id)
    if (!def) return
    this.id = id
    this.def = def
    this.index = 0
    this.show()
  }

  /** Next line; on a choice line, take the highlighted choice. */
  advance(): void {
    if (!this.def) return
    if (this.choices.length) {
      this.pick(this.picked)
      return
    }
    this.index += 1
    this.show()
  }

  close(): void {
    this.def = null
    this.choices = []
    this.box?.classList.add('hidden')
    document.body.classList.remove('talking')
    if (this.list) this.list.innerHTML = ''
  }

  private pick(i: number): void {
    const choice = this.choices[i] ?? null
    const id = this.id
    this.close()
    this.done(finishActions(id, choice), choice, id)
  }

  private highlight(i: number): void {
    if (!this.choices.length || !this.list) return
    this.picked = (i + this.choices.length) % this.choices.length
    this.list.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === this.picked))
  }

  private show(): void {
    const step = talkStep(this.id, this.index)
    if (!step.line) {
      const id = this.id
      this.close()
      this.done(finishActions(id, null), null, id)
      return
    }
    if (this.name) this.name.textContent = step.line.speaker
    if (this.text) this.text.textContent = step.line.text
    if (this.face) this.face.src = `${this.base}assets/${step.line.portrait}.png`
    this.choices = step.choices
    this.picked = 0
    if (this.list) {
      this.list.innerHTML = ''
      step.choices.forEach((choice, k) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = `${k + 1}. ${choice.text}`
        b.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
          event.preventDefault()
          this.pick(k)
        })
        this.list?.append(b)
      })
      this.highlight(0)
    }
    if (this.help) this.help.textContent = step.choices.length ? '숫자 · 위/아래 · E로 고르기' : 'E · Enter · 탭으로 넘기기'
    this.box?.classList.remove('hidden')
    document.body.classList.add('talking')
  }
}
